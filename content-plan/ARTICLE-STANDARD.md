# TailorCV article standard

Derived from the strongest existing posts (`germany-lebenslauf-cv-format`,
`india-jobs-for-graduates-guide`, `chrome-extension-apply-on-indeed-guide`).
Every new article must meet these. Enforced by `content-plan/check_article.py`.

## The one non-negotiable: read time

**Every article must be at least 9 minutes of genuine reading time**, measured
at the rate the site itself uses. `blog_system.WORD_PER_MINUTE` is **220**, so:

- 9 minutes = **1,980 words** (hard floor, article is not publishable below this)
- 10 minutes = **2,200 words** (target)

`check_article.py` imports that constant live from `blog_system.py`, so the
validator can never drift from the number the reader sees on the page. Do not
hardcode a words-per-minute rate anywhere.

4–8 minutes is a failure. If an article comes in short, keep expanding it with
genuinely useful material — more worked examples, a comparison table, a
scenario walkthrough, deeper FAQs — until it clears 9 minutes. Never pad.

### But length is the symptom, not the goal

The target is NOT "make this 10 minutes long." It is "make this so useful that
a reader willingly spends 10 minutes on it." An article that hits 2,200 words
by restating itself has failed even though the checker passes it.

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
| Words | 1,980 | 2,200–2,600 | 9–10 min read at the site's 220 wpm |
| H2 sections | 8 | 10–13 | Scannable structure |
| H3 subsections | 6 | 12–16 | Depth inside sections; mobile scanning |
| Table rows | 6 | 10–16 | Comparisons, options, before/after |
| Internal blog links | 12 | 18–22 | Topical authority + discovery |
| Product/feature links | 2 | 3–5 | Natural next step |
| FAQ questions | 6 | 8–10 | People Also Ask coverage |
| Worked examples | 2 | 3–5 | Concrete > abstract |

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
