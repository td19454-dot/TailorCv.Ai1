---
title: Campus Placement OS and DBMS Guide 2026 - The Questions Actually Asked
description: Operating systems and DBMS are asked at almost every campus interview. The specific questions that recur, what a good answer looks like, and what to skip from your syllabus.
date: 2026-08-20
author: TailorCV Team
tags: [Campus Placement, Operating Systems, DBMS, Technical Interview, Freshers]
category: Interview Preparation
image: public/blog-images/campus-placement-os-dbms-notes.png
slug: campus-placement-os-dbms-notes
keywords: os dbms interview questions, operating system placement, dbms interview freshers, deadlock normalization
---

## Key Takeaways

- OS and DBMS are asked more consistently than DSA at many campus interviews, and prepared far less.
- Definitions alone score poorly — every concept needs an example, ideally from your own project.
- Normalisation is the DBMS question students most often fail, because they memorise forms without practising on a real table.
- Deadlock and its four conditions is the single most reliable OS question.
- Your syllabus covers far more than interviews ask, so prioritise rather than revising everything.

Operating systems and database concepts get asked at almost every campus technical interview, and students consistently under-prepare them relative to DSA. That is a mistake in expected-value terms: the question bank is narrow, highly predictable, and largely unchanged year to year.

This guide covers what actually gets asked and what a scoring answer looks like.

