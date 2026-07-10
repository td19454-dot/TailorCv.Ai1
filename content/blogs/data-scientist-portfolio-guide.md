---
title: Data Scientist Portfolio Guide: Notebooks, Models, and Impact
description: What goes in a data scientist portfolio - reproducible notebooks, deployed models, and projects framed around business impact, not just accuracy.
date: 2026-06-24
author: TailorCV Team
tags: [Portfolio Guide, Data Science, Machine Learning, Projects]
category: Portfolio
image: public/blog-images/data-scientist-portfolio-guide.webp
slug: data-scientist-portfolio-guide
keywords: data scientist portfolio, machine learning portfolio, ml projects, kaggle portfolio, ml portfolio examples
---

A data science portfolio should prove you can frame a problem, model it responsibly, and explain the impact - not just chase a leaderboard score. Most rejected portfolios are a wall of Kaggle notebooks with a final accuracy number and nothing else; the ones that get callbacks show a small number of projects done end to end, with the reasoning made visible. Pair this guide with [How to Build a Professional Portfolio](https://thetailorcv.com/blog/how-to-build-professional-portfolio) for the fundamentals, and read the [Data Analyst Portfolio Guide](https://thetailorcv.com/blog/data-analyst-portfolio-guide) if you are not sure which track fits your background.

## Data Scientist vs. Data Analyst Portfolios: What Actually Changes

If you have read the analyst-focused portfolio advice, some of it will feel familiar - clean repos, clear write-ups, a hosted site. The difference is what the work has to demonstrate.

A strong analyst portfolio proves you can turn raw data into a clear answer for a stakeholder: a dashboard, a clean SQL query, a well-labeled chart that settles a business question. A strong data scientist portfolio has to prove something harder - that you can go from an ambiguous problem to a trained, evaluated, and (ideally) deployed model, and that you understood the tradeoffs at every step along the way.

That shows up as a shift in emphasis:

- **From reporting to modeling.** An analyst portfolio can lean on visualization. A data science portfolio needs at least one project where you built, tuned, and evaluated a model - not just described patterns in the data.
- **From "what happened" to "what should we do."** Analysts explain the past. Data scientists are expected to build something that predicts or decides, and to be honest about how much you should trust that prediction.
- **From a single notebook to a pipeline.** Reviewers want to see that you understand how a model fits into a system - ingestion, cleaning, feature engineering, training, evaluation, and (bonus) serving - not just the `model.fit()` line.
- **From accuracy to experimentation rigor.** What did you try that did not work? Why did you reject a more complex model in favor of a simpler one, or vice versa? That reasoning is worth more than a headline metric.

None of this means dashboards have no place in a data scientist's portfolio - they are useful supporting evidence, covered later in this guide. But if every project you show is EDA-and-a-chart, a hiring manager will read you as an analyst, not a data scientist, regardless of your job title.

## Pick 2-4 Projects, Not Ten Kaggle Notebooks

The single most common mistake in data science portfolios is volume over depth: a GitHub profile with fifteen repos, each one a Kaggle competition notebook that ends at a leaderboard score. It signals that you can follow a tutorial, not that you can own a problem.

Aim for **two to four substantial projects** instead. A workable mix:

1. **One full end-to-end project.** Real or realistic data, your own cleaning and feature engineering, a documented modeling process, honest evaluation, and ideally a working demo or deployed endpoint. This is your flagship - the one a recruiter or hiring manager will actually click into.
2. **One or two technique-demonstration projects.** Smaller in scope, but focused - a project that shows you can do time-series forecasting, or NLP with transformers, or a causal inference / A-B testing analysis, depending on what the roles you're targeting actually ask for.
3. **Optionally, one project that shows range beyond modeling** - a data pipeline, an experiment analysis, or a dashboard (see the section on this below).

Quality bar for "does this project belong in the portfolio":

- Would you be comfortable being asked detailed follow-up questions about every modeling decision in it for twenty minutes?
- Does it use a dataset or problem you chose or meaningfully modified, rather than a stock Kaggle dataset run through a stock notebook template?
- Does the README or write-up explain *why*, not just *what*?

If a project fails more than one of those, cut it or rework it. Three tight, well-explained projects beat ten shallow ones every time. For ideas on scoping projects that map to what employers screen for, see [15 Developer Portfolio Project Ideas](https://thetailorcv.com/blog/developer-portfolio-project-ideas) and [Projects in Resume](https://thetailorcv.com/blog/projects-in-resume) for how to summarize the same work in resume bullet form.

## What a Strong Project Write-Up Actually Includes

The model is often the least differentiating part of a data science project - plenty of candidates can call `sklearn.ensemble.RandomForestClassifier`. What separates a hire-worthy project from a tutorial clone is the write-up around it. At minimum, cover:

- **The business or research question.** State it in one sentence, in plain language, before any code. "Predict which customers will churn in the next 30 days so retention outreach can be prioritized" is a question. "Churn prediction" is a topic, not a question.
- **The data source and its problems.** Where did the data come from? What was wrong with it - missing values, class imbalance, leakage risk, inconsistent labels, a tiny sample size? Reviewers want to see that you noticed these issues before they became bugs.
- **Why you chose this approach over alternatives.** If you used gradient boosting, say what else you considered (logistic regression as a baseline, a neural net you decided was overkill) and why you landed where you did. This is the single highest-signal paragraph in the whole write-up.
- **Evaluation metrics that match the problem**, with reasoning. Accuracy is rarely the right headline metric for an imbalanced problem - precision/recall, AUC, calibration, or a business-relevant cost metric usually tells a more honest story. Explain the choice.
- **Honest limitations.** What would break this model in production? What data would you want but do not have? What did you not have time to try? A "limitations and next steps" section is one of the fastest ways to read as senior rather than junior.
- **What did not work.** If you tried three model families and two underperformed, say so briefly. It shows the accepted model was chosen deliberately, not by accident.

A project write-up that only shows the final confusion matrix and an accuracy number tells a reviewer almost nothing about how you think. A write-up that walks through the decision path - including the parts that failed - tells them everything they need to know about how you would perform on the job.

## A Worked Example: Mini Project Write-Up Outline

Here is roughly how a tight, well-scoped write-up should read, condensed to its bones:

> **Problem:** A subscription business wants to flag customers likely to cancel within 30 days so the retention team can prioritize outreach before renewal.
>
> **Data:** 18 months of anonymized billing and product-usage logs (about 40,000 customers). Class imbalance was significant - roughly 6% churn rate - and usage logs had gaps for customers who churned early, which risked leaking the outcome into the features.
>
> **Approach:** Started with logistic regression as a baseline to establish a floor and keep the model interpretable for the retention team. Tried a gradient-boosted tree model next, since the relationship between usage frequency and churn looked non-linear in EDA. Rejected a deep learning approach - the dataset was too small relative to the feature count to justify it, and interpretability mattered more here than marginal accuracy gains.
>
> **Result:** The gradient-boosted model improved recall on the churn class from 0.31 (logistic regression baseline) to 0.52 at a fixed precision of 0.40, which the business judged more actionable than a small AUC gain would have been on its own.
>
> **Limitation:** The model was trained on a single 18-month window and has not been validated across a full seasonal cycle or a pricing change, so recall may not hold if usage patterns shift. It also does not account for support-ticket sentiment, which domain experts flagged as a likely churn signal that was not available in this dataset.

Notice what that outline does not have: no leaderboard rank, no "99% accuracy," no vague "used machine learning to predict churn." It states a real decision problem, shows the reasoning trail, and ends with an honest limitation instead of a victory lap. That is the shape to copy, even if your numbers and domain are completely different. For a deeper template on structuring the full write-up (not just the outline), see [How to Write a Portfolio Case Study](https://thetailorcv.com/blog/how-to-write-portfolio-case-study).

## GitHub Repo Structure That Signals Competence

For data science work specifically, a reviewer skimming your repo is checking for signs that you can work on a real team, not just in a personal notebook. A few structural details do a lot of that signaling on their own:

- **A README that front-loads the story.** Problem, approach, result, and a link to a demo or key notebook, in that order, at the top of the file - before installation instructions. Nobody should have to read your code to find out what the project is about.
- **A reproducible environment.** A `requirements.txt`, `environment.yml`, or `pyproject.toml` that actually works if someone clones the repo fresh. A project that will not run for anyone but you is a portfolio liability, not an asset.
- **Notebooks for exploration, scripts or modules for anything reusable.** Final feature-engineering and training logic that lives only in a 400-cell notebook is hard to review and impossible to reuse. Split reusable logic into `.py` files and keep notebooks focused on exploration and narrative.
- **Markdown narration inside notebooks, not just code cells.** A notebook that is fifty code cells with no explanation forces the reader to reverse-engineer your thinking. Markdown cells that explain *why* you dropped a feature or chose a transformation turn a script into a story.
- **A visualization or demo up front**, not buried at the bottom. A single well-labeled chart or a link to a live demo near the top of the README does more for a thirty-second skim than pages of code ever will.
- **No secrets, no giant data dumps.** Use `.gitignore` for raw data and credentials, and document where the dataset can be obtained instead of committing gigabytes of CSVs.

A wall of code with no explanation reads as "I can write Python." A structured repo with a clear README, a reproducible environment, and a working demo reads as "I can ship work another engineer or analyst could pick up." For more on organizing the profile as a whole, see [GitHub Portfolio Optimization](https://thetailorcv.com/blog/github-portfolio-optimization).

## Show Range: Pipelines, A-B Tests, and Dashboards Alongside Models

Not every strong data science portfolio project has to end in a trained model. Hiring teams - especially at companies where data science overlaps with data engineering or product analytics - value seeing that you can operate across the full lifecycle. Consider including one project from outside pure modeling:

- **A data pipeline or ETL project.** Ingesting data from an API or public dataset, cleaning and transforming it on a schedule, and loading it somewhere queryable. This demonstrates you understand where the data your models depend on actually comes from, and it is a skill many "pure modeling" candidates cannot show.
- **An A/B test or experiment analysis write-up.** Take a public or simulated experiment dataset and walk through the design (sample size, randomization, guardrail metrics), the statistical test used, and the honest conclusion - including whether the result was statistically significant but not practically meaningful, or vice versa. This is one of the highest-value skills for product-facing data science roles and one of the least commonly demonstrated in portfolios.
- **A dashboard project**, used sparingly. One well-designed dashboard that supports a specific decision (not a generic "here's a bunch of charts" page) shows you can communicate to non-technical stakeholders. Keep it to one project, not the centerpiece of the portfolio - too many dashboards will pull your positioning back toward analyst.

The goal is not to add these for their own sake. Include one only if it genuinely rounds out gaps in what your flagship modeling project already shows, and frame it the same way: a stated question, the approach, the result, and what you learned. If you are torn on how many projects to show or how deep to go on any one of them, [Portfolio No Projects: What to Do When You're Starting From Zero](https://thetailorcv.com/blog/portfolio-no-projects) has practical guidance for building this range up from nothing.

## Where to Host and Deploy Your Work

Hosting choices for data science portfolios differ a little from a typical developer portfolio, because the "demo" is often a model rather than a UI.

- **GitHub** for code, notebooks, and the README-driven story of each project (see the repo structure section above).
- **A deployed model or small app** - even a minimal one - is a large differentiator. A tiny API endpoint, a Streamlit or Gradio app, or a Hugging Face Space where someone can enter an input and see a live prediction, beats a static notebook every time. It proves the model works outside your own machine and that you understand the basics of serving it.
- **Kaggle**, used selectively, for notebooks or competitions that show a specific technique well - not as your primary hosting location.
- **A portfolio site that ties everything together** - one page per project, each linking out to its GitHub repo and live demo, with the story summarized in plain language for a non-technical skimmer. See [How to Host Your Portfolio for Free](https://thetailorcv.com/blog/how-to-host-portfolio-free) for free hosting options, and [One-Page vs. Multi-Page Portfolio](https://thetailorcv.com/blog/one-page-vs-multi-page-portfolio) if you are deciding how to lay the site out. If you want your own domain rather than a subdomain, [Custom Domain Portfolio Guide](https://thetailorcv.com/blog/custom-domain-portfolio-guide) walks through the setup.

If building the site itself is the part slowing you down, the [TailorCV portfolio builder](https://thetailorcv.com/portfolio) turns your existing resume into a live, shareable portfolio page in minutes, so you can spend your time on the projects instead of on web design. If you would rather compare builders first, [Portfolio Website Builders 2026](https://thetailorcv.com/blog/portfolio-website-builders-2026) breaks down the tradeoffs.

## Common Mistakes That Undercut a Data Science Portfolio

Most weak data science portfolios fail for a small, repeatable set of reasons:

- **A list of Kaggle scores with no explanation.** "Top 15% on [competition]" tells a reviewer almost nothing about how you think. Without the reasoning behind the approach, a leaderboard rank is just a number.
- **No stated business or research question.** Projects that jump straight into code without ever saying what problem is being solved read as exercises, not work.
- **Notebooks with no narrative.** Fifty code cells and zero markdown explanations force the reader to reconstruct your logic themselves. Most will not bother.
- **No discussion of what did not work.** A project that presents only the winning model, with no mention of alternatives considered or rejected, reads as either lucky or incomplete.
- **Accuracy obsession with no business framing.** A 98% accuracy number on a 95%-majority-class dataset is not impressive - it is a red flag that you did not check for class imbalance.
- **Data leakage or missing validation.** Using future information to predict the past, or reporting metrics without a proper train/validation/test split, is one of the fastest ways to lose credibility with a technical reviewer.
- **No deployed demo anywhere.** Every project a static notebook, with nothing anyone can actually interact with.
- **Notebooks that will not run for anyone but you.** Hardcoded local file paths, missing dependency lists, or undocumented data sources that make the project impossible to reproduce.

These compound: a portfolio with two or three of these mistakes reads as unfinished, even if the underlying modeling work is solid. For the broader traps that apply beyond data science specifically, see [Portfolio Mistakes to Avoid](https://thetailorcv.com/blog/portfolio-mistakes-to-avoid).

## Keep Your Resume and Portfolio in Sync

Your resume, your LinkedIn, and your portfolio should tell the **same** story - same name, same headline, same top projects - just at different levels of depth. A recruiter who sees a "Data Scientist" resume and a portfolio headlined "Aspiring Analyst" gets confused, and confusion loses interviews. Lock the resume down first with the [ATS score checker](https://www.thetailorcv.com/solutions) and an [ATS-friendly template](https://www.thetailorcv.com/templates), then mirror that exact positioning in your portfolio.

Once your portfolio is live, a few small consistency checks go a long way:

- Use the same one or two flagship projects on both the resume and the portfolio homepage, not a different "best project" on each.
- Match your headline wording - if the resume says "Data Scientist," the portfolio should not say "ML Enthusiast."
- Make sure your resume summary references the skills your projects actually demonstrate, so a reader who checks both sees them reinforce each other rather than contradict.
- Add the portfolio link in the right place on the resume header - see [How to Add Your Portfolio Link to Your Resume](https://thetailorcv.com/blog/add-portfolio-link-to-resume) for placement.

When the two documents reinforce each other, every recruiter touchpoint pushes you forward instead of raising questions. If you're also deciding how to frame skills gained outside a formal DS role, [Data Analyst vs. Data Scientist](https://thetailorcv.com/blog/data-analyst-vs-data-scientist) can help you sanity-check which track your projects and resume should be aimed at.

## Make This Practical

Turn this advice into a live proof page rather than a mental checklist. Start with the [TailorCV portfolio builder](https://www.thetailorcv.com/portfolio) to generate a clean portfolio site from your resume, then slot your two to four projects in using the write-up structure above - question, data, approach, result, limitation.

A few next actions, in order:

1. Pick your flagship end-to-end project and rewrite its README using the worked-example outline above.
2. Add the portfolio link to your resume correctly with [How to Add Your Portfolio Link to Your Resume](https://thetailorcv.com/blog/add-portfolio-link-to-resume).
3. Run your resume through the [free ATS score checker](https://www.thetailorcv.com/solutions) and switch to an [ATS-friendly resume template](https://www.thetailorcv.com/templates) so the resume and portfolio present one consistent story.
4. Before you start applying, run through the [Portfolio Checklist Before Applying](https://thetailorcv.com/blog/portfolio-checklist-before-applying) and see [Portfolio Examples That Landed Interviews](https://thetailorcv.com/blog/portfolio-examples-that-landed-interviews) for concrete formats that have worked.
5. Practice explaining your flagship project's modeling decisions out loud - the [AI mock interview](https://www.thetailorcv.com/mock-interview) tool is a low-pressure way to rehearse the "why did you choose this model" question before it comes up live.

## FAQ

### Do I need Kaggle medals?

No. A few well-explained, reproducible [projects](https://thetailorcv.com/blog/projects-in-resume) - ideally one deployed - beat medals with no narrative. A hiring manager can't interview your leaderboard rank; they can interview your reasoning.

### How many projects should be in a data science portfolio?

Two to four is the practical range: one full end-to-end project plus one or two focused technique demonstrations. More than that tends to dilute attention rather than add credibility, unless each additional project is genuinely distinct in skill or domain.

### How important is deployment?

Very. A live demo someone can actually try - even a minimal Streamlit app or a simple API endpoint - is one of the strongest signals you can send, because it proves the model works outside your own environment. See [How to Host Your Portfolio for Free](https://thetailorcv.com/blog/how-to-host-portfolio-free) for low-cost ways to get something live.

### Should I include dashboards if I'm applying for data scientist roles, not analyst roles?

One is fine, and can show useful range, especially for product-facing roles. More than one starts to shift how a reviewer reads your positioning back toward analyst, so keep the emphasis on modeling projects.

### What's the biggest difference between a data analyst and data scientist portfolio?

Modeling and experimentation depth. Analyst portfolios prove you can turn data into a clear answer; data scientist portfolios need to prove you can build, evaluate, and reason about a model end to end, including what you tried and rejected. See the [Data Analyst Portfolio Guide](https://thetailorcv.com/blog/data-analyst-portfolio-guide) for the analyst-side version of this advice.

### How do I align my resume with my portfolio?

Use the [Data Scientist Resume guide](https://thetailorcv.com/blog/data-scientist-resume-2026) or the [ML Engineer Resume guide](https://thetailorcv.com/blog/machine-learning-engineer-resume-2026) to get the resume framing right first, then mirror the same headline, positioning, and flagship projects on the portfolio site.

### Is a personal website necessary, or is GitHub enough?

GitHub alone works for a technical audience that already knows how to navigate repos, but a portfolio site makes your best work skimmable for recruiters and non-technical hiring managers in under a minute. See [How to Build a Professional Portfolio](https://thetailorcv.com/blog/how-to-build-professional-portfolio) for why the combination outperforms either alone.

### What if I don't have real business data to work with?

Public datasets are fine as a starting point - what matters is that you treat the problem like a real one: state a specific question, make and justify modeling decisions, and report honest limitations. [Portfolio No Projects](https://thetailorcv.com/blog/portfolio-no-projects) has a practical path for building credible projects without an employer's proprietary data.

## Next Step

Stop refining projects in isolation and get them in front of recruiters - build your portfolio page now with the [TailorCV portfolio builder](https://www.thetailorcv.com/portfolio) and turn your best modeling work into a link you can put on your resume today.
