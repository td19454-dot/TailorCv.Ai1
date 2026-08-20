---
title: Portfolio SEO Guide 2026 - Getting Found by Recruiters
description: A portfolio nobody finds does nothing. How to rank for your own name, what recruiters actually search, and the technical basics that take an afternoon.
date: 2026-08-20
author: TailorCV Team
tags: [Portfolio, SEO, Personal Branding, Job Search 2026, Career Advice]
category: Portfolio
image: public/blog-images/portfolio-seo-guide.webp
slug: portfolio-seo-guide
keywords: portfolio seo, rank for your own name, personal website seo, get found by recruiters
---

## Key Takeaways

- The most important search you can win is your own name, because recruiters run it before interviews.
- Recruiters mostly search LinkedIn and GitHub rather than Google, so those profiles carry more SEO weight than your site.
- Basic on-page work — title tags, headings, descriptive text — takes an afternoon and does most of the job.
- Writing about your specialism is what makes a portfolio findable for anything beyond your name.
- Getting indexed at all requires a handful of technical basics people routinely skip.

Portfolio SEO is usually framed as a way to attract inbound opportunities, which oversells it. Very few people are hired because a recruiter found their site through a generic search.

The realistic goal is narrower and genuinely valuable: when someone searches your name — which they do, before interviews and after receiving your resume — your portfolio is what they find, rather than nothing or someone else.

This guide covers that, and the modest extra work that makes you findable for your specialism.

