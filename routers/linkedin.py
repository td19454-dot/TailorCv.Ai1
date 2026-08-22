import asyncio
import json
import os
import re
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from openai import AsyncOpenAI
from pydantic import BaseModel

router = APIRouter()


def _enforce_linkedin_quota(request: Request):
    """Login check + lifetime '1 free linkedin import' quota. Raises 401/402 as needed."""
    from database import SessionLocal
    from models import User, UsageRecord

    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not logged in")

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            raise HTTPException(status_code=401, detail="Not logged in")
        # Pro check — bypass quota. Goes through main.is_pro rather than
        # comparing pro_until directly: a stored value that is a string or is
        # timezone-aware raises on a raw ">", which 500s the request instead of
        # answering it, and a paying user is then refused.
        from main import is_pro as _is_pro
        if _is_pro(user):
            return
        # Beta rollout: only gate users in BILLING_BETA_USER_IDS
        _beta_env = os.getenv("BILLING_BETA_USER_IDS", "").strip()
        if _beta_env:
            _beta_ids = {int(x) for x in _beta_env.split(",") if x.strip().isdigit()}
            if user.id not in _beta_ids:
                return
        # Lifetime usage sum across all months
        used = (
            db.query(func.coalesce(func.sum(UsageRecord.linkedin_imports), 0))
            .filter(UsageRecord.user_id == user.id)
            .scalar() or 0
        )
        if used >= 1:
            raise HTTPException(
                status_code=402,
                detail={"error": "upgrade_required", "feature": "linkedin_imports"},
            )
        # Increment current month's counter
        month = datetime.utcnow().strftime("%Y-%m")
        rec = db.query(UsageRecord).filter_by(user_id=user.id, month=month).first()
        if not rec:
            rec = UsageRecord(user_id=user.id, month=month)
            db.add(rec)
            db.flush()
        rec.linkedin_imports = (rec.linkedin_imports or 0) + 1
        db.commit()
    finally:
        db.close()


class LinkedInParseRequest(BaseModel):
    text: str = ""


class LinkedInImportRequest(BaseModel):
    url: str


def _to_text(value) -> str:
    return "" if value is None else str(value).strip()


def _pick_first(payload: dict, keys: list[str]) -> str:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, dict):
            # Handle nested location-style objects: {"city":"...", "country":"..."}
            parts = [str(v).strip() for v in value.values() if v and str(v).strip()]
            if parts:
                return ", ".join(parts)
    return ""


def _format_period(start, end, is_current=False) -> tuple[str, str]:
    """Extract start/end date strings from either string or {year, month} dict."""
    def _period_str(raw) -> str:
        if not raw:
            return ""
        if isinstance(raw, str):
            return raw.strip()
        if isinstance(raw, dict):
            year = raw.get("year") or raw.get("Year") or ""
            month = raw.get("month") or raw.get("Month") or ""
            if year and month:
                return f"{month}/{year}"
            return str(year).strip() if year else ""
        return ""
    return _period_str(start), "Present" if is_current else _period_str(end)


