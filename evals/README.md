# Resume optimizer eval harness

Turns "is the tailoring any good?" into numbers you can compare across models
and across changes to the prompt or post-processing.

```bash
python evals/test_graders.py                        # offline, no API key
python evals/run_eval.py --dry-run                  # shows what would run, no cost
python evals/run_eval.py                            # gpt-4o-mini vs gpt-4o
python evals/run_eval.py --models gpt-4o-mini --fixtures junior_data_analyst
```

Results land in `evals/results/<timestamp>.{json,md}` — the `.md` is the
comparison table, the `.json` has every tailored resume in full. Both are
gitignored.

## What it runs

The real production path from `_optimize_resume_core()` (main.py:9333), minus
the PDF-annotation link recovery (needs a real PDF, orthogonal to rewrite
quality):

```
create_prompt -> model -> parse_ai_json_response -> restore_dropped_bullets
              -> inject_jd_hard_skills -> sanitize_resume_data
```

Two snapshots get graded, and the gap between them is the interesting part:

- **raw** — straight out of the model. Measures the *model*.
- **final** — after post-processing. Measures the *product*.

Skill gating is graded on `raw` on purpose. `inject_jd_hard_skills` rebuilds the
skills array afterwards, so grading `final` would always look perfect and tell
you nothing about whether the model follows the rules on its own. A model that
only passes because the post-processor rescues it will also be inventing
evidence in the bullets, where nothing is watching.

## Graders

All deterministic — regex and counting, no LLM judge, so the same output always
grades identically. Weights in `graders.WEIGHTS` encode the product's priorities:
never lie, never lose the candidate's work, never claim an unbacked skill.

| Grader | Weight | Catches |
|---|---|---|
| `fabrication` | 25% | Employers, schools, years, numbers not in the original |
| `preservation` | 20% | Entries and bullets silently dropped |
| `skill_gating` | 15% | JD skills claimed without evidence (Rule01/01b) |
| `evidence` | 15% | JD vocabulary in bullets, not just the skills list |
| `bullets` | 15% | Strong verbs, metrics, length, keyword stuffing |
| `links` | 5% | URLs lost from the original |
| `cleanliness` | 3% | Pronouns, stray bullet chars, unbalanced parens |
| `schema` | 2% | Malformed payloads the renderer would choke on |

The composite is for ranking models. Read the columns before believing it — two
models can tie overall while failing in completely different places.

## Fixtures

A fixture is a directory with `resume.txt`, `jd.txt` and `meta.json`. The meta
carries hand-written ground truth, which is what makes preservation and gating
measurable rather than guesswork:

```json
{
  "expected_counts":      { "experience": 2, "projects": 3 },
  "expected_entry_names": ["nexora", "sentiment"],
  "unevidenced_jd_skills": ["Power BI", "Tableau"]
}
```

`unevidenced_jd_skills` is the sharp one: JD skills the candidate genuinely does
not have. Any model that lists them is fabricating credentials.

Two synthetic fixtures are committed. To add a real one:

```bash
python evals/make_fixture.py uploads/<file>.pdf --jd samplejd.txt --name my_case
```

That writes to `fixtures/private/`, which is **gitignored** — real resumes are
other people's personal data and must never be committed. Then fill in
`meta.json` by hand; the graders are only as honest as that file.

## Known limitations

- **The harness uses the regex JD extractor; production no longer does.**
  `_optimize_resume_core` now takes its JD skill list from the ATS analysis
  (`ats_scoring`), which understands "PostgreSQL or MySQL" and required vs
  preferred. `run_eval.py` deliberately calls `inject_jd_hard_skills` without
  that list, so a run stays deterministic and costs one LLM call instead of
  two. Consequence: the `skill_gating` and `evidence` columns are measured
  against `_extract_hard_skills_from_jd`, not against what a real user now
  sees. They remain valid as a *model-behaviour probe* — every model is scored
  against the same list — but they are no longer the production gap list.
- `_extract_hard_skills_from_jd` returns sentence fragments alongside real
  skills ("another cloud data warehouse", "consumer goods analytics",
  "e-commerce"). These inflate the denominator, so `evidence` and
  `skill_gating` scores read lower than reality. Fine for A/B comparison —
  every model gets the same inflated denominator — but don't read the absolute
  numbers as truth.
- Matching is literal (`_contains_skill` is a word-boundary regex). A resume
  that migrated Jenkins to GitHub Actions still scores `CI/CD` as missing.
- Fixture count is small. Two fixtures catch gross regressions, not subtle
  wording quality. Add real ones before making a close call on model choice.