Before anything, make sure the resume driving people there works — the [free ATS score checker](https://www.thetailorcv.com/solutions).

---

## Win your own name first

**This is the search that matters.** Recruiters and hiring managers search candidates' names routinely, before interviews and after receiving applications.

**What you want them to find:** your portfolio, your LinkedIn and your GitHub — a consistent, professional picture.

**What you do not want:** nothing at all, an abandoned profile from a decade ago, or someone else entirely with your name.

**How to improve it:**

**Use your full name consistently** across your site, LinkedIn, GitHub and any writing. Inconsistent naming splits the signal.

**Put your name in the page title** — `Ananya Sharma — Backend Engineer`, not `Home` or `Portfolio`.

**Use it in an H1** on your homepage.

**Buy the domain in your name** if available — it is the strongest possible signal for a name search, and inexpensive. See [portfolio hosting options](https://thetailorcv.com/blog/portfolio-hosting-options-guide).

**Link your profiles to each other.** Your site links to LinkedIn and GitHub; both link back. That cluster reinforces which person you are.

**If your name is common**, add your field consistently — "Ananya Sharma backend engineer" becomes the searchable phrase.

### Search your own name now, in a private window

Do this before reading further, because what you find determines what to fix.

| What you see | What it means | What to do |
|---|---|---|
| **Your site, LinkedIn and GitHub in the top results** | Working as intended | Keep the three consistent |
| **Only an old LinkedIn, nothing else** | You have no other presence | Build the site; it will rank for a name quickly |
| **A different person entirely** | Your name is common | Add your field consistently everywhere |
| **An abandoned profile from years ago** | Stale content outranks you | Update or delete it, whichever is easier |
| **Personal social media accounts** | Recruiters see these too | Tighten the privacy settings |
| **Nothing at all** | Invisible before every interview | Any indexed page in your name fixes this |

**Log out and use a private window.** Your own search results are personalised by your history, so signed in you will see a version of yourself that nobody else sees.

---

## Where recruiters actually search

Worth being realistic about, because it changes where you spend effort.

**LinkedIn is where most sourcing happens.** Recruiters search LinkedIn's own database by title, skill and location far more than they search Google. Your LinkedIn profile is therefore doing more SEO work than your website — see [the LinkedIn profile optimization guide](https://thetailorcv.com/blog/linkedin-profile-optimization-guide).

**GitHub for technical roles.** Searchable by language and topic, and reviewers browse it directly — see [how to optimise your GitHub profile](https://thetailorcv.com/blog/github-profile-for-job-search-2026).

**Field-specific platforms** for designers, writers and photographers.

**Google, mostly for name searches** rather than discovery.

**The implication:** optimise LinkedIn and GitHub first, then your site. A perfectly optimised portfolio with a neglected LinkedIn profile is the wrong order.

---

## On-page basics

An afternoon of work, and it does most of what site-level SEO can do.

**Title tag per page.** Descriptive and unique. `Ananya Sharma — Backend Engineer` for the homepage; `Scheduling System Case Study — Ananya Sharma` for a project page. Not `Untitled` or `Home`.

**Meta description.** A sentence describing the page. It appears in search results and affects whether anyone clicks.

**One H1 per page**, containing what the page is actually about.

**Descriptive headings** through the content.

**Real text, not images of text.** Search engines cannot read text baked into a graphic — the same principle that governs [ATS resume formatting mistakes](https://thetailorcv.com/blog/ats-resume-formatting-mistakes).

**Alt text on images**, describing what they show.

**Descriptive URLs** — `/case-studies/scheduling-system` rather than `/page2`.

**Fast loading**, which is a ranking factor and also a reviewer-retention factor.

**Mobile responsive**, likewise.

### The two lines that do the most work

If you change nothing else, change these. They sit in the `<head>` of each page and they are what a searcher actually sees in the results.

```html
<title>Ananya Sharma — Backend Engineer (Python, Django)</title>
<meta name="description" content="Backend engineer in Bengaluru. I build Django and PostgreSQL systems — including a library platform that cut book issuing from 4 minutes to 30 seconds.">
```

**Why this beats the default.** `<title>Home</title>` tells a search engine nothing and tells a recruiter nothing. The version above contains your name, your role, your stack and your city — which covers both the name search and any specialism search you have a realistic chance at.

**Write a different one for every page.** Identical titles across pages actively hurt, and most site builders will happily let you ship twelve pages all titled "Portfolio".

---

## Getting indexed at all

The step people skip, which makes everything else pointless.

**Check you are indexed.** Search `site:yourdomain.com` in Google. Nothing returned means you are not in the index.

**Submit your site** to Google Search Console and Bing Webmaster Tools. Both are free and take minutes.

**Add a sitemap.** Most site builders and static generators produce one automatically.

**Check `robots.txt` is not blocking crawlers.** Some hosting platforms and builders block indexing by default on free tiers or staging URLs, which silently prevents everything.

**Check for a `noindex` tag.** Site builders frequently add one while a site is in draft and do not always remove it at publish. View the page source and search for `noindex` — if it is there, nothing you do to the content matters.

**Give it time.** Indexing takes days to weeks; a new site is not broken because it does not appear immediately.

---

## Being findable for more than your name

If you want inbound beyond name searches, one thing works reliably: **write about your specialism.**

**Technical writing, case studies and explanatory posts** are what make a site rank for anything other than your name. A portfolio of project pages alone has very little indexable substance.

**Write about what you actually do**, in the language people searching would use.

**Depth beats frequency.** Three genuinely useful pieces outperform twenty thin ones.

**This compounds slowly.** It is a long-term investment rather than a job-search tactic, and worth starting before you need it.

**A realistic expectation:** most people will not rank for competitive terms, and that is fine. The value is in having substance to point at, and in the occasional person who finds you through it.

**A useful starting point for students:** write up the thing you struggled with and solved. The problem that cost you two days and had no clear answer online is exactly the piece that ranks, because other people are searching the same words you searched. It also doubles as portfolio evidence, which makes it worth the afternoon regardless of whether it ever ranks.

---

## Common Mistakes

**Not checking whether the site is indexed.** Everything else is pointless if `site:yourdomain.com` returns nothing.

**Leaving indexing blocked by default.** Some builders and free hosting tiers block crawlers on staging or free URLs, silently.

**Leaving a `noindex` tag in from the draft stage.** Builders add it automatically and do not always remove it at publish.

**Generic page titles.** `Home` and `Portfolio` waste the single strongest on-page signal.

**Identical titles across every page.** Site builders default to this and it actively hurts.

**Searching your own name while signed in.** Personalised results show you a version of yourself nobody else sees.

**Optimising the site before LinkedIn.** Most recruiter sourcing happens inside LinkedIn's own database, so that profile does more work than your website.

**Using images of text.** Search engines cannot read it, exactly as parsers cannot read it on a resume.

**Inconsistent name usage.** Different forms across your site, LinkedIn and GitHub split the signal for your own name.

**Expecting inbound from a project gallery.** Without written substance there is very little for a search engine to index.

**Treating SEO as a short-term tactic.** Indexing takes weeks and content compounds over months — start before you need it.

---

## Frequently Asked Questions

### What is the most important portfolio SEO goal?

Ranking for your own name, because recruiters and hiring managers search it before interviews and after receiving applications.

### How do I see what a recruiter sees when they search me?

Search your name in a private browsing window while logged out. Signed in, your own history personalises the results.

### Do recruiters find candidates through Google?

Rarely for discovery. Most sourcing happens inside LinkedIn's database, and GitHub for technical roles — which is why those profiles deserve attention first.

### How do I check whether my site is indexed?

Search `site:yourdomain.com`. If nothing returns, submit the site through Google Search Console, check robots.txt, and view the page source for a leftover `noindex` tag.

### What are the essential on-page basics?

Unique descriptive title tags, a meta description, one H1 per page, real text rather than images of text, alt text, descriptive URLs, fast loading and mobile responsiveness.

### What should my homepage title tag actually say?

Your name, your role and your main tools — `Ananya Sharma — Backend Engineer (Python, Django)`. It covers both the name search and any specialism search at once.

### Will a custom domain help?

For name searches, yes — a domain in your name is the strongest single signal, and it is inexpensive.

### How do I rank for anything beyond my name?

Write about your specialism. Project pages alone give search engines very little to index; genuine explanatory writing is what makes a site findable.

### What should a student write about?

The problem that cost you two days and had no clear answer online. Other people are searching the same words you searched, and it doubles as portfolio evidence.

### How long does this take to work?

Indexing takes days to weeks. Content-driven ranking compounds over months, which is why it is worth starting before a job search rather than during one.

---

The resume is what sends people looking. [Check your ATS score free](https://www.thetailorcv.com/solutions).

## Make This Practical

Search your own name in a private window right now, logged out, and then search `site:yourdomain.com`. The first tells you what a recruiter sees before your interview; the second tells you whether your site exists as far as Google is concerned. If the second returns nothing, check robots.txt and view the page source for a leftover `noindex` before touching anything else.

Then fix your title tags. One per page, each containing your name, your role and your tools — `Ananya Sharma — Backend Engineer (Python, Django)` does more work than any other single line on your site, and most builders ship twelve pages titled "Portfolio" by default.

Finally, fix LinkedIn before the website. Most recruiter sourcing happens inside LinkedIn's own database rather than through search engines, so that profile is doing more work than your portfolio — and if you want to be found for anything beyond your name, write up the problem that cost you two days and had no answer online.
