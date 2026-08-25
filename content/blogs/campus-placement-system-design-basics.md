---
title: Campus Placement System Design Basics 2026 - What Freshers Need
description: System design appears in campus interviews at product companies, pitched far below senior level. The building blocks, a structure to follow, and how deep freshers are actually expected to go.
date: 2026-08-20
author: TailorCV Team
tags: [Campus Placement, System Design, Technical Interview, Freshers, Product Companies]
category: Interview Preparation
image: public/blog-images/campus-placement-system-design-basics.webp
slug: campus-placement-system-design-basics
keywords: system design for freshers, low level design interview, campus system design, hld lld basics
---

## Key Takeaways

- Freshers are asked design questions to see how they reason, not to produce a production architecture.
- Low-level design — classes, relationships, interfaces — is more common for freshers than distributed systems.
- Always start from requirements and scale, never from a diagram.
- Knowing a handful of building blocks and their trade-offs covers most of what is asked.
- Your own project is the strongest material you have, because you actually made the decisions.

System design in campus interviews causes disproportionate anxiety because students read guides written for senior engineers and conclude they need to design a globally distributed system.

They do not. A fresher design question is a reasoning test. Interviewers want to see whether you ask clarifying questions, whether you can justify a choice, and whether you understand the consequences of what you propose.

This guide covers what is actually asked at fresher level and how to structure an answer.

