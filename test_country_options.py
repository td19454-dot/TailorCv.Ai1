"""The profile's Country of citizenship dropdown and the extension's country table must agree.

routers/profile_page.py COUNTRY_OPTIONS is what a person can pick; the Chrome
extension's countries.js is what reads that pick against a form ("India" vs
"Indian", "Are you a citizen of Singapore?"). A country the extension does not
know would never be matched.

Run: python test_country_options.py
"""

import os
import re
import sys
import traceback

from routers.profile_page import COUNTRY_OPTIONS, NATIONALITY_LEGACY, SELECT_VALUES, nationality_canonical

ROOT = os.path.dirname(os.path.abspath(__file__))
COUNTRIES_JS = os.path.join(ROOT, "chrome-extension", "src", "autofill", "countries.js")


def _js_names():
    src = open(COUNTRIES_JS, encoding="utf-8").read()
    table = re.search(r"const TABLE = `(.*?)`;", src, re.S).group(1).strip().splitlines()
    return [line.split("|")[0].strip() for line in table]


def test_options_match_the_extensions_table():
    assert [v for v, _ in COUNTRY_OPTIONS if v] == _js_names()


def test_options_are_unique():
    values = [v for v, _ in COUNTRY_OPTIONS]
    assert len(values) == len(set(values))


def test_older_free_text_maps_to_its_country():
    assert nationality_canonical("Indian") == "India"
    assert nationality_canonical("  indian ") == "India"
    assert nationality_canonical("Viet Nam") == "Vietnam"
    assert nationality_canonical("American") == "United States"
    assert nationality_canonical("India") == "India"
    # Unknown text stays as it was, for the person to fix.
    assert nationality_canonical("Martian") == "Martian"


def test_every_legacy_target_is_an_option():
    assert set(NATIONALITY_LEGACY.values()) <= SELECT_VALUES["nationality"]


tests = [
    test_options_match_the_extensions_table,
    test_options_are_unique,
    test_older_free_text_maps_to_its_country,
    test_every_legacy_target_is_an_option,
]


def main():
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
