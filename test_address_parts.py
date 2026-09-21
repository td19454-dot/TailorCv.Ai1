"""Postal address stored in parts, and a parser that knows what a street is.

The reported bug: "36/F Sitalatala Lane, Kolkata, 700011" filled a City box
with "36/F Sitalatala Lane" and tried "Kolkata" as the Region. The address was
held only as one free-text line, and the splitter assumed "City, Region".

Run: python test_address_parts.py
"""
import asyncio
import sys
import traceback

from auto_apply.profile import answer_bank, build_applicant_profile, resolve_address_parts
from auto_apply.resume_facts import split_location


def parts(text):
    s = split_location(text)
    return (s["street"], s["area"], s["city"], s["state"], s["postal_code"], s["country"])


# ── the parser ────────────────────────────────────────────────────────────

def test_the_reported_address():
    assert parts("36/F Sitalatala Lane, Kolkata, 700011") == (
        "36/F Sitalatala Lane", "", "Kolkata", "", "700011", ""), parts(
        "36/F Sitalatala Lane, Kolkata, 700011")


def test_street_area_city_state_postal_country():
    assert parts("12 AB Road, Salt Lake, Kolkata, West Bengal 700091, India") == (
        "12 AB Road", "Salt Lake", "Kolkata", "West Bengal", "700091", "India")


def test_a_street_without_a_house_number_is_still_a_street():
    assert parts("Park Street, Kolkata, 700016")[0] == "Park Street"
    assert parts("Park Street, Kolkata, 700016")[2] == "Kolkata"


def test_a_flat_line_then_a_street():
    got = parts("Flat 3B, 221 Baker Street, London, NW1 6XE, United Kingdom")
    assert got[0] == "Flat 3B, 221 Baker Street", got
    assert got[2] == "London", got
    assert got[4].upper() == "NW1 6XE", got
    assert got[5] == "United Kingdom", got


def test_us_postal_address():
    got = parts("1600 Amphitheatre Parkway, Mountain View, CA 94043, USA")
    assert got[0] == "1600 Amphitheatre Parkway", got
    assert got[2:] == ("Mountain View", "CA", "94043", "USA"), got


# Places without a street must still parse as they always did.

def test_city_state_country():
    assert parts("Kolkata, West Bengal, India") == ("", "", "Kolkata", "West Bengal", "", "India")


def test_city_country():
    assert parts("Bangalore, India") == ("", "", "Bangalore", "", "", "India")


def test_us_city_state():
    assert parts("Austin, TX") == ("", "", "Austin", "TX", "", "")


def test_bare_city():
    assert parts("Kolkata") == ("", "", "Kolkata", "", "", "")


def test_city_names_that_look_like_streets_are_not_streets():
    # "St." and "Main" are in real city names; a city read as a street loses it.
    assert parts("St. Louis, MO") == ("", "", "St. Louis", "MO", "", "")
    assert parts("Frankfurt am Main, Germany")[2] == "Frankfurt am Main"


def test_a_sector_is_the_place_when_nothing_else_is():
    got = parts("Sector 62, Uttar Pradesh")
    assert got[2] == "Sector 62" and got[3] == "Uttar Pradesh", got


def test_no_country_or_state_is_ever_inferred():
    # A 6-digit PIN is Indian, but also Chinese, Russian, Singaporean... and
    # Kolkata is in West Bengal, but the text doesn't say so. Both stay empty.
    s = split_location("36/F Sitalatala Lane, Kolkata, 700011")
    assert s["country"] == "" and s["state"] == "", s


def test_empty():
    assert parts("") == ("", "", "", "", "", "")
    assert parts(None) == ("", "", "", "", "", "")


# ── saved parts win ───────────────────────────────────────────────────────

def test_saved_parts_win_over_the_guess():
    got = resolve_address_parts(
        {"address_line1": "36/F Sitalatala Lane", "city": "Kolkata", "state": "West Bengal",
         "postal_code": "700011", "country": "India"},
        "somewhere else entirely")
    assert got["city"] == "Kolkata" and got["state"] == "West Bengal", got


def test_a_saved_empty_part_stays_empty():
    got = resolve_address_parts({"address_line1": "36/F Sitalatala Lane", "city": "Kolkata"},
                                "36/F Sitalatala Lane, Salt Lake, Kolkata, West Bengal")
    assert got["address_line2"] == "", "the user saved no line 2"
    assert got["state"] == "", "the user saved no state"


def test_nothing_saved_parses_the_first_free_text_available():
    got = resolve_address_parts({}, "", "36/F Sitalatala Lane, Kolkata, 700011")
    assert got["city"] == "Kolkata"
    assert got["address_line1"] == "36/F Sitalatala Lane"


# ── the answer bank ───────────────────────────────────────────────────────

def _bank(profile):
    snap = {"name": "Shubham Sarkar", "email": "s@example.com", "resume_text": "",
            "profile": profile, "qa_entries": []}
    return answer_bank(asyncio.run(build_applicant_profile(snap, narrative=False)))


def test_bank_from_the_reported_location():
    bank = _bank({"location": "36/F Sitalatala Lane, Kolkata, 700011",
                  "phone": "+91 8240044652"})
    assert bank["address_city"] == "Kolkata", bank.get("address_city")
    assert bank["address_line1"] == "36/F Sitalatala Lane"
    assert bank["postal_code"] == "700011"
    # The form's Region: Kolkata is only ever in West Bengal, and the PIN
    # corroborates India.
    assert bank["address_state"] == "West Bengal", bank.get("address_state")
    assert bank["address_country"] == "India"
    assert "address_line2" not in bank
    assert bank["current_city"] == "Kolkata"
    assert bank["location"] == "Kolkata, West Bengal, India", "a place, not a street address"
    assert bank["address"] == "36/F Sitalatala Lane, Kolkata, West Bengal, 700011, India"


# ── state from city ───────────────────────────────────────────────────────

from auto_apply.resume_facts import infer_state_country  # noqa: E402


def test_state_is_filled_from_a_corroborated_indian_city():
    assert infer_state_country("Kolkata", "", "700011") == ("West Bengal", "India")
    assert infer_state_country("Bangalore", "India") == ("Karnataka", "India")
    assert infer_state_country("Pune", "", "", "+91 98765 43210") == ("Maharashtra", "India")


def test_a_city_name_alone_is_not_enough():
    # Hyderabad is also in Pakistan; nothing here says India.
    assert infer_state_country("Hyderabad") == ("", "")


def test_a_stated_other_country_is_never_overridden():
    assert infer_state_country("Hyderabad", "Pakistan", "71000") == ("", "")
    assert infer_state_country("Delhi", "USA", "", "+1 555 0100") == ("", "")


def test_an_unknown_or_ambiguous_city_is_left_alone():
    assert infer_state_country("Aurangabad", "India") == ("", ""), "in two states"
    assert infer_state_country("Smalltown", "India") == ("", "")


def test_a_saved_state_is_never_replaced():
    got = resolve_address_parts({"city": "Kolkata", "state": "WB", "postal_code": "700011"})
    assert got["state"] == "WB"
    assert got["country"] == "India", "an empty country is still filled"


def test_bank_from_saved_parts():
    bank = _bank({"location": "whatever", "address_line1": "36/F Sitalatala Lane",
                  "city": "Kolkata", "state": "West Bengal", "postal_code": "700011",
                  "country": "India"})
    assert bank["address_state"] == "West Bengal"
    assert bank["address_country"] == "India"
    assert bank["location"] == "Kolkata, West Bengal, India"


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
