"""Cross-pass field registry: the thing that stops fill_form re-filling a
field it already filled, and overwriting a good answer with a worse one.

No browser needed — _probe_fields' parsing and the skip rule are both pure
functions of the JS payload, so every interesting failure mode is reachable
by handing it a fake page.evaluate result.

Run: python test_field_registry.py
"""
import asyncio
import json
import sys
import traceback

from auto_apply import browser as b
from auto_apply import runner as r
from auto_apply.profile import question_signature


class _FakeBrowser:
    """LocalBrowser with everything but the probe stubbed out."""

    def __init__(self, raw):
        self._raw = raw
        self._filled_fields = {}
        self.calls = 0

    async def _active_page(self):
        return object()

    async def _call(self, factory, timeout=None):
        self.calls += 1
        if isinstance(self._raw, Exception):
            raise self._raw
        return self._raw

    _probe_fields = b.LocalBrowser._probe_fields


def _action(selector):
    return type("A", (), {"selector": selector, "description": selector})()


def _probe(raw, n=2):
    fake = _FakeBrowser(raw)
    return asyncio.run(fake._probe_fields([_action(f"//input[{i}]") for i in range(n)]))


def _entry(ident, filled=True, value="x", kind="text"):
    return {"ident": ident, "filled": filled, "value": value, "kind": kind}


def _should_skip(info, registry):
    """Mirror of the three-part condition in fill_form."""
    return bool(info and info["key"] in registry and info["filled"])


def _blocked(current, value):
    """Mirror of the anti-downgrade guard in _commit_combobox."""
    return bool(current and b._looks_like_decline(value) and not b._looks_like_decline(current))


# ── identity ────────────────────────────────────────────────────────────────

def test_key_is_normalized_through_question_signature():
    probed = _probe(json.dumps([_entry("Veteran Status!"), None]))
    assert probed[0]["key"] == question_signature("Veteran Status!") == "veteran status"


def test_same_field_keys_identically_across_passes():
    """react-select ids carry a render-order counter that changes between
    passes; as long as the probe found a name or label, the key must not."""
    first = _probe(json.dumps([_entry("veteran_status")]), n=1)
    second = _probe(json.dumps([_entry("veteran_status")]), n=1)
    assert first[0]["key"] == second[0]["key"]


def test_entry_without_identity_is_dropped_so_it_can_never_be_skipped():
    probed = _probe(json.dumps([_entry(""), _entry("email")]))
    assert 0 not in probed
    assert probed[1]["key"] == "email"


# ── the skip rule: key present AND registered AND filled ────────────────────

def test_first_sight_of_a_field_is_never_skipped():
    assert not _should_skip({"key": "veteran status", "filled": True}, {})


def test_registered_and_still_showing_a_value_is_skipped():
    assert _should_skip({"key": "veteran status", "filled": True}, {"veteran status": "No"})


def test_registered_but_form_cleared_it_is_refilled():
    """The filled=False corroboration is what saves a radio group where the
    model answered "No" to every member, so nothing was actually clicked."""
    assert not _should_skip({"key": "veteran status", "filled": False}, {"veteran status": "No"})


def test_unprobed_field_is_refilled_rather_than_guessed_at():
    assert not _should_skip(None, {"veteran status": "No"})


# ── fail-safe parsing: every bad shape degrades to "fill everything" ────────

def test_bad_probe_results_yield_no_skips_rather_than_raising():
    bad = [
        ("evaluate returned nothing", None),
        ("unexpected scalar", 12345),
        ("unparseable", "not json"),
        ("object, not a list", json.dumps({"ident": "x"})),
        ("wrong length", json.dumps([_entry("a")])),
        ("call itself raised", RuntimeError("evaluate unsupported")),
    ]
    for label, raw in bad:
        assert _probe(raw) == {}, label


def test_junk_entries_are_skipped_individually_not_fatally():
    for junk in (None, 5, "nope", []):
        probed = _probe(json.dumps([junk, _entry("email")]))
        assert 0 not in probed, junk
        assert probed[1]["key"] == "email", junk


