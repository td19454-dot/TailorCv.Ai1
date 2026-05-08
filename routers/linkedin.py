import json
import os
import re
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from openai import OpenAI
from pydantic import BaseModel

router = APIRouter()


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
    return ""


def _extract_linkedin_fallback(profile_raw: dict, linkedin_url: str) -> dict:
    def score_profile_shape(node: dict) -> int:
        if not isinstance(node, dict):
            return -1
        score = 0
        keyset = {str(k).lower() for k in node.keys()}
        for hint in ("full_name", "fullname", "first_name", "firstname", "headline", "summary", "about", "experience", "experiences", "education", "skills"):
            if hint in keyset:
                score += 2
        if any(isinstance(node.get(k), list) for k in ("experience", "experiences", "education", "skills", "projects")):
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

    experience_raw = source.get("experiences") or source.get("experience") or []
    if not isinstance(experience_raw, list):
        experience_raw = []
    experience = []
    for exp in experience_raw:
        if not isinstance(exp, dict):
            continue
        start = _pick_first(exp, ["start_date", "startDate", "starts_at", "from"])
        end = _pick_first(exp, ["end_date", "endDate", "ends_at", "to"])
        if not end and bool(exp.get("is_current")):
            end = "Present"
        experience.append(
            {
                "title": _pick_first(exp, ["title", "position"]),
                "company": _pick_first(exp, ["company", "company_name", "companyName"]),
                "location": _pick_first(exp, ["location"]),
                "start_date": start,
                "end_date": end,
                "description": _pick_first(exp, ["description", "summary"]),
            }
        )
    experience = [e for e in experience if any(_to_text(v) for v in e.values())]

    education_raw = source.get("education") or source.get("educations") or []
    if not isinstance(education_raw, list):
        education_raw = []
    education = []
    for edu in education_raw:
        if not isinstance(edu, dict):
            continue
        education.append(
            {
                "degree": _pick_first(edu, ["degree"]),
                "institution": _pick_first(edu, ["institution", "school", "school_name", "schoolName"]),
                "field": _pick_first(edu, ["field", "field_of_study", "fieldOfStudy"]),
                "start_year": _pick_first(edu, ["start_year", "startYear"]),
                "end_year": _pick_first(edu, ["end_year", "endYear"]),
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


def _parse_cv_with_openai(api_key: str, raw_text: str) -> dict:
    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=2500,
        messages=[
            {
                "role": "system",
                "content": "You are a professional CV builder. Convert LinkedIn profile data into structured CV JSON. Return ONLY valid JSON, no markdown, no explanation, no code fences.",
            },
            {
                "role": "user",
                "content": f"""Convert this LinkedIn profile into a structured CV.
Return ONLY this exact JSON structure with real data filled in:
{{
  "full_name": "string",
  "headline": "string",
  "location": "string",
  "email": "",
  "phone": "",
  "summary": "string (professional summary from About + experience)",
  "experience": [{{"title":"","company":"","location":"","start_date":"","end_date":"","description":""}}],
  "education": [{{"degree":"","institution":"","field":"","start_year":"","end_year":""}}],
  "skills": [],
  "certifications": [{{"name":"","issuer":"","date":""}}],
  "languages": [],
  "projects": [{{"name":"","description":"","url":""}}]
}}

LinkedIn text:
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
        parsed = _parse_cv_with_openai(api_key, raw_text)
        return {"success": True, "data": parsed}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Could not parse response: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Server error: {exc}")


@router.post("/api/linkedin-import")
async def import_linkedin(body: LinkedInImportRequest):
    linkedin_url = (body.url or "").strip()
    if "linkedin.com/in/" not in linkedin_url:
        raise HTTPException(status_code=400, detail="Please enter a valid LinkedIn profile URL.")

    rapidapi_key = os.getenv("RAPIDAPI_KEY", "").strip()
    if not rapidapi_key:
        raise HTTPException(status_code=500, detail="RAPIDAPI_KEY is not configured.")

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured.")

    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            resp = await http.get(
                "https://linkedin-data-api.p.rapidapi.com/get-profile-data-by-url",
                headers={
                    "x-rapidapi-host": "linkedin-data-api.p.rapidapi.com",
                    "x-rapidapi-key": rapidapi_key,
                },
                params={"url": linkedin_url},
            )
            if resp.status_code == 404:
                raise HTTPException(status_code=404, detail="LinkedIn profile not found. Make sure it is set to Public.")
            if resp.status_code == 429:
                raise HTTPException(status_code=429, detail="Too many requests. Please try again shortly.")
            if resp.status_code == 401 or resp.status_code == 403:
                raise HTTPException(status_code=502, detail="RapidAPI authorization failed. Check RAPIDAPI_KEY/subscription.")
            resp.raise_for_status()
            profile_raw = resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Request timed out. Please try again.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch profile: {exc}")

    try:
        fallback = _extract_linkedin_fallback(profile_raw, linkedin_url)
        payload_for_ai = profile_raw.get("data") if isinstance(profile_raw, dict) and isinstance(profile_raw.get("data"), (dict, list)) else profile_raw
        raw_for_ai = json.dumps(payload_for_ai, ensure_ascii=False, indent=2)
        parsed = _parse_cv_with_openai(api_key, raw_for_ai[:50000])
        merged = _merge_ai_with_fallback(parsed, fallback)
        merged.setdefault("linkedin_url", linkedin_url)
        return {"success": True, "data": merged}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Could not structure profile data: {exc}")
    except HTTPException:
        raise
    except Exception as exc:
        fallback = _extract_linkedin_fallback(profile_raw, linkedin_url)
        if any(_to_text(fallback.get(k)) for k in ("full_name", "headline", "summary")) or any(
            isinstance(fallback.get(k), list) and len(fallback.get(k)) > 0 for k in ("experience", "education", "skills", "projects")
        ):
            return {"success": True, "data": fallback}
        raise HTTPException(status_code=500, detail=f"Server error: {exc}")