def _extract_linkedin_fallback(profile_raw: dict, linkedin_url: str) -> dict:
    def score_profile_shape(node: dict) -> int:
        if not isinstance(node, dict):
            return -1
        score = 0
        keyset = {str(k).lower() for k in node.keys()}
        for hint in ("full_name", "fullname", "first_name", "firstname", "headline", "summary", "about", "experience", "experiences", "positions", "education", "educations", "skills"):
            if hint in keyset:
                score += 2
        if any(isinstance(node.get(k), list) for k in ("experience", "experiences", "positions", "education", "educations", "skills", "projects")):
            score += 3
        return score

    def best_profile_node(root: dict) -> dict:
        best = root if isinstance(root, dict) else {}
        best_score = score_profile_shape(best)
        stack = [root] if isinstance(root, dict) else []
        while stack:
            cur = stack.pop()
            if not isinstance(cur, dict):
                continue
            cur_score = score_profile_shape(cur)
            if cur_score > best_score:
                best = cur
                best_score = cur_score
            for value in cur.values():
                if isinstance(value, dict):
                    stack.append(value)
                elif isinstance(value, list):
                    for item in value:
                        if isinstance(item, dict):
                            stack.append(item)
        return best if isinstance(best, dict) else {}

    source_root = profile_raw if isinstance(profile_raw, dict) else {}
    source = best_profile_node(source_root)

    full_name = _pick_first(source, ["full_name", "fullName", "name"])
    first_name = _pick_first(source, ["first_name", "firstName"])
    last_name = _pick_first(source, ["last_name", "lastName"])
    if not full_name:
        full_name = f"{first_name} {last_name}".strip()

    headline = _pick_first(source, ["headline", "occupation", "title"])
    location = _pick_first(source, ["location", "city", "geo"])
    summary = _pick_first(source, ["summary", "about", "bio", "description"])
    email = _pick_first(source, ["email", "emailAddress"])
    phone = _pick_first(source, ["phone", "phoneNumber"])

    # LinkedIn API uses "positions" for work experience; also try "experiences"/"experience"
    experience_raw = (
        source.get("positions")
        or source.get("experiences")
        or source.get("experience")
        or []
    )
    if not isinstance(experience_raw, list):
        experience_raw = []
    experience = []
    for exp in experience_raw:
        if not isinstance(exp, dict):
            continue
        start_raw = exp.get("start") or exp.get("start_date") or exp.get("startDate") or exp.get("starts_at") or exp.get("from")
        end_raw = exp.get("end") or exp.get("end_date") or exp.get("endDate") or exp.get("ends_at") or exp.get("to")
        is_current = bool(exp.get("isCurrent") or exp.get("is_current"))
        start, end = _format_period(start_raw, end_raw, is_current)
        experience.append(
            {
                "title": _pick_first(exp, ["title", "position", "roleName"]),
                "company": _pick_first(exp, ["companyName", "company", "company_name", "organizationName"]),
                "location": _pick_first(exp, ["location", "locationName"]),
                "start_date": start,
                "end_date": end,
                "description": _pick_first(exp, ["description", "summary"]),
            }
        )
    experience = [e for e in experience if any(_to_text(v) for v in e.values())]

    education_raw = source.get("educations") or source.get("education") or []
    if not isinstance(education_raw, list):
        education_raw = []
    education = []
    for edu in education_raw:
        if not isinstance(edu, dict):
            continue
        start_raw = edu.get("start") or edu.get("start_year") or edu.get("startYear")
        end_raw = edu.get("end") or edu.get("end_year") or edu.get("endYear")
        start_yr, end_yr = _format_period(start_raw, end_raw)
        education.append(
            {
                "degree": _pick_first(edu, ["degree", "degreeName"]),
                "institution": _pick_first(edu, ["schoolName", "institution", "school", "school_name"]),
                "field": _pick_first(edu, ["fieldOfStudy", "field", "field_of_study"]),
                "start_year": start_yr or _pick_first(edu, ["start_year", "startYear"]),
                "end_year": end_yr or _pick_first(edu, ["end_year", "endYear"]),
            }
        )
    education = [e for e in education if any(_to_text(v) for v in e.values())]

    skills_raw = source.get("skills") or []
    skills = []
    if isinstance(skills_raw, list):
        for skill in skills_raw:
            if isinstance(skill, str) and skill.strip():
                skills.append(skill.strip())
            elif isinstance(skill, dict):
                name = _pick_first(skill, ["name", "skill"])
                if name:
                    skills.append(name)

    certs_raw = source.get("certifications") or []
    certifications = []
    if isinstance(certs_raw, list):
        for cert in certs_raw:
            if not isinstance(cert, dict):
                continue
            certifications.append(
                {
                    "name": _pick_first(cert, ["name", "title"]),
                    "issuer": _pick_first(cert, ["issuer", "organization", "authority"]),
                    "date": _pick_first(cert, ["date", "year"]),
                }
            )
    certifications = [c for c in certifications if any(_to_text(v) for v in c.values())]

    langs_raw = source.get("languages") or []
    languages = []
    if isinstance(langs_raw, list):
        for lang in langs_raw:
            if isinstance(lang, str) and lang.strip():
                languages.append(lang.strip())
            elif isinstance(lang, dict):
                name = _pick_first(lang, ["name", "language"])
                if name:
                    languages.append(name)

    projects_raw = source.get("projects") or []
    projects = []
    if isinstance(projects_raw, list):
        for proj in projects_raw:
            if not isinstance(proj, dict):
                continue
            projects.append(
                {
                    "name": _pick_first(proj, ["name", "title"]),
                    "description": _pick_first(proj, ["description", "summary"]),
                    "url": _pick_first(proj, ["url", "link"]),
                }
            )
    projects = [p for p in projects if any(_to_text(v) for v in p.values())]

    return {
        "full_name": full_name,
        "headline": headline,
        "location": location,
        "email": email,
        "phone": phone,
        "summary": summary,
        "experience": experience,
        "education": education,
        "skills": skills,
        "certifications": certifications,
        "languages": languages,
        "projects": projects,
        "linkedin_url": linkedin_url,
    }