def test_probe_is_disabled_by_the_kill_switch():
    original = b.config.field_registry_enabled
    b.config.field_registry_enabled = lambda: False
    try:
        fake = _FakeBrowser(json.dumps([_entry("email")]))
        assert asyncio.run(fake._probe_fields([_action("//input[1]")])) == {}
        assert fake.calls == 0, "kill switch must skip the round-trip entirely"
    finally:
        b.config.field_registry_enabled = original


def test_placeholder_text_on_an_empty_field_is_not_reported_as_a_value():
    """An unfilled <select> still displays "Select…". That must not reach the
    anti-downgrade guard as `current`, or it would refuse a legitimate first
    decline answer on a field that is actually empty."""
    probed = _probe(json.dumps([_entry("state", filled=False, value="Select...")]), n=1)
    assert probed[0]["value"] == ""
    assert not _blocked(probed[0]["value"], "I do not wish to answer")


def test_accepts_an_already_decoded_list():
    assert _probe([_entry("email"), None])[0]["key"] == "email"


def test_empty_action_list_needs_no_round_trip():
    fake = _FakeBrowser(json.dumps([]))
    assert asyncio.run(fake._probe_fields([])) == {}
    assert fake.calls == 0


# ── anti-downgrade guard ────────────────────────────────────────────────────

def test_decline_wordings_are_recognised():
    for text in ("I do not wish to answer", "I don't wish to answer",
                 "Decline to self-identify", "Prefer not to say",
                 "I do not want to answer"):
        assert b._looks_like_decline(text), text


def test_real_answers_are_not_mistaken_for_declines():
    for text in ("I am not a military Veteran", "Yes", "No", "Female", "India"):
        assert not b._looks_like_decline(text), text


def test_guard_blocks_exactly_the_reported_overwrite():
    assert _blocked("I am not a military Veteran", "I do not wish to answer")


def test_guard_allows_a_first_legitimate_decline():
    assert not _blocked("", "I do not wish to answer")


def test_guard_allows_upgrading_a_decline_to_a_real_answer():
    assert not _blocked("I do not wish to answer", "I am not a military Veteran")


def test_guard_allows_an_ordinary_value_change():
    assert not _blocked("India", "United States")


# ── attached documents vs. the verify step's "still missing" list ───────────

def test_reported_case_resume_attached_but_verify_says_missing():
    """The exact failure: Greenhouse hides the file input behind an "Attach"
    button, so verify reports Resume/CV missing while the file is right there.
    The run must NOT dead-end telling the user to attach it by hand."""
    still, satisfied = r._drop_documents_already_attached(
        ["Resume/CV"], {"resume": ["shubham_resume.pdf"], "cover_letter": []}
    )
    assert still == []
    assert satisfied == ["Resume/CV"]


def test_genuinely_missing_resume_is_still_reported():
    still, satisfied = r._drop_documents_already_attached(
        ["Resume/CV"], {"resume": [], "cover_letter": []}
    )
    assert still == ["Resume/CV"]
    assert satisfied == []


def test_documents_we_never_attach_are_never_waved_through():
    for label in ("Portfolio", "Writing Sample", "Transcript"):
        still, satisfied = r._drop_documents_already_attached(
            [label], {"resume": ["cv.pdf"], "cover_letter": ["cl.pdf"]}
        )
        assert still == [label], label
        assert satisfied == [], label


def test_cover_letter_is_matched_to_its_own_slot_not_the_resume():
    """A resume on file must not silently satisfy a required Cover Letter."""
    still, _ = r._drop_documents_already_attached(
        ["Cover Letter"], {"resume": ["cv.pdf"], "cover_letter": []}
    )
    assert still == ["Cover Letter"]
    still, satisfied = r._drop_documents_already_attached(
        ["Cover Letter"], {"resume": [], "cover_letter": ["cl.pdf"]}
    )
    assert still == [] and satisfied == ["Cover Letter"]


