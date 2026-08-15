---
title: Campus Placement Technical Interview Questions 2026 - Topics and Answers
description: The technical questions campus interviewers actually ask - OOP, DBMS, operating systems, networking, and project follow-ups - what each is testing, and how to answer without being caught out.
date: 2026-08-12
author: TailorCV Team
tags: [Campus Placement, Technical Interview, Freshers, Computer Science, Interview Questions]
category: Interview Preparation
image: public/blog-images/campus-placement-technical-interview-questions.png
slug: campus-placement-technical-interview-questions
keywords: technical interview questions campus placement, oop interview questions freshers, dbms interview questions placement, os interview questions placement
---

## Key Takeaways

- Campus technical interviews concentrate on four areas: OOP, DBMS, operating systems, and your own projects - in roughly that order of frequency.
- Project questions are the highest-risk part, because interviewers probe until they find the edge of your understanding.
- Definitions alone score poorly; interviewers want an example, ideally from something you built.
- Anything on your resume is fair game, so a skill you cannot defend is worse than one you never listed.
- Saying "I don't know, but here's how I'd find out" scores far better than a confident wrong answer.

The technical round is where preparation either shows or does not. Unlike aptitude, it cannot be crammed in a fortnight, and unlike the coding round, there is no partial credit for an incomplete attempt.

What makes it manageable is how predictable the question bank is. Across service-based and product-based companies alike, the same core topics recur - object-oriented programming, database concepts, operating system fundamentals, some networking, and detailed questions about whatever you put on your resume.

This guide covers what gets asked in each area, what the interviewer is actually testing, and how to answer.

