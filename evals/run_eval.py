"""Offline A/B harness for the resume-tailoring pipeline.

Runs real resume/JD fixtures through the production tailoring path against one
or more models and grades the output deterministically, so "does a bigger model
actually write better resumes" becomes a number instead of an impression.

    python evals/run_eval.py                                  # default models
    python evals/run_eval.py --models gpt-4o-mini,gpt-4o
    python evals/run_eval.py --fixtures junior_data_analyst --runs 2
    python evals/run_eval.py --dry-run                        # no API calls

This calls the real OpenAI API and therefore costs money and needs
OPENAI_API_KEY. It is deliberately NOT named test_*.py: the repo's test files
run offline with no key, and this must never be swept into that suite.

The pipeline mirrors _optimize_resume_core() (main.py:9333) exactly, minus the
PDF-annotation link recovery, which needs a real PDF and is orthogonal to
rewrite quality:

    create_prompt -> model -> parse_ai_json_response -> restore_dropped_bullets
                  -> inject_jd_hard_skills -> sanitize_resume_data

Both the pre-injection ("raw") and post-processed ("final") payloads are kept,
because some graders can only see the truth in one or the other.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = EVAL_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))

import functions  # noqa: E402
from functions import (  # noqa: E402
    create_prompt,
    get_resume_response,
    inject_jd_hard_skills,
    sanitize_resume_data,
)

import graders  # noqa: E402  (same directory)

FIXTURES_DIR = EVAL_DIR / "fixtures"
RESULTS_DIR = EVAL_DIR / "results"

DEFAULT_MODELS = ["gpt-4o-mini", "gpt-4o"]

# USD per 1M tokens. Verify against current OpenAI pricing before trusting the
# cost column - these move, and a stale number here turns into a bad decision
# about which model to ship. Unknown models simply report no cost.
PRICES = {
    "gpt-4o-mini": {"in": 0.15, "out": 0.60},
    "gpt-4o": {"in": 2.50, "out": 10.00},
}


# --------------------------------------------------------------------------
# Token accounting
# --------------------------------------------------------------------------

class _CompletionsProxy:
    """Records usage from every create() call, including the continuation calls
    get_resume_response() makes when a long resume overflows max_tokens - those
    are real money and real latency, and a model that needs three of them is
    more expensive than its per-token price suggests."""

    def __init__(self, real, sink):
        self._real = real
        self._sink = sink

    async def create(self, **kwargs):
        response = await self._real.create(**kwargs)
        usage = getattr(response, "usage", None)
        if usage is not None:
            self._sink.append({
                "prompt_tokens": getattr(usage, "prompt_tokens", 0) or 0,
                "completion_tokens": getattr(usage, "completion_tokens", 0) or 0,
            })
        return response


class _ChatProxy:
    def __init__(self, real, sink):
        self.completions = _CompletionsProxy(real.completions, sink)


class _ClientProxy:
    def __init__(self, real, sink):
        self.chat = _ChatProxy(real.chat, sink)


async def _install_usage_recorder() -> list[dict]:
    """Wrap the module-level OpenAI client so usage is observable.

    get_resume_response() returns only the text content, so there is no other
    way to see token counts without duplicating its continuation logic here -
    and a duplicated copy would drift from production.
    """
    real = await functions._build_openai_client()
    sink: list[dict] = []
    if not isinstance(real, _ClientProxy):
        functions._openai_client = _ClientProxy(real, sink)
    else:
        functions._openai_client._chat_sink = sink  # pragma: no cover
    return sink


def _cost(model: str, prompt_tokens: int, completion_tokens: int):
    price = PRICES.get(model)
    if not price:
        return None
    return round(prompt_tokens / 1e6 * price["in"] + completion_tokens / 1e6 * price["out"], 5)


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------

def load_fixtures(only: list[str] | None) -> list[dict]:
    """Fixture = a directory holding resume.txt, jd.txt and meta.json.

    Anything under fixtures/private/ is gitignored, which is where real
    candidate resumes belong - they are other people's personal data and must
    not be committed.
    """
    found: list[dict] = []
    roots = [FIXTURES_DIR] + ([FIXTURES_DIR / "private"] if (FIXTURES_DIR / "private").is_dir() else [])

    for root in roots:
        for d in sorted(p for p in root.iterdir() if p.is_dir() and p.name != "private"):
            resume, jd, meta = d / "resume.txt", d / "jd.txt", d / "meta.json"
            if not (resume.exists() and jd.exists()):
                continue
            if only and d.name not in only:
                continue
            found.append({
                "name": d.name,
                "private": root.name == "private",
                "resume_text": resume.read_text(encoding="utf-8"),
                "jd_text": jd.read_text(encoding="utf-8"),
                "meta": json.loads(meta.read_text(encoding="utf-8")) if meta.exists() else {},
            })
    return found


# --------------------------------------------------------------------------
# One run
# --------------------------------------------------------------------------

async def run_one(fixture: dict, model: str, usage_sink: list[dict]) -> dict:
    """Tailor one resume with one model and grade the result."""
    # main.py is a 505KB module that builds a FastAPI app at import time, so it
    # is imported lazily and once, only when a run actually needs it.
    from main import parse_ai_json_response, restore_dropped_bullets

    resume_text, jd_text = fixture["resume_text"], fixture["jd_text"]
    prompt = create_prompt(resume_text, jd_text)

    usage_sink.clear()
    started = time.perf_counter()
    try:
        response = await get_resume_response(prompt, model=model)
    except Exception as exc:
        return {
            "fixture": fixture["name"], "model": model, "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
            "latency_s": round(time.perf_counter() - started, 2),
        }
    latency = round(time.perf_counter() - started, 2)

    try:
        raw = parse_ai_json_response(response)
    except Exception as exc:
        return {
            "fixture": fixture["name"], "model": model, "ok": False,
            "error": f"unparseable JSON: {type(exc).__name__}: {exc}",
            "latency_s": latency,
            "raw_response_head": response[:400],
        }

    # Mirrors production order (main.py:9361, 9407, 9586). `raw` is deep-copied
    # first because the post-processors mutate in place, and skill gating can
    # only be measured before inject_jd_hard_skills rewrites the skills array.
    raw_snapshot = json.loads(json.dumps(raw))
    final = restore_dropped_bullets(raw, resume_text)
    final = inject_jd_hard_skills(final, jd_text, resume_text)
    final = sanitize_resume_data(final)

    prompt_tokens = sum(u["prompt_tokens"] for u in usage_sink)
    completion_tokens = sum(u["completion_tokens"] for u in usage_sink)

    scored = graders.grade_all(raw_snapshot, final, resume_text, jd_text, fixture["meta"])

    return {
        "fixture": fixture["name"], "model": model, "ok": True,
        "latency_s": latency,
        "api_calls": len(usage_sink),
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost_usd": _cost(model, prompt_tokens, completion_tokens),
        "composite": scored["composite"],
        "parts": scored["parts"],
        "skill_gaps": final.get("skill_gaps") or [],
        "output": final,
    }


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------

def _mean(values):
    vals = [v for v in values if isinstance(v, (int, float))]
    return round(statistics.mean(vals), 1) if vals else None


def build_report(results: list[dict], models: list[str]) -> str:
    ok = [r for r in results if r.get("ok")]
    failed = [r for r in results if not r.get("ok")]

    lines = [
        "# Resume optimizer eval",
        "",
        f"Generated {datetime.now():%Y-%m-%d %H:%M}  |  {len(ok)} successful runs"
        + (f", {len(failed)} failed" if failed else ""),
        "",
        "## Overall by model",
        "",
        "| Model | Composite | Fabrication | Preservation | Skill gating | Evidence | Bullets | Latency | Cost/run |",
        "|---|---|---|---|---|---|---|---|---|",
    ]

    for model in models:
        rows = [r for r in ok if r["model"] == model]
        if not rows:
            lines.append(f"| {model} | — (all runs failed) | | | | | | | |")
            continue
        part = lambda key: _mean([r["parts"][key]["score"] for r in rows])  # noqa: E731
        costs = [r["cost_usd"] for r in rows if r.get("cost_usd") is not None]
        lines.append(
            f"| `{model}` | **{_mean([r['composite'] for r in rows])}** "
            f"| {part('fabrication')} | {part('preservation')} | {part('skill_gating')} "
            f"| {part('evidence')} | {part('bullets')} "
            f"| {_mean([r['latency_s'] for r in rows])}s "
            f"| {('$' + format(statistics.mean(costs), '.4f')) if costs else 'n/a'} |"
        )

    lines += ["", "## Per fixture", ""]
    for fixture in sorted({r["fixture"] for r in ok}):
        lines += [f"### {fixture}", "",
                  "| Model | Composite | Entries dropped | Fabrications | Unevidenced skills claimed | Strong verbs | Quantified | JD in bullets |",
                  "|---|---|---|---|---|---|---|---|"]
        for model in models:
            rows = [r for r in ok if r["fixture"] == fixture and r["model"] == model]
            if not rows:
                continue
            p = [r["parts"] for r in rows]
            leaked = sorted({s for r in p for s in r["skill_gating"]["declared_gaps_leaked"]})
            dropped = sorted({n for r in p for n in r["preservation"]["dropped_names"]})
            lines.append(
                f"| `{model}` | {_mean([r['composite'] for r in rows])} "
                f"| {_mean([r['preservation']['entries_dropped'] for r in p])}"
                f"{(' (' + ', '.join(dropped) + ')') if dropped else ''} "
                f"| {_mean([r['fabrication']['finding_count'] for r in p])} "
                f"| {', '.join(leaked) if leaked else 'none'} "
                f"| {_mean([r['bullets']['strong_verb_pct'] for r in p])}% "
                f"| {_mean([r['bullets']['quantified_pct'] for r in p])}% "
                f"| {_mean([r['evidence']['bullets_pct'] for r in p])}% |"
            )
        lines.append("")

    if failed:
        lines += ["## Failed runs", ""]
        for r in failed:
            lines.append(f"- `{r['model']}` / {r['fixture']}: {r['error']}")
        lines.append("")

    lines += [
        "## How to read this",
        "",
        "- **Fabrication** and **preservation** outrank everything else: an invented employer or a",
        "  silently dropped job is a product failure, while a slightly flat bullet is not.",
        "- **Skill gating** is measured on the raw model output, before `inject_jd_hard_skills`",
        "  rebuilds the skills array. It answers whether the model follows Rule01 on its own —",
        "  a model that only passes because the post-processor rescues it will also be inventing",
        "  evidence in the bullets, where nothing is watching.",
        "- **Unevidenced skills claimed** lists JD skills the fixture declares the candidate does",
        "  not have, that the model put in `skills` anyway. Anything but `none` is a red flag.",
        "- **Evidence / JD in bullets** is the product thesis: JD vocabulary appearing in real",
        "  achievements rather than in a comma-separated list.",
        "- The composite exists to rank models. Read the columns before believing it.",
    ]
    return "\n".join(lines)


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

async def main_async(args) -> int:
    fixtures = load_fixtures(args.fixtures.split(",") if args.fixtures else None)
    if not fixtures:
        print("No fixtures found under evals/fixtures/", file=sys.stderr)
        return 1

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    total = len(fixtures) * len(models) * args.runs

    print(f"Fixtures: {', '.join(f['name'] + (' [private]' if f['private'] else '') for f in fixtures)}")
    print(f"Models:   {', '.join(models)}")
    print(f"Runs:     {args.runs}  ->  {total} API-backed runs\n")

    if args.dry_run:
        for f in fixtures:
            prompt = create_prompt(f["resume_text"], f["jd_text"])
            print(f"  {f['name']}: prompt {len(prompt):,} chars (~{len(prompt)//4:,} tokens), "
                  f"meta expects {sum((f['meta'].get('expected_counts') or {}).values())} entries")
        print("\nDry run - no API calls made.")
        return 0

    usage_sink = await _install_usage_recorder()

    results: list[dict] = []
    done = 0
    for fixture in fixtures:
        for model in models:
            for run in range(args.runs):
                done += 1
                print(f"[{done}/{total}] {fixture['name']} x {model} (run {run + 1})... ", end="", flush=True)
                result = await run_one(fixture, model, usage_sink)
                result["run"] = run + 1
                results.append(result)
                if result["ok"]:
                    print(f"composite {result['composite']}  ({result['latency_s']}s, "
                          f"{result['api_calls']} call(s))")
                else:
                    print(f"FAILED - {result['error']}")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    raw_path = RESULTS_DIR / f"{stamp}.json"
    raw_path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    report = build_report(results, models)
    report_path = RESULTS_DIR / f"{stamp}.md"
    report_path.write_text(report, encoding="utf-8")

    print("\n" + report)
    print(f"\nFull payloads: {raw_path}\nReport:        {report_path}")
    return 0 if any(r.get("ok") for r in results) else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="A/B the resume tailoring pipeline across models.")
    parser.add_argument("--models", default=",".join(DEFAULT_MODELS),
                        help=f"comma-separated model ids (default: {','.join(DEFAULT_MODELS)})")
    parser.add_argument("--fixtures", default="", help="comma-separated fixture names (default: all)")
    parser.add_argument("--runs", type=int, default=1,
                        help="runs per fixture/model. temperature=0 and a fixed seed make output "
                             "near-deterministic, so 1 is usually enough; raise it to measure variance")
    parser.add_argument("--dry-run", action="store_true", help="show what would run, make no API calls")
    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
