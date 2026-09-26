"""Deterministic graders for the resume-tailoring pipeline.

No LLM judge anywhere in this file. Every metric is regex/counting logic, so a
score is reproducible: the same tailored JSON always grades identically. That
matters because the whole point of the harness is to compare two models, and a
grader that itself drifts would make the comparison meaningless.

The graders reuse the production primitives from functions.py wherever one
already exists (_extract_hard_skills_from_jd, _contains_skill,
factcheck_against_original, compute_skill_match_score_structured). Grading with
the same code the product ships with means a metric moving here is a metric that
actually moved for the user.

Two snapshots of the resume get graded, and the difference between them is the
point:
  * `raw`   - straight out of the model, before post-processing. Measures the
              MODEL, and is the only place Rule01 compliance can be observed at
              all (inject_jd_hard_skills rewrites the skills array afterwards,
              which would mask whether the model obeyed).
  * `final` - after the full post-processing chain. Measures the PRODUCT.
"""

from __future__ import annotations

import json
import re

import functions
from functions import (
    _balance_parentheses,
    _contains_skill,
    _extract_hard_skills_from_jd,
    compute_skill_match_score_structured,
    factcheck_against_original,
)

# Mirrors the "Strong action verbs" list the ATS prompt uses (functions.py:2229).
# Duplicated as data because the production copy lives inside an f-string prompt
# and cannot be imported. If that list changes, change this one too.
STRONG_VERBS = {
    "developed", "built", "implemented", "designed", "engineered", "created",
    "led", "optimized", "automated", "managed", "analyzed", "delivered",
    "reduced", "increased", "generated", "architected", "deployed", "migrated",
    "produced", "directed", "established",
}

# The corresponding "Weak verbs" list from the same prompt block.
WEAK_OPENERS = (
    "worked on", "helped", "assisted", "participated", "responsible for",
    "involved in", "contributed to",
)

_URL_RE = re.compile(r"https?://[^\s,)\]}>\"']+|(?:www\.|github\.com/|linkedin\.com/)[^\s,)\]}>\"']+", re.I)
_PRONOUN_RE = re.compile(r"\b(I|my|me|mine)\b")
_WORD_RE = re.compile(r"[A-Za-z0-9+#./-]+")

# A bullet longer than this reads as a paragraph and stops being skimmable.
LONG_BULLET_WORDS = 35
# More than this many distinct JD skills in one sentence is keyword stuffing,
# which the prompt explicitly forbids ("a bullet crammed with keywords reads as
# fake to a human and adds nothing for an ATS").
STUFFING_SKILLS_PER_BULLET = 2


def _entries(data: dict, key: str) -> list[dict]:
    return [e for e in (data.get(key) or []) if isinstance(e, dict)]


def collect_bullets(data: dict) -> list[str]:
    """Every bullet in the resume, across the sections that carry them."""
    out: list[str] = []
    for key in ("experience", "projects", "extracurriculars"):
        for entry in _entries(data, key):
            out.extend(str(b).strip() for b in (entry.get("bullets") or []) if str(b).strip())
    return out


def _pct(part: int, whole: int) -> float:
    return round(part / whole * 100, 1) if whole else 0.0


# --------------------------------------------------------------------------
# 1. Schema validity
# --------------------------------------------------------------------------

def grade_schema(data: dict) -> dict:
    """Structural soundness. A malformed payload breaks the renderer, so this
    gates everything else - a model that scores well on wording but returns a
    bullets list containing dicts is not usable."""
    problems: list[str] = []
    if not isinstance(data, dict):
        return {"valid": False, "problems": ["top level is not an object"], "score": 0.0}

    if not str(data.get("name") or "").strip():
        problems.append("missing name")
    if not isinstance(data.get("contact"), dict):
        problems.append("contact is not an object")
    if not isinstance(data.get("skills"), list):
        problems.append("skills is not a list")

    for key in ("experience", "projects", "education", "certifications", "publications", "extracurriculars"):
        value = data.get(key)
        if value is None:
            continue
        if not isinstance(value, list):
            problems.append(f"{key} is not a list")
            continue
        for i, entry in enumerate(value):
            if not isinstance(entry, dict):
                problems.append(f"{key}[{i}] is not an object")
                continue
            bullets = entry.get("bullets")
            if bullets is not None and not isinstance(bullets, list):
                problems.append(f"{key}[{i}].bullets is not a list")
            elif isinstance(bullets, list):
                for j, b in enumerate(bullets):
                    if not isinstance(b, str):
                        problems.append(f"{key}[{i}].bullets[{j}] is {type(b).__name__}, not str")

    return {
        "valid": not problems,
        "problems": problems[:10],
        "score": 100.0 if not problems else max(0.0, 100.0 - 20.0 * len(problems)),
    }


