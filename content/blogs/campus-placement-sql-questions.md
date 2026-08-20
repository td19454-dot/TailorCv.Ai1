---
title: Campus Placement SQL Questions 2026 - The Queries You Will Be Asked
description: SQL appears in almost every campus technical round and is under-prepared. The recurring query patterns, worked solutions, and the concepts interviewers probe behind each one.
date: 2026-08-20
author: TailorCV Team
tags: [Campus Placement, SQL, DBMS, Technical Interview, Freshers]
category: Interview Preparation
image: public/blog-images/campus-placement-sql-questions.png
slug: campus-placement-sql-questions
keywords: sql interview questions freshers, second highest salary query, sql placement questions, joins interview
---

## Key Takeaways

- SQL is asked at almost every campus technical round and prepared far less than DSA.
- The question bank is small — roughly eight query patterns cover the overwhelming majority.
- You will frequently write queries on paper, so practise without autocomplete.
- Interviewers probe the concept behind each query, so know why your solution works.
- WHERE versus HAVING and the difference between join types are the two most reliable follow-ups.

SQL is the highest return-per-hour topic in campus preparation. The question bank is genuinely small, it barely changes year to year, and most students spend all their time on DSA and improvise here.

You will also frequently be asked to write queries by hand, which is a different experience from typing them with an editor helping you.

This guide covers the patterns that recur, with worked solutions.

