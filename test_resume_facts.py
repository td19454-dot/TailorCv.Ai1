"""Resume facts: the GPA and address extraction that must never be inferred.

These are the parts of auto_apply/resume_facts.py that the LLM is deliberately
NOT trusted with, so they are the parts that need tests. The LLM call itself is
stubbed — what matters here is that a resume without a GPA yields no GPA, and
that an unparseable address part stays empty rather than becoming a guess.

Run: python test_resume_facts.py
"""
import asyncio
import sys
import traceback

from auto_apply import resume_facts as rf


def _place(parts):
    """The four place parts. split_location also returns street/area, which
    test_address_parts.py covers."""
    return {k: parts[k] for k in ("city", "state", "country", "postal_code")}


# ── split_location ────────────────────────────────────────────────────────

def test_city_state_country():
    assert _place(rf.split_location("Kolkata, West Bengal, India")) == {
        "city": "Kolkata", "state": "West Bengal", "country": "India", "postal_code": ""
    }


def test_city_country():
    assert _place(rf.split_location("Bangalore, India")) == {
        "city": "Bangalore", "state": "", "country": "India", "postal_code": ""
    }


def test_us_city_state():
    assert _place(rf.split_location("Austin, TX")) == {
        "city": "Austin", "state": "TX", "country": "", "postal_code": ""
    }


def test_postal_code_before_the_country():
    # The zip sits on the part BEFORE the country, which is why the country is
    # removed first.
    assert _place(rf.split_location("San Francisco, CA 94107, USA")) == {
        "city": "San Francisco", "state": "CA", "country": "USA", "postal_code": "94107"
    }


def test_uk_postcode():
    got = _place(rf.split_location("London, EC1A 1BB, United Kingdom"))
    assert got["country"] == "United Kingdom", got
    assert got["postal_code"].upper() == "EC1A 1BB", got


def test_indian_six_digit_pincode():
    got = _place(rf.split_location("Kolkata, West Bengal 700001, India"))
    assert got["postal_code"] == "700001", got
    assert got["city"] == "Kolkata", got


def test_a_bare_city_is_not_promoted_to_a_country():
    assert _place(rf.split_location("Kolkata")) == {
        "city": "Kolkata", "state": "", "country": "", "postal_code": ""
    }


def test_nothing_in_nothing_out():
    for value in ("", None, "   ", ","):
        assert _place(rf.split_location(value)) == {
            "city": "", "state": "", "country": "", "postal_code": ""
        }, value


def test_us_state_code():
    assert rf.us_state_code("California") == "CA"
    assert rf.us_state_code("ca") == "CA"
    assert rf.us_state_code("New York") == "NY"
    # Not a US state: no code, and emphatically not a wrong one.
    assert rf.us_state_code("West Bengal") == ""
    assert rf.us_state_code("") == ""


# ── extract_gpa ───────────────────────────────────────────────────────────

def test_gpa_out_of_ten():
    edu = [{"description": "CGPA: 8.7/10"}]
    assert rf.extract_gpa(edu, "") == "8.7/10"


def test_gpa_out_of_four():
    assert rf.extract_gpa([{"description": "GPA 3.92/4.0"}], "") == "3.92/4.0"


def test_bare_gpa_keeps_its_own_form():
    assert rf.extract_gpa([{"description": "GPA: 3.9"}], "") == "3.9"


def test_percentage_is_marked_as_one():
    assert rf.extract_gpa([{"description": "Percentage: 82.5"}], "") == "82.5%"


def test_gpa_written_after_the_number():
    assert rf.extract_gpa([{"description": "8.61 CGPA"}], "") == "8.61"


def test_no_gpa_means_no_gpa():
    # The whole point. A model asked for "the GPA" on this resume would invent
    # a plausible one.
    resume = """ADA LOVELACE
    Software Engineer
    EDUCATION
    B.Tech, Computer Science, IIT Delhi, 2020-2024
    EXPERIENCE
    Built a model with 99.2% accuracy and reduced latency by 40%.
    """
    assert rf.extract_gpa([{"description": "B.Tech, Computer Science"}], resume) == ""


