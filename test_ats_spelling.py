"""Guards the fused-word repair that keeps correctly-spelled resumes from being
reported as misspelled on the ATS analysis page.

Background: pdfplumber's default x_tolerance is 3 *points*, an absolute figure.
On a resume set in a tight 9-10pt face the gap between two words falls under it
and they extract welded together - "progresstracking". Two things then go wrong:
the JD keyword "progress tracking" can never match, and the model reports the
token as a spelling error despite a prompt rule telling it not to.

The prompt rule is not a fix, so the repair is deterministic. These tests hold
the two halves of it in place:

  1. real long words must never be split (the expensive failure - splitting
     "maintainability" would corrupt the resume text), and
  2. genuine fusions must be split, and artifact spelling claims scrubbed.

Run:  python test_ats_spelling.py
"""
import sys
import traceback

from functions import (
    count_fused_words,
    looks_like_fused_word,
    repair_fused_words,
    scrub_extraction_artifacts_from_spelling,
    split_fused_word,
)

# Welded tokens observed in a real user report, with the split they must produce.
FUSED = {
    "progresstracking": "progress tracking",
    "maintaininglearnerrecords": "maintaining learner records",
    "Supportedschoolactivities": "Supported school activities",
    "learnerrecords": "learner records",
    "learnerrequirements": "learner requirements",
    "resolveroutineconcerns": "resolve routine concerns",
    "sharinglearnersprogress": "sharing learners progress",
    "parentconsent": "parent consent",
    "ensuresmoothexecution": "ensure smooth execution",
    "communicationandsupporting": "communication and supporting",
}

# Real single words. Splitting any of these would damage the resume text, which
# is far worse than leaving one fused token in place - hence the guards in
# _NEVER_SPLIT and the -ability rule.
REAL_WORDS = [
    "responsibilities", "extracurricular", "Extracurricular", "EXTRACURRICULARS",
    "recommendations", "implementations", "transferability", "sustainability",
    "maintainability", "generalization", "infrastructure", "classification",
    "representations", "Entrepreneurship", "hallucinations", "qualifications",
    "internationalization", "Certifications", "thermodynamics", "multiplication",
    "explainability", "Conversational", "accomplishments", "administration",
    "characteristics", "troubleshooting", "shortlisting", "streamlining",
    "stakeholders", "understanding", "notwithstanding", "apprenticeship",
]


def test_fused_tokens_are_recognised():
    for token in FUSED:
        assert looks_like_fused_word(token), f"missed fusion: {token}"


def test_fused_tokens_split_correctly():
    for token, expected in FUSED.items():
        parts = split_fused_word(token)
        assert parts is not None, f"no split for {token}"
        got = " ".join([parts[0]] + [p.lower() for p in parts[1:]])
        assert got == expected, f"{token}: got {got!r}, want {expected!r}"


def test_real_words_are_never_split():
    for word in REAL_WORDS:
        assert not looks_like_fused_word(word), (
            f"{word} would be split into {split_fused_word(word)}"
        )


def test_short_tokens_are_left_alone():
    # Below the length floor nothing is suspected, so ordinary text is untouched.
    for word in ["parent", "records", "the", "data", "manager", "python"]:
        assert not looks_like_fused_word(word)


def test_repair_inserts_the_missing_spaces():
    raw = "Responsible for progresstracking and maintaininglearnerrecords weekly."
    out = repair_fused_words(raw)
    assert "progress tracking" in out
    assert "maintaining learner records" in out
    assert "progresstracking" not in out


def test_repair_leaves_clean_text_unchanged():
    clean = (
        "Managed extracurricular activities and reported on maintainability, "
        "sustainability and transferability of the classification model."
    )
    assert repair_fused_words(clean) == clean


def test_repair_preserves_leading_capital():
    assert repair_fused_words("Supportedschoolactivities") == "Supported school activities"


def test_count_fused_words_picks_the_better_extraction():
    # This is the comparison _extract_pdf_text_for_ats makes between the default
    # and font-scaled reads: fewer fused tokens wins.
    welded = "progresstracking and maintaininglearnerrecords and parentconsent"
    spaced = "progress tracking and maintaining learner records and parent consent"
    assert count_fused_words(welded) == 3
    assert count_fused_words(spaced) == 0