# --------------------------------------------------------------------------
# 2. Content preservation
# --------------------------------------------------------------------------

def grade_preservation(data: dict, meta: dict) -> dict:
    """Did the rewrite silently drop entries?

    The single most damaging failure mode in this pipeline: a candidate uploads
    5 jobs and 20 certifications and gets back 3 and 6, with no warning. The
    prompt devotes a whole MANDATORY block to it and restore_dropped_bullets()
    exists purely to repair it, which is evidence it happens.

    Ground truth comes from the fixture's meta.json, so this measures against
    what the resume actually contains rather than against another model's guess.
    """
    expected = meta.get("expected_counts") or {}
    counts: dict[str, dict] = {}
    missing_total = 0
    expected_total = 0

    for key, want in expected.items():
        got = len(_entries(data, key)) if key != "achievements" else len(data.get("achievements") or [])
        counts[key] = {"expected": want, "got": got, "dropped": max(0, want - got)}
        expected_total += want
        missing_total += max(0, want - got)

    # Named entries that vanished entirely - more actionable than a bare count.
    blob = json.dumps(data, ensure_ascii=False).lower()
    dropped_names = [n for n in (meta.get("expected_entry_names") or []) if n.lower() not in blob]

    # Bullets are counted but not scored against a target: a good rewrite may
    # legitimately merge two fragments. A collapse is caught by entry counts.
    bullet_count = len(collect_bullets(data))

    score = _pct(expected_total - missing_total, expected_total) if expected_total else 100.0
    if dropped_names:
        score = min(score, _pct(len(meta.get("expected_entry_names") or []) - len(dropped_names),
                                len(meta.get("expected_entry_names") or [])))

    return {
        "counts": counts,
        "entries_expected": expected_total,
        "entries_dropped": missing_total,
        "dropped_names": dropped_names,
        "bullet_count": bullet_count,
        "score": round(score, 1),
    }


# --------------------------------------------------------------------------
# 3. Fabrication
# --------------------------------------------------------------------------

def grade_fabrication(data: dict, resume_text: str) -> dict:
    """Facts in the output that the original resume never contained.

    Reuses the shipped factcheck_against_original() so this measures exactly
    what the product would flag. Any finding is serious: an invented number is
    the one error a candidate cannot talk their way out of in an interview.
    """
    checked = factcheck_against_original(dict(data), resume_text)
    findings = (checked.get("factcheck") or {}).get("findings") or []

    by_type: dict[str, int] = {}
    for f in findings:
        by_type[f.get("type", "unknown")] = by_type.get(f.get("type", "unknown"), 0) + 1

    # Company/school/degree inventions are categorically worse than a stray
    # number, so they cost more.
    weights = {"company": 40, "school": 40, "degree": 25, "year": 15, "number": 10}
    penalty = sum(weights.get(f.get("type", ""), 10) for f in findings)

    return {
        "clean": not findings,
        "finding_count": len(findings),
        "by_type": by_type,
        "examples": findings[:8],
        "score": round(max(0.0, 100.0 - penalty), 1),
    }


# --------------------------------------------------------------------------
# 4. Skill gating (Rule01 compliance)
# --------------------------------------------------------------------------

