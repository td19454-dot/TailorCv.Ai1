"""The sensitive-question lock, on the server side.

This is the rule that decides whether the extension can ever fabricate a legal
declaration, so it gets the most cases of anything in the autofill feature. The
last test here is the important structural one: it runs the JavaScript
classifier over the same corpus and asserts the two agree, because the rule is
enforced independently on both sides and a drift between them is a hole.

Run: python test_match_guard.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import traceback

from auto_apply import match_guard as mg

# (expected category, label). Also consumed by the JS-agreement test below.
MUST_FLAG = [
    ("work_authorization", "Are you legally authorized to work in the United States?"),
    ("work_authorization", "Are you authorized to work in the country of employment?"),
    ("work_authorization", "Do you have the legal right to work in the UK?"),
    ("work_authorization", "Work authorization status"),
    ("work_authorization", "Employment eligibility"),
    ("work_authorization", "Are you eligible to work in Canada?"),
    ("work_authorization", "Right to work"),
    ("sponsorship", "Will you now or in the future require sponsorship?"),
    ("sponsorship", "Do you require visa sponsorship to work in the US?"),
    ("sponsorship", "Will you require sponsorship for employment visa status?"),
    ("sponsorship", "Do you now or will you in the future require an H1B?"),
    ("sponsorship", "What is your current visa status?"),
    ("sponsorship", "Are you on OPT?"),
    ("citizenship", "Are you a US citizen?"),
    ("citizenship", "What is your nationality?"),
    ("citizenship", "Are you a permanent resident?"),
    ("citizenship", "Do you hold a green card?"),
    ("clearance", "Do you have an active security clearance?"),
    ("clearance", "What is your clearance level?"),
    ("criminal", "Have you ever been convicted of a felony?"),
    ("criminal", "Do you consent to a background check?"),
    ("criminal", "Any criminal history?"),
    ("salary", "What are your salary expectations?"),
    ("salary", "Desired salary"),
    ("salary", "Expected compensation"),
    ("salary", "Current salary"),
    ("salary", "What is your expected CTC?"),
    ("salary", "Desired pay rate"),
    ("salary", "What is your compensation requirement?"),
    ("demographic", "What is your gender?"),
    ("demographic", "Gender identity"),
    ("demographic", "Race / Ethnicity"),
    ("demographic", "What is your ethnicity?"),
    ("demographic", "Racial identity"),
    ("demographic", "Are you Hispanic or Latino?"),
    ("demographic", "Veteran status"),
    ("demographic", "Protected veteran status"),
    ("demographic", "Are you a protected military veteran?"),
    ("demographic", "Disability status"),
    ("demographic", "Do you have a disability?"),
    ("demographic", "What are your pronouns?"),
    ("demographic", "Do you identify as LGBTQ+?"),
    ("demographic", "Sexual orientation"),
]

MUST_NOT_FLAG = [
    "First name", "Last name", "Email address", "Phone number",
    "LinkedIn profile", "GitHub URL", "Portfolio", "City", "State", "Country",
    "Zip code", "University", "Degree", "Major", "Graduation date", "GPA",
    "Current company", "Current job title", "Years of experience",
    "Notice period", "When can you start?", "Are you willing to relocate?",
    "How did you hear about us?", "Why do you want to work here?",
    "Tell us about yourself", "Do you agree to the terms and conditions?",
    "Would you like to receive marketing emails?", "Key skills",
    "What is your preferred name?", "Website", "Cover letter",
    "Have you ever used our product?", "Preferred office location",
]

NEVER_FILL = [
    "Social Security Number", "SSN", "National Insurance number",
    "Bank account number", "Routing number", "IBAN", "Credit card number", "CVV",
    "Password", "One time password", "Date of birth", "DOB", "Birth date",
    "PAN card number", "Aadhaar number",
]

FILLABLE = ["Phone number", "Employee ID at current company",
            "Account manager name", "Graduation date", "Email address"]


def test_every_sensitive_wording_is_flagged():
    missed = [label for _, label in MUST_FLAG if not mg.classify_sensitive(label)]
    assert not missed, "NOT FLAGGED:\n    " + "\n    ".join(missed)


def test_sensitive_categories_are_as_expected():
    wrong = []
    for expected, label in MUST_FLAG:
        got = mg.classify_sensitive(label)
        if got and got != expected:
            wrong.append(f"{label} -> {got}, expected {expected}")
    assert not wrong, "\n    ".join(wrong)


def test_ordinary_questions_are_not_flagged():
    flagged = [f"{lab} -> {mg.classify_sensitive(lab)}"
               for lab in MUST_NOT_FLAG if mg.classify_sensitive(lab)]
    assert not flagged, "OVER-FLAGGED:\n    " + "\n    ".join(flagged)


def test_relocation_is_a_preference_not_a_sensitive_question():
    assert mg.classify_sensitive("Are you willing to relocate to New York?") is None


def test_a_dual_category_question_is_still_locked():
    assert mg.classify_sensitive("Do you hold a valid work permit?")
    assert mg.classify_sensitive("Do you have the right to work here without sponsorship?")


def test_never_fill_identifiers():
    missed = [lab for lab in NEVER_FILL if not mg.is_never_fill(lab)]
    assert not missed, "NOT never-fill:\n    " + "\n    ".join(missed)


def test_never_fill_leaves_ordinary_fields_alone():
    flagged = [lab for lab in FILLABLE if mg.is_never_fill(lab)]
    assert not flagged, flagged


def test_looks_secret():
    for value in ["123-45-6789", "4111 1111 1111 1111", "GB82WEST12345698765432"]:
        assert mg.looks_secret(value), value
    for value in ["Ada Lovelace", "+91 98765 43210", "", "Yes", "8.7/10"]:
        assert not mg.looks_secret(value), value


def test_is_never_store_refuses_secrets_and_sensitive_questions():
    assert mg.is_never_store("Social Security Number", "123-45-6789")
    assert mg.is_never_store("Employee reference", "123-45-6789"), "a secret VALUE is enough"
    assert mg.is_never_store("What is your gender?", "Female"), \
        "EEO answers belong in the profile, not captured per-application"
    assert mg.is_never_store("Are you authorized to work in the US?", "Yes")
    assert mg.is_never_store("Expected salary", "2500000")


def test_is_never_store_allows_an_ordinary_learned_answer():
    assert not mg.is_never_store("Have you ever used our product?", "Yes, since 2022")
    assert not mg.is_never_store("Preferred office location", "Bangalore")
    assert not mg.is_never_store("Why do you want to work here?", "I admire the product.")


def test_empty_input_is_not_flagged():
    assert mg.classify_sensitive("") is None
    assert mg.classify_sensitive(None) is None
    assert not mg.is_never_fill("")
    assert not mg.looks_secret(None)


def test_js_and_python_classifiers_agree():
    """The structural test: both halves of the lock must classify identically.

    The extension classifies a field so it can show the right UI; the server
    reclassifies it so a request cannot unlock one by claiming it is ordinary.
    Two implementations mean two chances to be wrong, and a label the JS side
    thinks is ordinary would be sent for an LLM answer — so the only safe state
    is agreement, asserted here rather than assumed.

    Skipped (not failed) without node: this is a Python suite and node is not
    one of its dependencies.
    """
    node = shutil.which("node")
    if not node:
        print("    (skipped: node not on PATH)")
        return
    match_js = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "chrome-extension", "src", "autofill", "match.js")
    if not os.path.exists(match_js):
        print("    (skipped: match.js not found)")
        return

    labels = [label for _, label in MUST_FLAG] + MUST_NOT_FLAG + NEVER_FILL + FILLABLE
    # A bare Windows absolute path is not a valid ESM specifier ("protocol 'c:'"),
    # so the import target has to be a file:// URL.
    from pathlib import Path

    script = (
        "import * as m from " + json.dumps(Path(match_js).as_uri()) + ";\n"
        # Via the environment, not argv: the label corpus is a few KB of text
        # with quotes and slashes in it, and Windows argument quoting mangles it.
        "const labels = JSON.parse(process.env.TCV_LABELS);\n"
        "console.log(JSON.stringify(labels.map(l => "
        "[m.classifySensitive(l), m.isNeverFill(l)])));\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as fh:
        fh.write(script)
        path = fh.name
    try:
        env = dict(os.environ, TCV_LABELS=json.dumps(labels))
        proc = subprocess.run([node, path], capture_output=True, text=True, env=env)
        assert proc.returncode == 0, proc.stderr[:2000]
        js_results = json.loads(proc.stdout.strip().splitlines()[-1])
    finally:
        os.unlink(path)

    disagreements = []
    for label, (js_cat, js_never) in zip(labels, js_results):
        py_cat = mg.classify_sensitive(label)
        py_never = mg.is_never_fill(label)
        if bool(js_cat) != bool(py_cat):
            disagreements.append(
                f"sensitive: {label!r} -> js={js_cat!r} py={py_cat!r}")
        elif js_cat != py_cat:
            disagreements.append(
                f"category:  {label!r} -> js={js_cat!r} py={py_cat!r}")
        if js_never != py_never:
            disagreements.append(
                f"neverFill: {label!r} -> js={js_never} py={py_never}")
    assert not disagreements, (
        f"{len(disagreements)} disagreement(s) between match.js and match_guard.py:\n    "
        + "\n    ".join(disagreements))


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed, failures = 0, []
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
