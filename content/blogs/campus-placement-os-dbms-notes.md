---
title: Campus Placement OS and DBMS Guide 2026 - The Questions Actually Asked
description: Operating systems and DBMS are asked at almost every campus interview. The specific questions that recur, what a good answer looks like, and what to skip from your syllabus.
date: 2026-08-20
author: TailorCV Team
tags: [Campus Placement, Operating Systems, DBMS, Technical Interview, Freshers]
category: Interview Preparation
image: public/blog-images/campus-placement-os-dbms-notes.webp
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

### Deadlock, answered properly

This is the highest-frequency question in the whole topic, so it is worth having a complete answer rather than four memorised words.

| Condition | What it means | How you break it |
|---|---|---|
| **Mutual exclusion** | A resource can be held by only one process | Make resources shareable where possible (read-only data) |
| **Hold and wait** | A process holds one resource while waiting for another | Require all resources to be requested at once, up front |
| **No preemption** | A resource cannot be forcibly taken back | Allow the OS to preempt and roll back |
| **Circular wait** | A cycle of processes each waiting on the next | Impose a global ordering — always acquire lock A before lock B |

**All four must hold simultaneously for deadlock to occur**, which is why breaking any one prevents it. That sentence is the part that scores, because it explains why the table matters instead of just listing it.

**The follow-up is almost always "which one would you break in practice".** Circular wait, by ordering your locks — it is the cheapest to implement and does not require the OS to support preemption or force processes to declare everything in advance.

**Then connect it to something real if you can:** "I hit this in a project where two threads locked a user row and an order row in different orders. Fixing it meant always locking the user first."

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

**Joins.** Inner, left, right, full outer — be able to draw the result of each on two small tables. Worked examples are in [the campus placement SQL questions guide](https://thetailorcv.com/blog/campus-placement-sql-questions).

**Transactions and deadlocks in databases.**

**SQL vs NoSQL** — and when you would choose each.

---

## Normalisation, worked on an actual table

This is the exercise you will be handed. Definitions will not get you through it.

**The messy table you are given:**

| student_id | student_name | course_ids | instructor | instructor_phone |
|---|---|---|---|---|
| 101 | Aarav | CS101, CS102 | Dr Menon | 98xxxx1234 |
| 102 | Priya | CS101 | Dr Menon | 98xxxx1234 |
| 103 | Rohan | CS103 | Dr Iyer | 98xxxx5678 |

**Step 1 — 1NF: no repeating groups.** `course_ids` holds two values in one cell. Split it so each row holds a single value.

| student_id | student_name | course_id | instructor | instructor_phone |
|---|---|---|---|---|
| 101 | Aarav | CS101 | Dr Menon | 98xxxx1234 |
| 101 | Aarav | CS102 | Dr Menon | 98xxxx1234 |
| 102 | Priya | CS101 | Dr Menon | 98xxxx1234 |

**Step 2 — 2NF: no partial dependency.** The key is now (student_id, course_id). But `student_name` depends only on `student_id`, not on the whole key. Split it out.

- **Students** — student_id, student_name
- **Enrolments** — student_id, course_id
- **Courses** — course_id, instructor, instructor_phone

**Step 3 — 3NF: no transitive dependency.** In Courses, `instructor_phone` depends on `instructor`, which depends on `course_id`. The phone number is transitively dependent, so pull instructors out.

- **Students** — student_id, student_name
- **Enrolments** — student_id, course_id
- **Courses** — course_id, instructor_id
- **Instructors** — instructor_id, instructor_name, instructor_phone

**Say the reason out loud at each step**, because that is what is being marked. "1NF because the course column held multiple values. 2NF because the student name depended on part of the key. 3NF because the phone number depended on the instructor rather than the course."

**The payoff is worth stating too:** Dr Menon's phone number now exists in exactly one row, so changing it is one update rather than three — and there is no way for the three copies to disagree.

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

**Normalising without saying why at each step.** The reason is what is being marked, not the final set of tables.

**Listing the four deadlock conditions without saying they must all hold.** That sentence is what turns a memorised list into an explanation.

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

### Which deadlock condition would I break in practice?

Circular wait, by imposing a global lock ordering. It is the cheapest to implement and needs no OS support for preemption.

### What is the most failed DBMS topic?

Normalisation. Students memorise the normal forms and then cannot normalise an actual table, which is what interviewers ask them to do.

### How do I practise normalisation properly?

Take a table with a multi-value column and a transitive dependency, work it to 3NF on paper, and say the reason for each step out loud. The reason is what is marked.

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

Work the normalisation example above on paper, from the messy table to the four final tables, saying the reason for each step out loud. That is the exact exercise you will be handed, and the reason at each step is what is being marked — not the tables you end up with.

Then build a proper deadlock answer: the four conditions, the sentence that all four must hold simultaneously, and circular wait as the one you would break in practice by ordering your locks. It is the most reliable question in the topic and most students give four words where a complete answer takes thirty seconds.

Finally, attach an example to every concept, ideally from your own project. "Two users could book the same slot because I checked availability and then inserted" beats any textbook definition, survives the follow-up, and usually ends the questioning on that topic satisfied.
