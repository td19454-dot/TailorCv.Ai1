"""The learned-answers store: UserApplyQA reads and writes, in one place.

Two callers write here — the dashboard's "answer and retry" modal on a
needs_input run, and the Chrome extension's inline "needs your answer" input —
and an answer saved by either immediately improves the other engine. That shared
behaviour is the reason this is a module rather than a helper inside one router.

Every row is something the user explicitly typed in response to a specific
question shown to them. Nothing here is ever LLM-generated; see the model
docstring for why that guarantee matters.
"""

from __future__ import annotations

import json
import logging

from auto_apply.profile import question_signature

logger = logging.getLogger(__name__)

# Above this, a stored answer is used as-is. Chosen high on purpose: recalling
# the WRONG stored answer is worse than not recalling one, because a wrong
# answer is filled silently while a missing one is shown to the user.
RECALL_AUTOFILL = 0.88
# Between the two, the answer is offered as a suggestion for the user to confirm.
RECALL_SUGGEST = 0.72
# Cap on rows embedded per request, so a user with a long history never turns
# one click into an unbounded embedding bill.
MAX_BACKFILL_PER_CALL = 25


def upsert_answers(db, user_id: int, items, embeddings: dict[str, list[float]] | None = None) -> int:
    """Insert or update answers, keyed by normalized question signature.

    `items` is any iterable of objects/dicts with `question` and `answer`.
    `embeddings` optionally maps question_text -> vector, so the caller can
    embed a whole batch in one request rather than one call per row.

    Returns the number of rows written. Commits once.
    """
    from models import UserApplyQA

    saved = 0
    for item in items or []:
        question = str(_get(item, "question") or "").strip()
        answer = str(_get(item, "answer") or "").strip()
        if not question or not answer:
            continue
        sig = question_signature(question)
        if not sig:
            continue
        row = (
            db.query(UserApplyQA)
            .filter(UserApplyQA.user_id == user_id, UserApplyQA.question_signature == sig)
            .first()
        )
        if not row:
            row = UserApplyQA(user_id=user_id, question_signature=sig)
            db.add(row)
        row.question_text = question
        row.answer = answer
        vector = (embeddings or {}).get(question)
        if vector:
            from functions import EMBEDDING_MODEL

            row.embedding = json.dumps(vector)
            row.embedding_model = EMBEDDING_MODEL
        elif row.embedding and row.question_text != question:
            # The wording changed, so the stored vector describes the old text.
            # Clearing it makes the next read re-embed rather than match against
            # a question this row no longer holds.
            row.embedding = None
            row.embedding_model = None
        saved += 1
    db.commit()
    return saved


def _get(item, key):
    if isinstance(item, dict):
        return item.get(key)
    return getattr(item, key, None)


def load_answers(db, user_id: int) -> list[dict]:
    """Every stored answer for this user, with its decoded embedding."""
    from models import UserApplyQA

    rows = db.query(UserApplyQA).filter(UserApplyQA.user_id == user_id).all()
    out = []
    for r in rows:
        vector = []
        if r.embedding:
            try:
                decoded = json.loads(r.embedding)
                if isinstance(decoded, list):
                    vector = decoded
            except Exception:
                vector = []
        out.append({
            "id": r.id,
            "signature": r.question_signature,
            "question": r.question_text,
            "answer": r.answer,
            "embedding": vector,
        })
    return out


async def backfill_embeddings(db, user_id: int, answers: list[dict]) -> int:
    """Embed any stored answers that have no vector yet. Best-effort.

    Lazy rather than at write time for the rows that predate the column, and
    bounded per call. A failure here is not an error: recall falls back to exact
    signature matching, which is what it did before embeddings existed.
    """
    from models import UserApplyQA

    todo = [a for a in answers if not a["embedding"] and a["question"].strip()]
    todo = todo[:MAX_BACKFILL_PER_CALL]
    if not todo:
        return 0
    try:
        from functions import EMBEDDING_MODEL, embed_texts

        vectors = await embed_texts([a["question"] for a in todo])
    except Exception:
        logger.warning("could not backfill QA embeddings; exact matching still works",
                       exc_info=True)
        return 0

    written = 0
    for entry, vector in zip(todo, vectors):
        if not vector:
            continue
        entry["embedding"] = vector
        row = db.query(UserApplyQA).filter(UserApplyQA.id == entry["id"]).first()
        if row:
            row.embedding = json.dumps(vector)
            row.embedding_model = EMBEDDING_MODEL
            written += 1
    if written:
        try:
            db.commit()
        except Exception:
            logger.warning("could not persist backfilled QA embeddings", exc_info=True)
            db.rollback()
    return written


def recall(label: str, label_vector: list[float], answers: list[dict]) -> dict | None:
    """The stored answer for this question, or None.

    Exact normalized signature first — free, and certain. Then cosine against
    the stored question embeddings, which is what makes "Will you now or in the
    future require sponsorship?" recall the answer given to a differently worded
    sponsorship question on another company's form. The server engine does this
    matching by handing the entire answer list to an LLM in every prompt (see
    answer_bank's other_answers_on_file); that costs tokens per field and does
    not scale past a few dozen rows.

    Returns {"answer", "question", "score", "confident"} or None.
    """
    from functions import cosine_similarity

    sig = question_signature(label)
    if sig:
        for a in answers:
            if a["signature"] == sig:
                return {"answer": a["answer"], "question": a["question"],
                        "score": 1.0, "confident": True}
    if not label_vector:
        return None

    best, best_score = None, 0.0
    for a in answers:
        if not a["embedding"]:
            continue
        score = cosine_similarity(label_vector, a["embedding"])
        if score > best_score:
            best, best_score = a, score
    if not best or best_score < RECALL_SUGGEST:
        return None
    return {
        "answer": best["answer"],
        "question": best["question"],
        "score": best_score,
        "confident": best_score >= RECALL_AUTOFILL,
    }
