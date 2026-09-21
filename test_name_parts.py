"""Legal name stored in parts — first, middle, last.

The account holds one name string, and forms ask for the parts separately.
Before this, the split was guessed at fill time into first + "everything
else", with nowhere to put a middle name — and a form's Middle Name box was
filled with the person's full name.

Run: python test_name_parts.py
"""
import asyncio
import sys
import traceback

from auto_apply.profile import (
    answer_bank,
    build_applicant_profile,
    resolve_name_parts,
    split_full_name,
)


# ── the default split from the account name ───────────────────────────────

def test_two_words_have_no_middle_name():
    # The reported case.
    assert split_full_name("Shubham Sarkar") == ("Shubham", "", "Sarkar")


def test_three_words_put_the_middle_in_the_middle():
    assert split_full_name("Shubham Kumar Sarkar") == ("Shubham", "Kumar", "Sarkar")


def test_four_words_keep_all_middles():
    assert split_full_name("Ada Augusta King Lovelace") == ("Ada", "Augusta King", "Lovelace")


def test_one_word_is_a_first_name_only():
    assert split_full_name("Madonna") == ("Madonna", "", "")


def test_empty_and_whitespace():
    for value in ("", None, "   "):
        assert split_full_name(value) == ("", "", ""), value


def test_extra_spaces_are_ignored():
    assert split_full_name("  Shubham    Sarkar ") == ("Shubham", "", "Sarkar")


# ── stored parts win over the guess ───────────────────────────────────────

def test_stored_parts_win():
    got = resolve_name_parts(
        {"first_name": "Mary Ann", "middle_name": "", "last_name": "Smith"},
        "Mary Ann Smith")
    assert got == {"first": "Mary Ann", "middle": "", "last": "Smith",
                   "full": "Mary Ann Smith"}, got


def test_a_stored_EMPTY_middle_name_is_respected():
    # The account name has three words, so the guess WOULD produce a middle name.
    # The user saved first + last with no middle: that means "I have none".
    got = resolve_name_parts(
        {"first_name": "Maria", "middle_name": "", "last_name": "Garcia Lopez"},
        "Maria Garcia Lopez")
    assert got["middle"] == "", got
    assert got["last"] == "Garcia Lopez", got


def test_full_name_is_composed_from_stored_parts():
    got = resolve_name_parts(
        {"first_name": "Shubham", "middle_name": "Kumar", "last_name": "Sarkar"}, "S Sarkar")
    assert got["full"] == "Shubham Kumar Sarkar", got


def test_nothing_stored_falls_back_to_the_split():
    got = resolve_name_parts({}, "Shubham Sarkar")
    assert got == {"first": "Shubham", "middle": "", "last": "Sarkar",
                   "full": "Shubham Sarkar"}, got


def test_only_one_part_stored_is_topped_up_from_the_guess():
    got = resolve_name_parts({"first_name": "Shubh"}, "Shubham Sarkar")
    assert got["first"] == "Shubh"
    assert got["last"] == "Sarkar"


# ── the answer bank ───────────────────────────────────────────────────────

def _bank(profile, name):
    snap = {"name": name, "email": "s@example.com", "resume_text": "",
            "profile": profile, "qa_entries": []}
    p = asyncio.run(build_applicant_profile(snap, narrative=False))
    return p, answer_bank(p)


def test_no_middle_name_means_no_middle_name_key():
    # Absent, not present-and-empty: nothing for a matcher or a model to use.
    p, bank = _bank({}, "Shubham Sarkar")
    assert p.middle_name == ""
    assert "middle_name" not in bank, bank.keys()
    assert bank["first_name"] == "Shubham"
    assert bank["last_name"] == "Sarkar"
    assert bank["full_name"] == "Shubham Sarkar"


def test_a_stored_middle_name_reaches_the_bank():
    _p, bank = _bank({"first_name": "Shubham", "middle_name": "Kumar",
                      "last_name": "Sarkar"}, "Shubham Sarkar")
    assert bank["middle_name"] == "Kumar"
    assert bank["full_name"] == "Shubham Kumar Sarkar"


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