def test_a_project_accuracy_is_not_read_as_a_grade():
    # 99.2% appears in the resume text but nowhere near a grade word.
    resume = "Achieved 99.2% accuracy on the benchmark. Improved recall to 97%."
    assert rf.extract_gpa([], resume) == ""


def test_education_description_wins_over_the_whole_document():
    edu = [{"description": "CGPA: 8.7/10"}]
    resume = "Percentage: 55 (this is some other number elsewhere)"
    assert rf.extract_gpa(edu, resume) == "8.7/10"


def test_gpa_found_in_the_resume_body_when_education_has_none():
    assert rf.extract_gpa([{"description": ""}], "B.Sc. — GPA 3.4/4") == "3.4/4"


def test_an_absurd_bare_number_is_rejected():
    # 850 is a credit score, not a grade.
    assert rf.extract_gpa([{"description": "GPA 850"}], "") == ""


# ── normalisation / assembly ──────────────────────────────────────────────

RAW = {
    "personal_info": {
        "full_name": " Ada Lovelace ", "email": "ada@example.com",
        "phone": "+91 98765 43210", "location": "Kolkata, West Bengal, India",
        "linkedin": "linkedin.com/in/ada", "github": "", "portfolio": None,
    },
    "education": [
        {"institution": "IIT Delhi", "degree": "B.Tech", "field_of_study": "Computer Science",
         "start_date": "2020", "end_date": "Jun 2024", "description": "CGPA: 8.7/10"},
        {"institution": "Delhi Public School", "degree": "Class XII", "field_of_study": "Science",
         "start_date": "2018", "end_date": "2020", "description": "Percentage: 94"},
    ],
    "work_history": [
        {"company": "Acme Corp", "role": "SDE II", "location": "Remote",
         "start_date": "Jul 2024", "end_date": "Present", "is_current": True},
        {"company": "Beta Labs", "role": "Intern", "location": "Bangalore",
         "start_date": "Jan 2024", "end_date": "Jun 2024", "is_current": False},
    ],
    "skills": ["Python", " Django ", "", None, "React"],
}


def test_normalize_trims_and_shapes():
    facts = rf._normalize(RAW, "CGPA: 8.7/10")
    assert facts["version"] == rf.FACTS_VERSION
    assert facts["personal_info"]["full_name"] == "Ada Lovelace"
    assert facts["personal_info"]["portfolio"] == ""
    assert _place(facts["address"]) == {
        "city": "Kolkata", "state": "West Bengal", "country": "India", "postal_code": ""
    }
    assert facts["gpa"] == "8.7/10"
    assert facts["skills"] == ["Python", "Django", "React"]
    assert len(facts["education"]) == 2
    assert len(facts["work_history"]) == 2


def test_normalize_survives_a_partial_parse():
    for junk in ({}, {"education": None}, {"education": ["not a dict"]},
                 {"work_history": [None, 3]}, {"personal_info": "nope"}):
        facts = rf._normalize(junk, "")
        assert facts["version"] == rf.FACTS_VERSION, junk
        assert facts["education"] == [], junk
        assert facts["gpa"] == "", junk
        assert facts["personal_info"]["email"] == "", junk


def test_normalize_drops_wholly_empty_entries():
    facts = rf._normalize({"education": [{"institution": "", "degree": ""}, {}]}, "")
    assert facts["education"] == []


def test_empty_facts_has_the_full_shape():
    facts = rf.empty_facts()
    for key in ("version", "personal_info", "address", "education", "work_history",
                "gpa", "skills"):
        assert key in facts, key


# ── flat answer keys ──────────────────────────────────────────────────────