def test_slot_classifier_covers_real_label_wordings():
    for label in ("Resume/CV", "Resume", "CV", "Attach your resume",
                  "Curriculum Vitae", "Resume/CV*"):
        assert r._document_slot_for(label) == "resume", label
    for label in ("Cover Letter", "Cover letter (optional)", "CoverLetter"):
        assert r._document_slot_for(label) == "cover_letter", label
    for label in ("Portfolio", "Writing Sample", "LinkedIn Profile"):
        assert r._document_slot_for(label) is None, label


def test_a_failed_document_read_leaves_everything_reported():
    """If the ground-truth read fails we must fall back to reporting, never
    to silently assuming the document is present."""
    still, satisfied = r._drop_documents_already_attached(["Resume/CV"], {})
    assert still == ["Resume/CV"] and satisfied == []


def test_mixed_list_splits_correctly():
    still, satisfied = r._drop_documents_already_attached(
        ["Resume/CV", "Portfolio", "Cover Letter"],
        {"resume": ["cv.pdf"], "cover_letter": ["cl.pdf"]},
    )
    assert still == ["Portfolio"]
    assert satisfied == ["Resume/CV", "Cover Letter"]


# ── verify's "missing" list vs. what the page actually holds ───────────────
# Labels below are copied verbatim from runs 89/90 on the real Robinhood
# Greenhouse form, where the recheck reported fields the repair pass had just
# filled and the run ended without ever submitting.

REAL_MISSING = [
    "Are you legally work authorized to work in the US?",
    "Will you now (or in the future) require visa sponsorship in order to work in the US?",
    "Are you willing to work from the office(s) listed on the job description?",
    "What is your preferred office location?",
    "What is your gender identity?",
    "What is your race or ethnicity?",
    "What is your military status?",
    "What is your disability status?",
]


def test_reported_case_verify_relists_fields_the_page_shows_filled():
    still, already = r._drop_fields_already_filled(REAL_MISSING, list(REAL_MISSING))
    assert still == []
    assert len(already) == len(REAL_MISSING)


def test_matches_across_minor_label_wording_differences():
    """verify's label and the DOM's label are rarely character-identical."""
    page_labels = [
        "Are you legally work authorized to work in the US?*",
        "What is your gender identity?",
        "Will you now (or in the future) require visa sponsorship in order to work in the US?",
    ]
    still, already = r._drop_fields_already_filled(REAL_MISSING, page_labels)
    assert "Are you legally work authorized to work in the US?" in already
    assert "What is your gender identity?" in already
    assert "What is your race or ethnicity?" in still


def test_genuinely_empty_fields_are_never_dropped():
    still, already = r._drop_fields_already_filled(REAL_MISSING, [])
    assert still == REAL_MISSING and already == []


def test_a_failed_probe_degrades_to_previous_behaviour():
    """No labels read back => trust missing_required exactly as before."""
    still, already = r._drop_fields_already_filled(["Location (City)"], [])
    assert still == ["Location (City)"] and already == []


def test_similar_but_distinct_questions_are_not_conflated():
    """The two Robinhood follow-ups differ only in their subject; matching
    one must not silently satisfy the other."""
    a = ("Do you have any Personal/Familial Relationships with current "
         "Robinhood employees or employees of Robinhood's vendors?")
    bq = ("Do you currently hold or have you held, within the last 5 years, "
          "a position as a government official?")
    still, already = r._drop_fields_already_filled([bq], [a])
    assert still == [bq], "distinct questions must not cross-match"


def test_gender_and_race_are_not_conflated():
    still, _ = r._drop_fields_already_filled(
        ["What is your race or ethnicity?"], ["What is your gender identity?"]
    )
    assert still == ["What is your race or ethnicity?"]


def test_military_and_disability_are_not_conflated():
    """These differ by one word and score 0.85 on a similarity ratio — the
    reason label matching is token-containment, not fuzzy."""
    still, _ = r._drop_fields_already_filled(
        ["What is your disability status?"], ["What is your military status?"]
    )
    assert still == ["What is your disability status?"]


