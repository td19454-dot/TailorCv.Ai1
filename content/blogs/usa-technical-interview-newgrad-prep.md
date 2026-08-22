---
title: "US New Grad Technical Interviews - What to Prepare and in What Order"
description: The online assessment, the phone screen and the onsite loop each test different things. What to prioritise with limited time, and why communication scores as heavily as the solution.
date: 2026-08-22
author: TailorCV Team
tags: [USA Jobs, Interview Preparation, Campus Placement, New Grad, Technical Interview]
category: Interview Preparation
image: public/blog-images/usa-technical-interview-newgrad-prep.png
slug: usa-technical-interview-newgrad-prep
keywords: new grad technical interview, coding interview prep, online assessment prep, us tech interview process, system design new grad
---

## Key Takeaways

- The pipeline has distinct stages — online assessment, phone screen, onsite loop — and each rewards different preparation.
- The online assessment is usually the biggest filter by volume and the one students prepare for least.
- In live rounds, how you communicate while solving is scored alongside whether you solve it.
- Depth on arrays, strings, hash maps, trees and graphs beats breadth across exotic algorithms.
- New grad loops rarely require serious system design; behavioral rounds usually matter more than students expect.

## The pipeline, stage by stage

**Online assessment (OA).** Automated, timed, usually two to four problems in 60 to 120 minutes. Sent after the application, often expiring within days. Graded on passing hidden test cases.

**Phone or virtual screen.** 45 to 60 minutes with an engineer, one or two problems, shared editor. First stage where a human forms an opinion.

**Onsite loop.** Typically three to five rounds: two or three coding, one behavioral, sometimes a practical or design round. For new grads, design is usually light or absent.

Each stage removes far more people than the next. The OA is where most of the field disappears, which makes it the highest-return thing to prepare — and it is the stage most students skip preparing for, because it feels administrative.

## Preparing for the online assessment

**Practise under a timer.** The OA is a speed test as much as a correctness test. People who can solve a problem in forty minutes fail an assessment that allots twenty-five.

**Get comfortable with the input format.** Many OAs require you to read stdin and print output rather than filling in a function body. Losing ten minutes to parsing is a common and entirely avoidable failure.

**Partial credit is real.** Test cases are usually weighted, so a brute-force solution that passes half the cases beats an elegant approach you did not finish. Get something working, then optimise.

**Know the platform.** Companies use a handful of assessment platforms. Doing one practice run on the same platform removes a category of avoidable problems.

## What to actually study

With limited time, depth beats breadth. The overwhelming majority of new grad problems come from a narrow set of topics:

- **Arrays and strings** — two pointers, sliding window, prefix sums
- **Hash maps and sets** — by far the most common tool in the most common solutions
- **Sorting** and what becomes easy once data is sorted
- **Binary search**, including on answers rather than arrays
- **Trees** — traversals, recursion, basic BST properties
- **Graphs** — BFS, DFS, and recognising when a problem is a graph problem
- **Recursion and basic dynamic programming** — memoisation before tabulation
- **Stacks and queues**, including monotonic stacks

What is usually **not** worth heavy investment for a new grad loop: advanced dynamic programming, segment trees, network flow, obscure string algorithms. They appear occasionally; the topics above appear constantly.

The most common preparation error is doing three hundred problems shallowly rather than eighty properly. If you cannot reproduce a solution a week later without hints, you have not learned it.

## Communication is scored

In a live round, the interviewer is filling in a rubric. It has categories, and correctness is one of several.

They are also scoring: did you clarify the problem before coding, did you explain your approach, did you consider complexity, did you test your own code, and could you take a hint.

Practical consequences:

**Talk before you type.** State your understanding, ask about edge cases and input size, describe your approach, then write. A candidate who silently produces correct code scores worse than one who explains a slightly worse solution clearly.

**Say what you are unsure about.** "I think this is O(n log n) because of the sort — let me double-check" is a positive signal. Confident wrong claims are the negative one.

