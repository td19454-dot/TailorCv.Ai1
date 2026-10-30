"""Which questions must never be answered by inference.

This is the server-side half of a rule that is enforced on both sides. The
extension classifies a field before it asks for a plan (so it can show the right
UI), and this module classifies it again when the plan request arrives — a
request that says `sensitive: false` about "Are you legally authorized to work in
the United States?" must not get an answer just because it asked nicely. The
client flag is OR'd with this one; it can only ever add caution.

The rule being protected is the one stated in auto_apply/profile.py's module
docstring: a fabricated answer to a work-authorization, sponsorship, salary or
EEO question is a false declaration filed under the user's name. In the server
engine that guarantee is structural because the narrative prompt physically
cannot produce those fields. Here it is structural for the same reason — a
sensitive field is removed from the prompt's field list, so the model is never
shown an index it could answer.

DUPLICATION IS DELIBERATE. chrome-extension/src/autofill/match.js carries the
same patterns for the client half. They are kept in sync by
test_match_guard.py::test_js_and_python_classifiers_agree, which runs both over
one shared corpus — if you add a pattern here, add it there.
"""

from __future__ import annotations

import re

from auto_apply.profile import question_signature

# (category, pattern) against the normalised signature. Order decides only which
# label the UI shows; every branch is equally locked.
SENSITIVE_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("sponsorship", re.compile(
        r"\bsponsor\w*|\bvisa\b|\bh1b\b|\bh 1b\b|\bwork permit\b|\bimmigration status\b"
        # OPT the work permit, not "opt in" / "opt out" (as match.js has it).
        r"|\bopt\b(?!\s+(?:in|out)\b)|\bcpt\b")),
    ("work_authorization", re.compile(
        r"\bright to work\b"
        r"|\bwork (authori\w*|eligib\w*|status)\b"
        r"|\bemployment eligib\w*"
        r"|\b(authori[sz]\w*|eligib\w*) to (work|be employed)\b"
        r"|\b(authori[sz]\w*|eligib\w*|legal\w*)\b[\s\S]*\b(work|employ\w*)\b")),
    ("citizenship", re.compile(
        r"\bcitizen\w*|\bnationality\b|\bpermanent resident\b|\bgreen card\b|\bpassports?\b")),
    # Date and place of birth: the profile's own answer or nothing, never the
    # model. After citizenship, so "citizen by birth" stays citizenship. Same as match.js.
    ("birth", re.compile(
        r"\b(date|country|territory|city|town|place|region|state|province) of birth\b"
        r"|\bbirth ?(date|day|place|country|city)\b|\bdob\b|\bborn\b")),
    ("clearance", re.compile(
        r"\bsecurity clearance\b|\bclearance level\b|\bpolygraph\b")),
    ("criminal", re.compile(
        r"\b(convict\w*|criminal|felony|misdemeanor|background check)\b")),
    # Anti-bribery declarations: "Are you (or any of your family members) a
    # Government Official?". Answered from the profile only. Ahead of
    # "government_employment", whose words their definitions share. Same as match.js.
    ("government_official", re.compile(
        r"\b(government|public|foreign) officials?\b"
        r"|\bofficials? (or employees? )?of (a|an|any|the) (government|public|foreign)\b"
        r"|\bpolitically exposed\b")),
    # Employment BY a government / the military / a state-owned enterprise: an
    # employment-history question, not military service. Ahead of "demographic"
    # so "served in the military" stays a veteran question. Same as match.js.
    ("government_employment", re.compile(
        r"\b(employ\w*|worked for|working for)\b[\s\S]*"
        r"\b(government|military|state owned|publicly funded|public sector|civil service)\b"
        r"|\b(government|military|state owned|public sector)\b[\s\S]*\bemploy\w*")),
    ("salary", re.compile(
        r"\b(salary|compensation|pay|wage|rate|ctc)\b[\s\S]*"
        r"\b(expect\w*|desir\w*|requir\w*|range|current|minimum)\b"
        r"|\b(expect\w*|desir\w*|current|minimum)\b[\s\S]*"
        r"\b(salary|compensation|pay|wage|rate|ctc)\b")),
    ("demographic", re.compile(
        r"\bgender\b|\bsex\b|\brac(e|ial)\b|\bethnic\w*|\bveteran\b|\bmilitary\b|\bdisab\w*"
        r"|\bpronoun\w*")),
    ("demographic", re.compile(
        r"\bhispanic\b|\blatino\b|\blgbtq?\b|\bsexual orientation\b|\btransgender\b"
        r"|\bneuro\s?diver\w*")),
    # Military service asked without the word "military" (Oracle's India form:
    # "Have you served in any of the below India Uniformed forces?").
    ("demographic", re.compile(
        r"\b(armed|uniformed|defen[cs]e) forces?\b|\bparamilitary\b")),
]