While you prepare, make sure your resume clears screening — the [free ATS score checker](https://www.thetailorcv.com/solutions).

---

## Two kinds of question

**Low-level design (LLD).** Design the classes for a parking lot, a library system, an elevator, a vending machine, a card game. **This is the more common fresher question**, particularly at Indian product companies, and it tests object-oriented thinking rather than distributed systems.

**High-level design (HLD).** Design a URL shortener, a chat application, a news feed. Asked less often at fresher level, and when it is, expectations are pitched much lower than for experienced candidates.

**Which you get depends on the company.** Service-based companies rarely ask either; product companies ask LLD frequently and HLD occasionally — see [service-based vs product-based companies](https://thetailorcv.com/blog/service-based-vs-product-based-companies).

---

## Low-level design: what they assess

**Identify the entities.** For a parking lot: ParkingLot, Level, ParkingSpot, Vehicle, Ticket, Payment.

**Define relationships.** A ParkingLot has many Levels; a Level has many Spots; a Ticket links a Vehicle to a Spot.

**Apply OOP principles sensibly.** Inheritance where there is a genuine is-a relationship — Car, Bike and Truck extending Vehicle. Encapsulation so state changes go through methods that enforce rules.

**Handle the interesting case.** Every LLD question has one: how do you allocate the nearest available spot, how do you prevent two vehicles being assigned the same spot, how do you calculate a fee across pricing tiers. **The interesting case is where the marks are.**

**Mention a design pattern only where it fits.** Factory for creating vehicle types, Strategy for pricing rules, Singleton for a single lot instance. Forcing patterns in where they add nothing is a recognisable failure.

The OOP grounding is covered in [campus placement technical interview questions](https://thetailorcv.com/blog/campus-placement-technical-interview-questions).

### The interesting case in each common question

Students spend their preparation listing entities, which is the easy half. This is the half that decides the round.

| Question | The interesting case | What they want to hear |
|---|---|---|
| **Parking lot** | Two cars assigned the same spot | Lock or atomically mark the spot when allocating, not after |
| **Elevator** | Which lift answers a call on floor 7 | A scoring rule — direction of travel, current load, distance |
| **Vending machine** | Payment succeeds, dispensing fails | State machine with a refund path, not a linear flow |
| **Library system** | Two members borrow the last copy | Lock the copy row inside the transaction |
| **Movie booking** | Two users select the same seat | Temporary hold with a timeout, then confirm |
| **Splitwise** | Settling debts across three people | Net the balances rather than storing every transaction |
| **Rate limiter** | Requests exactly on the window boundary | Sliding window over fixed window, and say why |
| **Card game** | Shuffling and dealing fairly | Fisher-Yates, and dealing from a single source of truth |

**The pattern across all of them is concurrency or state.** If you cannot see the interesting case in a question, ask yourself what breaks when two people do the same thing at the same time — that is almost always it.

**Say it unprompted.** "Before I go further, the part I think matters most here is what happens when two users select the same seat" is the single strongest thing you can say in an LLD round, because it demonstrates you found the difficulty rather than waiting to be led to it.

---

## High-level design: the structure

If you get an HLD question, follow this sequence rather than drawing first.

**1. Clarify requirements.** Functional — what must it do? Non-functional — roughly how many users, how much data, read-heavy or write-heavy? **Jumping straight to a diagram is the classic failure**, and asking these questions is itself part of the assessment.

**2. Estimate roughly.** "If a million users each shorten ten URLs, that is ten million records." Precision is not the point; showing you think about magnitude is.

**3. Define the API.** Two or three endpoints with inputs and outputs.

**4. Sketch the components.** Client, server, database, and a cache if reads dominate.

**5. Go deeper where prompted.** The interviewer will steer you.

**6. Discuss trade-offs.** This is the highest-scoring part — SQL versus NoSQL and why, what the cache costs in staleness, what happens when a component fails.

### The questions to ask before you draw anything

Have these ready. Asking four of them takes ninety seconds and changes how the rest of the round goes.

| Ask | Why it changes the design |
|---|---|
| "Roughly how many users are we designing for?" | A thousand and ten million are different systems |
| "Is this read-heavy or write-heavy?" | Decides whether a cache is the first thing you add |
| "Does it need to be real-time, or is a delay acceptable?" | Decides whether a queue solves it |
| "How long does the data need to be kept?" | Changes storage and archival entirely |
| "Do we need it to work across regions?" | Otherwise do not mention geo-distribution at all |
| "Is any of this money or safety critical?" | Decides how much consistency you trade for speed |

**Ask, then say what you concluded from the answer.** "If it is read-heavy at that scale, I would put a cache in front of the database" makes the question part of your reasoning rather than a delaying tactic.

---

## The building blocks worth knowing

A small set covers most fresher questions.

**Load balancer.** Distributes requests across servers, and enables horizontal scaling.

**Caching.** Store frequent reads in memory. The follow-up is always invalidation — how do you avoid serving stale data.

**Database choice.** SQL for structured data with relationships and transactions; NoSQL for flexible schemas and simple high-volume access. Be able to justify your pick rather than naming one.

**Indexing.** Speeds reads, costs writes and storage — see [the campus placement OS and DBMS guide](https://thetailorcv.com/blog/campus-placement-os-dbms-notes).

**Horizontal vs vertical scaling.** Adding machines versus making one bigger.

**Message queue.** Decouples producers from consumers, and lets slow work happen asynchronously.

**CDN.** Serves static content from locations near users.

That is genuinely enough for a fresher round.

---

## Use your own project

The strongest material you have, and most students never use it.

When you designed your project, you made real decisions — which database, how to structure the data, what to do when two requests collided. Those are design decisions, and discussing them is far more convincing than reciting a generic architecture.

> In my scheduling project I initially checked availability then inserted the booking, and two users could book the same slot. I moved it into a transaction with row-level locking. The trade-off was slightly slower writes, but correctness mattered more than throughput at that volume.

That answer demonstrates requirements thinking, a real constraint, a decision and a trade-off — everything an HLD question is testing — and it is unarguably yours. See [choosing a final year project for placements](https://thetailorcv.com/blog/final-year-project-for-placement).

---

## Common Mistakes

**Drawing a diagram before asking anything.** Clarifying requirements and scale is part of the assessment, and skipping it is the classic failure.

**Listing entities and stopping there.** That is the easy half of an LLD question; the concurrency or state problem underneath it is what is being marked.

**Waiting to be led to the difficulty.** Naming the interesting case unprompted is the strongest single move available in a design round.

**Studying senior-level system design material.** It is pitched far above what freshers are asked and creates anxiety without improving your answer.

**Forcing design patterns in.** Naming Singleton or Factory where they add nothing is a recognisable attempt to sound advanced.

**Naming a database without justifying it.** "I'd use MongoDB" scores nothing; explaining why the access pattern suits it scores well.

**Asking clarifying questions and then ignoring the answers.** State what each answer changed, or the questions read as a stalling tactic.

**Ignoring trade-offs.** Every choice has a cost, and stating it unprompted is the highest-scoring habit in a design round.

**Not mentioning cache invalidation.** It is the guaranteed follow-up to proposing a cache.

**Never using your own project.** You made real design decisions there, and they are more convincing than any memorised architecture.

---

## Frequently Asked Questions

### Do freshers get system design questions?

At product companies, frequently — usually low-level design of classes for a parking lot or similar. Service-based companies rarely ask either type.

### What is the difference between LLD and HLD?

LLD is class and object design within an application. HLD is the architecture of a system — servers, databases, caches. Freshers are asked LLD far more often.

### How do I find the "interesting case" in an LLD question?

Ask what breaks when two people do the same thing simultaneously. Two cars in one spot, two users on one seat, two members borrowing the last copy — it is almost always concurrency or state.

### How deep do I need to go?

Not far. Interviewers assess reasoning, clarifying questions and trade-off awareness rather than production-grade architecture.

### Where should I start in an HLD question?

Requirements and rough scale, always. Drawing components before establishing what the system must do is the most common mistake.

### What should I ask before designing?

Scale, read-heavy or write-heavy, real-time or not, retention, regions, and whether anything is money-critical. Then say what each answer changed about your approach.

### Should I mention design patterns?

Only where they genuinely fit. Forced pattern references are transparent and score against you.

### What building blocks should I know?

Load balancer, caching and invalidation, SQL versus NoSQL, indexing, horizontal versus vertical scaling, message queues and CDNs. That set covers most fresher questions.

### Can I use my own project in a design answer?

Yes, and it is the strongest material available to you, because you made the decisions and can defend them under follow-up questions.

---

Design rounds only matter if your resume gets you there. [Check your ATS score free](https://www.thetailorcv.com/solutions).

## Make This Practical

Take the eight LLD questions above and, for each one, write down only the interesting case — not the entity list. Two cars in one spot, two users on one seat, payment taken and nothing dispensed. Listing entities is the half everyone prepares; the concurrency problem underneath is the half that decides the round.

Then memorise six clarifying questions for HLD and, crucially, practise saying what each answer changed. "If it is read-heavy at that scale, I would put a cache in front of the database" turns a question into reasoning; asking and then ignoring the answer reads as stalling.

Finally, write out one real decision from your own project — why that database, how you handled a collision, what you traded away. A decision you genuinely made and can defend through four follow-ups beats any architecture you memorised from a senior-level guide.