def test_work_authorization_and_sponsorship_are_not_conflated():
    a = "Are you legally work authorized to work in the US?"
    bq = "Will you now (or in the future) require visa sponsorship in order to work in the US?"
    still, _ = r._drop_fields_already_filled([bq], [a])
    assert still == [bq]


def test_a_shorter_page_label_still_matches_its_question():
    still, already = r._drop_fields_already_filled(
        ["What is your gender identity?"], ["Gender identity"]
    )
    assert still == [] and already == ["What is your gender identity?"]


def test_required_marker_and_optional_suffix_do_not_block_a_match():
    for page_label in ("What is your gender identity?*",
                       "What is your gender identity? (optional)"):
        still, _ = r._drop_fields_already_filled(["What is your gender identity?"], [page_label])
        assert still == [], page_label


def test_a_single_distinctive_word_cannot_match_broadly():
    """One shared word must never be enough — "status" alone appears in four
    different required questions on this one form."""
    still, _ = r._drop_fields_already_filled(["What is your disability status?"], ["Status"])
    assert still == ["What is your disability status?"]


def test_stopword_only_label_never_matches():
    still, _ = r._drop_fields_already_filled(["What is your race or ethnicity?"], ["Please select"])
    assert still == ["What is your race or ethnicity?"]


def test_filled_field_labels_reports_only_filled_fields():
    class LB(b.LocalBrowser):
        def __init__(self):
            self.session_id = "t"
        async def observe(self, instruction):
            return [_action("//a"), _action("//b"), _action("//c")]
        async def _probe_fields(self, actions):
            return {
                0: {"key": "gender identity", "label": "What is your gender identity?",
                    "kind": "combobox", "value": "Male", "filled": True},
                1: {"key": "race", "label": "", "kind": "combobox", "value": "", "filled": False},
                2: {"key": "military status", "label": "", "kind": "combobox",
                    "value": "Not a veteran", "filled": True},
            }
    labels = asyncio.run(LB().filled_field_labels())
    assert "What is your gender identity?" in labels
    # falls back to observe()'s description when the DOM had no label
    assert "//c" in labels
    assert len(labels) == 2, "an unfilled field must not be reported as filled"


def test_filled_field_labels_is_best_effort():
    class Broken(b.LocalBrowser):
        def __init__(self):
            self.session_id = "t"
        async def observe(self, instruction):
            raise RuntimeError("RPC client is closed")
    assert asyncio.run(Broken().filled_field_labels()) == []


# ── selector normalisation: the bug that made the whole registry inert ─────
# Stagehand emits three shapes for the same element and normalises them itself
# (_extension/content-script.js: isXPath / normalizeXPath). The probe resolved
# the RAW string, so "xpath=/html/..." reached document.evaluate as a boolean
# expression (which raises under FIRST_ORDERED_NODE_TYPE) and querySelector as
# invalid CSS. Every entry came back null, so nothing was ever recorded and
# nothing was ever skipped. These live in Python precisely so they're testable.

def test_xpath_prefix_is_stripped_and_classified():
    assert b._selector_kind("xpath=/html/body/div[2]/input") == ("xpath", "/html/body/div[2]/input")


def test_prefix_match_is_case_and_whitespace_insensitive():
    for raw in ("XPath=/html/a", "  xpath = /html/a  ", "XPATH=/html/a"):
        assert b._selector_kind(raw) == ("xpath", "/html/a"), raw


def test_bare_xpath_still_classifies_as_xpath():
    for raw in ("/html/body/input", '//input[@name="email"]', "(//div)[2]"):
        assert b._selector_kind(raw)[0] == "xpath", raw


def test_css_selectors_are_not_mangled():
    for raw in ("#email", "[data-testid='submit-button']", "input[name='x']", "div > .field"):
        assert b._selector_kind(raw) == ("css", raw), raw