Make sure your resume gets you to this round first - run it through the [free ATS score checker](https://www.thetailorcv.com/solutions).

---

## Object-Oriented Programming

The single most-asked topic in campus technical interviews, largely because it is language-agnostic and quickly reveals depth.

**Core questions:**

- What are the four pillars of OOP? Explain each with an example.
- Difference between abstraction and encapsulation
- Method overloading vs method overriding
- What is polymorphism, and what are its types?
- Can you explain inheritance types? Why does Java not support multiple inheritance through classes?
- Abstract class vs interface - when would you use each?
- What is a constructor? Types of constructors. Can a constructor be private?
- Static vs instance members
- What is the `final` keyword used for?
- Shallow copy vs deep copy
- What is the diamond problem?

**How to answer well.** Definitions are the floor, not the answer. Every one of these is stronger with an example, and strongest with an example from your own code.

Weak: "Encapsulation means binding data and methods together and hiding internal state."

Strong: "Encapsulation is bundling data with the methods that operate on it and controlling access. In my scheduling project the `Appointment` class kept its status field private, because changing status had to go through a method that also checked for conflicts. If it were public, someone could set a status directly and skip the validation - which is exactly the bug that made me change it."

That answer demonstrates you have used the concept rather than memorised it, and it usually ends the questioning on that topic.

---

## DBMS and SQL

The second most common area, asked at almost every company.

**Concept questions:**

- What is normalisation? Explain 1NF, 2NF, 3NF with an example
- What is denormalisation, and when would you do it?
- Primary key vs unique key vs foreign key
- What are ACID properties?
- Clustered vs non-clustered index
- What is an index and what does it cost you?
- DELETE vs TRUNCATE vs DROP
- What is a transaction? What is a deadlock?
- Types of joins - inner, left, right, full outer
- What is a view? What is a stored procedure?
- SQL vs NoSQL - when would you choose each?

**Query questions.** Expect to write SQL on paper or a whiteboard:

- Find the second highest salary
- Find duplicate rows in a table
- Find employees earning more than their department average
- Use GROUP BY with HAVING
- Join three tables and aggregate

**The most common failure:** knowing normal form definitions but being unable to normalise an actual table when given one. Practise with a concrete messy table rather than memorising the rules.

**Second most common:** confusing WHERE and HAVING. WHERE filters rows before grouping; HAVING filters groups after. Interviewers ask this specifically because it separates memorisation from understanding.

---

## Operating Systems

Asked consistently, particularly by product companies and core IT recruiters.

- Process vs thread
- What is a deadlock? What are the four necessary conditions? How do you prevent it?
- CPU scheduling algorithms - FCFS, SJF, round robin, priority. Which is best and why is that a trick question?
- What is virtual memory? What is paging? What is segmentation?
- Thrashing
- What is a semaphore? Binary vs counting. Mutex vs semaphore
- Race condition and critical section
- Context switching - what actually happens?
- Internal vs external fragmentation
- Page replacement algorithms - FIFO, LRU, optimal
- What is Belady's anomaly?

**Answering approach:** these are conceptual, so a short definition plus a concrete scenario works well. For deadlock, naming the four conditions - mutual exclusion, hold and wait, no preemption, circular wait - and then explaining that prevention means breaking any one of them shows structured understanding rather than recall.

---

## Computer Networks

Asked less often than OOP or DBMS but common enough to prepare.

- OSI model layers and what each does
- TCP vs UDP - differences and when to use each
- What happens when you type a URL into a browser and press enter? (Extremely common - practise the full walkthrough: DNS resolution, TCP handshake, TLS, HTTP request, response, rendering)
- Three-way handshake
- HTTP vs HTTPS
- What is DNS? What is DHCP?
- IP addressing basics, subnetting
- What is a firewall? What is NAT?
- GET vs POST
- What are status codes 200, 301, 404, 500?

The "what happens when you type a URL" question is worth rehearsing out loud specifically. It is asked constantly, it has no single right answer, and interviewers use it to see how much of the stack you actually understand.

---

## Data Structures and Algorithms

Even when there has been a separate coding round, expect conceptual questions:

- Array vs linked list - tradeoffs
- Stack vs queue, with real use cases
- Time complexity of common operations
- Explain a hash map. How does collision handling work?
- Binary search tree vs balanced tree
- When would you use a heap?
- Explain your approach to a problem you solved in the coding round

The full preparation for the coding side is in [the campus placement coding round guide](https://thetailorcv.com/blog/campus-placement-coding-round-guide).

---

## Project Questions: The Highest-Risk Section

This is where interviews are won and lost, and where unprepared candidates come apart.

Interviewers probe until they find the limit of your understanding. That is the point of the exercise - they are calibrating how deep your knowledge actually goes.

**Standard sequence:**

1. "Walk me through your project."
2. "Why did you choose that technology?"
3. "What was the hardest part?"
4. "What would you do differently?"
5. "How would you scale it to a hundred times the users?"
6. "How did you test it?"
7. "What did you personally build, and what did your teammates build?"

**Preparation that works:**

**Be able to explain it in two minutes and in ten.** Different interviewers want different depth.

**Know why, not just what.** "I used MongoDB" is not an answer; "I used MongoDB because the records had varying fields per client and I did not want to keep altering a schema" is.

**Have a real hardest part.** A specific bug or design problem, what you tried, and what worked. This is the single best question to prepare because it demonstrates genuine engagement.

**Be honest about team contributions.** If four people built it, say so and be precise about your part. Being caught inflating is far more damaging than the project being smaller than assumed.

**Know its weaknesses.** "What would you do differently" is answered badly by "nothing". Naming a limitation reads as engineering maturity.

**Do not list projects you cannot defend.** This is the recurring theme, and the fix is in [campus placement resume mistakes](https://thetailorcv.com/blog/campus-placement-resume-mistakes). Which projects to build in the first place is covered in [choosing a final year project for placements](https://thetailorcv.com/blog/final-year-project-for-placement).

---

## Language-Specific Questions

Whatever you list as your primary language, expect depth.

**Java:** JVM, JRE and JDK; garbage collection; collections framework; HashMap internal working (asked constantly); String immutability; String vs StringBuilder vs StringBuffer; exception hierarchy; checked vs unchecked exceptions.

**C++:** pointers and references; memory management; virtual functions and vtables; STL containers; copy constructor; destructors; RAII.

**Python:** lists vs tuples; dictionaries; mutability; decorators; generators; the GIL; shallow vs deep copy.

Only list a language if you are ready for this level of questioning. Two languages you know well beat five you have touched.

---

## What Interviewers Are Really Assessing

Beyond the answers themselves:

**Can you think, or only recall?** Follow-up questions test this deliberately.

**Do you admit what you do not know?** A confident wrong answer is a serious negative; "I'm not certain, but my understanding is X, and I'd verify by Y" scores well.

**Can you explain clearly?** Communication is being assessed throughout - see [campus placement communication skills](https://thetailorcv.com/blog/campus-placement-communication-skills).

**Are you consistent with your resume?** Contradictions between what you wrote and what you say are noticed.

Emphasis differs by employer type - service companies weight fundamentals and communication, product companies weight depth and problem-solving. The distinction is set out in [service-based vs product-based companies](https://thetailorcv.com/blog/service-based-vs-product-based-companies).

---

## Common Mistakes

**Memorising definitions without examples.** The follow-up question exposes it immediately.

**Claiming skills you cannot defend.** The most avoidable failure in the entire round.

**Saying "nothing" to "what would you do differently".** Reads as no reflection.

**Overstating your role in a team project.** Precise, honest answers are stronger.

**Guessing confidently.** Far worse than admitting uncertainty.

**Only preparing DSA.** OOP and DBMS are asked more often at most campus drives.

**Not rehearsing your project explanation out loud.** It is always harder than it seems in your head.

**Ignoring your own resume.** Read it before every interview - you wrote it months ago.

---

## Frequently Asked Questions

### What topics are most important for campus technical interviews?

OOP, DBMS with SQL, operating systems, and your own projects. Networking and DSA concepts follow. OOP and DBMS are asked at almost every company regardless of type.

### How deep do they go on projects?

Deep enough to find the limit of your understanding - that is the purpose. Expect questions on technology choices, the hardest problem you hit, scaling, testing, and exactly what you personally built.

### What if I do not know an answer?

Say so briefly, state what you do understand about the area, and explain how you would find out. This scores considerably better than a confident wrong answer, which damages your credibility for the rest of the interview.

### Do I need to prepare all four subjects?

OOP and DBMS are essential. Operating systems is asked very frequently. Networking is worth a lighter pass unless you are targeting core IT or infrastructure roles.

### How long is a campus technical interview?

Typically 30 to 60 minutes, sometimes across two rounds at product companies. Service companies often run a single shorter technical round before HR.

### Are technical questions different for non-CSE students?

Core branches often face branch-specific technical questions alongside programming fundamentals. If you are targeting IT roles from a core branch, you will generally face the same CS questions as CSE students - see [resume for campus placement for non-CSE branches](https://thetailorcv.com/blog/resume-for-campus-placement-non-cse).

### Should I revise from my college notes?

They are a reasonable base for OS and DBMS theory, but campus interviews favour applied understanding. Pair the theory with examples from your own projects, which is what actually distinguishes answers.

---

Get to the technical round in the first place. [Check your ATS score free](https://www.thetailorcv.com/solutions).

## Make This Practical

Prepare your project answers first, because they carry the highest risk and the highest reward. For each project on your resume, write out why you chose the technology, the hardest problem you hit and how you solved it, what you would change, and precisely what you built versus your teammates - then rehearse the two-minute and ten-minute versions out loud.

Then cover the four core areas in order of frequency: OOP with an example for every concept, DBMS including writing actual queries on paper, operating systems fundamentals, and a lighter pass on networking including the full "what happens when you type a URL" walkthrough.

Finally, audit your resume against what you can defend. Remove any language or framework you are not ready to be questioned on, re-read the document before every interview, and prepare the honest "I don't know, but here's how I'd find out" response. Then check the rest of the process using [the campus placement preparation timeline](https://thetailorcv.com/blog/campus-placement-preparation-timeline) and the [free ATS score checker](https://www.thetailorcv.com/solutions).