def _finding(explanation, passed="false"):
    return {
        "spelling_and_grammar": {
            "spelling": {
                "passed": passed,
                "explanation": explanation,
                "action": "Fix the spelling errors.",
            }
        }
    }


def test_scrub_clears_a_finding_that_is_all_artifacts():
    parsed = _finding(
        "The word 'progresstracking' should be 'progress tracking'. "
        "The word 'maintaininglearnerrecords' should be 'maintaining learner records'. "
        "The word 'parentconsent' should be 'parent consent'."
    )
    out = scrub_extraction_artifacts_from_spelling(parsed)
    spelling = out["spelling_and_grammar"]["spelling"]
    assert spelling["passed"] == "true"
    assert spelling["explanation"] == ""


def test_scrub_keeps_genuine_misspellings():
    parsed = _finding("The word 'acomplishment' should be 'accomplishment'.")
    out = scrub_extraction_artifacts_from_spelling(parsed)
    spelling = out["spelling_and_grammar"]["spelling"]
    assert spelling["passed"] == "false"
    assert "acomplishment" in spelling["explanation"]


def test_scrub_keeps_the_real_error_and_drops_the_artifact():
    parsed = _finding(
        "The word 'progresstracking' should be 'progress tracking'. "
        "The word 'recieved' should be 'received'."
    )
    out = scrub_extraction_artifacts_from_spelling(parsed)
    spelling = out["spelling_and_grammar"]["spelling"]
    assert spelling["passed"] == "false", "a real misspelling must still fail the check"
    assert "recieved" in spelling["explanation"]
    assert "progresstracking" not in spelling["explanation"]


def test_scrub_clears_an_email_flagged_as_misspelled():
    # Real report: the candidate's own email address was shown as a typo.
    parsed = _finding(
        "The word 'Gerson.craviid@gmail.com' contains a misspelling in the email "
        "domain, where 'craviid' should be 'cravid'."
    )
    out = scrub_extraction_artifacts_from_spelling(parsed)
    spelling = out["spelling_and_grammar"]["spelling"]
    assert spelling["passed"] == "true"
    assert spelling["explanation"] == ""


def test_scrub_drops_contact_claims_but_keeps_real_errors():
    parsed = _finding(
        "The word 'recieved' should be 'received'. "
        "The URL 'linkedin.com/in/jhon-doe' should be 'john-doe'. "
        "The handle '@devjhon' looks misspelled."
    )
    out = scrub_extraction_artifacts_from_spelling(parsed)
    spelling = out["spelling_and_grammar"]["spelling"]
    assert spelling["passed"] == "false"
    assert "recieved" in spelling["explanation"]
    assert "linkedin" not in spelling["explanation"]
    assert "devjhon" not in spelling["explanation"]


def test_scrub_keeps_a_real_misspelling_of_a_contact_keyword():
    parsed = _finding("The word 'domian' should be 'domain'.")
    out = scrub_extraction_artifacts_from_spelling(parsed)
    spelling = out["spelling_and_grammar"]["spelling"]
    assert spelling["passed"] == "false"
    assert "domian" in spelling["explanation"]


def test_scrub_is_safe_on_missing_or_odd_shapes():
    # parse_ai_json_response can hand back anything; the scrub must not raise.
    for shape in [None, {}, [], "text", {"spelling_and_grammar": None},
                  {"spelling_and_grammar": {"spelling": None}},
                  {"spelling_and_grammar": {"spelling": {}}}]:
        scrub_extraction_artifacts_from_spelling(shape)


def test_scrub_leaves_a_passing_check_alone():
    parsed = _finding("", passed="true")
    out = scrub_extraction_artifacts_from_spelling(parsed)
    assert out["spelling_and_grammar"]["spelling"]["passed"] == "true"


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    failures = []
    for t in tests:
        try:
            t()
            passed += 1
            print(f"  PASS  {t.__name__}")
        except Exception as exc:  # noqa: BLE001 - report every failure
            failures.append((t.__name__, exc))
            print(f"  FAIL  {t.__name__}: {exc}")
            traceback.print_exc()

    print(f"\n{passed}/{len(tests)} passed, {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
