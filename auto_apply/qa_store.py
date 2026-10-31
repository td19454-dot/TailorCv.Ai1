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
import re

from auto_apply.countries import country_of, country_option, country_share
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

# ── One answer per kind of option list ───────────────────────────────────
# chrome-extension/src/autofill/saved.js is the same matcher, run in the
# browser; both are checked against chrome-extension/test/fixtures/
# saved_cases.json so they cannot drift.
#
# "Citizenship Status" over U.S. statuses and over a country list is one
# question with two answers. An answer is kept per KIND of list and only ever
# reused on the same kind, as an option this list offers — never as the
# nearest-looking one: the DACA answer from a U.S. list was typed into
# Workday's country list, found nothing, and the field stayed empty.

# Two lists at least this alike are the same kind (Jaccard over their options).
SAME_KIND = 0.6
MAX_VARIANTS = 8
MAX_OPTION_CHARS = 300
MAX_OPTIONS = 300

_ENUMERATOR_RE = re.compile(r"^(\([a-z0-9]{1,2}\)|[a-z]\)|\d{1,2}[.)])\s+")
_PLACEHOLDER_RE = re.compile(
    r"^(select|choose|please select|please choose)( one| an option)?$|^no selection$")
_YES_NO_RE = re.compile(r"^(yes|no)\b")