def _merge_ai_with_fallback(ai_data: dict, fallback_data: dict) -> dict:
    if not isinstance(ai_data, dict):
        return fallback_data

    merged = dict(fallback_data)
    for key, fallback_value in fallback_data.items():
        ai_value = ai_data.get(key)
        if isinstance(fallback_value, list):
            merged[key] = ai_value if isinstance(ai_value, list) and len(ai_value) > 0 else fallback_value
        elif isinstance(fallback_value, str):
            merged[key] = ai_value if isinstance(ai_value, str) and ai_value.strip() else fallback_value
        else:
            merged[key] = ai_value if ai_value is not None else fallback_value

    for key, ai_value in ai_data.items():
        if key not in merged and ai_value is not None:
            merged[key] = ai_value

    return merged


def _extract_json_block(raw: str) -> str:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
        text = text.strip()
    return text


async def _parse_cv_with_openai(api_key: str, raw_text: str) -> dict:
    client = AsyncOpenAI(api_key=api_key)
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=3500,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": "You are a professional CV builder. Convert LinkedIn profile data into structured CV JSON. Return ONLY valid JSON matching the exact schema provided.",
            },
            {
                "role": "user",
                "content": f"""Convert this LinkedIn profile data into a structured CV.
Return ONLY this exact JSON schema with real values. Use empty string for missing fields, empty array [] for missing lists.

{{
  "full_name": "string",
  "headline": "string",
  "location": "string",
  "email": "string",
  "phone": "string",
  "summary": "string (write a professional 2-3 sentence summary based on the profile)",
  "experience": [{{"title":"string","company":"string","location":"string","start_date":"string","end_date":"string","description":"string"}}],
  "education": [{{"degree":"string","institution":"string","field":"string","start_year":"string","end_year":"string"}}],
  "skills": ["skill1","skill2"],
  "certifications": [{{"name":"string","issuer":"string","date":"string"}}],
  "languages": ["language1","language2"],
  "projects": [{{"name":"string","description":"string","url":"string"}}]
}}

LinkedIn data:
{raw_text}""",
            },
        ],
    )
    raw_json = _extract_json_block(response.choices[0].message.content if response.choices else "")
    return json.loads(raw_json)


def _linkedin_oauth_config() -> dict[str, str]:
    return {
        "client_id": os.getenv("LINKEDIN_CLIENT_ID", "").strip(),
        "client_secret": os.getenv("LINKEDIN_CLIENT_SECRET", "").strip(),
        "redirect_uri": os.getenv("LINKEDIN_REDIRECT_URI", "").strip(),
    }


def _is_linkedin_oauth_configured() -> bool:
    cfg = _linkedin_oauth_config()
    return bool(cfg["client_id"] and cfg["client_secret"] and cfg["redirect_uri"])


