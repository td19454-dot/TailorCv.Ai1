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
                "https://linkedin-profile-data4.p.rapidapi.com/profile",
                headers={
                    "x-rapidapi-host": "linkedin-profile-data4.p.rapidapi.com",
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
        payload_for_ai = profile_raw.get("data") if isinstance(profile_raw, dict) and isinstance(profile_raw.get("data"), (dict, list)) else profile_raw
        raw_for_ai = json.dumps(payload_for_ai, ensure_ascii=False, indent=2)
        parsed = _parse_cv_with_openai(api_key, raw_for_ai[:50000])
        if isinstance(parsed, dict):
            parsed.setdefault("linkedin_url", linkedin_url)
        return {"success": True, "data": parsed}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Could not structure profile data: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Server error: {exc}")