def test_answer_keys_take_the_most_recent_education():
    keys = rf.facts_answer_keys(rf._normalize(RAW, "CGPA: 8.7/10"))
    assert keys["university"] == "IIT Delhi"
    assert keys["degree"] == "B.Tech"
    assert keys["major"] == "Computer Science"
    assert keys["graduation_date"] == "Jun 2024"
    assert keys["gpa"] == "8.7/10"


def test_answer_keys_pick_the_current_employer():
    keys = rf.facts_answer_keys(rf._normalize(RAW, ""))
    assert keys["current_company"] == "Acme Corp"
    assert keys["previous_company"] == "Beta Labs"


def test_answer_keys_fall_back_to_the_first_job_when_none_is_current():
    raw = dict(RAW)
    raw["work_history"] = [
        {"company": "Acme Corp", "role": "SDE", "is_current": False},
        {"company": "Beta Labs", "role": "Intern", "is_current": False},
    ]
    keys = rf.facts_answer_keys(rf._normalize(raw, ""))
    assert keys["current_company"] == "Acme Corp"
    assert keys["previous_company"] == "Beta Labs"


def test_answer_keys_include_the_address_parts():
    keys = rf.facts_answer_keys(rf._normalize(RAW, ""))
    assert keys["address_city"] == "Kolkata"
    assert keys["address_state"] == "West Bengal"
    assert keys["address_country"] == "India"
    assert "address_state_code" not in keys, "West Bengal has no US state code"


def test_answer_keys_omit_blanks_entirely():
    # A blank must be ABSENT, not present-and-empty: the answering tier treats a
    # present key as an available answer.
    keys = rf.facts_answer_keys(rf.empty_facts())
    assert keys == {}, keys


def test_answer_keys_tolerate_junk():
    assert rf.facts_answer_keys(None) == {}
    assert rf.facts_answer_keys({}) == {}
    assert rf.facts_answer_keys({"education": []}) == {}


# ── build_resume_facts: the LLM boundary ──────────────────────────────────

def test_build_returns_empty_for_no_resume():
    assert asyncio.run(rf.build_resume_facts(""))["education"] == []
    assert asyncio.run(rf.build_resume_facts(None))["gpa"] == ""


def test_build_never_raises_when_the_llm_fails():
    import functions

    original = functions.get_resume_response

    async def boom(*a, **k):
        raise RuntimeError("model unavailable")

    functions.get_resume_response = boom
    try:
        facts = asyncio.run(rf.build_resume_facts("Some resume text"))
        assert facts["version"] == rf.FACTS_VERSION
        assert facts["education"] == []
    finally:
        functions.get_resume_response = original


def test_build_never_raises_on_unparseable_json():
    import functions

    original = functions.get_resume_response

    async def junk(*a, **k):
        return "this is not json"

    functions.get_resume_response = junk
    try:
        assert asyncio.run(rf.build_resume_facts("Some resume text"))["education"] == []
    finally:
        functions.get_resume_response = original


def test_build_extracts_the_gpa_from_the_raw_text_not_the_model():
    import json as _json

    import functions

    original = functions.get_resume_response
    # The model returns NO gpa key at all (the prompt forbids it). The value
    # must still arrive, from the text.
    payload = {"personal_info": {"location": "Pune, Maharashtra, India"},
               "education": [{"institution": "COEP", "degree": "B.E.",
                              "field_of_study": "IT", "end_date": "2023",
                              "description": "CGPA 9.1/10"}],
               "work_history": [], "skills": []}

    async def fake(*a, **k):
        return _json.dumps(payload)

    functions.get_resume_response = fake
    try:
        facts = asyncio.run(rf.build_resume_facts("resume text here"))
        assert facts["gpa"] == "9.1/10", facts
        assert facts["address"]["state"] == "Maharashtra", facts
    finally:
        functions.get_resume_response = original


def test_resume_text_hash_is_stable_and_content_sensitive():
    assert rf.resume_text_hash("abc") == rf.resume_text_hash("abc")
    assert rf.resume_text_hash("abc") != rf.resume_text_hash("abd")
    assert len(rf.resume_text_hash("abc")) == 64


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