While you prepare, make sure your resume clears screening — the [free ATS score checker](https://www.thetailorcv.com/solutions).

---

## 1. Second highest salary

The single most-asked SQL question in campus interviews.

```sql
SELECT MAX(salary)
FROM employees
WHERE salary < (SELECT MAX(salary) FROM employees);
```

**The follow-up:** what if you need the Nth highest? That moves you to a window function or `LIMIT` with `OFFSET`:

```sql
SELECT DISTINCT salary
FROM employees
ORDER BY salary DESC
LIMIT 1 OFFSET 1;
```

**Why `DISTINCT` matters:** without it, duplicate salaries mean the second row is not the second highest *value*. Interviewers ask about this specifically.

---

## 2. Find duplicates

```sql
SELECT email, COUNT(*)
FROM users
GROUP BY email
HAVING COUNT(*) > 1;
```

**The concept probed:** why `HAVING` rather than `WHERE`. Because you are filtering on an aggregate computed after grouping — `WHERE` filters rows before grouping and cannot see `COUNT(*)`.

This is the distinction most students get wrong, and it appears constantly.

---

## 3. Employees earning more than their department average

```sql
SELECT e.name, e.salary, e.dept_id
FROM employees e
WHERE e.salary > (
    SELECT AVG(salary)
    FROM employees
    WHERE dept_id = e.dept_id
);
```

**What this tests:** correlated subqueries — the inner query references the outer row, so it re-evaluates per row.

---

## 4. Department-wise aggregates with a filter

```sql
SELECT d.dept_name, COUNT(e.id) AS headcount, AVG(e.salary) AS avg_salary
FROM departments d
JOIN employees e ON e.dept_id = d.id
GROUP BY d.dept_name
HAVING COUNT(e.id) > 5;
```

---

## 5. The join types

Be able to draw the output of each on two small tables — interviewers frequently ask you to.

**INNER JOIN** — rows matching in both tables.
**LEFT JOIN** — all rows from the left, with NULLs where no match.
**RIGHT JOIN** — the mirror.
**FULL OUTER JOIN** — all rows from both, NULLs where no match.

**The practical question that follows:** find records in one table with no match in another.

```sql
SELECT c.name
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.id IS NULL;
```

**Why this works** is worth being able to explain: the LEFT JOIN keeps every customer, and customers with no order have NULL in the order columns.

---

## 6. Employees and their managers — self join

```sql
SELECT e.name AS employee, m.name AS manager
FROM employees e
LEFT JOIN employees m ON e.manager_id = m.id;
```

**Why LEFT rather than INNER:** the person at the top has no manager, and an INNER JOIN would silently drop them. Interviewers look for this.

---

## 7. Top N per group

Harder, and asked at product companies.

```sql
SELECT dept_id, name, salary
FROM (
    SELECT dept_id, name, salary,
           ROW_NUMBER() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS rn
    FROM employees
) ranked
WHERE rn <= 3;
```

**Know the difference** between `ROW_NUMBER`, `RANK` and `DENSE_RANK` — ties are handled differently, and that is the follow-up.

---

## 8. Consecutive or date-based queries

```sql
SELECT COUNT(*)
FROM orders
WHERE order_date >= '2026-01-01'
  AND order_date <  '2026-02-01';
```

**A common trap:** applying a function to the column, such as `WHERE YEAR(order_date) = 2026`, prevents an index from being used. Mentioning that unprompted is a strong signal.

---

## Concepts behind the queries

Expect these as follow-ups rather than standalone questions:

**WHERE vs HAVING.** WHERE filters rows before grouping; HAVING filters groups after.

**Why an index helps, and what it costs.** Faster reads, slower writes, extra storage.

**DELETE vs TRUNCATE vs DROP.** DELETE removes rows, can be filtered and rolled back; TRUNCATE removes all rows faster; DROP removes the table.

**NULL handling.** `NULL = NULL` is not true — use `IS NULL`. `COUNT(column)` ignores NULLs while `COUNT(*)` does not.

**UNION vs UNION ALL.** UNION removes duplicates and therefore sorts; UNION ALL does not and is faster.

The wider DBMS ground is in [the campus placement OS and DBMS guide](https://thetailorcv.com/blog/campus-placement-os-dbms-notes).

---

## Common Mistakes

**Using WHERE to filter an aggregate.** WHERE runs before grouping and cannot see COUNT or AVG — this is the most frequent error and the most reliable follow-up.

**Forgetting DISTINCT in the second-highest query.** Duplicate salaries break the result, and interviewers ask about it specifically.

**Using INNER JOIN for a self join on managers.** It silently drops the person at the top of the hierarchy.

**Not knowing ROW_NUMBER versus RANK versus DENSE_RANK.** Tie handling is the follow-up to any top-N question.

**Comparing to NULL with `=`.** NULL comparisons require IS NULL, and this appears in interview traps deliberately.

**Applying functions to indexed columns in WHERE.** It prevents index usage, and noticing it unprompted marks you out.

**Practising only with autocomplete.** You will frequently write on paper, where syntax you never typed manually deserts you.

**Preparing DSA while improvising SQL.** SQL has a far smaller question bank and a much better return per hour of study.

---

## Frequently Asked Questions

### Is SQL really asked in campus placements?

At almost every technical round, and it is consistently under-prepared relative to DSA despite having a much smaller and more predictable question bank.

### What is the most common SQL question?

Second highest salary, followed by finding duplicates and filtering above a group average.

### What is the difference between WHERE and HAVING?

WHERE filters individual rows before grouping; HAVING filters groups after aggregation. It is the most reliable follow-up in any SQL round.

### Do I need window functions?

For service-based companies usually not. Product companies ask top-N-per-group questions where ROW_NUMBER and RANK are the natural solution.

### Will I write queries by hand?

Frequently, on paper or a whiteboard. Practise without an editor helping you, because syntax you have never typed manually is easy to lose under pressure.

### How much SQL should I learn?

The eight patterns above plus the concept follow-ups cover the overwhelming majority of campus questions.

### What is the difference between UNION and UNION ALL?

UNION removes duplicates and therefore has to sort; UNION ALL keeps everything and is faster.

---

Preparation only matters if your resume gets you the interview. [Check your ATS score free](https://www.thetailorcv.com/solutions).

## Make This Practical

Write the eight patterns out by hand, on paper, without an editor. Second highest salary, duplicates, above-group-average, grouped aggregates with HAVING, the four join types, self join, top-N per group, and date range filtering — that set covers the overwhelming majority of what campus rounds ask.

Then learn the concept behind each rather than the syntax. WHERE versus HAVING, why LEFT JOIN is needed for the manager query, why DISTINCT matters in second-highest, and how NULL comparison works are the follow-ups that separate a memorised answer from an understood one.

Finally, treat this as the highest return-per-hour topic in your preparation. The question bank barely changes year to year, most students improvise here while grinding DSA, and a few focused evenings puts you clearly ahead in a round you will almost certainly face.
