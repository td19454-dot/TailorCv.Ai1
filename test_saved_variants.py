"""Saved answers remember the options they were chosen from.

One question can have several answers, one per KIND of option list:
"Citizenship Status" over U.S. statuses ("(e) … DACA") and over a country list
("India"). An answer is reused only on the same kind of list, as an option the
list offers. The DACA answer from a U.S. list was typed into Workday's country
list, found nothing, and the field stayed empty (Oct 2026).

The pick_saved cases are shared with the extension (chrome-extension/test/
fixtures/saved_cases.json, run by test/saved.test.mjs): browser and server
must pick the same option.

Run: python test_saved_variants.py
"""

import json
import os
import sys
import traceback

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from auto_apply import qa_store
from models import Base, User, UserApplyQA

ROOT = os.path.dirname(os.path.abspath(__file__))
CASES = os.path.join(ROOT, "chrome-extension", "test", "fixtures", "saved_cases.json")

FIXTURE = json.load(open(CASES, encoding="utf-8"))
LISTS = FIXTURE["lists"]
US = LISTS["us_status"]
COUNTRIES = LISTS["countries_a"]
DACA = US[5]


def _list(v):
    return LISTS[v] if isinstance(v, str) else v


def _db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    user = User(email="t@example.com", name="T", hashed_password="x")
    db.add(user)
    db.commit()
    return db, user.id


def _row(db, uid):
    return db.query(UserApplyQA).filter(UserApplyQA.user_id == uid).one()


def test_shared_cases():
    failed = []
    for c in FIXTURE["cases"]:
        entry = {"answer": c["entry"]["answer"],
                 "variants": [{"answer": v["answer"], "options": _list(v["options"])}
                              for v in c["entry"]["variants"]]}
        got = qa_store.pick_saved(entry, _list(c["labels"]))
        if got != c["expect"]:
            failed.append(f'{c["name"]}: got {got!r}, want {c["expect"]!r}')
    for k in FIXTURE["kinds"]:
        got = qa_store.list_kind(_list(k["labels"]))
        if got != k["expect"]:
            failed.append(f'kind of {k["labels"]}: got {got!r}, want {k["expect"]!r}')
    assert not failed, "\n".join(failed)


def test_one_answer_per_kind_of_list():
    db, uid = _db()
    qa_store.upsert_answers(db, uid, [{"question": "Citizenship Status", "answer": DACA, "options": US}])
    qa_store.upsert_answers(db, uid, [{"question": "Citizenship Status", "answer": "India", "options": COUNTRIES}])
    variants = qa_store.decode_variants(_row(db, uid).variants)
    assert [v["answer"] for v in variants] == [DACA, "India"], variants
    assert _row(db, uid).answer == "India"           # the latest, for readers without variants


def test_the_same_kind_of_list_is_replaced_not_added():
    db, uid = _db()
    qa_store.upsert_answers(db, uid, [{"question": "Citizenship Status", "answer": "India", "options": COUNTRIES}])
    qa_store.upsert_answers(db, uid, [{"question": "Citizenship Status", "answer": DACA, "options": US}])
    qa_store.upsert_answers(db, uid, [{"question": "Citizenship Status", "answer": "Canada",
                                       "options": LISTS["countries_b"] + ["Canada"]}])
    variants = qa_store.decode_variants(_row(db, uid).variants)
    assert [v["answer"] for v in variants] == [DACA, "Canada"], variants


def test_at_most_eight_kinds_kept():
    db, uid = _db()
    for n in range(10):
        options = [f"choice {n} {k}" for k in range(4)]
        qa_store.upsert_answers(db, uid, [{"question": "Pick one", "answer": options[0], "options": options}])
    variants = qa_store.decode_variants(_row(db, uid).variants)
    assert len(variants) == qa_store.MAX_VARIANTS
    assert variants[-1]["answer"] == "choice 9 0" and variants[0]["answer"] == "choice 2 0"


def test_an_answer_without_options_keeps_the_variants():
    db, uid = _db()
    qa_store.upsert_answers(db, uid, [{"question": "Citizenship Status", "answer": "India", "options": COUNTRIES}])
    qa_store.upsert_answers(db, uid, [{"question": "Citizenship Status", "answer": "Indian"}])
    row = _row(db, uid)
    assert row.answer == "Indian"
    assert [v["answer"] for v in qa_store.decode_variants(row.variants)] == ["India"]


def test_old_rows_load_with_no_variants():
    db, uid = _db()
    qa_store.upsert_answers(db, uid, [{"question": "LinkedIn profile", "answer": "https://linkedin.com/in/x"}])
    loaded = qa_store.load_answers(db, uid)
    assert loaded[0]["variants"] == []
    hit = qa_store.recall("LinkedIn profile", [], loaded)
    assert hit["variants"] == [] and hit["answer"] == "https://linkedin.com/in/x"