def _linked_in_profile_to_cv_schema(profile: dict) -> dict:
    full_name = str(profile.get("name", "")).strip()
    if not full_name:
        full_name = f"{str(profile.get('given_name', '')).strip()} {str(profile.get('family_name', '')).strip()}".strip()
    email = str(profile.get("email", "")).strip()
    linkedin_url = str(profile.get("profile_url", "")).strip()
    headline = str(profile.get("headline", "")).strip()
    location = str(profile.get("locale", "")).strip()
    summary = str(profile.get("summary", "")).strip()

    return {
        "full_name": full_name,
        "headline": headline,
        "location": location,
        "email": email,
        "phone": "",
        "summary": summary,
        "experience": [],
        "education": [],
        "skills": [],
        "certifications": [],
        "languages": [],
        "projects": [],
        "linkedin_url": linkedin_url,
    }


@router.get("/api/linkedin/oauth/status")
async def linkedin_oauth_status(request: Request):
    return {
        "configured": _is_linkedin_oauth_configured(),
        "connected": bool(request.session.get("linkedin_profile")),
    }


@router.get("/api/linkedin/oauth/start")
async def linkedin_oauth_start(request: Request, next: str = Query("/modify-cv")):
    if not _is_linkedin_oauth_configured():
        raise HTTPException(status_code=500, detail="LinkedIn OAuth is not configured.")

    safe_next = next if next.startswith("/") else "/modify-cv"
    state = secrets.token_urlsafe(24)
    request.session["linkedin_oauth_state"] = state
    request.session["linkedin_oauth_next"] = safe_next

    cfg = _linkedin_oauth_config()
    params = {
        "response_type": "code",
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"],
        "state": state,
        "scope": "openid profile email",
    }
    auth_url = f"https://www.linkedin.com/oauth/v2/authorization?{urlencode(params)}"
    return RedirectResponse(auth_url, status_code=302)