def normalize_option(text) -> str:
    """'(e) Authorized to work…' and 'Authorized to work…' read the same."""
    import unicodedata

    s = unicodedata.normalize("NFD", str(text or ""))
    s = re.sub("[̀-ͯ]", "", s).lower().strip()
    s = _ENUMERATOR_RE.sub("", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _real(labels) -> list[tuple[str, str]]:
    """(label, normalized) for every option that is not a placeholder."""
    out = []
    for raw in labels or []:
        norm = normalize_option(raw)
        if norm and not _PLACEHOLDER_RE.match(norm):
            out.append((str(raw), norm))
    return out


def _looks_like_decline(text: str) -> bool:
    from auto_apply.browser import _looks_like_decline as decline

    return decline(text)


def list_kind(labels) -> str:
    """'yesno', 'countries' or 'other'."""
    real = _real(labels)
    if not real:
        return "other"
    if (all(_YES_NO_RE.match(n) or _looks_like_decline(raw) for raw, n in real)
            and any(_YES_NO_RE.match(n) for _, n in real)):
        return "yesno"
    if country_share([raw for raw, _ in real]) >= 0.5:
        return "countries"
    return "other"


def kind_score(a, b) -> float:
    """How alike two option lists are: 1 for two Yes/No or two country lists,
    otherwise the overlap of their options."""
    ka, kb = list_kind(a), list_kind(b)
    if ka == kb and ka in ("yesno", "countries"):
        return 1.0
    sa = {n for _, n in _real(a)}
    sb = {n for _, n in _real(b)}
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def _exact(answer, real) -> str | None:
    want = normalize_option(answer)
    if not want:
        return None
    return next((raw for raw, n in real if n == want), None)


def pick_saved_variant(entry: dict, labels) -> dict | None:
    """The variant saved over the same kind of list as `labels` — the one that
    decides this field — or None. Oldest first, so a tie goes to the newest."""
    best, best_score = None, 0.0
    for v in entry.get("variants") or []:
        if not v.get("options"):
            continue
        score = kind_score(v["options"], labels)
        if score >= SAME_KIND and score >= best_score:
            best, best_score = v, score
    return best


def pick_saved(entry: dict, labels) -> str | None:
    """The option on THIS list that states the saved answer, or None.

    `entry` is {"answer", "variants"}. The variant saved over the same kind of
    list decides; with none of the same kind there is no saved answer here, and
    the field is decided as if nothing were saved. A row saved without options
    (older, or the dashboard) counts only when this list offers it verbatim.
    """
    real = _real(labels)
    if not real:
        return None
    if not [v for v in (entry.get("variants") or []) if v.get("options")]:
        return _exact(entry.get("answer"), real)
    best = pick_saved_variant(entry, labels)
    if best is None:
        return None
    answer = best.get("answer") or ""
    hit = _exact(answer, real)
    if hit:
        return hit
    kind = list_kind(labels)
    if kind == "countries":
        country = country_of(answer)
        return country_option(country, [raw for raw, _ in real]) if country else None
    if kind == "yesno":
        m = _YES_NO_RE.match(normalize_option(answer))
        if m:
            same = [raw for raw, n in real if n.split(" ")[0] == m.group(1)]
            return same[0] if len(same) == 1 else None
    return None


def decode_variants(raw) -> list[dict]:
    try:
        decoded = json.loads(raw) if raw else []
    except Exception:
        return []
    out = []
    for v in decoded if isinstance(decoded, list) else []:
        if isinstance(v, dict) and isinstance(v.get("options"), list) and v.get("answer"):
            out.append({"options": [str(o) for o in v["options"]], "answer": str(v["answer"])})
    return out


def _newest_answer(row, variants: list[dict]) -> None:
    row.variants = json.dumps(variants)
    row.answer = variants[-1]["answer"]


def forget_answer(db, user_id: int, question: str, options) -> bool:
    """Forget the saved answer to `question` for this kind of option list.

    Only that kind's answer goes: "Citizenship Status" forgotten on a U.S.
    status list keeps its country-list answer. An answer saved without options,
    or forgotten without them, takes the whole row. Returns whether anything
    was forgotten. Commits.
    """
    from models import UserApplyQA

    sig = question_signature(question or "")
    if not sig:
        return False
    row = (db.query(UserApplyQA)
           .filter(UserApplyQA.user_id == user_id, UserApplyQA.question_signature == sig)
           .first())
    if not row:
        return False
    variants = decode_variants(row.variants)
    labels = [str(o) for o in (options or []) if str(o or "").strip()]
    if labels and variants:
        kept = [v for v in variants if kind_score(v["options"], labels) < SAME_KIND]
        if len(kept) == len(variants):
            return False
        if kept:
            _newest_answer(row, kept)
            db.commit()
            return True
    db.delete(row)
    db.commit()
    return True


def _variant_at(row, index: int, was: str) -> list[dict]:
    variants = decode_variants(row.variants)
    if not 0 <= index < len(variants) or variants[index]["answer"] != was:
        raise ValueError("that answer changed since it was shown")
    return variants


def edit_variant(row, index: int, was: str, answer: str) -> None:
    """The profile page's edit of one kind of list's answer. `was` is the
    answer it showed: a list changed in another tab is never edited blind."""
    variants = _variant_at(row, index, was)
    variants[index]["answer"] = answer
    _newest_answer(row, variants)


def delete_variant(row, index: int, was: str) -> bool:
    """Forget one kind of list's answer. Returns True when it was the last one,
    and the row itself should go."""
    variants = _variant_at(row, index, was)
    del variants[index]
    if not variants:
        return True
    _newest_answer(row, variants)
    return False


def merge_variant(variants: list[dict], options, answer: str) -> list[dict]:
    """`variants` with this answer kept for its kind of list: replacing the one
    saved over the same kind, else added. The oldest go past MAX_VARIANTS."""
    opts = [str(o).strip()[:MAX_OPTION_CHARS] for o in (options or []) if str(o or "").strip()]
    opts = opts[:MAX_OPTIONS]
    if not _real(opts):
        return variants
    kept = [v for v in variants if kind_score(v["options"], opts) < SAME_KIND]
    kept.append({"options": opts, "answer": answer})
    return kept[-MAX_VARIANTS:]


def upsert_answers(db, user_id: int, items, embeddings: dict[str, list[float]] | None = None) -> int:
    """Insert or update answers, keyed by normalized question signature.

    `items` is any iterable of objects/dicts with `question` and `answer`, and
    optionally `options` — the list the answer was chosen from, which keeps it
    as that kind of list's answer (see pick_saved).
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
        options = _get(item, "options") or []
        if options:
            row.variants = json.dumps(merge_variant(decode_variants(row.variants), options, answer))
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
            "variants": decode_variants(r.variants),
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

    Returns {"answer", "question", "variants", "score", "confident"} or None.
    """
    from functions import cosine_similarity

    sig = question_signature(label)
    if sig:
        for a in answers:
            if a["signature"] == sig:
                return {"answer": a["answer"], "question": a["question"],
                        "variants": a.get("variants") or [],
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
        "variants": best.get("variants") or [],
        "score": best_score,
        "confident": best_score >= RECALL_AUTOFILL,
    }