def test_a_css_selector_containing_the_literal_prefix_is_untouched():
    raw = 'input[value="xpath=/html"]'
    assert b._selector_kind(raw) == ("css", raw)


def test_empty_and_degenerate_selectors_yield_no_kind():
    for raw in (None, "", "   ", "xpath=", "xpath=   "):
        assert b._selector_kind(raw) == ("", ""), repr(raw)


def test_regression_the_normalized_form_is_never_prefixed():
    """The exact defect: a prefixed selector must never reach a resolver."""
    kind, norm = b._selector_kind("xpath=/html/body/form/input[1]")
    assert kind == "xpath" and norm.startswith("/") and not norm.startswith("xpath=")


# ── probe health gates the re-sweep ────────────────────────────────────────

def test_probe_health_is_false_when_nothing_resolves():
    fake = _FakeBrowser(json.dumps([None, None]))
    asyncio.run(fake._probe_fields([_action("xpath=/a"), _action("xpath=/b")]))
    assert fake._probe_resolved == 0
    assert b.LocalBrowser.probe_healthy(fake) is False


def test_probe_health_is_true_when_fields_resolve():
    fake = _FakeBrowser(json.dumps([_entry("email"), None]))
    asyncio.run(fake._probe_fields([_action("xpath=/a"), _action("xpath=/b")]))
    assert fake._probe_resolved == 1
    assert b.LocalBrowser.probe_healthy(fake) is True


def test_probe_note_distinguishes_zero_resolved_from_a_crash():
    """These returned '{}' identically before, which is why a total resolution
    failure read as 'no fields were already filled' instead of as a bug."""
    dead = _FakeBrowser(json.dumps([None]))
    asyncio.run(dead._probe_fields([_action("xpath=/a")]))
    crashed = _FakeBrowser(RuntimeError("evaluate unsupported"))
    asyncio.run(crashed._probe_fields([_action("xpath=/a")]))
    assert "resolved 0/1" in dead._last_probe_note
    assert "raised" in crashed._last_probe_note
    assert dead._last_probe_note != crashed._last_probe_note


# ── a confirmed submission must not be downgraded by an echoed EEO answer ──

def test_a_genuine_confirmation_is_not_read_as_a_rejection():
    """Regression: the EEO answers this app itself submits contain the word
    "decline", so a confirmation page echoing them back used to flip
    submitted=True to False and report a successful application as failed."""
    for text in (
        "Thank you for applying! Your application has been received.",
        "Thanks for applying. Gender: I declined to self-identify. Veteran: I am not a veteran.",
        "Application received. Race/ethnicity: Decline to self-identify.",
    ):
        assert not r._looks_permanently_rejected(text), text


def test_real_rejections_are_still_caught():
    for text in (
        "Your submission was flagged as spam.",
        "This request was blocked.",
        "Too many attempts, please try later.",
        "Your application was rejected.",
        "The submission was unsuccessful.",
    ):
        assert r._looks_permanently_rejected(text), text


def test_reconcile_keeps_a_real_success_submitted():
    out = r._reconcile_confirm_result({
        "submitted": True,
        "confirmation_text": "Thank you for applying. Gender: Decline to self-identify.",
    })
    assert out["submitted"] is True


def test_reconcile_still_downgrades_a_disguised_rejection():
    out = r._reconcile_confirm_result({
        "submitted": True,
        "confirmation_text": "Your application was flagged as spam.",
    })
    assert out["submitted"] is False


# ── identity collision: distinct fields must never share a key ─────────────

def test_distinct_fields_must_not_collapse_onto_one_identity():
    """Regression for a live probe bug: rsContainer() used
    el.closest('[class*="container"]'), which on a real form matches the
    page-level <div class="application-container">. Every text input then read
    the first react-select's .singleValue and hidden input, so a dozen fields
    shared one identity and one value — which would skip empty fields as
    "already filled" and clear genuinely-missing ones, submitting an
    incomplete form. Keys must stay distinct per field."""
    probed = _probe(json.dumps([
        _entry("first_name", filled=True, value="Shubham"),
        _entry("last_name", filled=False, value=""),
        _entry("veteran_status", filled=True, value="I am not a military Veteran"),
    ]), n=3)
    keys = [probed[i]["key"] for i in sorted(probed)]
    assert len(set(keys)) == len(keys), f"identity collision: {keys}"
    assert probed[1]["filled"] is False, "an empty field must not inherit a filled one's state"


