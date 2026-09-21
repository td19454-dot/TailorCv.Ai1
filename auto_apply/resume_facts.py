"""Structured facts parsed out of the user's base resume, cached per user.

WHY: application forms routinely ask for university, degree, major, graduation
date, GPA, current/previous employer, and the separate parts of an address.
UserApplyProfile holds none of those — its `location` is a single free-text
string, and there is no education or employment history anywhere at user level.
The information is already on file as plain text in User.base_resume_text; it
just isn't structured. This module structures it once and caches the result in
UserResumeFacts.

WHY NOT _parse_cv_text_to_editor_data_ai (main.py): that parser's schema does
cover education and experience, but the function returns the *normalized editor
payload* rather than the strict parse, and the normalisation drops exactly the
fields needed here (field_of_study, separate start/end dates). Reusing it would
mean refactoring a working CV-editor code path for no gain, so this asks for the
smaller set of facts directly — which is also cheaper and more accurate than
re-deriving projects, publications and awards that no application form asks for.

WHAT IS AND ISN'T INFERRED: the LLM is asked only to *transcribe* what the
resume says, and the prompt forbids invention. Everything it returns is the
user's own claim about themselves, already written down by them. The two fields
it is NOT trusted with — GPA and the address components — are extracted
deterministically by regex, because a model asked for "the GPA" on a resume
without one will helpfully produce a plausible number, and a fabricated GPA is
the kind of thing that costs someone an offer.

These facts rank BELOW anything the user typed: build_applicant_profile layers
them under UserApplyProfile, and an answer the user gives to a specific question
(UserApplyQA) overrides them permanently.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re

logger = logging.getLogger(__name__)

# Bumped when the shape of facts_json changes incompatibly, so cached rows from
# an older shape are re-parsed rather than half-read.
FACTS_VERSION = 1

_MODEL = "gpt-4o-mini"
_MAX_RESUME_CHARS = 12000


def resume_text_hash(text: str) -> str:
    """The cache key. A hash of the text, not a path or a timestamp: both of
    those miss an in-place re-upload of a same-named file, and the parse is only
    valid for the exact text it saw."""
    return hashlib.sha256(str(text or "").encode("utf-8", "replace")).hexdigest()


_FACTS_PROMPT = """Extract factual details from this resume. Transcribe only — never infer,
never estimate, never fill a gap with something plausible.

RESUME:
{resume}

Return ONLY a JSON object of exactly this shape:
{{
  "personal_info": {{
    "full_name": "", "email": "", "phone": "", "location": "",
    "linkedin": "", "github": "", "portfolio": ""
  }},
  "education": [
    {{"institution": "", "degree": "", "field_of_study": "",
      "start_date": "", "end_date": "", "description": ""}}
  ],
  "work_history": [
    {{"company": "", "role": "", "location": "",
      "start_date": "", "end_date": "", "is_current": false}}
  ],
  "skills": []
}}

RULES:
- Use "" for anything the resume does not state. Never guess.
- Dates: copy the resume's own wording ("Jun 2024", "2021-2024", "Present").
- "field_of_study" is the major/branch/specialisation, separate from the degree
  name: "Bachelor of Technology" is the degree, "Computer Science" the field.
- "description" for an education entry: copy any line mentioning grades, GPA,
  CGPA, percentage or honours VERBATIM. Do not compute or normalise a score.
- Order education and work_history most recent first.
- "is_current" is true only where the resume says the role is ongoing
  ("Present", "Current"), never because it looks like the latest one.
- Do NOT output a GPA field. Do NOT split the location into parts. Those are
  handled outside this prompt.
