# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TailorCV — a FastAPI monolith that tailors resumes to job descriptions with LLM calls, scores them for ATS, renders them to PDF, and wraps that in a marketing site (521 markdown blog posts, SEO landing pages), a portfolio-site builder, a Chrome extension backend, and billing.

## Commands

```bash
# Run the app (Windows, project venv)
venv/Scripts/python.exe main.py                 # single-process, no reload (default)
venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8006 --reload
.\run_local.ps1                                 # launcher: clears proxy vars, frees port 8000

# Tests — hand-rolled runners, NOT pytest. Each file is its own entry point.
python test_restore_bullets.py
python test_optimizer_postprocess.py
python test_ats_scoring.py
python test_project_links.py
python test_portfolio.py
python evals/test_graders.py

# Syntax check after touching the big files
python -m py_compile main.py functions.py

# LLM quality evals (costs API credits — see evals/README.md)
python evals/run_eval.py --dry-run
python evals/run_eval.py --models gpt-4o-mini --fixtures junior_data_analyst
```

There is no pytest, no linter, and no build step. Tests import deterministic functions directly and need no API key; a single "test" is a function inside the file's `tests` list — comment out the others or call it in a `python -c` one-liner.

**Port 8005 is the user's own dev server. Never start, restart, or kill anything on it.** Use a scratch port and stop it when done.

**Restarts:** `main.py` starts without `--reload`. Jinja templates, CSS and JS reload on their own; any change to a `.py` file needs a manual server restart. Say so proactively when you edit `main.py`, `functions.py`, `blog_system.py`, or a router.

## Architecture

**`main.py` (~12k lines)** is the app: 117 routes, the DB bootstrap, quota gating, PDF rendering, portfolio generation, and the blog/SEO routes. **`functions.py` (~4.4k lines)** is the AI and text-processing layer — prompt construction, OpenAI calls, ATS scoring, link extraction, skill gating, sanitization. Neither is organized into modules; find things by grepping for the function name. Only `linkedin`, `billing` and `feedback` live under `routers/` (`jobs` is deliberately not registered).

### The resume pipeline