# ── a field the form REJECTS is not "done" ─────────────────────────────────
# Regression for a live failure: a phone field read "+246 8240044652" under a
# red "Phone number is too long". It was filled, so (a) the registry skipped
# it as already-done, (b) the missing-list reconciliation cleared it, and the
# run submitted an invalid application — then the post-rejection repair pass
# reported "0 filled, 22 already filled" because the registry skipped it again.

def test_invalid_field_is_not_counted_as_filled():
    probed = _probe(json.dumps([
        {"ident": "phone", "filled": True, "invalid": True,
         "value": "+246 8240044652", "kind": "text"},
    ]), n=1)
    assert probed[0]["filled"] is False, "a rejected value must not count as filled"
    assert probed[0]["invalid"] is True


def test_invalid_field_is_never_skipped_by_the_registry():
    info = _probe(json.dumps([
        {"ident": "phone", "filled": True, "invalid": True, "value": "+246 82400", "kind": "text"},
    ]), n=1)[0]
    assert not _should_skip(info, {"phone": "+91 8240044652"}), (
        "the form is rejecting this value; it must be re-filled, not skipped"
    )


def test_valid_field_is_still_skipped():
    info = _probe(json.dumps([
        {"ident": "phone", "filled": True, "invalid": False, "value": "+91 8240044652", "kind": "text"},
    ]), n=1)[0]
    assert _should_skip(info, {"phone": "+91 8240044652"})


def test_invalid_field_is_not_reported_as_filled_to_the_reconciler():
    """filled_field_labels feeds _drop_fields_already_filled; an invalid field
    leaking through there is what cleared 'Phone' from the missing list and
    let the run submit anyway."""
    class LB(b.LocalBrowser):
        def __init__(self):
            self.session_id = "t"
        async def observe(self, instruction):
            return [_action("//phone"), _action("//email")]
        async def _probe_fields(self, actions):
            return {
                0: {"key": "phone", "label": "Phone", "kind": "text",
                    "value": "", "filled": False, "invalid": True},
                1: {"key": "email", "label": "Email", "kind": "text",
                    "value": "a@b.c", "filled": True, "invalid": False},
            }
    labels = asyncio.run(LB().filled_field_labels())
    assert "Email" in labels
    assert "Phone" not in labels
    still, _ = r._drop_fields_already_filled(["Phone", "Email"], labels)
    assert still == ["Phone"], "a rejected field must stay in the missing list"


# ── a dropdown must commit the option we ASKED for ─────────────────────────
# Typing "India" into a phone country-code list highlights "British Indian
# Ocean Territory (+246)" first; Enter took it, a value landed, and the old
# check (did anything land?) called that success.

def test_commit_rejects_a_different_option_than_requested():
    assert not b._commit_matches("India", "British Indian Ocean Territory (+246)")


def test_commit_accepts_the_right_option_with_decoration():
    for shown in ("India (+91)", "India", "  India (+91)  ", "IN India +91"):
        assert b._commit_matches("India", shown), shown


def test_commit_accepts_close_wording():
    assert b._commit_matches("I am not a military Veteran", "I am not a military veteran")


def test_commit_rejects_an_empty_widget():
    assert not b._commit_matches("India", "")
    assert not b._commit_matches("India", None)


def test_commit_check_is_permissive_when_nothing_was_requested():
    assert b._commit_matches("", "anything")


def test_commit_does_not_confuse_neighbouring_countries():
    assert not b._commit_matches("India", "Indonesia (+62)")
    assert not b._commit_matches("Austria", "Australia")


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
