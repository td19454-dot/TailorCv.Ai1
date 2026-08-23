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

## A twelve-week schedule that works

Most students prepare by solving problems until they run out of time. A structure produces more with fewer hours, because the failure modes at each stage are different.

**Weeks 1–3: fundamentals, untimed.** Arrays, strings, hash maps, two pointers, sliding window. Solve untimed and read other people's solutions afterwards — at this stage, reading good solutions teaches faster than grinding your own. Roughly forty problems.

**Weeks 4–6: trees, graphs, recursion.** The largest single topic block in new grad interviews. Traversals, BFS and DFS, basic graph problems. Still mostly untimed, but start narrating aloud now rather than later, because the habit is hard to add under pressure. Roughly forty problems.

**Weeks 7–8: heaps, intervals, binary search, basic dynamic programming.**

DP is where students over-invest. New grad loops use it, but rarely the exotic variants — knowing the handful of standard patterns is sufficient, and time spent beyond that is usually better spent on communication.

**Weeks 9–10: timed practice.** The switch that matters. Set a clock at forty-five minutes and stop when it rings, whether or not you are done. Most candidates who fail online assessments can solve the problems; they cannot solve them in the time allowed, and that is a separately trainable skill.

**Weeks 11–12: mock interviews and behavioural.** Solve out loud with another person, ideally one who will interrupt. Simultaneously build the behavioural stories, because the behavioural round decides more new grad outcomes than students expect.

**Throughout:** two to three hours on weekdays and a longer session at the weekend is realistic alongside coursework. Consistency beats intensity — five hours on Sunday after nothing all week produces markedly less than an hour a day.

**What to cut if you are short of time:** exotic algorithms, obscure data structures, and anything you have never seen appear in a new grad interview. What not to cut: timed practice and speaking aloud.

## What "communication is scored" actually means

The advice is universal and rarely specific. Here is the difference, in the same problem.

**A silent candidate** reads the question, thinks for four minutes, writes a correct solution, says "done". The interviewer has: one data point, no insight into the reasoning, and nothing to write in the feedback except that it worked. If the solution had a bug, they also have no idea whether the candidate would have found it.

**A narrating candidate** says:

> "So we need pairs summing to a target. The brute force is nested loops, quadratic — let me start there so we have something correct. Actually, better: if I put the values in a hash map as I go, then for each element I can look up the complement in constant time. That is linear time and linear space. Let me check the edge cases — duplicates, an empty array, and whether an element can pair with itself. I will assume it cannot; is that right?"

Same solution, one minute in, and the interviewer now has: awareness of the naive approach, a reasoned improvement, stated complexity, edge cases identified unprompted, and a clarifying question. That is a feedback form that writes itself, and it is why the narrating candidate scores higher on identical code.

Four habits worth drilling until automatic:

**State the brute force first**, then improve on it. It guarantees you have said something correct, and it demonstrates the reasoning that got you to the better answer.

**Say the complexity before you are asked.** Being asked "what is the time complexity?" is mildly negative — it means you left it out.

**Name your assumptions and check them.** "I am assuming the input fits in memory — is that fair?" Two seconds, and it demonstrates exactly the thinking the round is testing.

**Say when you are stuck, specifically.** "I know this is a graph problem but I cannot see how to handle the cycles" invites a hint. Silent struggling does not, and interviewers are usually permitted to help.

## Testing your own code

Almost universally skipped, and it is one of the cheapest scoring opportunities in the whole loop.

When you finish writing, do not say "done". Say "let me trace through an example" and walk a small input through your code line by line, out loud. Then check the boundaries: empty input, one element, all duplicates, the maximum size.

Two things happen. You frequently find a bug — and finding your own bug scores considerably better than the interviewer finding it. And you demonstrate a habit that interviewers know correlates with being a decent engineer, which is exactly what the round is trying to establish.

The same applies in online assessments, where hidden test suites include the boundary cases. A solution that is correct on the sample and crashes on an empty array scores zero rather than partial credit, and spending the last three minutes checking edges is usually worth more than starting a problem you cannot finish.

## What to study, and what to skip

Students lose weeks to the wrong material. This is roughly how new grad interview questions distribute in practice.

| Topic | Weight | What to actually know |
|---|---|---|
| Arrays, strings, hash maps | Very high | Two pointers, sliding window, frequency counting. The single most productive block. |
| Trees and graphs | Very high | Traversals, BFS/DFS, level order, basic path problems. |
| Sorting and binary search | Medium | Knowing when to reach for it matters more than implementing it. |
| Heaps and intervals | Medium | Top-k, merge intervals, scheduling. Small, high-yield block. |
| Dynamic programming | Medium | The standard patterns only. Over-invested in by most candidates. |
| Linked lists | Low-medium | Reversal, cycle detection, merge. Cheap to learn. |
| Stacks and queues | Low-medium | Parentheses, monotonic stack. |
| Tries, union-find | Low | Worth an afternoon each, no more. |
| Advanced graph algorithms | Very low | Rarely appears in new grad loops. |
| Bit manipulation | Very low | Occasional, and usually a single trick. |

**Depth beats breadth.** A candidate who has genuinely internalised two pointers and graph traversal outperforms one who has seen every topic once. The interview asks a variation you have not seen; pattern depth is what lets you recognise it.

