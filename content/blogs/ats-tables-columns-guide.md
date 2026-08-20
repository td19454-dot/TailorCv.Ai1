---
title: ATS Tables and Columns Guide 2026 - Why Layouts Break Parsing
description: Multi-column resumes and tables are the most common cause of parsing failure. What actually happens to your text, how to spot it, and what to use instead.
date: 2026-08-20
author: TailorCV Team
tags: [ATS Optimization, Resume Writing, Formatting, Job Search 2026]
category: ATS Optimization
image: public/blog-images/ats-tables-columns-guide.png
slug: ats-tables-columns-guide
keywords: two column resume ats, tables in resume, resume layout parsing, sidebar resume problem
---

## Key Takeaways

- A parser reads a page in a linear order, so two columns can interleave into unreadable text.
- Tables used for layout frequently lose their structure, scattering related information.
- The sidebar resume — skills on the left, experience on the right — is the most common offender.
- You cannot tell whether it worked by looking at the document; you have to check the extracted text.
- A single-column layout with clear headings loses nothing that matters and eliminates the risk.

Multi-column resumes are popular because they look organised and fit more onto a page. They are also the single most common cause of parsing failure, and the failure is invisible to the person who created the document.

That combination — attractive, widespread, and silently broken — makes this worth understanding properly rather than taking on faith.

This guide covers what actually goes wrong and how to check.

See what a parser extracts from your own file — the [free ATS score checker](https://www.thetailorcv.com/solutions).

---

## What a parser actually does

A PDF does not store "columns". It stores text elements with positions on a page.

When a parser extracts text, it has to decide what order to read those elements in. Some parsers handle multi-column layouts well; many read across the page, line by line, from left to right.

**On a two-column resume, reading across produces this:**

> Skills Senior Data Analyst
> Python, SQL Acme Corp, 2023-2026
> Tableau Built the forecasting model that
> Excel reduced stockouts by 18%

Your name, your skills and your experience are all present, and none of it means anything. A recruiter searching for "forecasting" may still hit it, but a hiring manager reading the parsed profile sees nonsense — and any structured field extraction, like matching job titles to dates, fails.

**The critical part:** your document still looks perfect. You have no indication anything went wrong.

---

## The sidebar resume

The most common version of this problem.

A narrow left column carrying your photo, contact details, skills and languages, with a wide right column for experience and education. Extremely popular in downloadable templates.

**Why it is particularly bad:** the sidebar frequently holds your contact details. If extraction scrambles or drops it, a recruiter has your experience and no way to reach you.

**It is also where photos and icons cluster**, which introduces the separate problem of text rendered as graphics — see [ATS resume formatting mistakes](https://thetailorcv.com/blog/ats-resume-formatting-mistakes).

---

## Tables

Tables cause a related but distinct problem.

**Used for layout** — an invisible table structuring your whole page — extraction may read cells in an unexpected order, or lose the relationship between them entirely.

**Used for content** — a genuine table of skills with proficiency ratings — the association between a skill and its rating frequently disappears, leaving a list of words and a list of numbers.

**Nested tables** are worse again.

**What to use instead:** ordinary paragraphs and bullet lists. Everything a layout table does on a resume can be done with normal text flow and spacing.

---

## How to check

You cannot tell by looking. Three ways to actually verify:

**1. Select all and paste.** Open your PDF, select the entire document, copy, and paste into a plain text editor. **Read the result.** That approximation of what a parser sees is usually enough to reveal a scrambled layout immediately.

**2. Run it through a parser.** A scoring tool shows you the extracted fields — whether your name, contact details, titles and dates landed where they should.

**3. Check the field mapping specifically.** Did your phone number extract? Your job titles? Your dates? Missing fields point directly at the layout element that swallowed them.

**Do this once per template.** If you change resume design, check again.

---

## What to use instead

**Single column, full width.** Everything in one flow, top to bottom.

**Standard headings** — Experience, Education, Skills, Projects — so a parser can categorise sections.

**Bullet points for lists.** Entirely safe and easier to read.

**Bold and italics** are fine, and always were.

**White space and spacing** for visual separation, rather than table borders or column rules.

**Contact details in the body**, at the top — never in a header or a sidebar.

**What you lose:** slightly less content per page. **What you gain:** a document that survives extraction. For a resume, that trade is not close.

---

## When two columns are acceptable

Narrow cases, and they require verification.

**If you have verified extraction works** for your specific document with your specific parser, and you are applying somewhere you know reviews resumes manually.

**Design and creative roles** where you also submit a portfolio and the resume is reviewed by a human — though even then, applications frequently pass through a system first.

**A short skills line** rendered as two columns of a few words is lower risk than a full-height sidebar.

**The general rule stands:** if you cannot verify it, do not risk it. The cost of being invisible is total, and the benefit of the layout is aesthetic.

---

## Common Mistakes

**Assuming it looks fine so it parses fine.** The document appearing correct tells you nothing about extraction, and this is why the failure is so widespread.

**Using a sidebar for contact details.** If it is scrambled or dropped, a recruiter has your experience and no way to contact you.

**Using tables for layout.** Cell order and relationships are frequently lost, scattering related information.

**Putting skills and proficiency ratings in a table.** The association between them typically disappears entirely.

**Never doing the select-all-and-paste check.** It takes thirty seconds and reveals the problem immediately.

**Changing template without re-checking.** Each design has its own extraction behaviour.

**Prioritising content density over readability.** Fitting more on a page is worthless if the page cannot be read by the system.

**Trusting a template because it is marketed as ATS-friendly.** Verify it yourself rather than taking the claim on faith.

---

## Frequently Asked Questions

### Are two-column resumes bad for ATS?

They are the most common cause of parsing failure. Some parsers handle them; many read across the page and interleave your columns into unreadable text.

### Why are tables a problem?

Layout tables can be read in unexpected cell order, and content tables frequently lose the association between related cells — a skill and its rating, for instance.

### How do I know if my layout parses correctly?

Select all the text in your PDF, copy it, and paste into a plain text editor. If the result is scrambled or interleaved, so is what the parser sees.

### What is wrong with a sidebar?

It usually carries your contact details, and losing those means a recruiter has your experience with no way to reach you.

### Can I use bullet points?

Yes. Bullets, bold and italics are all safe. The problems come from tables, text boxes, columns and text inside images.

### Are templates advertised as ATS-friendly reliable?

Not automatically. Verify by extracting the text yourself rather than trusting the description.

### What if I need more space?

Cut content or reduce margins rather than adding a column. A shorter readable resume beats a denser unreadable one.

---

Check what a parser actually extracts from your resume. [Check your ATS score free](https://www.thetailorcv.com/solutions).

## Make This Practical

Select all the text in your resume PDF, copy it, and paste it into a plain text editor. Read what comes out — if your skills are interleaved with your job titles, that is exactly what a parser sees, and your document looking perfect told you nothing.

Then move to a single-column layout with standard headings and your contact details in the body rather than a header or sidebar. Bullets, bold and white space are all safe, so you lose almost nothing except a little content density.

Finally, re-run the check whenever you change template. Each design behaves differently under extraction, and a template marketed as ATS-friendly is a claim to verify rather than trust.
