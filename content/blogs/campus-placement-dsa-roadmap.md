---
title: Campus Placement DSA Roadmap 2026 - What to Study and in What Order
description: A month-by-month DSA plan for placements, covering what to learn, what to skip, how many problems to solve, and how to revise so patterns actually stick.
date: 2026-08-20
author: TailorCV Team
tags: [Campus Placement, DSA, Coding Interview, Freshers, Preparation]
category: Interview Preparation
image: public/blog-images/campus-placement-dsa-roadmap.webp
slug: campus-placement-dsa-roadmap
keywords: dsa roadmap placements, data structures for placement, coding preparation plan, dsa topics campus
---

## Key Takeaways

- Campus rounds test a narrow, predictable band of DSA — far less than a full competitive programming syllabus.
- Order matters: arrays and strings first, because they carry the largest share of questions.
- 150-250 well-understood problems beats 500 skimmed, and revision is what makes the difference.
- Learn patterns rather than problems, because unfamiliar questions are familiar patterns in new clothing.
- Skip the advanced topics — segment trees and heavy graph algorithms rarely appear in campus rounds.

Most DSA preparation fails not from lack of effort but from lack of order. Students solve problems randomly across topics, never revise, and arrive at placement season having seen four hundred problems and retained the patterns from none.

The syllabus for campus rounds is genuinely narrow and genuinely learnable in a few months of structured work.

This guide is that structure.

