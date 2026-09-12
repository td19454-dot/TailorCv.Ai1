---
title: Parsing Errors That Silently Delete an Entire Job
description: A whole role can vanish between your PDF and the recruiter's screen, with no error and no warning. Here are the five structures that cause it.
date: 2026-09-12
author: TailorCV Team
tags: [ATS Optimization, ATS Resume, Resume Writing, Resume Tips, Job Applications]
category: ATS Optimization
slug: parsing-errors-delete-a-job
keywords: resume parsing deleted job, ats missing work experience, resume section not parsed, ats dropped my job
image: public/blog-images/parsing-errors-delete-a-job.png
---

## Key Takeaways

- Whole roles disappear when they sit in a text box, a table cell, a second column, or after a page break that splits them.
- Nothing warns you - your PDF looks complete and the extracted text is missing a job.
- A deleted role usually also breaks your computed experience total and can invent a gap.
- The copy-paste test catches every version of this in under a minute.
- The fix is structural: plain body text, single column, one role per contiguous block.

There is a specific failure worse than a low score: a role that never arrives. Your resume shows five jobs; the recruiter's system shows four, with an unexplained two-year gap where the missing one was.

No error is raised. Your PDF is fine. The job is simply gone.

## The Five Causes

### 1. The role sits in a text box

Design-tool templates frequently build each section as a separate text frame. A parser reading the document's content stream may take the frames in an unpredictable order, or skip one entirely.

**The tell:** an entire block missing from your copy-paste, while everything around it is present.

### 2. The role is inside a table cell

Tables are handled inconsistently. Some parsers read cell by cell in the right order; others flatten row-first, interleaving content from adjacent cells; a few skip nested tables.

**The tell:** your job title arriving on the same line as an unrelated fragment, or bullets appearing without their role heading.

### 3. The role is in the second column

A parser that reads down the left column and then down the right will produce roughly correct output. One that reads across each horizontal band will shred both columns together. Which behaviour you get is not predictable from looking at the page.

**The tell:** alternating fragments - title, skill, employer, skill, date.

### 4. A page break splits the role

Your job title sits at the bottom of page one; its bullets continue on page two. Some parsers treat each page as a unit and fail to reconnect them, leaving orphaned bullets with no employer and a title with no content.

**The tell:** bullets appearing under the wrong job, or a title immediately followed by the next role's title.

### 5. The section heading is unrecognised

Parsers use headings to identify sections. "Professional Journey," "Where I've Worked," or "Career Highlights" may not be recognised as the experience section, so the content is filed as unclassified text and may not appear in the structured work-history view at all.

**The tell:** your jobs present in the raw text but absent from any structured summary.

## Why It Matters More Than a Low Score

A deleted role has knock-on effects that compound.

**Your experience total shrinks.** If the system computes years from the roles it found, a missing job reduces your total - potentially below a filter threshold.

**You acquire a gap you never had.** The dates on either side of the missing role no longer connect. You now appear to have been unemployed for two years, and if anyone asks, you will not know why they think so.

**Your career story stops making sense.** A progression from analyst to senior analyst to manager reads oddly when the middle step is absent.

**Your most relevant experience may be the missing one.** There is no reason the dropped role will be an unimportant one.

## Finding Out

Copy-paste your PDF into a plain text editor. Then count.

Count the jobs in the paste and compare with the jobs on your page. Check each one has its employer, its dates, and its bullets attached. Read it as if you were the recruiter seeing it for the first time.

Specifically look for:

- A role heading with no bullets under it
- Bullets with no role heading above them
- Two role titles adjacent with nothing between them
- Dates in the wrong place or missing
- Any role you cannot find at all

## Fixing It

The fixes are structural, and all of them are simple:

**Convert text boxes to normal body text.** Retype the content directly into the document flow rather than into a frame.

**Replace tables with plain lines.** Job title on one line, dates beneath, bullets as a normal list. Use spacing, not cells, for layout.

**Move to a single column** for the experience section at minimum. A sidebar holding only skills and contact details is lower risk; your work history should never span columns.

**Keep each role on one page.** If a role would split across the page break, move the whole block to the next page. White space at the bottom of page one costs you nothing.

**Use conventional section headings.** "Experience," "Work Experience," "Professional Experience," "Employment History." Save the creative naming for a portfolio site.

## What a Correct Parse Looks Like

> EXPERIENCE
>
> Senior Data Analyst, Acme Corp
> March 2022 – Present
> - Rebuilt weekly revenue reporting, cutting turnaround from two days to under an hour
> - Led the migration of 40 source tables to Snowflake
>
> Data Analyst, Beta Ltd
> June 2019 – March 2022
> - Built the company's first customer cohort analysis...

Plain, sequential, each role a contiguous block with its dates and bullets. Unremarkable to look at and structurally sound.

## Frequently Asked Questions

**Will the recruiter notice a role is missing?**
Usually not. They see what their system shows them, with no indication anything was lost. The gap appears to be yours.

**Does this happen with .docx as well as PDF?**
Yes. Text boxes and tables cause the same problems in Word documents. The format matters less than the structure.

**Could a role be missing from the summary but present in the attachment?**
Frequently, and it still hurts - many recruiters work from the parsed view and structured fields, especially when screening at volume.

**How often should I check this?**
Once per resume version. Re-check after any layout change, template switch, or export from a new tool.

**My resume has always been two-column and I get interviews. Is it fine?**
Possibly, or you are succeeding despite losing some applications invisibly. The test takes a minute and removes the doubt.

## Check Nothing Is Missing

This is the one resume problem that no amount of good writing can compensate for, because the writing never arrives.

Run the copy-paste test and count your jobs. Then [scan the resume against a posting](/ats-analysis) — with the full history arriving, the match reflects your actual experience rather than a truncated version of it.

Related: [the copy-paste test](/blog/copy-paste-ats-test) and [when employment dates parse wrong](/blog/employment-dates-parsed-wrong).
