# Advik Thorambath

Senior Software Engineer, Backend and Distributed Systems

Hyderabad, Telangana, India | advik@thorambath.example | +91 40 5550 0142 | github.example/athorambath

## Summary

Backend engineer with six years of experience building and operating distributed systems in Go and Kotlin on PostgreSQL and Kafka. Currently tech lead of the Dispatch Core team at Quillhaven Freight Systems, where I lead 4 engineers and own the event pipeline that tracks every shipment on the platform. Most of my work has been on throughput, tail latency, zero-downtime data migrations and the on-call practices that keep those systems boring. Most at home on systems where correctness under failure matters more than feature count.

## Experience

### Quillhaven Freight Systems, Hyderabad

Freight dispatch and shipment-tracking platform used by about 1,900 regional trucking carriers.

#### Senior Software Engineer and Tech Lead, Dispatch Core | April 2024 - Present

- Tech lead for Dispatch Core, a team of five: I lead 4 engineers, own the technical roadmap, run the weekly design review and sign off the production-readiness checklist for every service the team ships.
- Designed and led Skeinrouter, the Go and Kafka pipeline that replaced the cron-polled tracking module of the monolith (numbers under Selected Projects).
- Made every Skeinrouter consumer idempotent with a deduplication table in PostgreSQL keyed on event ID and carrier ID, which cut duplicate status webhooks sent to carriers from 0.6% of deliveries to under 0.01%.
- Primary on-call for the dispatch domain one week in five; incident commander for 9 Sev-1 and Sev-2 incidents since April 2024.
- Led the response to the November 2024 consumer-lag incident, a rebalance storm that delayed tracking updates for 3 hours 40 minutes, and the follow-up that moved all consumer groups to cooperative rebalancing with static membership.
- Ran the reliability programme that took Sev-1 incidents in the dispatch domain from 14 in 2023 to 5 in 2025 and median time to restore from 52 minutes to 19 minutes; wrote 17 runbooks and replaced threshold alerts with SLO burn-rate alerts.
- Cut p95 latency of the load-search API from 310 ms to 85 ms by replacing OFFSET pagination with keyset pagination and adding two covering indexes.

#### Software Engineer II | March 2023 - March 2024

- Owned the design document and the cutover runbook for Marrowgate, the move of the dispatch datastore from sharded MySQL 5.7 to PostgreSQL 15 (numbers under Selected Projects).
- Built the carrier rate-limiting middleware in Go, a token bucket backed by Redis, now in front of all 23 public API endpoints.
- Added OpenTelemetry tracing across the 8 dispatch services and built the Grafana dashboards the on-call engineer starts from.

### Tessarine Mobility, Pune

Intercity bus ticketing platform selling about 55,000 tickets a day.

#### Software Engineer | July 2020 - February 2023

- Built and operated Farecrest, the fare-quote service, in Kotlin on Ktor with PostgreSQL and a Redis cache (numbers under Selected Projects).
- Replaced application-level seat holds with PostgreSQL advisory locks in the seat-inventory service, taking double bookings from 37 a month to fewer than 2.
- Moved booking events from RabbitMQ to Kafka (12 topics) with a two-week dual-publish period; this was the first production Kafka cluster at the company.
- Joined the backend on-call rotation in my second year and carried the booking-path pager through two festival seasons.

## Selected Projects

### Skeinrouter (Quillhaven, June 2024 - February 2025)

Role: tech lead of 4 engineers; author of the design document.

- Problem: tracking updates came from a cron job that polled carrier integrations every 60 seconds, so updates arrived late and the job fell behind at peak.
- Design: Go 1.22 services consuming from Kafka, 48 partitions on the main topic keyed by shipment ID to keep per-shipment ordering, an outbox table in PostgreSQL for outgoing webhooks, and backpressure by pausing partitions instead of dropping events.
- My part: the partitioning and ordering scheme, the shared consumer framework, the deduplication layer, and review of every change to the delivery path.
- Rollout: 6 weeks of shadow traffic, then per-carrier flags over 9 weeks, with no rollback.
- Result: peak throughput from 9,000 to 41,000 events per second and p99 end-to-end latency from 870 ms to 140 ms.

### Marrowgate (Quillhaven, August 2023 - February 2024)

Role: design owner, working with 2 other engineers and 1 database administrator.

- Scope: 2.3 TB in 410 tables across 6 MySQL shards, consolidated into one PostgreSQL 15 cluster on Amazon RDS with monthly table partitioning.
- Approach: change data capture with Debezium through Kafka for the backfill, dual writes from the application for 5 weeks, and nightly row-level checksum comparison until mismatches stayed at zero for 10 consecutive nights.
- Cutover: one 11-minute read-only window on a Sunday morning, with no data-loss incident and no rollback.
- Result: database spend down from USD 18,400 to USD 12,700 per month (31% lower) and the shard-routing library deleted from 8 services.

### Farecrest (Tessarine Mobility, 2021 - 2022)

Role: one of 3 engineers; I owned caching and query performance.

- Removed N+1 queries on the route-and-fare lookup, added partial indexes for active routes and put PgBouncer in transaction mode in front of the database.
- Introduced a two-tier cache, in-process plus Redis, with event-driven invalidation whenever an operator changed a fare.
- Result: p95 latency from 480 ms to 95 ms at a festival-season peak of 3,200 requests per second, and the fleet reduced from 36 to 22 instances.

### pgslotwatch (open source, 2022)

A small Go command-line tool that reports PostgreSQL replication-slot lag and alerts before a slot fills the disk; about 260 GitHub stars.

## Skills

- Languages: Go, Kotlin, SQL; Python for scripts and tooling
- Data and messaging: PostgreSQL, Kafka, Redis, Debezium, MySQL
- Infrastructure: Kubernetes, AWS (EKS, RDS, MSK), Terraform
- Observability: Prometheus, Grafana, OpenTelemetry
- Practices: gRPC and REST API design, idempotent consumers, outbox pattern, zero-downtime migrations, SLOs, incident command

## Education

Bachelor of Technology in Computer Science and Engineering, Kesavadri Institute of Technology, Warangal, 2016 - 2020. CGPA 8.41 / 10.

Final-year project: a Raft-based key-value store written in Go.

## Certifications and Other

- AWS Certified Solutions Architect - Associate (2022)
- Speaker, Hyderabad Go meetup, March 2025: Ordering guarantees you actually get from Kafka
- Languages: English, Telugu, Hindi
