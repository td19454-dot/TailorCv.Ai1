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
        r"|\bopt\b|\bcpt\b")),
    ("work_authorization", re.compile(
        r"\bright to work\b"
        r"|\bwork (authori\w*|eligib\w*|status)\b"
        r"|\bemployment eligib\w*"
        r"|\b(authori[sz]\w*|eligib\w*) to (work|be employed)\b"
        r"|\b(authori[sz]\w*|eligib\w*|legal\w*)\b[\s\S]*\b(work|employ\w*)\b")),
    ("citizenship", re.compile(
        r"\bcitizen\w*|\bnationality\b|\bpermanent resident\b|\bgreen card\b")),
    ("clearance", re.compile(
        r"\bsecurity clearance\b|\bclearance level\b|\bpolygraph\b")),
    ("criminal", re.compile(
        r"\b(convict\w*|criminal|felony|misdemeanor|background check)\b")),
    ("salary", re.compile(
        r"\b(salary|compensation|pay|wage|rate|ctc)\b[\s\S]*"
        r"\b(expect\w*|desir\w*|requir\w*|range|current|minimum)\b"
        r"|\b(expect\w*|desir\w*|current|minimum)\b[\s\S]*"
        r"\b(salary|compensation|pay|wage|rate|ctc)\b")),
    ("demographic", re.compile(
        r"\bgender\b|\brac(e|ial)\b|\bethnic\w*|\bveteran\b|\bmilitary\b|\bdisab\w*"
        r"|\bpronoun\w*")),
    ("demographic", re.compile(
        r"\bhispanic\b|\blatino\b|\blgbtq?\b|\bsexual orientation\b|\btransgender\b")),
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
    re.compile(r"\bdate of birth\b|\bbirth date\b|\bbirthdate\b|\bdob\b"),
]

SECRET_VALUE_PATTERNS: list[re.Pattern] = [
    re.compile(r"^\d{3}-?\d{2}-?\d{4}$"),                 # US SSN
    re.compile(r"^(?:\d[ -]*?){13,19}$"),                 # card-shaped
    re.compile(r"^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$", re.IGNORECASE),   # IBAN
]


def classify_sensitive(label: str) -> str | None:
    """The sensitive category this question falls into, or None.

    Errs toward flagging. A false positive costs the user one question they
    answer once and we remember forever; a false negative is a fabricated legal
    declaration. That asymmetry settles every borderline case.
    """
    sig = question_signature(label)
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


def is_never_store(question: str, answer: str) -> bool:
    """Whether this question/answer pair must be refused by the answer store.

    Checked server-side even though the extension filters the same cases, for the
    obvious reason: the filter that matters is the one an attacker cannot skip.
    Sensitive-but-answerable questions (work authorization, EEO) are excluded
    too — those belong in the user's profile as a single deliberate answer, not
    captured per-application from whatever they typed into one employer's form.
    """
    if is_never_fill(question):
        return True
    if looks_secret(answer):
        return True
    if classify_sensitive(question):
        return True
    return False