def test_server_recall_picks_the_variant_or_leaves_it_to_the_model():
    """The plan endpoint's recall: the answer saved for this kind of list, or
    nothing (the mapping call answers it); a list not read yet gets the
    variants, for the extension to pick from once open."""
    import asyncio
    from types import SimpleNamespace

    from routers import extension_autofill as ea

    stored = [{"id": 1, "signature": "which team are you most interested in",
               "question": "Which team are you most interested in?", "answer": "Payments",
               "variants": [{"options": ["Platform", "Payments", "Growth"], "answer": "Payments"}],
               "embedding": []}]
    saved = (qa_store.load_answers, qa_store.backfill_embeddings, ea._embed_quietly, ea._llm_answers)

    async def no_backfill(*a, **k):
        return 0

    async def no_vectors(labels):
        return []

    async def no_model(bank, fields, payload):
        return {}

    qa_store.load_answers = lambda db, uid: stored
    qa_store.backfill_embeddings = no_backfill
    ea._embed_quietly = no_vectors
    ea._llm_answers = no_model
    try:
        def field(i, options):
            return SimpleNamespace(i=i, label="Which team are you most interested in?", options=options,
                                   sensitive=False, neverFill=False, compose=False, documentSlot=None,
                                   recallOnly=False, required=True)
        fields = [field(0, ["Platform", "Payments", "Growth", "Infra"]),
                  field(1, ["Bangalore", "Pune", "Remote"]),
                  field(2, [])]
        answers = {}
        asyncio.run(ea._recall_and_map(None, SimpleNamespace(id=1), {}, fields, SimpleNamespace(), answers))
    finally:
        qa_store.load_answers, qa_store.backfill_embeddings, ea._embed_quietly, ea._llm_answers = saved
    assert answers["0"]["value"] == "Payments", answers
    assert "variants" not in answers["0"]
    assert "1" not in answers, "a different kind of list: no saved answer, never the nearest"
    assert answers["2"]["value"] == "Payments" and answers["2"]["variants"], answers


def _two_kinds(db, uid):
    qa_store.upsert_answers(db, uid, [{"question": "Citizenship Status", "answer": DACA, "options": US}])
    qa_store.upsert_answers(db, uid, [{"question": "Citizenship Status", "answer": "India", "options": COUNTRIES}])


def test_forget_takes_only_that_kind_of_list():
    db, uid = _db()
    _two_kinds(db, uid)
    # Forgotten from a U.S.-status list worded without lettering: same kind.
    assert qa_store.forget_answer(db, uid, "Citizenship Status*", LISTS["us_status_unlettered"])
    row = _row(db, uid)
    assert [v["answer"] for v in qa_store.decode_variants(row.variants)] == ["India"]
    assert row.answer == "India"
    # The country list's answer, last of all: the row goes.
    assert qa_store.forget_answer(db, uid, "Citizenship Status", LISTS["countries_b"])
    assert db.query(UserApplyQA).count() == 0


def test_forget_of_another_kind_forgets_nothing():
    db, uid = _db()
    _two_kinds(db, uid)
    assert not qa_store.forget_answer(db, uid, "Citizenship Status", LISTS["degree"])
    assert len(qa_store.decode_variants(_row(db, uid).variants)) == 2
    assert not qa_store.forget_answer(db, uid, "Some other question", US)


def test_forget_without_options_takes_the_row():
    db, uid = _db()
    qa_store.upsert_answers(db, uid, [{"question": "LinkedIn profile", "answer": "x"}])
    assert qa_store.forget_answer(db, uid, "LinkedIn profile", ["a", "b"])
    assert db.query(UserApplyQA).count() == 0
    _two_kinds(db, uid)
    assert qa_store.forget_answer(db, uid, "Citizenship Status", [])
    assert db.query(UserApplyQA).count() == 0


def test_profile_edit_reaches_the_kind_of_list_forms_read():
    db, uid = _db()
    _two_kinds(db, uid)
    row = _row(db, uid)
    qa_store.edit_variant(row, 0, DACA, US[2])
    db.commit()
    variants = qa_store.decode_variants(_row(db, uid).variants)
    assert variants[0]["answer"] == US[2] and variants[1]["answer"] == "India"
    assert qa_store.pick_saved({"answer": row.answer, "variants": variants}, US) == US[2]
    assert row.answer == "India", "answer stays the newest variant's"
    qa_store.edit_variant(row, 1, "India", "Canada")
    assert row.answer == "Canada"


def test_profile_edit_of_a_stale_answer_is_refused():
    db, uid = _db()
    _two_kinds(db, uid)
    row = _row(db, uid)
    for index, was in ((0, "India"), (5, DACA)):
        try:
            qa_store.edit_variant(row, index, was, "x")
        except ValueError:
            continue
        raise AssertionError(f"edited a stale variant {index}")


def test_profile_delete_of_one_kind():
    db, uid = _db()
    _two_kinds(db, uid)
    row = _row(db, uid)
    assert qa_store.delete_variant(row, 1, "India") is False
    assert row.answer == DACA
    assert qa_store.delete_variant(row, 0, DACA) is True, "the last one: the row should go"


def test_bad_json_is_no_variants():
    assert qa_store.decode_variants("not json") == []
    assert qa_store.decode_variants(json.dumps([{"options": "x", "answer": "y"}])) == []


tests = [
    test_shared_cases,
    test_one_answer_per_kind_of_list,
    test_the_same_kind_of_list_is_replaced_not_added,
    test_at_most_eight_kinds_kept,
    test_an_answer_without_options_keeps_the_variants,
    test_old_rows_load_with_no_variants,
    test_bad_json_is_no_variants,
    test_server_recall_picks_the_variant_or_leaves_it_to_the_model,
    test_forget_takes_only_that_kind_of_list,
    test_forget_of_another_kind_forgets_nothing,
    test_forget_without_options_takes_the_row,
    test_profile_edit_reaches_the_kind_of_list_forms_read,
    test_profile_edit_of_a_stale_answer_is_refused,
    test_profile_delete_of_one_kind,
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
    print(f"\ntest_saved_variants: {passed}/{len(tests)} passed, {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
