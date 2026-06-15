# Blog SEO Audit — Cannibalization Cleanup (2026-06-08)

**Problem:** 180 blog posts, many competing for the same keywords ("Discovered –
currently not indexed" in Search Console). Google rations indexing when it sees
large clusters of near-duplicate content. Fix = consolidate duplicates into
strong "pillar" posts, prune/de-index thin pages, build authority (backlinks).

**Mechanism used:** `BLOG_REDIRECTS` in `main.py` 301-redirects merged slugs to
their pillar and drops them from the sitemap. Source `.md` files stay on disk
(reversible). No content is deleted.

---

## ✅ DONE — 27 duplicates merged via 301 (see BLOG_REDIRECTS in main.py)

### "Check my ATS score free" → `ats-score-checker-free`
- how-to-check-ats-score-free
- free-ats-resume-scan
- ats-resume-checker-how-it-works
- does-my-resume-pass-ats

### "What is an ATS score / good score"
- ats-score-vs-resume-score → what-is-a-good-ats-score
- what-is-an-ats-score-...-human-reads-it → ats-score-guide

### "ATS mistakes" (kept: ats-keyword-mistakes, ats-resume-formatting-mistakes)
- ats-mistakes-tech-professionals → ats-keyword-mistakes
- ats-mistakes-experienced-professionals → ats-keyword-mistakes
- hidden-ats-mistakes-job-search → ats-keyword-mistakes

### "Resume matching to JD" → `resume-matching-with-job-description-complete-guide`
(except where noted → `how-to-tailor-resume-for-every-job`)
- how-to-match-resume-keywords-to-job-description
- how-to-match-resume-to-job-description-fast → how-to-tailor-resume-for-every-job
- improve-resume-job-match-score
- resume-job-description-match-percentage
- resume-matching-checklist
- resume-matching-for-multiple-jobs
- why-resume-doesnt-match-job-description
- common-resume-job-description-mismatch-mistakes
- what-recruiters-look-for-resume-job-match
- how-ai-resume-matching-works
- resume-skills-match-job-description
- resume-summary-match-job-description
- how-to-match-resume-to-remote-job-description
- overqualified-resume-match-job-description
- resume-matching-experienced-professionals
- resume-matching-for-career-changers
- resume-matching-marketing
- resume-matching-product-manager

### Kept pillars (do NOT redirect — link TO these)
- resume-optimization-guide
- how-to-tailor-resume-for-every-job
- resume-matching-with-job-description-complete-guide
- resume-matching-software-engineer, resume-matching-data-analyst, resume-matching-no-experience (persona pages with real demand)

---

## ⏭️ TODO — Thin "X-resume-2026" examples (NOT duplicates → noindex or improve, don't redirect)

These are unique-role pages but thin + low search volume. Either expand to
1,500+ words with genuinely unique guidance, or add `noindex` to keep them live
without diluting crawl budget. Candidates (word count):
- physiotherapist-resume-2026 (910)
- pharmacist-resume-2026 (942)
- recruiter-resume-2026 (963)
- python-developer-resume-2026 (978)  ← high demand, EXPAND don't cut
- java-developer-resume-2026 (979)    ← high demand, EXPAND don't cut
- scrum-master-resume-2026 (991)
- supply-chain-manager-resume-2026 (998)
- golang-developer-resume-2026 (1028)
- social-media-manager-resume-2026 (1030)
- consultant-resume-2026 (1055)
- accountant-resume-2026 (1085)
- flutter-developer-resume-2026 (1089)

## ⏭️ TODO — Category taxonomy cleanup
Merge `Career Advice` + `Career Growth` + `Career Development` → one **Career**
category. Clarify `Resume Writing` vs `Resume Optimization` boundary.

---

## 🎯 Money pages — prioritize internal links + Request Indexing in GSC
ats-score-guide · ats-score-checker-free · ats-friendly-resume-builder ·
how-to-make-resume-ats-friendly · resume-optimization-guide ·
how-to-tailor-resume-for-every-job · resume-matching-with-job-description-complete-guide ·
how-to-write-resume-from-scratch · how-to-write-resume-with-ai ·
mock-interview-practice-online-free-ai · technical-skills-in-resume-for-freshers ·
resume-mistakes-every-fresher-makes · how-to-get-first-tech-job ·
how-to-prepare-for-campus-placement · data-analyst-resume-2026 ·
software-engineer-resume-faang · how-to-prepare-for-a-job-interview-2026 ·
how-to-get-a-job-with-no-experience

---

## Off-page (the real unlock for "Discovered – not indexed")
1. Build 5–10 quality backlinks (Reddit, LinkedIn, dev/student communities, directories, a guest post).
2. Request Indexing for the money pages in Search Console.
3. STOP publishing new posts until indexing recovers.