def grade_skill_gating(raw: dict, resume_text: str, jd_text: str, meta: dict) -> dict:
    """Did the MODEL put JD skills into `skills` that the resume never evidences?

    Must run on the raw pre-injection output. inject_jd_hard_skills() rebuilds
    the skills array from evidence afterwards, so grading the final payload
    would always look perfect and would tell you nothing about whether a
    stronger model actually follows the rule on its own.

    A model that needs the post-processor to save it is a model that will also
    be inventing evidence in the bullets, where no post-processor is watching.
    """
    jd_skills = _extract_hard_skills_from_jd(jd_text)
    skills_text = " ".join(str(s) for s in (raw.get("skills") or []) if s)

    violations = [
        s for s in jd_skills
        if _contains_skill(skills_text, s) and not _contains_skill(resume_text, s)
    ]

    # Fixture-declared ground truth: skills the JD asks for that this resume
    # genuinely lacks. Catching these is the sharpest version of the test.
    declared = meta.get("unevidenced_jd_skills") or []
    declared_leaked = [s for s in declared if _contains_skill(skills_text, s)]

    # Rule01b: skills entries must be named technologies, not phrases.
    phrase_entries = [
        str(s) for s in (raw.get("skills") or [])
        if len(_WORD_RE.findall(str(s))) > 3
    ]

    total_checks = max(1, len(jd_skills))
    score = _pct(total_checks - len(violations), total_checks)
    if declared_leaked:
        score = min(score, _pct(len(declared) - len(declared_leaked), max(1, len(declared))))
    score -= 5 * len(phrase_entries)

    return {
        "jd_skills_total": len(jd_skills),
        "unevidenced_in_skills": violations,
        "declared_gaps_leaked": declared_leaked,
        "phrase_not_technology": phrase_entries[:8],
        "score": round(max(0.0, min(100.0, score)), 1),
    }


# --------------------------------------------------------------------------
# 5. Evidence coverage
# --------------------------------------------------------------------------

def grade_evidence(final: dict, jd_text: str) -> dict:
    """How much of the JD is demonstrated in bullets, not just listed.

    `bullets_pct` is the number that matters. The skills array is force-injected
    downstream so its coverage is near-100 by construction; only the bullets
    reflect whether the rewrite actually surfaced the candidate's evidence in
    the JD's vocabulary - which is the entire product thesis.
    """
    result = compute_skill_match_score_structured(final, jd_text)
    return {
        "match_score": result.get("score"),
        "skills_section_pct": result.get("skills_section_pct"),
        "bullets_pct": result.get("bullets_pct"),
        "missing": result.get("missing") or [],
        "score": float(result.get("bullets_pct") or 0),
    }


# --------------------------------------------------------------------------
# 6. Bullet quality
# --------------------------------------------------------------------------

def grade_bullets(final: dict, jd_text: str) -> dict:
    """Action-oriented, quantified, single-idea bullets - and no keyword stuffing."""
    bullets = collect_bullets(final)
    if not bullets:
        return {"bullet_count": 0, "score": 0.0, "note": "no bullets"}

    jd_skills = _extract_hard_skills_from_jd(jd_text)

    strong = weak = quantified = overlong = stuffed = 0
    word_total = 0
    stuffed_examples: list[str] = []

    for b in bullets:
        words = _WORD_RE.findall(b)
        word_total += len(words)
        first = (words[0].lower() if words else "")
        low = b.lower()

        if first in STRONG_VERBS:
            strong += 1
        if low.startswith(WEAK_OPENERS):
            weak += 1
        if any(ch.isdigit() for ch in b):
            quantified += 1
        if len(words) > LONG_BULLET_WORDS:
            overlong += 1

        hits = sum(1 for s in jd_skills if _contains_skill(b, s))
        if hits > STUFFING_SKILLS_PER_BULLET:
            stuffed += 1
            if len(stuffed_examples) < 3:
                stuffed_examples.append(b)

    n = len(bullets)
    strong_pct = _pct(strong, n)
    quant_pct = _pct(quantified, n)
    overlong_pct = _pct(overlong, n)
    stuffed_pct = _pct(stuffed, n)

    # Weighted so stuffing and padding actively cost points rather than merely
    # failing to earn them - the failure mode this product is trying to avoid.
    score = (0.45 * strong_pct) + (0.30 * quant_pct) + (0.25 * (100 - overlong_pct)) - stuffed_pct

    return {
        "bullet_count": n,
        "avg_words": round(word_total / n, 1),
        "strong_verb_pct": strong_pct,
        "weak_opener_count": weak,
        "quantified_pct": quant_pct,
        "overlong_pct": overlong_pct,
        "keyword_stuffed_pct": stuffed_pct,
        "stuffed_examples": stuffed_examples,
        "score": round(max(0.0, min(100.0, score)), 1),
    }


# --------------------------------------------------------------------------
# 7. Link preservation
# --------------------------------------------------------------------------

