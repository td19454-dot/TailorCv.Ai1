"""The profile's job and school lists. Jobs in the shape Workday's My Experience asks for:
Job Title, Company, Location, From (MM/YYYY), To (MM/YYYY), I currently work
here, Role Description.

Suggested from the resume until the user saves one; once saved it is the
source of truth, including for the current title / company single-box forms
ask for.

Run: python test_work_experience.py
"""
import asyncio
import json
import sys
import traceback

from fastapi import HTTPException

from auto_apply.profile import (
    answer_bank,
    build_applicant_profile,
    education_from_facts,
    experience_from_facts,
    parse_saved_experience,
    to_month_year,
)
from routers.profile_page import _validated_education, _validated_experience


def test_resume_dates_become_month_year():
    assert to_month_year("Jan 2026") == "01/2026"
    assert to_month_year("September 2024") == "09/2024"
    assert to_month_year("Sept. 2024") == "09/2024"
    assert to_month_year("1/2026") == "01/2026"
    assert to_month_year("04-2026") == "04/2026"
    assert to_month_year("2026-04") == "04/2026"
    assert to_month_year("Present") == ""
    # No month on the resume: kept as written for the user to finish, not
    # turned into a guessed January.
    assert to_month_year("2021") == "2021"


def test_resume_work_history_is_suggested_in_workday_shape():
    jobs = experience_from_facts([
        {"company": "Alignerr", "role": "Machine Learning Engineer",
         "location": "Kolkata, West Bengal, India", "start_date": "Jan 2026",
         "end_date": "Apr 2026", "is_current": False,
         "description": "Analyzed AI agent code fixes across 100+ GitHub repositories"},
        {"company": "Acme", "role": "Analyst", "location": "", "start_date": "Jun 2024",
         "end_date": "Present", "is_current": False, "description": ""},
    ])
    assert jobs[0] == {"title": "Machine Learning Engineer", "company": "Alignerr",
                       "location": "Kolkata, West Bengal, India", "from": "01/2026",
                       "to": "04/2026", "current": False,
                       "description": "Analyzed AI agent code fixes across 100+ GitHub repositories"}, jobs[0]
    # "Present" on the resume means I currently work here, with no end date.
    assert jobs[1]["current"] is True and jobs[1]["to"] == "", jobs[1]


def _profile(profile, facts=None):
    snap = {"name": "Shubham Sarkar", "email": "s@example.com", "resume_text": "",
            "profile": profile, "qa_entries": [], "resume_facts": facts or {}}
    p = asyncio.run(build_applicant_profile(snap, narrative=False))
    return p, answer_bank(p)


def test_saved_jobs_win_over_the_resume_and_name_the_current_role():
    facts = {"work_history": [{"company": "OldCo", "role": "Intern", "start_date": "Jan 2020",
                               "end_date": "Dec 2020"}]}
    saved = [
        {"title": "Machine Learning Engineer", "company": "Alignerr", "location": "Kolkata",
         "from": "01/2026", "to": "", "current": True, "description": "x"},
        {"title": "Analyst", "company": "Acme", "location": "", "from": "06/2024",
         "to": "12/2025", "current": False, "description": ""},
    ]
    p, bank = _profile({"work_experience": json.dumps(saved), "current_company": "Stale Inc"}, facts)
    assert [j["company"] for j in p.work_experience] == ["Alignerr", "Acme"]
    assert bank["current_company"] == "Alignerr", bank.get("current_company")
    assert bank["current_job_title"] == "Machine Learning Engineer"
    assert bank["previous_company"] == "Acme"


def test_nothing_saved_suggests_from_the_resume():
    facts = {"work_history": [{"company": "Alignerr", "role": "ML Engineer",
                               "start_date": "Jan 2026", "end_date": "Present"}]}
    p, _ = _profile({}, facts)
    assert p.work_experience[0]["company"] == "Alignerr"
    assert p.work_experience[0]["current"] is True


def test_malformed_saved_json_reads_as_empty():
    assert parse_saved_experience("{not json") == []
    assert parse_saved_experience('{"a": 1}') == []
    # "I currently work here" clears the end date even if one was sent.
    assert parse_saved_experience([{"title": "X", "to": "01/2026", "current": True}])[0]["to"] == ""


def test_save_rejects_dates_workday_would_reject():
    ok = _validated_experience([{"title": "X", "company": "Y", "from": "01/2026", "to": "04/2026"},
                                {"title": "", "company": "", "location": ""}])
    assert len(ok) == 1, ok   # the empty card is dropped
    for bad in ("2026", "1/2026", "13/2026", "Jan 2026"):
        try:
            _validated_experience([{"title": "X", "from": bad}])
        except HTTPException as exc:
            assert "Job 1: From" in exc.detail, exc.detail
        else:
            raise AssertionError(f"accepted From={bad!r}")


# ── education: School or University, Degree, Field of Study, From, To ─────

def test_resume_education_is_suggested_with_years():
    schools = education_from_facts([
        {"institution": "Jadavpur University", "degree": "Bachelor of Engineering",
         "field_of_study": "Chemical Engineering", "start_date": "Aug 2023",
         "end_date": "May 2027 (expected)", "description": ""},
        # The whole range written in one date, as resumes often do.
        {"institution": "Some School", "degree": "", "field_of_study": "",
         "start_date": "", "end_date": "2021 - 2023"},
    ])
    assert schools[0] == {"school": "Jadavpur University", "degree": "Bachelor of Engineering",
                          "field": "Chemical Engineering", "from": "2023", "to": "2027"}, schools[0]
    assert (schools[1]["from"], schools[1]["to"]) == ("2021", "2023"), schools[1]


def test_saved_schools_answer_the_single_education_boxes():
    saved = [{"school": "Jadavpur University", "degree": "Bachelor's Degree",
              "field": "Chemical Engineering", "from": "2023", "to": "2027"},
             {"school": "DPS", "degree": "High School Diploma", "field": "", "from": "2019", "to": "2021"}]
    facts = {"education": [{"institution": "Old Parse U", "degree": "BSc"}]}
    p, bank = _profile({"education_history": json.dumps(saved), "university": "Stale U"}, facts)
    assert [s["school"] for s in p.education_entries] == ["Jadavpur University", "DPS"]
    assert bank["university"] == "Jadavpur University", bank.get("university")
    assert bank["degree"] == "Bachelor's Degree"
    assert bank["major"] == "Chemical Engineering"
    assert bank["graduation_date"] == "2027"


def test_save_rejects_schools_workday_would_reject():
    ok = _validated_education([{"school": "JU", "from": "2023", "to": "2027"}, {"school": ""}])
    assert len(ok) == 1, ok
    for bad, msg in (({"school": "JU", "from": "Aug 2023"}, "From should be a year"),
                     ({"school": "JU", "to": "27"}, "To should be a year"),
                     ({"school": "JU", "from": "2027", "to": "2023"}, "From is after To")):
        try:
            _validated_education([bad])
        except HTTPException as exc:
            assert msg in exc.detail, exc.detail
        else:
            raise AssertionError(f"accepted {bad}")


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
