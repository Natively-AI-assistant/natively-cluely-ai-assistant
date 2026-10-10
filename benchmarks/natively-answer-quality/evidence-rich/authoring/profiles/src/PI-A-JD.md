# Senior Backend Engineer — Payments & Ledger

Ostrakel Payments | Ledger Core team | Bengaluru (hybrid) | Full-time | Level L5

Requisition OST-ENG-0417 | Posted 14 September 2026

## About Ostrakel

Ostrakel Payments builds payment orchestration and merchant-ledger infrastructure for mid-market marketplaces in India and Southeast Asia. We were founded in 2019 and are about 420 people. More than 3,100 marketplaces move money through our platform. On an ordinary day we process 2.6 million transactions and settle to sellers through 13 partner banks.

## The team

Ledger Core owns the double-entry ledger, the idempotency layer in front of every money-moving API, and the daily reconciliation between our books, processor reports and bank statements. The team has 9 engineers: 7 backend engineers and 2 site reliability engineers. You will report to Sarvesh Idnavalli, Engineering Manager for Ledger Core.

This is a senior individual-contributor role at level L5. The next level, L6, is Staff Engineer.

## What you will do

- Design, build and own services in the ledger write path. New services are written in Go 1.23. The settlement engine and the reconciliation batch jobs are Java 21 on Spring Boot and make up roughly 40% of the team's code, so you will read and change both.
- Keep money movement exactly-once in effect: idempotency keys on every write API, an outbox per service, and consumers that can be replayed safely.
- Evolve the ledger schema on PostgreSQL 16: partitioned journal tables, serializable transactions where the invariants need them, and schema changes with no downtime.
- Operate and extend the Kafka backbone that carries ledger events to settlement, risk and reporting.
- Improve the three-way reconciliation pipeline. The unexplained break rate today is 0.05% of transactions and the goal for this financial year is below 0.02%.
- Take part in the on-call rotation: one week in six as primary for Ledger Core, around the clock, with a compensatory day off after each on-call week.
- Lead design reviews and guide 2 to 3 engineers on the projects you own. The role has no line-management duties.
- Write the design documents and production-readiness reviews for what you ship, and present ledger changes to the finance operations team before release.

## What we are looking for

### Must have

- 6 or more years of backend engineering, with at least 2 of them at senior level or as the technical lead of a team.
- Production experience in Go or Java, and willingness to work in both.
- At least 2 years building payment, ledger, banking or other money-movement systems.
- Deep PostgreSQL knowledge: transaction isolation, locking, indexing and partitioning.
- Hands-on work with Kafka or a comparable log: ordering, consumer groups and delivery semantics.
- A record of designing for idempotency, retries and partial failure in distributed systems.
- Experience carrying the pager for a tier-1 service and leading incident response.
- Ownership: you have taken a system from design document to production and stayed with it afterwards.

### Good to have

- Java and Spring Boot in production.
- Working knowledge of PCI DSS v4.0. Ostrakel is certified as a PCI DSS Level 1 service provider and Ledger Core services are in audit scope.
- Having built or run a reconciliation system, or a working understanding of double-entry accounting.
- Familiarity with UPI and card settlement flows, or with ISO 20022 messages.
- Zero-downtime data migrations and change data capture.

## Where and how we work

The role is based at our Bengaluru office in HSR Layout. We work hybrid: three days a week in the office, Tuesday to Thursday, and the other two from wherever you like. The role is not open to fully remote candidates. Relocation assistance is available for candidates moving to Bengaluru from another city.

## Interview process

After a 30-minute call with a recruiter there are four rounds, usually completed within three weeks:

1. Coding, 60 minutes, in Go or Java.
2. System design, 75 minutes, on a ledger or payment flow.
3. Deep dive into a system you have built and run.
4. Conversation with the hiring manager.

## Benefits

- Health insurance for you and your dependants.
- Annual learning budget of INR 60,000.
- Employee stock options for all permanent staff.
- 26 days of paid leave a year, not counting public holidays.

Compensation is fixed pay plus stock options. The band for level L5 is shared during the recruiter call.

Ostrakel Payments is an equal-opportunity employer. We consider every applicant without regard to gender, religion, caste, disability, age or sexual orientation.