def grade_links(final: dict, resume_text: str) -> dict:
    """URLs present in the original that survived into the output.

    Graded on the final payload because link recovery is explicitly a
    post-processing job (inject_links + the PDF-annotation passes), so the model
    losing a URL is recoverable. Persistent loss here still means the recovery
    chain has a hole.
    """
    originals = {u.rstrip(".,);").lower() for u in _URL_RE.findall(resume_text)}
    if not originals:
        return {"original_urls": 0, "preserved": 0, "lost": [], "score": 100.0}

    blob = json.dumps(final, ensure_ascii=False).lower()
    lost = [u for u in sorted(originals) if u not in blob]
    kept = len(originals) - len(lost)

    return {
        "original_urls": len(originals),
        "preserved": kept,
        "lost": lost[:8],
        "score": _pct(kept, len(originals)),
    }


# --------------------------------------------------------------------------
# 8. Cleanliness
# --------------------------------------------------------------------------

def grade_cleanliness(final: dict) -> dict:
    """Artifacts that make output look machine-generated to a human reader."""
    bullets = collect_bullets(final)
    summary = str(final.get("summary") or "")
    texts = bullets + [summary]

    leading_marker = [b for b in bullets if b[:1] in functions._BULLET_CHARS]
    unbalanced = [t for t in texts if t and _balance_parentheses(t) != t]
    pronouns = [t for t in texts if _PRONOUN_RE.search(t)]

    issues = len(leading_marker) + len(unbalanced) + len(pronouns)
    return {
        "leading_bullet_chars": len(leading_marker),
        "unbalanced_parens": len(unbalanced),
        "pronoun_usages": len(pronouns),
        "examples": (leading_marker + unbalanced + pronouns)[:5],
        "score": round(max(0.0, 100.0 - 10.0 * issues), 1),
    }


# --------------------------------------------------------------------------
# 9. Summary quality (Rule 00)
# --------------------------------------------------------------------------

def grade_summary(final: dict, jd_text: str) -> dict:
    """Is the professional summary a positioning paragraph or a compressed JD?

    Reuses the production validator rather than reimplementing the rules, so a
    score moving here is a score that moved for the user. Every failure mode is
    decidable from the text (banned filler, hedging, JD-echo, trailing domain
    tag, keyword padding, pronouns, sentence count) - no LLM judge, consistent
    with the rest of this file.
    """
    summary = str(final.get("summary") or "").strip()
    if not summary:
        return {"issues": ["empty"], "sentences": 0, "examples": [], "score": 0.0}

    issues = functions._summary_quality_issues(summary, jd_text)
    sentences = functions._summary_sentences(summary)
    return {
        "issues": issues,
        "sentences": len(sentences),
        "examples": issues[:5],
        "score": round(max(0.0, 100.0 - 15.0 * len(issues)), 1),
    }


# --------------------------------------------------------------------------
# Composite
# --------------------------------------------------------------------------

# Weights encode what this product promises, in order: never lie, never lose
# the candidate's work, never claim an unbacked skill. Wording quality matters
# but is worth less than trustworthiness - a beautifully written resume with an
# invented employer is a worse product than a plain honest one.
#
# `summary` earns its 0.07 from `bullets` (0.15 -> 0.10) and `cleanliness`
# (0.03 -> 0.01): the summary is the most-read line on the resume and was
# previously unmeasured, while cleanliness counts cosmetic artifacts. The
# trustworthiness weights (fabrication, preservation) are deliberately untouched.
WEIGHTS = {
    "fabrication": 0.25,
    "preservation": 0.20,
    "skill_gating": 0.15,
    "evidence": 0.15,
    "bullets": 0.10,
    "summary": 0.07,
    "links": 0.05,
    "cleanliness": 0.01,
    "schema": 0.02,
}


def grade_all(raw: dict, final: dict, resume_text: str, jd_text: str, meta: dict) -> dict:
    """Run every grader and fold the sub-scores into one comparable number.

    The composite exists to rank models. The sub-scores are the actual signal -
    read those before believing the total, because two models can tie overall
    while failing in completely different places.
    """
    parts = {
        "schema": grade_schema(final),
        "preservation": grade_preservation(final, meta),
        "fabrication": grade_fabrication(final, resume_text),
        "skill_gating": grade_skill_gating(raw, resume_text, jd_text, meta),
        "evidence": grade_evidence(final, jd_text),
        "bullets": grade_bullets(final, jd_text),
        "summary": grade_summary(final, jd_text),
        "links": grade_links(final, resume_text),
        "cleanliness": grade_cleanliness(final),
    }
    composite = sum(WEIGHTS[k] * parts[k]["score"] for k in WEIGHTS)
    return {"composite": round(composite, 1), "parts": parts}
