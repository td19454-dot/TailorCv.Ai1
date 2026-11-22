"""A country answer selects that country, under any of its names, or nothing.

auto_apply/countries.py is the server's copy of the Chrome extension's
countries.js; _best_option_match uses it so that "India" is never matched to the
nearest-looking name on a list that lacks it — "Dominica" scored 0.615 by difflib
on EY's first page of countries (Oct 2026).

Run: python test_countries.py
"""

import os
import re
import sys
import traceback

from auto_apply import countries as c
from auto_apply.browser import _best_option_match

ROOT = os.path.dirname(os.path.abspath(__file__))
COUNTRIES_JS = os.path.join(ROOT, "chrome-extension", "src", "autofill", "countries.js")

# The first page of a SuccessFactors country list: it stops at Dominica.
FIRST_PAGE = ["No Selection", "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina",
              "Australia", "Austria", "Bangladesh", "Belgium", "Brazil", "Canada", "China",
              "Denmark", "Dominica"]


def pick(value, labels):
    hit = _best_option_match(value, [{"value": l, "label": l} for l in labels])
    return hit["label"] if hit else None


def test_table_is_the_extensions():
    src = open(COUNTRIES_JS, encoding="utf-8").read()
    js = re.search(r"const TABLE = `(.*?)`;", src, re.S).group(1).strip()
    assert c.TABLE.strip() == js


def test_names_of_one_country():
    assert c.country_of("U.S.A.") == "United States"
    assert c.country_of("United States of America") == "United States"
    assert c.country_of("India (+91)") == "India"
    assert c.country_of("India › Citizen") == "India"
    assert c.country_of("Côte d'Ivoire") == "Cote d'Ivoire"
    assert c.country_of("The Netherlands") == "Netherlands"
    # A country only in brackets is not the subject.
    assert c.country_of("Single (India)") == ""
    assert c.country_of("British Indian Ocean Territory") == ""


def test_a_country_missing_from_the_list_is_none_never_a_look_alike():
    assert pick("India", FIRST_PAGE) is None
    assert pick("India", ["Afghanistan", "Iceland", "Indonesia", "British Indian Ocean Territory"]) is None
    assert pick("Nigeria", ["Niger", "Norway", "Oman"]) is None


def test_the_same_country_under_another_name():
    for row in ("United States of America", "USA", "U.S.A.", "United States (US)"):
        assert pick("United States", ["Canada", "Mexico", row]) == row, row
    assert pick("USA", ["Canada", "United States", "United Kingdom"]) == "United States"
    assert pick("India", FIRST_PAGE + ["India (+91)", "Indonesia"]) == "India (+91)"
    # The plain name over a suffixed one when both are offered.
    assert pick("India", ["India (+91)", "India", "Nepal"]) == "India"


def test_lists_that_are_not_country_lists_match_as_before():
    assert pick("India", ["USA", "Canada", "Located Elsewhere"]) is None
    assert pick("Located elsewhere", ["USA", "Canada", "Located Elsewhere"]) == "Located Elsewhere"
    assert pick("Decline to self-identify", ["Male", "Female", "I decline to self-identify"]) \
        == "I decline to self-identify"
    assert pick("Bachelors", ["High School", "Bachelor's Degree", "Master's Degree"]) == "Bachelor's Degree"


tests = [
    test_table_is_the_extensions,
    test_names_of_one_country,
    test_a_country_missing_from_the_list_is_none_never_a_look_alike,
    test_the_same_country_under_another_name,
    test_lists_that_are_not_country_lists_match_as_before,
]


def main():
    passed, failures = 0, []
    for t in tests:
        try:
            t()
            passed += 1
            print(f"  PASS  {t.__name__}")
        except Exception:
            failures.append(t.__name__)
            print(f"  FAIL  {t.__name__}")
            traceback.print_exc()
    print(f"\ntest_countries: {passed}/{len(tests)} passed, {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