While you prepare, make sure your resume clears screening — the [free ATS score checker](https://www.thetailorcv.com/solutions).

---

## Operating systems — what recurs

**Process vs thread.** The most common opener. A process has its own memory space; threads share the memory of their parent process. Follow it with the consequence — threads are lighter to create and switch between, but a bug in one can corrupt shared state.

**Deadlock.** The single most reliable OS question. Know the **four necessary conditions** — mutual exclusion, hold and wait, no preemption, circular wait — and that prevention means breaking any one of them. Naming all four in order signals structured preparation immediately.

**CPU scheduling.** FCFS, SJF, round robin, priority. The follow-up is usually "which is best", and the answer is that it depends on the objective — SJF minimises average waiting time but can starve long processes; round robin is fair but adds context-switch overhead.

**Virtual memory and paging.** What virtual memory achieves, how paging maps virtual to physical addresses, what a page fault is.

**Thrashing.** When the system spends more time swapping pages than executing.

**Semaphore vs mutex.** A mutex is a locking mechanism owned by one thread; a semaphore is a signalling mechanism with a counter. Binary semaphore and mutex are similar but not identical — ownership is the distinction.

**Race condition and critical section.**

**Context switching** — what the OS actually saves and restores.

**Internal vs external fragmentation.**

**Page replacement** — FIFO, LRU, optimal — and **Belady's anomaly**, which is a favourite because it is counterintuitive.

---

## DBMS — what recurs

**Normalisation.** The most-asked and most-failed topic. Students memorise the definitions of 1NF, 2NF and 3NF and then cannot normalise an actual table when handed one.

**Practise on real tables.** Take a messy table with repeating groups and partial dependencies and work it through. That is what you will be asked to do, not to recite definitions.

**Denormalisation** — and why you would deliberately do it. Read performance, at the cost of redundancy and update complexity.

**Keys.** Primary, unique, foreign, candidate, composite. Know that a primary key cannot be null while a unique key generally can.

**ACID properties.** Atomicity, Consistency, Isolation, Durability, each with a one-line explanation and an example.

**Indexes.** What they are, why they speed up reads, and — the follow-up that separates answers — what they cost you on writes and in storage.

**Clustered vs non-clustered index.** A clustered index determines the physical order of rows, so there can only be one.

**DELETE vs TRUNCATE vs DROP.** DELETE removes rows and can be rolled back and filtered; TRUNCATE removes all rows faster with less logging; DROP removes the table itself.

**Joins.** Inner, left, right, full outer — be able to draw the result of each on two small tables.

**Transactions and deadlocks in databases.**

**SQL vs NoSQL** — and when you would choose each.

---

## SQL queries you should be able to write

Expect to write these on paper or a whiteboard:

- Second highest salary
- Find duplicate rows
- Employees earning above their department average
- GROUP BY with HAVING
- Join three tables and aggregate

**The WHERE vs HAVING distinction** is asked specifically because it separates memorisation from understanding: WHERE filters rows before grouping, HAVING filters groups after.

---

## How to answer well

**Definition, then example, then consequence.** A definition alone is the floor.

**Use your own project wherever possible.** "We hit this in my scheduling project — two users could book the same slot because I was checking availability and then inserting, so I moved to a transaction with row-level locking" is worth far more than a textbook answer, and it usually ends the questioning on that topic.

**Say when you do not know.** "I haven't worked with that directly, but my understanding is X" is far better than a confident wrong answer, which damages your credibility for the rest of the interview.

**Expect follow-ups.** Every concept gets probed one or two levels deeper, which is exactly why examples matter — see [campus placement technical interview questions](https://thetailorcv.com/blog/campus-placement-technical-interview-questions).

---

## What to skip

Your syllabus covers far more than interviews ask. Deprioritise:

- Detailed disk scheduling algorithms
- Advanced file system internals
- Distributed database theory
- Detailed concurrency control protocols beyond basic locking
- Query optimisation internals

Focus instead on the recurring list above, which covers the overwhelming majority of what is actually asked. Ask your placement cell what specific companies asked last year — the records frequently exist.

---

## Common Mistakes

**Memorising normalisation definitions without practising.** You will be handed a table and asked to normalise it, not asked to recite the forms.

**Giving definitions with no example.** It is the floor, not an answer, and the follow-up exposes it immediately.

**Confusing WHERE and HAVING.** It is asked specifically because it distinguishes understanding from recall.

**Not knowing the cost of an index.** The follow-up to "what is an index" is always what it costs on writes.

**Answering "which scheduling algorithm is best" with one name.** The point is that it depends on the objective.

**Guessing confidently.** A wrong answer delivered with certainty damages your credibility for the whole interview.

**Revising the entire syllabus.** Interviews ask a narrow recurring set, and spreading thin means knowing nothing well.

**Prioritising DSA to the exclusion of OS and DBMS.** These are asked more consistently at many campus drives and prepared far less.

---

## Frequently Asked Questions

### Are OS and DBMS really asked in campus interviews?

Consistently, at most companies, and frequently more reliably than complex DSA. They are also under-prepared relative to how often they appear.

### What is the most common OS question?

Deadlock — specifically the four necessary conditions and how prevention works by breaking one of them.

### What is the most failed DBMS topic?

Normalisation. Students memorise the normal forms and then cannot normalise an actual table, which is what interviewers ask them to do.

### Do I need to write SQL by hand?

Frequently yes, on paper or a whiteboard. Practise the recurring queries — second highest salary, duplicates, above-average filtering, and multi-table joins.

### How deep do the questions go?

One or two follow-ups past the definition, which is why examples from your own work matter so much.

### What should I skip from my syllabus?

Disk scheduling details, file system internals, distributed database theory and query optimisation internals rarely appear in campus interviews.

### What if I do not know an answer?

Say so briefly, state what you do understand, and how you would find out. It scores considerably better than a confident wrong answer.

---

Preparation only matters if your resume gets you the interview. [Check your ATS score free](https://www.thetailorcv.com/solutions).

## Make This Practical

Practise normalisation on actual tables rather than memorising the forms. Take a messy table with repeating groups and partial dependencies and work it to 3NF on paper — that is the exercise you will be handed, and reciting definitions is what fails.

Then attach an example to every concept, ideally from your own project. "We hit this when two users could book the same slot" beats any textbook answer, survives follow-up questions, and usually ends the questioning on that topic satisfied.

Finally, prioritise rather than revising everything. Deadlock and its four conditions, process versus thread, scheduling trade-offs, normalisation, indexes and their write cost, ACID, joins and the WHERE-versus-HAVING distinction cover the overwhelming majority of what campus interviews actually ask.