`_optimize_resume_core()` ([main.py:10163](main.py#L10163)) is the spine, shared by the web flow (`/get-optimised-resume`) and the extension (`/api/extension/tailor-resume`):

```
extract_pdf_text → create_prompt → LLM → parse_ai_json_response
  → restore_dropped_bullets → restore_dropped_entries
  → inject_jd_hard_skills → inject_links → sanitize_resume_data
  → _render_resume_html → WeasyPrint
```

Post-processing exists because the model drops content on long resumes and hallucinates skills. Key invariants, all of them load-bearing and all of them regression-tested:

- **Never fabricate.** `create_prompt` Rule01/01b forbids listing a JD skill the resume shows no evidence for; `factcheck_against_original` and the `fabrication` grader police it.
- **Never lose the candidate's work.** `restore_dropped_bullets` re-attaches bullets the model silently dropped. This function has repeatedly leaked date rows and section headers back in as bullets — `test_restore_bullets.py` guards it; run that file after any change there.
- **One ATS analysis per session.** When the client forwards `ats_payload`, it is used verbatim rather than re-scored. Two LLM calls on identical input disagree, and users saw the score page list 13 missing skills while the editor listed 5. Don't reintroduce a second scoring call.
- Link recovery reads the PDF's annotation layer, not just its text — URLs are frequently invisible in extracted text.

### Rendering

Resume templates are static HTML/CSS under [resume-templates/resume-templates/](resume-templates/resume-templates/) — `html/template1..22.html` plus `css/style1..4.css`, selected by `template_id`/`style_id` and filled by `_render_resume_html()` ([main.py:10555](main.py#L10555)). PDFs come from WeasyPrint. Portfolio sites are separate Jinja themes (`templates/portfolio_*.html`), served at `/p/<slug>`.

### Data

SQLAlchemy over SQLite locally (`users.db`, gitignored) and Postgres in production via `DATABASE_URL`. **There is no Alembic.** `initialize_database()` calls `create_all` and then hand-written `_ensure_*_columns()` functions that inspect the table and `ALTER TABLE ADD COLUMN` whatever is missing, dialect-aware, on every startup. Adding a field to `models.py` is only half the change — add the matching clause to the corresponding `_ensure_*` function or production silently breaks.

### Gating

- ATS scanning is free and unlimited for logged-in users. Guests get **one** free scan, tracked by session flag plus hashed-IP row (`GuestAtsScan`); after that they hit signup. It is not fully gated behind login.
- Everything else is metered by `FREE_LIMITS` ([main.py:610](main.py#L610)) as a *lifetime* sum across all `UsageRecord` months, not per month. `enforce_quota` takes a `SELECT ... FOR UPDATE` on the user row so concurrent requests can't both spend the last credit, and raises HTTP 402 `{"error": "upgrade_required"}`. `refund_quota` undoes the increment when the LLM call afterwards fails.
- `BILLING_BETA_USER_IDS` narrows gating to specific user IDs; empty means everyone is gated.

### Blog

Markdown files in [content/blogs/](content/blogs/) with YAML-ish frontmatter (`title`, `description`, `date`, `tags`, `category`, `image`, `slug`, `keywords`), parsed by `BlogService` in [blog_system.py](blog_system.py) with an mtime-snapshot cache.

- **Files may begin with a UTF-8 BOM.** `_split_frontmatter` lstrips `﻿`; any script you write that splits on `---` must do the same or it corrupts frontmatter.
- **Much of an article's body is injected client-side by [static/blog.js](static/blog.js)** — TOC, key-takeaways box, FAQ accordion, step cards, CTAs. Read it before adding any in-article feature server-side; you will likely find it already exists.
- New blog batches need heavy internal linking (blog→blog and blog→feature pages), floor of roughly 60 links across a batch.

**Every blog post must pass three tests: buyer intent, reader value, SEO.** They reinforce each other — a post a buyer searches for and reads to the end is the post Google ranks. They only conflict when "SEO" means chasing volume, which is how the current catalogue drifted.

Context (Trisha's call, Sep 2026; TailorCV was 3 months old): the blog took daily actives 150 → 300 and the product had 3,500 registered / 10 paying users. Real early traction. But 528 of 1,025 posts are Career Advice / Job Search, much of it visa-and-relocation content (`austria-red-white-red-card`, `australia-first-job-tax-and-super`) that ranks well and brings readers months away from touching a resume, against only 64 ATS Optimization posts.

**1. Buyer intent — does this reader have a resume open right now?** If not, don't write it.
- Write for the reader mid-application: tailoring a resume, decoding a JD, fixing an ATS score, prepping an interview this week.
- Prefer ATS Optimization, Resume Examples, Resume Writing, role-specific posts (`backend-developer-resume-2026`) over country/visa/relocation guides.
- Country content only when the intent is a resume written today (`australia-resume-format-guide`, `ats-english-resume-japan`), never immigration or tax pathways.
- The post must end where the product starts. If the natural next step isn't "scan or tailor my resume," the topic is wrong — no CTA rescues it.
- Say no to a brief that would only add pageviews. Traffic that never converts hides the real conversion rate.

**2. Reader value — would they finish it, and read a second post?** Completion and return visits are the goal, not word count.
- Lead with the answer. These readers arrive mid-task from search; a 200-word wind-up loses them.
- Every section must teach something the bullets above it didn't — see the no-filler rule. Concrete examples (real bullet rewrites, real JD lines), not abstract advice.
- Write the honest answer even when it isn't the product's answer. Trust is what earns the second post and the signup.
- Earn the next click: the strongest related post, surfaced while the reader is still engaged — not a generic card grid after the CTA.

**3. SEO — rank for terms buyers actually search.** Keep it subordinate to tests 1 and 2.
- Target the query a job-seeker types mid-application, not the highest-volume adjacent term.
- Keep the internal-linking floor above; it protects the link graph. But relevance to the reader comes first — `related_posts` in [blog_system.py](blog_system.py) deliberately pads with ring/recency filler for SEO coverage, which is why its tail is often irrelevant to the reader.
- Match the frontmatter (`title`, `description`, `keywords`) to real search language, and let `description` carry the reason to click.

### Frontend

Server-rendered Jinja plus vanilla JS in [static/](static/) — no framework, no bundler, no npm build for the site itself. The site is already heavily animated (wave canvas, scroll reveals, page transitions); before building an animation, check whether it ships already.

## Working style

- Act on the request rather than asking for approval; ask only when explicitly invited to.
- **Trace the actual code before claiming a bug.** Assumptions about this codebase have been wrong more than once — the file is big, and the surprising behaviour is usually deliberate and commented.
- **Visual changes: don't iterate blind.** Ask for a screenshot or a plain description of what looks wrong, then fix it in one pass.
- **`uploads/` and other user drop folders are read-only.** Copy files out; never delete or overwrite originals.
- Real resumes are other people's personal data — `evals/fixtures/private/` is gitignored and must stay that way.

## Environment

`.env` at the project root. `OPENAI_API_KEY` is the only one required to run the core flow; `DATABASE_URL` falls back to SQLite. Also read: `SECRET_KEY`, `ENVIRONMENT`, `RESEND_API_KEY` (email), `GOOGLE_CLIENT_ID` (sign-in), `RAZORPAY_*`/`POLAR_*` (billing, region-split), `NETLIFY_AUTH_TOKEN` (portfolio deploy), `SENTRY_DSN`, `SHOW_OPTIMIZED_EDITOR`. Deployment is Render (`render.yaml`, `Procfile`); see [DEPLOYMENT.md](DEPLOYMENT.md).