# Never filled from any source, and never stored either. Unlike the sensitive
# categories these are not even "ask the user in the sidebar" — the extension has
# no business touching them at all.
NEVER_FILL_PATTERNS: list[re.Pattern] = [
    re.compile(r"\bssn\b|\bsocial security\b|\bnational insurance\b|\btax id\b"
               r"|\bpan (card|number)\b|\baadhaar\b"),
    re.compile(r"\biban\b|\bswift\b|\bsort code\b|\bcvv\b|\bcredit card\b|\bcard number\b"),
    re.compile(r"\b(bank|routing|account) (number|no|details)\b"),
    re.compile(r"\bpassword\b|\bpasscode\b|\bone time (code|password)\b|\botp\b"),
    # Date of birth is the "birth" sensitive category now: profile answer only.
]

SECRET_VALUE_PATTERNS: list[re.Pattern] = [
    re.compile(r"^\d{3}-?\d{2}-?\d{4}$"),                 # US SSN
    re.compile(r"^(?:\d[ -]*?){13,19}$"),                 # card-shaped
    re.compile(r"^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$", re.IGNORECASE),   # IBAN
]


# An employer whose NAME is a sensitive word: on Visa's application "I agree
# that Visa may reach out to me via SMS" read as a visa question. The name is
# set aside before classifying, except in visa wording ("work Visa", "Visa
# sponsorship"). Mirrors match.js withoutEmployer — same rules, same result.
_EMPLOYER_SUFFIX_RE = re.compile(
    r"[\s,]+(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc)\.?$", re.I)
_VISA_WORDING_BEFORE_RE = re.compile(
    r"\b(work|h-?1b|student|employment|immigration|immigrant|nonimmigrant|tourist|business|"
    r"dependent|valid|current|sponsored|a|an|your|any|which|what|l-?1|o-?1|tn|e-?3|f-?1|j-?1|opt)\s*$",
    re.I)
_VISA_WORDING_AFTER_RE = re.compile(
    r"^\s*(sponsor\w*|status|type|holder|category|categories|transfer|requirement|support|"
    r"application|petition|stamp|expir\w*)", re.I)


def without_employer(label: str, employer: str | None) -> str:
    """`label` with the employer's name — when that name is itself sensitive —
    replaced by "the company"."""
    text = str(label or "")
    name = str(employer or "").strip()
    while _EMPLOYER_SUFFIX_RE.search(name):
        name = _EMPLOYER_SUFFIX_RE.sub("", name).strip()
    if not name or not classify_sensitive(name):
        return text

    def keep_or_mask(m: re.Match) -> str:
        word = m.group(0)
        # A name is written capitalised; "visa" in lower case is the document.
        if not word[:1].isupper():
            return word
        if _VISA_WORDING_BEFORE_RE.search(text[:m.start()]):
            return word
        if _VISA_WORDING_AFTER_RE.search(text[m.end():]):
            return word
        return "the company"

    return re.sub(r"\b" + re.escape(name) + r"\b", keep_or_mask, text, flags=re.I)


def classify_sensitive(label: str, employer: str | None = None) -> str | None:
    """The sensitive category this question falls into, or None. `employer`,
    when given, is the company the form belongs to — see without_employer.

    Errs toward flagging. A false positive costs the user one question they
    answer once and we remember forever; a false negative is a fabricated legal
    declaration. That asymmetry settles every borderline case.
    """
    sig = question_signature(without_employer(label, employer) if employer else label)
    if not sig:
        return None
    for category, pattern in SENSITIVE_PATTERNS:
        if pattern.search(sig):
            return category
    return None


def is_never_fill(label: str) -> bool:
    sig = question_signature(label)
    if not sig:
        return False
    return any(p.search(sig) for p in NEVER_FILL_PATTERNS)


def looks_secret(value: str) -> bool:
    v = str(value or "").strip()
    if not v:
        return False
    return any(p.match(v) for p in SECRET_VALUE_PATTERNS)


# Sensitive categories whose answer may be saved from a form the person answered
# themselves. There is no profile field for these — employers word them too
# differently for one stored value — so the person's own answer to that exact
# question is the only source. Reused for the SAME question only (exact
# signature, in the extension), never semantically recalled or shown to a model.
# Birth too: Region of Birth has no profile field, and its options are the
# regions of one country, so the person's answer to that exact question is kept.
# Demographic too: the profile answers these, but a wording the extension cannot
# place went back to the person on every form; their answer to that exact
# wording is kept, and used only after the profile. Same as match.js.
STORABLE_SENSITIVE = {"clearance", "criminal", "citizenship", "government_employment", "birth",
                      "government_official", "demographic"}


def is_never_store(question: str, answer: str) -> bool:
    """Whether this question/answer pair must be refused by the answer store.

    Checked server-side even though the extension filters the same cases, for the
    obvious reason: the filter that matters is the one an attacker cannot skip.
    Sensitive-but-answerable questions (work authorization, EEO) are excluded
    too — those belong in the user's profile as a single deliberate answer, not
    captured per-application from whatever they typed into one employer's form.
    Clearance and criminal history are the exception: see STORABLE_SENSITIVE.
    """
    if is_never_fill(question):
        return True
    if looks_secret(answer):
        return True
    category = classify_sensitive(question)
    if category and category not in STORABLE_SENSITIVE:
        return True
    return False