@router.get("/api/linkedin/oauth/callback")
async def linkedin_oauth_callback(request: Request, code: str = "", state: str = ""):
    stored_state = str(request.session.get("linkedin_oauth_state", "")).strip()
    if not code or not state or state != stored_state:
        raise HTTPException(status_code=400, detail="Invalid LinkedIn OAuth state.")

    if not _is_linkedin_oauth_configured():
        raise HTTPException(status_code=500, detail="LinkedIn OAuth is not configured.")

    cfg = _linkedin_oauth_config()
    next_path = str(request.session.get("linkedin_oauth_next", "/modify-cv")).strip() or "/modify-cv"
    request.session.pop("linkedin_oauth_state", None)
    request.session.pop("linkedin_oauth_next", None)

    async with httpx.AsyncClient(timeout=20.0) as http:
        token_res = await http.post(
            "https://www.linkedin.com/oauth/v2/accessToken",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": cfg["redirect_uri"],
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if token_res.status_code >= 400:
            raise HTTPException(status_code=500, detail="Failed to exchange LinkedIn authorization code.")
        token_payload = token_res.json()
        access_token = str(token_payload.get("access_token", "")).strip()
        if not access_token:
            raise HTTPException(status_code=500, detail="LinkedIn access token missing.")

        userinfo_res = await http.get(
            "https://api.linkedin.com/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if userinfo_res.status_code >= 400:
            raise HTTPException(status_code=500, detail="Failed to fetch LinkedIn user info.")
        userinfo = userinfo_res.json()

    profile = {
        "sub": str(userinfo.get("sub", "")).strip(),
        "name": str(userinfo.get("name", "")).strip(),
        "given_name": str(userinfo.get("given_name", "")).strip(),
        "family_name": str(userinfo.get("family_name", "")).strip(),
        "email": str(userinfo.get("email", "")).strip(),
        "email_verified": bool(userinfo.get("email_verified", False)),
        "locale": str(userinfo.get("locale", "")).strip(),
        "picture": str(userinfo.get("picture", "")).strip(),
        "profile_url": str(userinfo.get("profile", "")).strip(),
    }
    request.session["linkedin_profile"] = profile
    redirect_to = f"{next_path}{'&' if '?' in next_path else '?'}linkedin_oauth=success"
    return RedirectResponse(redirect_to, status_code=302)


@router.get("/api/linkedin/oauth/profile")
async def linkedin_oauth_profile(request: Request):
    profile = request.session.get("linkedin_profile")
    if not isinstance(profile, dict) or not profile:
        raise HTTPException(status_code=404, detail="No LinkedIn profile connected.")
    return {"success": True, "data": _linked_in_profile_to_cv_schema(profile), "raw": profile}


@router.post("/api/linkedin-parse")
async def parse_linkedin(body: LinkedInParseRequest):
    raw_text = (body.text or "").strip()
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured.")

    try:
        raw_text = raw_text[:20000]
        if len(raw_text) < 100:
            raise HTTPException(status_code=400, detail="Please paste more text from your LinkedIn profile.")
        parsed = await _parse_cv_with_openai(api_key, raw_text)
        return {"success": True, "data": parsed}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Could not parse response: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Server error: {exc}")


async def _fetch_linkedin_html_text(linkedin_url: str) -> str:
    """Fetch a public LinkedIn profile page, strip login-wall noise, return cleaned text."""
    _LOGIN_NOISE = {
        "sign in", "sign in with email", "sign in with google", "email or phone",
        "forgot password?", "new to linkedin?", "join now", "show", "password",
        "or", "by clicking continue to join or sign in, you agree to linkedin's",
        "user agreement", "privacy policy", "cookie policy", "continue",
        "get the linkedin app", "skip to main content",
    }
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Cache-Control": "no-cache",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers=headers) as http:
            resp = await http.get(linkedin_url)
            if resp.status_code != 200:
                return ""
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(resp.text, "html.parser")

            # og: meta tags are always present even behind login walls
            meta_prefix = ""
            og_title = soup.find("meta", property="og:title")
            og_desc = soup.find("meta", property="og:description")
            if og_title and og_title.get("content"):
                meta_prefix += f"Profile Title: {og_title['content']}\n"
            if og_desc and og_desc.get("content"):
                meta_prefix += f"Profile Summary: {og_desc['content']}\n\n"

            for tag in soup(["script", "style", "nav", "footer", "iframe", "noscript"]):
                tag.decompose()
            raw = soup.get_text(separator="\n", strip=True)
            low = raw.lower()

            # Deduplicate and strip login-form boilerplate when page is walled
            if "sign in to view" in low or "authwall" in low:
                seen: set[str] = set()
                filtered = []
                for line in raw.split("\n"):
                    s = line.strip()
                    if not s or s.lower() in _LOGIN_NOISE or s in seen:
                        continue
                    seen.add(s)
                    filtered.append(s)
                raw = "\n".join(filtered)

            combined = (meta_prefix + raw).strip()
            return combined[:40000] if len(combined) >= 80 else ""
    except Exception:
        return ""


async def _fetch_rapidapi_profile(linkedin_url: str, rapidapi_key: str, attempts: int = 3):
    """Fetch profile data from a RapidAPI LinkedIn data API, with retries on
    transient failures (429 / 5xx / timeout). Returns the parsed JSON, or raises
    HTTPException for definitive failures (404, not authorized).

    The provider is configurable so you can point at whichever live API you've
    subscribed to on RapidAPI (the previous default, linkedin-data-api, was shut
    down). Defaults to linkedin-api8, which uses the same `?url=` request shape.
    Override with env vars RAPIDAPI_LINKEDIN_HOST / RAPIDAPI_LINKEDIN_PATH /
    RAPIDAPI_LINKEDIN_PARAM if your chosen API differs."""
    host = os.getenv("RAPIDAPI_LINKEDIN_HOST", "fresh-linkedin-profile-data.p.rapidapi.com").strip()
    path = os.getenv("RAPIDAPI_LINKEDIN_PATH", "/get-linkedin-profile").strip()
    param = os.getenv("RAPIDAPI_LINKEDIN_PARAM", "linkedin_url").strip()
    endpoint = f"https://{host}{path if path.startswith('/') else '/' + path}"

    last_status = None
    for i in range(attempts):
        try:
            async with httpx.AsyncClient(timeout=25.0) as http:
                resp = await http.get(
                    endpoint,
                    headers={
                        "x-rapidapi-host": host,
                        "x-rapidapi-key": rapidapi_key,
                    },
                    params={param: linkedin_url},
                )
            if resp.status_code == 404:
                raise HTTPException(status_code=404, detail="LinkedIn profile not found. Make sure it is set to Public.")
            if resp.status_code in (401, 403):
                # Key not subscribed/authorized — definitive, don't retry.
                raise HTTPException(
                    status_code=422,
                    detail="Automatic LinkedIn import isn't available right now. Paste your profile text instead — it always works.",
                )
            if resp.status_code == 429 or resp.status_code >= 500:
                last_status = resp.status_code
                await asyncio.sleep(0.8 * (i + 1))
                continue
            resp.raise_for_status()
            return resp.json()
        except httpx.TimeoutException:
            last_status = "timeout"
            await asyncio.sleep(0.8 * (i + 1))
            continue
    # Exhausted retries on transient errors.
    raise HTTPException(status_code=503, detail="LinkedIn import is busy right now. Try again in a moment, or paste your profile text.")


@router.post("/api/linkedin-import")
async def import_linkedin(body: LinkedInImportRequest):
    linkedin_url = (body.url or "").strip()
    if "linkedin.com/in/" not in linkedin_url:
        raise HTTPException(status_code=400, detail="Please enter a valid LinkedIn profile URL.")

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured.")

    rapidapi_key = os.getenv("RAPIDAPI_KEY", "").strip()

    # ── Primary: RapidAPI profile data (the reliable source when subscribed) ──
    if rapidapi_key:
        profile_raw = None
        try:
            profile_raw = await _fetch_rapidapi_profile(linkedin_url, rapidapi_key)
        except HTTPException:
            profile_raw = None  # non-fatal — fall through to the HTML scrape
        except Exception:
            profile_raw = None

        service_down = isinstance(profile_raw, dict) and profile_raw.get("success") is False
        if profile_raw is not None and not service_down:
            try:
                fallback = _extract_linkedin_fallback(profile_raw, linkedin_url)
                payload_for_ai = (
                    profile_raw.get("data")
                    if isinstance(profile_raw, dict) and isinstance(profile_raw.get("data"), (dict, list))
                    else profile_raw
                )
                raw_for_ai = json.dumps(payload_for_ai, ensure_ascii=False, indent=2)
                parsed = await _parse_cv_with_openai(api_key, raw_for_ai[:50000])
                merged = _merge_ai_with_fallback(parsed, fallback)
                merged.setdefault("linkedin_url", linkedin_url)
                return {"success": True, "data": merged}
            except Exception:
                fb = _extract_linkedin_fallback(profile_raw, linkedin_url)
                if any(_to_text(fb.get(k)) for k in ("full_name", "headline", "summary")) or any(
                    isinstance(fb.get(k), list) and len(fb.get(k)) > 0
                    for k in ("experience", "education", "skills", "projects")
                ):
                    fb.setdefault("linkedin_url", linkedin_url)
                    return {"success": True, "data": fb}

    # ── Fallback: public HTML scrape + GPT (best-effort; LinkedIn often blocks) ──
    profile_text = await _fetch_linkedin_html_text(linkedin_url)
    if profile_text:
        try:
            parsed = await _parse_cv_with_openai(api_key, profile_text)
            parsed.setdefault("linkedin_url", linkedin_url)
            return {"success": True, "data": parsed}
        except Exception:
            pass

    raise HTTPException(
        status_code=422,
        detail="Couldn't fetch this profile automatically. Paste your LinkedIn profile text instead — that always works.",
    )