**Do not study by counting problems.** "Five hundred solved" is a worse predictor than "I can explain why this pattern applies here". Revisiting a problem you failed a week later teaches more than a new one.

**Read solutions early, grind later.** In the first weeks, struggling for two hours on a problem whose technique you have never seen teaches less than reading a good solution and then re-solving it from memory two days later.

## The online assessment, specifically

The largest filter by volume and the stage students prepare for least, because it feels like an administrative step.

**Format.** Two or three problems, sixty to ninety minutes, auto-scored against hidden tests. No human present, no partial credit for approach.

**Partial credit is real** in the sense that test cases are usually scored individually — a solution that passes eight of twelve cases scores better than one that passes none. So a working brute force submitted is worth more than an elegant solution left unfinished. Get something correct on the board first, then optimise.

**Hidden tests include the boundaries.** Empty input, single element, all duplicates, maximum size, negative numbers. Checking these in the final three minutes is usually a better use of time than opening a third problem.

**Learn the platform before the real one.** Each has its own quirks — how input is read, whether you write a function or a full program, what the console does. Fumbling the input format for ten minutes has failed candidates who could solve every problem.

**Do them at a sensible hour.** These are often sent with a multi-day window and taken at 1am after a full day. The difference in performance is not small.

## Common Mistakes

- **Ignoring the online assessment.** The largest filter, and the least prepared for.
- **Untimed practice.** Builds the wrong skill for a stage that is explicitly time-constrained.
- **Solving silently.** Costs points in every live round.
- **Breadth over depth.** Three hundred shallow problems lose to eighty properly learned ones.
- **Skipping behavioral prep.** Frequently the deciding round when technical scores are close.
- **Not testing your own code.** Letting the interviewer find the bug is a scored moment.
- **Studying advanced topics early.** Rare in new grad loops; the common patterns are not.

## The behavioural round is not filler

Students prepare for weeks on algorithms and walk into the behavioural round with nothing, on the assumption that it is a formality. At most large employers it is scored on the same feedback form and it decides genuinely close outcomes.

What it is testing for a new graduate: whether you can work with people, whether you take feedback, whether you own mistakes, and whether you can explain your own work clearly to someone who was not there.

**Prepare six stories**, and the [story bank approach](/blog/usa-behavioral-interview-star-campus) is the efficient way to do it — a conflict, a failure, a time you led, a time you learned something fast, a deadline problem, and something you are proud of. Each should have a concrete result and at least one detail you could produce under a follow-up question.

**Expect questions about your projects.** "Walk me through something you built" is the most common technical-behavioural hybrid, and it is where a real project pays off twice. What was hard, what you would change, why you chose that approach over the alternative.

**"Tell me about a time you disagreed with a teammate"** appears constantly, and the answer that scores names what the other person actually wanted and treats it as reasonable.

The cheapest possible win here is preparing at all, because a meaningful share of candidates do not.

## System design, honestly

Most new grad loops do not include a serious system design round, and students spend anxious weeks preparing for one that never comes.

What does appear:

**Questions about something you built.** How does it work, what happens if traffic increases tenfold, what breaks first, what would you change. This is answerable from a real project and nearly unanswerable from coursework, which is the strongest practical argument for having built something.

**Light design discussion** — how you would structure a simple service, what you would store where, how you would handle a failure. Reasoning is being assessed, not knowledge of specific architectures.

**Occasionally a real design round**, at a minority of employers or for candidates with prior industry experience.

If you have limited time, an hour spent being able to discuss your own project's trade-offs beats ten hours of distributed-systems reading. The former will definitely come up; the latter usually will not.

## Practising with other people

The single highest-return change most candidates can make, and the one most avoided because it is uncomfortable.

**Why solo practice plateaus.** Alone, you think silently, you look things up without noticing, you take as long as you like, and you never experience the specific cognitive load of explaining while solving. The live round tests exactly that load, and it is not trained by solving alone.

**What to do.** Find one other person preparing and trade mock interviews weekly. Take turns being the interviewer — watching someone else struggle teaches you what an interviewer actually sees, which changes how you narrate afterwards.

**Make the interviewer interrupt.** Ask questions mid-solution, request the complexity, challenge a choice. The realistic version is not a monologue.

**Record one session and watch it.** Unpleasant and unusually informative. Most people discover they go silent for long stretches without any awareness of it.

**Three or four mocks is enough** to fix the communication problem. Beyond that the returns flatten and time is better spent on problems.

## Where preparation transfers

Worth knowing if you are also applying abroad, because it changes how you allocate the semester.

The algorithmic rounds are close to identical internationally. Technology hiring in [Singapore](/blog/singapore-tech-jobs-graduates) uses the same question banks and formats; Canadian technical rounds mirror US practice closely; UK technology employers vary more but overlap substantially. Preparation done once serves all of them.

What does not transfer is the non-technical half. The behavioural conventions differ meaningfully — the measured register expected in [Singapore interviews](/blog/singapore-interview-etiquette-guide), the competency frameworks used in the [UK](/blog/uk-competency-questions-guide), the collaborative framing expected in [Canada](/blog/canada-new-grad-interview-preparation). Same stories, adjusted delivery.

The practical takeaway: build the technical preparation once and reuse it everywhere, then spend a couple of hours per market adjusting the behavioural half. That is a far better allocation than preparing separately for each.

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
