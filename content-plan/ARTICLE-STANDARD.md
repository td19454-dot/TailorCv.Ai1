# TailorCV article standard

Derived from the strongest existing posts (`germany-lebenslauf-cv-format`,
`india-jobs-for-graduates-guide`, `chrome-extension-apply-on-indeed-guide`).
Every new article must meet these. Enforced by `content-plan/check_article.py`.

## The one non-negotiable: read time

**Every article must be at least 12 minutes of genuine reading time**, measured
at the rate the site itself uses. `blog_system.WORD_PER_MINUTE` is **220**, so:

- 12 minutes = **2,640 words** (hard floor, article is not publishable below this)
- 13 minutes = **2,860 words** (target)

`check_article.py` imports that constant live from `blog_system.py`, so the
validator can never drift from the number the reader sees on the page. Do not
hardcode a words-per-minute rate anywhere.

Anything under 12 minutes is a failure. If an article comes in short, keep
expanding it with genuinely useful material until it clears 12 minutes.
Never pad.

### What earns the extra 600+ words

Going from 9 to 12 minutes must add substance, not volume. In priority order:

1. **A second worked example** with different circumstances from the first —
   different seniority, industry, or constraint.
2. **A decision table** — when to do X vs Y, by situation.
3. **Edge cases and exceptions** — the "but what if" the reader is already
   thinking. This is the highest-value addition and the most commonly skipped.
4. **A step-by-step walkthrough** with the actual keystrokes or wording.
5. **What this looks like at different levels** — fresher vs mid vs senior.
6. **Two or three more FAQs** drawn from real follow-up questions.
7. **A "common mistakes" section** naming specific failure patterns.

### But length is the symptom, not the goal

The target is NOT "make this 12 minutes long." It is "make this so useful that
a reader willingly spends 12 minutes on it." An article that hits 2,640 words
by restating itself has failed even though the checker passes it.

The checker now flags near-duplicate sentences, but it cannot catch a section
that adds nothing. That judgement stays with the writer.

The word count is a floor that catches thin work. It cannot detect padding, so
that judgement stays with the writer. Two tests before calling an article done:

1. **Delete test.** Could any section be deleted without the reader losing
   something? If yes, it was padding — cut it and add something real instead.
2. **Next-section test.** At the end of each section, does the reader have a
   reason to continue? If a section resolves everything, it belongs later.

### Engagement rules

- **Open on the reader's problem, not context.** First two sentences name the
  situation they are in. No "in today's job market", no defining terms nobody
  asked about, no explaining what the article will cover.
- **Front-load the answer.** Give the short answer early, then earn the rest of
  the read with depth, edge cases, examples and the reasoning behind it.
- **Every section must teach something new.** Restating the bullets above it is
  the failure mode CLAUDE.md calls garbage. If a section paraphrases an earlier
  one, merge them.
- **Escalate specificity.** Move from principle to worked example to edge case.
  A reader stays when each section is more concrete than the last.
- **Vary the texture.** Prose, table, blockquote example, checklist, scenario.
  Three consecutive prose sections is where readers leave.
- **Short paragraphs — 1–3 sentences.** Long blocks read as walls on a phone.
- **Earn each heading.** A heading promises something; the section must deliver
  it within two sentences.
- **Close with what to do now**, not a summary of what was already said.

## Hard minimums

| Property | Minimum | Target | Why |
|---|---|---|---|
| Words | 2,640 | 2,860–3,200 | 12–13 min read at the site's 220 wpm |
| H2 sections | 11 | 13–16 | Scannable structure at this length |
| H3 subsections | 12 | 16–22 | Depth inside sections; mobile scanning |
| Table rows | 12 | 18–24 | Comparisons, options, before/after |
| Internal blog links | 15 | 20–25 | Topical authority + discovery |
| Product/feature links | 2 | 3–5 | Natural next step |
| FAQ questions | 8 | 10–12 | People Also Ask coverage |
| Worked examples | 3 | 5–7 | Concrete > abstract |

No H2 section may exceed ~400 words without at least two H3s inside it. The
checker enforces this — at 2,640 words, an unbroken section is where readers
leave.

## Structure

Not a rigid template — vary the middle per topic. But every article has:

1. **Key Takeaways** — 5–6 bullets, each a real finding, not a teaser.
2. **Direct opening** — 2–4 sentences. Answer the query immediately. No wind-up.
3. **Body** — 8–13 H2 sections with H3s inside. Vary the shape:
   - diagnostic ladder (symptom → cause → fix)
   - scenario walkthroughs ("Scenario 1: you are applying to…")
   - do/don't split
   - section-by-section breakdown
   - comparison table + explanation
4. **At least one comparison table** — options, before/after, country/role/level differences.
5. **Worked examples in blockquotes** — real bullet rewrites, real JD lines, real numbers.
6. **Common mistakes** section where the topic supports it.
7. **FAQ** — 8–10 questions as H3, each answered in 2–4 sentences.
8. **Conclusion / next steps** — what to do now, then the product CTA framed honestly.

## Internal linking — the part that was worst

**Weave links through the prose.** The house style links a natural noun phrase
mid-sentence (`[recruiters](/blog/how-recruiters-read-resumes)`), NOT a
"Related:" list at the bottom. A trailing related-links block is fine as well,
but it does not count toward the minimum.

Rules:
- Anchor text is the descriptive phrase, never "click here" or the raw slug.
- Spread across the whole article — every H2 section should contain at least one.
- Only link where genuinely relevant. A forced link is worse than no link.
- **Verify every target exists** before writing it. Use `check_article.py`.
- Link to planned-but-unwritten posts only when that post is in
  `tailorcv_1000_topics.json` — it resolves when that batch lands.

Product pages that exist (verified against main.py routes):
`/ats-analysis`, `/solutions`, `/portfolio`, `/cover-letter`, `/mock-interview`,
`/templates`, `/extension`, `/pricing`.

## Voice

- Short paragraphs, 1–3 sentences. Mobile-first.
- Second person. Concrete nouns. No "in today's competitive job market".
- Say the honest thing even when it is not the product's answer.
- Every section teaches something the bullets above it did not.
