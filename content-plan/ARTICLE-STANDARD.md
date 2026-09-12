# TailorCV article standard

Derived from the strongest existing posts (`germany-lebenslauf-cv-format`,
`india-jobs-for-graduates-guide`, `chrome-extension-apply-on-indeed-guide`).
Every new article must meet these. Enforced by `content-plan/check_article.py`.

## Hard minimums

| Property | Minimum | Target | Why |
|---|---|---|---|
| Words | 2,000 | 2,200–2,600 | 9–10 min read at ~250 wpm |
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