"""


async def _llm_facts(resume_text: str) -> dict:
    from functions import get_resume_response

    prompt = _FACTS_PROMPT.format(resume=resume_text[:_MAX_RESUME_CHARS])
    raw = await get_resume_response(prompt, model=_MODEL, temperature=0)
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("resume facts parse returned a non-object")
    return data


# ── deterministic extraction (never the LLM's job) ────────────────────────

# "CGPA: 8.7/10", "GPA 3.9", "Percentage: 82%", "8.7 CGPA".
_GPA_RE = re.compile(
    r"\b(?:C?GPA|Grade\s*Point\s*Average|Percentage|Marks)\b\s*[:\-–]?\s*"
    r"(\d{1,3}(?:\.\d{1,2})?)\s*(?:/\s*(\d{1,2}(?:\.\d{1,2})?)|\s*%)?",
    re.IGNORECASE,
)
_GPA_SUFFIX_RE = re.compile(
    r"(\d{1,2}(?:\.\d{1,2})?)\s*(?:/\s*(\d{1,2}(?:\.\d{1,2})?))?\s*\b(?:C?GPA)\b",
    re.IGNORECASE,
)


def extract_gpa(education: list[dict], resume_text: str) -> str:
    """The GPA exactly as the resume states it, or "".

    Deliberately regex rather than part of the LLM prompt: asked for "the GPA",
    a model will produce a plausible number for a resume that never mentions
    one. Education descriptions are searched before the whole document so a
    project's "99.2% accuracy" cannot be mistaken for a grade.
    """
    haystacks = [str(e.get("description") or "") for e in (education or [])]
    haystacks.append(str(resume_text or ""))
    for text in haystacks:
        if not text.strip():
            continue
        for pattern in (_GPA_RE, _GPA_SUFFIX_RE):
            m = pattern.search(text)
            if not m:
                continue
            score, scale = m.group(1), m.group(2)
            try:
                value = float(score)
            except (TypeError, ValueError):
                continue
            if scale:
                return f"{score}/{scale}"
            # A bare number needs a sane range or it isn't a grade at all.
            if value <= 10:
                return score
            if value <= 100:
                return f"{score}%"
    return ""


# Matched against the last comma-separated part. A closed set, so this is the
# most reliable part to identify and therefore the first one removed.
_COUNTRIES = {
    "india", "united states", "united states of america", "usa", "u s a", "us",
    "canada", "united kingdom", "uk", "england", "scotland", "wales", "ireland",
    "australia", "new zealand", "germany", "france", "spain", "italy",
    "netherlands", "belgium", "sweden", "norway", "denmark", "finland",
    "poland", "portugal", "switzerland", "austria", "singapore", "japan",
    "china", "south korea", "brazil", "mexico", "argentina", "chile",
    "south africa", "nigeria", "kenya", "egypt", "israel", "uae",
    "united arab emirates", "saudi arabia", "qatar", "pakistan", "bangladesh",
    "sri lanka", "nepal", "philippines", "indonesia", "malaysia", "thailand",
    "vietnam", "remote",
}

_US_STATES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE",
    "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR",
    "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
    "district of columbia": "DC",
}
_US_STATE_CODES = set(_US_STATES.values())

_POSTAL_RE = re.compile(
    r"\b(\d{5}(?:-\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}|[A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{6})\b",
    re.IGNORECASE,
)


# Regions recognised by name. Used to decide whether the last remaining part is
# a state/province or a city — never to INFER one: a region is only ever taken
# from what the text actually says.
_INDIAN_STATES = {
    "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh", "goa",
    "gujarat", "haryana", "himachal pradesh", "jharkhand", "karnataka", "kerala",
    "madhya pradesh", "maharashtra", "manipur", "meghalaya", "mizoram", "nagaland",
    "odisha", "orissa", "punjab", "rajasthan", "sikkim", "tamil nadu", "telangana",
    "tripura", "uttar pradesh", "uttarakhand", "west bengal", "delhi", "new delhi",
    "jammu and kashmir", "ladakh", "puducherry", "chandigarh",
}
_CA_PROVINCES = {
    "ontario", "quebec", "british columbia", "alberta", "manitoba", "saskatchewan",
    "nova scotia", "new brunswick", "newfoundland and labrador", "prince edward island",
    "on", "qc", "bc", "ab", "mb", "sk", "ns", "nb", "nl", "pe",
}

# A part that is a street / house / building line rather than a place name: it
# starts with a house number ("36/F Sitalatala Lane", "221B Baker Street", "Flat
# 3B"), or names a thoroughfare or building. Resume headers routinely carry the
# full postal address, and the old splitter — built for "City, Region" — read
# "36/F Sitalatala Lane, Kolkata, 700011" as city "36/F Sitalatala Lane", region
# "Kolkata".
# Deliberately not "st", "dr" or "main": those appear inside real city names
# (St. Louis, St Albans, Frankfurt am Main), and a city read as a street loses
# the city entirely.
_STREET_WORDS = re.compile(
    r"\b(lane|ln|road|rd|street|avenue|ave|boulevard|blvd|drive|marg|sarani|gali|"
    r"sector|block|plot|flat|apt|apartment|suite|floor|house|building|bldg|tower|"
    r"society|enclave|layout)\b",
    re.IGNORECASE,
)


def _looks_like_street(part: str) -> bool:
    p = part.strip()
    if not p:
        return False
    if re.match(r"^(#\s*)?\d", p):          # starts with a house/flat number
        return True
    return bool(_STREET_WORDS.search(p))


def _is_region(part: str) -> bool:
    p = part.strip().lower()
    return (p in _US_STATES or p.upper() in _US_STATE_CODES
            or p in _INDIAN_STATES or p in _CA_PROVINCES)


def split_location(location: str) -> dict:
    """Split a free-text address into street / area / city / state / postal / country.

    Handles both shapes that turn up: a place ("Kolkata, West Bengal, India",
    "Austin, TX") and a full postal address ("36/F Sitalatala Lane, Kolkata,
    700011"). Done here rather than in the extension so there is one
    implementation, used by both the extension and the server engine.

    Anything not identified stays EMPTY rather than guessed — no country is
    inferred from a postcode, no state from a city. An empty field is surfaced
    to the user as "needs your answer"; a wrong city is submitted silently.
    """
    out = {"street": "", "area": "", "city": "", "state": "", "country": "",
           "postal_code": ""}
    raw = str(location or "").strip()
    if not raw:
        return out

    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if not parts:
        return out

    # Country first: a closed set, and removing it exposes the postal code,
    # which commonly sits on the part *before* it ("San Francisco, CA 94107, USA").
    if parts[-1].lower() in _COUNTRIES:
        out["country"] = parts[-1]
        parts = parts[:-1]
    if not parts:
        return out

    m = _POSTAL_RE.search(parts[-1])
    if m:
        out["postal_code"] = m.group(1)
        stripped = parts[-1].replace(m.group(0), "").strip().strip(",").strip(" -").strip()
        parts = parts[:-1] + [stripped] if stripped else parts[:-1]
    if not parts:
        return out

    # The street: the leading run of street-like parts. Never the LAST part — a
    # one-part address is a place, and the city has to come from somewhere.
    street = []
    while (len(parts) > 1 and _looks_like_street(parts[0])
           # ...and a city must be left over: "Sector 62, Uttar Pradesh" has no
           # city once the sector is taken, so the sector is the place.
           and not (len(parts) == 2 and _is_region(parts[1]))):
        street.append(parts.pop(0))
    out["street"] = ", ".join(street)

    if len(parts) >= 2 and _is_region(parts[-1]):
        # "…, Kolkata, West Bengal" / "…, Austin, TX": a recognised region.
        out["state"] = parts[-1]
        out["city"] = parts[-2]
        out["area"] = ", ".join(parts[:-2])
    elif street:
        # A postal address with no recognisable region: the last place name is
        # the city, and anything between it and the street is a locality
        # ("12 AB Road, Salt Lake, Kolkata" -> area "Salt Lake").
        out["city"] = parts[-1]
        out["area"] = ", ".join(parts[:-1])
    elif len(parts) >= 2:
        # A place with an unrecognised region ("Kolkata, Bengal", "Leeds,
        # Yorkshire"): City, Region is by far the common shape.
        out["state"] = parts[-1]
        out["city"] = ", ".join(parts[:-1])
    else:
        out["city"] = parts[0]
    return out


# Major Indian cities and the one state each belongs to. Deliberately curated,
# not exhaustive: a city name that exists in more than one state (Aurangabad is
# in Maharashtra AND Bihar) is left out, because a wrong state is worse than an
# empty one. Used to fill a form's "Region" / "State" when the address itself
# names only the city — "36/F Sitalatala Lane, Kolkata, 700011" never says
# West Bengal, but Kolkata is in no other state.
_INDIAN_CITY_STATE = {
    "kolkata": "West Bengal", "calcutta": "West Bengal", "howrah": "West Bengal",
    "durgapur": "West Bengal", "asansol": "West Bengal", "siliguri": "West Bengal",
    "mumbai": "Maharashtra", "bombay": "Maharashtra", "pune": "Maharashtra",
    "nagpur": "Maharashtra", "nashik": "Maharashtra", "thane": "Maharashtra",
    "navi mumbai": "Maharashtra",
    "bengaluru": "Karnataka", "bangalore": "Karnataka", "mysuru": "Karnataka",
    "mysore": "Karnataka", "mangaluru": "Karnataka", "mangalore": "Karnataka",
    "hubli": "Karnataka",
    "chennai": "Tamil Nadu", "madras": "Tamil Nadu", "coimbatore": "Tamil Nadu",
    "madurai": "Tamil Nadu",
    "hyderabad": "Telangana", "secunderabad": "Telangana", "warangal": "Telangana",
    "visakhapatnam": "Andhra Pradesh", "vijayawada": "Andhra Pradesh",
    "ahmedabad": "Gujarat", "surat": "Gujarat", "vadodara": "Gujarat", "rajkot": "Gujarat",
    "gandhinagar": "Gujarat",
    "jaipur": "Rajasthan", "jodhpur": "Rajasthan", "udaipur": "Rajasthan",
    "lucknow": "Uttar Pradesh", "kanpur": "Uttar Pradesh", "noida": "Uttar Pradesh",
    "greater noida": "Uttar Pradesh", "ghaziabad": "Uttar Pradesh",
    "varanasi": "Uttar Pradesh", "agra": "Uttar Pradesh",
    "gurgaon": "Haryana", "gurugram": "Haryana", "faridabad": "Haryana",
    "new delhi": "Delhi", "delhi": "Delhi",
    "chandigarh": "Chandigarh",
    "patna": "Bihar",
    "bhubaneswar": "Odisha", "cuttack": "Odisha",
    "kochi": "Kerala", "cochin": "Kerala", "thiruvananthapuram": "Kerala",
    "trivandrum": "Kerala", "kozhikode": "Kerala",
    "bhopal": "Madhya Pradesh", "indore": "Madhya Pradesh",
    "ranchi": "Jharkhand", "jamshedpur": "Jharkhand",
    "guwahati": "Assam",
    "dehradun": "Uttarakhand",
    "raipur": "Chhattisgarh",
    "panaji": "Goa",
}


def infer_state_country(city: str, country: str = "", postal_code: str = "",
                        phone: str = "") -> tuple[str, str]:
    """(state, country) for a known Indian city, or ("", "").

    Needs corroboration that the address is in India — the country saying so, a
    six-digit PIN, or a +91 phone — before anything is filled. A city name alone
    is not enough: Hyderabad is also in Pakistan, and "Delhi" is a town in
    several US states. Never overrides a country the text states as something
    other than India.
    """
    key = str(city or "").strip().lower()
    state = _INDIAN_CITY_STATE.get(key, "")
    if not state:
        return "", ""
    c = str(country or "").strip().lower()
    if c and c not in ("india", "in", "ind", "bharat"):
        return "", ""
    corroborated = (c in ("india", "in", "ind", "bharat")
                    or bool(re.fullmatch(r"\d{6}", str(postal_code or "").strip()))
                    or re.sub(r"[\s\-()]", "", str(phone or "")).startswith("+91"))
    if not corroborated:
        return "", ""
    return state, (country or "India")


def us_state_code(state: str) -> str:
    """The two-letter code for a US state name, or "" — many forms want the code."""
    s = str(state or "").strip()
    if not s:
        return ""
    if s.upper() in _US_STATE_CODES:
        return s.upper()
    return _US_STATES.get(s.lower(), "")


# ── assembly ──────────────────────────────────────────────────────────────

def _clean_str(value) -> str:
    return str(value or "").strip()


def _normalize(parsed: dict, resume_text: str) -> dict:
    """The stored shape. Tolerant of a partial parse — every key is optional and
    an absent one means "unknown", which is surfaced rather than filled in."""
    pi = parsed.get("personal_info") if isinstance(parsed.get("personal_info"), dict) else {}

    education = []
    for e in (parsed.get("education") or [])[:8]:
        if not isinstance(e, dict):
            continue
        entry = {
            "institution": _clean_str(e.get("institution")),
            "degree": _clean_str(e.get("degree")),
            "field_of_study": _clean_str(e.get("field_of_study")),
            "start_date": _clean_str(e.get("start_date")),
            "end_date": _clean_str(e.get("end_date")),
            "description": _clean_str(e.get("description")),
        }
        if any(entry.values()):
            education.append(entry)

    work = []
    for w in (parsed.get("work_history") or [])[:12]:
        if not isinstance(w, dict):
            continue
        entry = {
            "company": _clean_str(w.get("company")),
            "role": _clean_str(w.get("role")),
            "location": _clean_str(w.get("location")),
            "start_date": _clean_str(w.get("start_date")),
            "end_date": _clean_str(w.get("end_date")),
            "is_current": bool(w.get("is_current")),
        }
        if any(v for k, v in entry.items() if k != "is_current"):
            work.append(entry)

    skills = [_clean_str(s) for s in (parsed.get("skills") or []) if _clean_str(s)][:40]
    location = _clean_str(pi.get("location"))

    return {
        "version": FACTS_VERSION,
        "personal_info": {
            "full_name": _clean_str(pi.get("full_name")),
            "email": _clean_str(pi.get("email")),
            "phone": _clean_str(pi.get("phone")),
            "location": location,
            "linkedin": _clean_str(pi.get("linkedin")),
            "github": _clean_str(pi.get("github")),
            "portfolio": _clean_str(pi.get("portfolio")),
        },
        "address": split_location(location),
        "education": education,
        "work_history": work,
        "gpa": extract_gpa(education, resume_text),
        "skills": skills,
    }


def empty_facts() -> dict:
    """The shape every consumer can rely on, with nothing known. Returned rather
    than None so callers never have to distinguish "no resume" from "parse
    failed" — both mean the same thing downstream: these fields are unknown and
    will be asked of the user."""
    return _normalize({}, "")


async def build_resume_facts(resume_text: str) -> dict:
    """Parse resume text into the stored facts shape. Never raises."""
    text = str(resume_text or "").strip()
    if not text:
        return empty_facts()
    try:
        parsed = await _llm_facts(text)
    except Exception:
        logger.exception("resume facts parse failed; continuing without them")
        return empty_facts()
    return _normalize(parsed, text)


# ── persistence ───────────────────────────────────────────────────────────

def load_cached_facts(db, user) -> dict | None:
    """The cached facts for this user if they match the current resume, else None."""
    from models import UserResumeFacts

    text = getattr(user, "base_resume_text", "") or ""
    if not text.strip():
        return None
    row = db.query(UserResumeFacts).filter(UserResumeFacts.user_id == user.id).first()
    if not row:
        return None
    if row.resume_text_hash != resume_text_hash(text):
        return None
    try:
        facts = json.loads(row.facts_json)
    except Exception:
        logger.warning("user %s has unreadable cached resume facts; re-parsing", user.id)
        return None
    if not isinstance(facts, dict) or facts.get("version") != FACTS_VERSION:
        return None
    return facts


def store_facts(db, user, facts: dict) -> None:
    from models import UserResumeFacts

    text = getattr(user, "base_resume_text", "") or ""
    row = db.query(UserResumeFacts).filter(UserResumeFacts.user_id == user.id).first()
    if not row:
        row = UserResumeFacts(user_id=user.id)
        db.add(row)
    row.facts_json = json.dumps(facts, ensure_ascii=False)
    row.resume_text_hash = resume_text_hash(text)
    row.source_resume_path = getattr(user, "base_resume_path", "") or ""
    row.model = _MODEL
    db.commit()


def invalidate_facts(db, user_id: int) -> None:
    """Drop a user's cached facts. Called when the base resume changes.

    Delete rather than re-parse: the upload path must not grow an LLM call for
    something that may never be needed. The next /apply-context re-parses.
    """
    from models import UserResumeFacts

    try:
        db.query(UserResumeFacts).filter(UserResumeFacts.user_id == user_id).delete()
        db.commit()
    except Exception:
        logger.warning("could not invalidate resume facts for user %s", user_id, exc_info=True)
        db.rollback()


# ── flat answer keys ──────────────────────────────────────────────────────

def facts_answer_keys(facts: dict) -> dict:
    """The flat label -> value pairs these facts contribute to the answer bank.

    Only the single most relevant entry of each list becomes a flat key (most
    recent education, current employer), because a form asking "University" has
    one box. The full lists travel separately for forms with repeaters.
    """
    if not isinstance(facts, dict):
        return {}
    edu = (facts.get("education") or [{}])[0] if facts.get("education") else {}
    work = facts.get("work_history") or []
    current = next((w for w in work if w.get("is_current")), work[0] if work else {})
    previous = next((w for w in work if w is not current), {})
    addr = facts.get("address") or {}
    pi = facts.get("personal_info") or {}

    out = {
        "university": edu.get("institution", ""),
        "degree": edu.get("degree", ""),
        "major": edu.get("field_of_study", ""),
        "graduation_date": edu.get("end_date", ""),
        "gpa": facts.get("gpa", ""),
        "current_company": current.get("company", ""),
        "previous_company": previous.get("company", ""),
        "address": pi.get("location", ""),
        "address_city": addr.get("city", ""),
        "address_state": addr.get("state", ""),
        "address_state_code": us_state_code(addr.get("state", "")),
        "address_country": addr.get("country", ""),
        "postal_code": addr.get("postal_code", ""),
    }
    return {k: v for k, v in out.items() if str(v).strip()}