While you prepare, make sure your resume clears screening — the [free ATS score checker](https://www.thetailorcv.com/solutions).

---

## The order to learn in

Sequenced by how much of the question bank each topic covers, so early effort pays fastest.

### Month 1: Foundations

**One language, properly.** C++, Java or Python. Depth in one beats familiarity with three.

**Arrays.** Traversal, two pointers, prefix sums, sliding window, in-place manipulation. **The single largest category** in campus rounds.

**Strings.** Palindromes, anagrams, substrings, frequency counting, basic manipulation.

**Time and space complexity.** Not as theory — as the habit of stating the complexity of everything you write.

By the end of month one you should be solving easy problems without fighting the syntax.

### Month 2: Core structures

**Hashing.** Hash maps and sets for frequency, duplicates and lookup. This single topic converts a large number of nested-loop problems from quadratic to linear, and interviewers explicitly look for it.

**Searching and sorting.** Binary search, including on rotated arrays and on answer spaces. Sorting as a preprocessing step.

**Linked lists.** Reversal, cycle detection, finding the middle, merging, removing the nth node. A small topic with a fixed set of recurring questions.

**Stacks and queues.** Balanced parentheses, next greater element, monotonic stack.

### Month 3: Recursion and trees

**Recursion.** Understand the recursion tree rather than memorising templates.

**Backtracking.** Subsets, permutations, N-queens, grid paths.

**Trees.** Traversals, height, diameter, BST operations, lowest common ancestor, checking balance and symmetry. Recursion fluency matters more here than anything else.

### Month 4: The remaining ground

**Dynamic programming**, at the easier end — Fibonacci variants, climbing stairs, house robber, coin change, longest common subsequence, 0/1 knapsack. Learn the memoisation-to-tabulation progression on a handful of classics rather than attempting the whole topic.

**Graphs.** BFS, DFS, connected components, cycle detection, simple shortest path. More common at product companies than service-based ones.

**Number theory basics.** Primes and sieve, GCD and LCM, digit manipulation.

### Ongoing: timed practice

Contests and mock tests under real time pressure. This is a separate skill from untimed solving and it is the one tested on the day.

---

## The patterns, and the signal that tells you which one

This is the part that converts effort into results. Almost every campus problem is one of these, and each has a giveaway in the question wording.

| Pattern | The signal in the question | Typical problems |
|---|---|---|
| **Two pointers** | Sorted array, pair or triplet, "without extra space" | Two sum on sorted, remove duplicates, container with most water |
| **Sliding window** | "Contiguous subarray", "substring", fixed size k | Max sum subarray of size k, longest substring without repeats |
| **Hash map frequency** | "Count", "duplicate", "appears exactly", "anagram" | First non-repeating char, group anagrams, two sum |
| **Binary search** | Sorted input, or "minimum/maximum value such that" | Search rotated array, koko eating bananas, sqrt |
| **Prefix sum** | Repeated range-sum queries, "subarray sums to k" | Subarray sum equals k, running sum |
| **Fast and slow pointers** | Linked list, "cycle", "middle" | Detect cycle, find middle, palindrome linked list |
| **Monotonic stack** | "Next greater", "previous smaller", histogram | Next greater element, largest rectangle, daily temperatures |
| **Recursion / backtracking** | "All possible", "generate every", "combinations" | Subsets, permutations, N-queens, word search |
| **Tree DFS** | "Path", "depth", "root to leaf" | Max depth, path sum, diameter, LCA |
| **Tree BFS** | "Level", "shortest in an unweighted structure" | Level order traversal, minimum depth, right side view |
| **Graph BFS/DFS** | Grid, "islands", "connected", "reach" | Number of islands, rotting oranges, course schedule |
| **DP** | "Maximum/minimum ways", overlapping choices | Climbing stairs, house robber, coin change, LCS |

**How to use this table.** When you hit an unfamiliar problem, do not look for the solution — look for the signal. "Longest substring with at most k distinct characters" contains the word substring, so it is a sliding window before you have thought about anything else.

**That recognition step is the entire interview skill.** Nobody expects you to have seen the exact problem. They expect you to place it within thirty seconds.

---

## What to skip

Explicitly, because time spent here is time not spent on what actually appears:

- Segment trees and Fenwick trees
- Advanced graph algorithms — max flow, strongly connected components
- Heavy number theory
- String algorithms like KMP and suffix structures
- Advanced DP — bitmask, digit DP

A small number of top product companies go further, but for the overwhelming majority of campus rounds these do not appear. Check what your target companies actually asked last year — placement cells frequently keep records, and it is the most underused resource on campus.

---

## Volume and revision

**150 to 250 well-understood problems** is enough for campus rounds. Understood means you could re-solve it in a week without looking.

**Revision is what separates outcomes.** Re-solve problems you got wrong after a week, then after a month. Spaced repetition applies to coding exactly as to anything else, and skipping it is why students forget patterns they "already did".

**Keep a pattern log**, not a problem count. For each problem write which pattern it was — two pointers, sliding window, monotonic stack. Within weeks you start recognising shapes rather than recalling solutions, which is the entire skill the round tests.

**A reasonable weekly rhythm:** 8-10 new problems, 3-4 revisions, one timed session.

### What a pattern log line looks like

Four columns in a spreadsheet. Two minutes per problem, and it is the highest-value thing in this guide after the pattern table.

| Problem | Pattern | Got it? | Note to myself |
|---|---|---|---|
| Longest substring without repeating | Sliding window + hash set | After 25 min | Forgot to move left pointer past the duplicate, not just by one |
| Koko eating bananas | Binary search on answer | No, saw solution | Did not realise you can binary search a value, not an index |
| Number of islands | Grid DFS | Yes, 12 min | Mark visited in place to avoid an extra grid |
| Coin change | DP bottom-up | After 40 min | Set unreachable to a large value, not zero |

**The "note to myself" column is the one that matters.** In a month you will not remember why you got it wrong, and that sentence is what makes the re-solve worth doing. Sort the sheet by pattern before revision week and the gaps become obvious.

---

## Adjusting by target

**Service-based companies** ask easy to easy-medium — arrays, strings, basic logic. Aptitude carries more weight than DSA depth, so balance accordingly — see [the campus placement aptitude test guide](https://thetailorcv.com/blog/campus-placement-aptitude-test-guide) and [service-based vs product-based companies](https://thetailorcv.com/blog/service-based-vs-product-based-companies).

**Product companies** ask medium difficulty with optimal complexity expected, and graphs and DP appear more often.

**If you are starting late**, prioritise arrays, strings, hashing and binary search. They cover a disproportionate share of easy and easy-medium questions.

### If you have four weeks, not four months

Not ideal, and still workable. Cut the syllabus rather than skimming all of it.

| Week | Focus | Target |
|---|---|---|
| **1** | Arrays, two pointers, sliding window, prefix sum | 30 problems, all easy to easy-medium |
| **2** | Strings and hashing | 25 problems, plus re-solve week 1 failures |
| **3** | Binary search, linked lists, stacks | 25 problems, plus one timed mock |
| **4** | Recursion, basic trees, revision only | 15 new, everything else re-solves and two timed mocks |

**Deliberately absent:** DP and graphs. With four weeks you are better served by being reliable on arrays, strings and hashing than shaky across everything — and those three carry most of the easy-medium band where campus questions live.

The full round mechanics are in [the campus placement coding round guide](https://thetailorcv.com/blog/campus-placement-coding-round-guide).

---

## Common Mistakes

**Solving randomly across topics.** Without order you never build depth in the areas that carry the most questions.

**Counting problems instead of logging patterns.** The count is not the skill; recognising which pattern a new problem belongs to is.

**Looking for the solution rather than the signal.** The interview skill is placing an unfamiliar problem in thirty seconds, not having seen it before.

**Never revising.** Patterns fade, and students routinely forget material they solved two months earlier.

**Logging that you got it wrong without logging why.** In a month the re-solve teaches you nothing without that sentence.

**Studying advanced topics that do not appear.** Segment trees and max flow are time taken from arrays and hashing.

**Practising only untimed.** Time pressure changes performance substantially and is its own skill.

**Learning multiple languages simultaneously.** Depth in one is what campus rounds reward.

**Skipping complexity analysis.** Stating time and space for everything you write is a habit interviewers explicitly assess.

**Neglecting aptitude while grinding DSA.** For many companies aptitude eliminates you before the coding round.

---

## Frequently Asked Questions

### How many problems should I solve?

150 to 250 that you genuinely understand and could re-solve. Depth and pattern recognition matter far more than raw count.

### Which topics matter most?

Arrays, strings, hashing and binary search carry the largest share of campus questions. Trees, recursion and basic DP follow.

### How do I know which pattern a new problem uses?

Read for the signal words. "Substring" or "contiguous" means sliding window; "sorted" plus "pair" means two pointers; "next greater" means monotonic stack.

### Which language should I use?

Whichever you know best. C++ for its standard library and speed, Java widely accepted, Python fine for most campus rounds though slower on tight limits.

### Do I need advanced topics?

Rarely. Segment trees, advanced graph algorithms and heavy DP variants seldom appear in campus rounds outside a few top product companies.

### How long does the roadmap take?

Roughly four months of consistent work at 8-10 new problems and a few revisions weekly, plus ongoing timed practice.

### How do I make patterns stick?

Log the pattern and the specific reason you got it wrong, then re-solve after a week and again after a month. The reason is what makes the re-solve useful.

### What if placements are next month?

Follow the four-week plan — arrays, strings, hashing, binary search and basic trees only. Skip DP and graphs entirely; reliability on the easy-medium band beats shakiness everywhere.

---

DSA only matters if your resume gets you into the drive. [Check your ATS score free](https://www.thetailorcv.com/solutions).

## Make This Practical

Follow the order rather than solving randomly. Arrays and strings first because they carry the largest share of questions, then hashing and binary search, then recursion and trees, then basic DP and graphs.

Then start a pattern log today — four columns, two minutes per problem, and one of them is why you got it wrong in your own words. Sort it by pattern before a revision week and your actual gaps become obvious in a way that a solved-problem count never shows you.

Finally, train the recognition step rather than the solution. When you open an unfamiliar problem, spend thirty seconds finding the signal — "substring" means sliding window, "sorted plus pair" means two pointers — before you write anything. That thirty seconds is what the interview is actually testing.