**Take hints.** Interviewers give them deliberately. Not noticing, or resisting, is scored badly. Saying "that's a good point, so if I use a set instead..." shows exactly what they are checking.

**Test your own code.** Walk through a small example line by line before declaring completion. Finding your own bug is far better than the interviewer finding it.

## The behavioral round is not filler

New grad loops almost always include a behavioral interview, and it carries real weight. When several candidates clear the technical bar — which happens constantly — the behavioral round decides.

Prepare it properly rather than treating it as a rest between coding rounds. [Building a story bank](/blog/usa-behavioral-interview-star-campus) is a few hours of work and it is the cheapest scoring you will get in the entire process.

## System design for new grads

Usually light. If it appears at all, expect something like "design a URL shortener" or "how would you structure a system for X", assessed on whether you can reason about components and trade-offs — not on whether you know real distributed systems.

What helps: being able to talk about what a database does, what caching is for, what an API boundary is, and why you might split a system into services. What does not help for a new grad: memorising architecture diagrams for large-scale systems you have never operated.

If your loop includes design and you have limited time, spend it on coding fundamentals instead. Design questions for new grads are rarely the deciding round.

## A realistic schedule

If you have eight weeks before autumn interviews:

- **Weeks 1-2.** Arrays, strings, hash maps. Timed practice from the start.
- **Weeks 3-4.** Trees, recursion, binary search. Begin explaining solutions aloud.
- **Weeks 5-6.** Graphs, basic DP, stacks. Add full mock interviews.
- **Weeks 7-8.** Mixed timed sets, behavioral story bank, company-specific patterns.

Practise aloud from week three, not week seven. The gap between solving silently and solving while narrating is much larger than people expect, and discovering that in a real interview is expensive. [Mock interview practice](/blog/ai-mock-interview-complete-guide-2026) is worth more than additional problems once you can solve the core patterns.

Remember that none of this matters if you do not reach the interview. The resume screen removes most applicants first, so a document that [passes the ATS check](/ats-analysis) and is [tailored to the posting](/blog/how-to-tailor-resume-for-every-job) is a prerequisite, not an afterthought — and the [autumn window](/blog/usa-campus-recruiting-timeline) is when it has to be ready.

## Common Mistakes

- **Ignoring the online assessment.** The largest filter, and the least prepared for.
- **Untimed practice.** Builds the wrong skill for a stage that is explicitly time-constrained.
- **Solving silently.** Costs points in every live round.
- **Breadth over depth.** Three hundred shallow problems lose to eighty properly learned ones.
- **Skipping behavioral prep.** Frequently the deciding round when technical scores are close.
- **Not testing your own code.** Letting the interviewer find the bug is a scored moment.
- **Studying advanced topics early.** Rare in new grad loops; the common patterns are not.

## Frequently Asked Questions

### How many problems should I solve before interviewing?

There is no correct number, and the count matters less than retention. If you can re-solve a problem a week later unaided, it counted. If you needed the solution again, it did not.

### What language should I use?

Whichever you write fastest and most correctly in. Interviewers rarely care. Python is common for brevity; a language you know well beats a language that looks impressive.

### Do I need to prepare system design as a new grad?

Lightly. Understand databases, caching and API boundaries at a conceptual level. Deep design preparation is usually a poor use of limited time at this level.

### What if I cannot solve the problem?

Explain your thinking, get a partial solution working, take hints. Interviewers routinely pass candidates who did not fully solve it but reasoned well — and fail candidates who reached the answer silently and could not explain why.

### How important is the behavioral round really?

Enough to decide outcomes between technically similar candidates, which describes most loops. Treating it as a formality is a common and avoidable loss.

### Should I ask about the interview format beforehand?

Yes. Recruiters routinely tell you the structure, the number of rounds and sometimes the topics. It is a normal question and the information is free.
