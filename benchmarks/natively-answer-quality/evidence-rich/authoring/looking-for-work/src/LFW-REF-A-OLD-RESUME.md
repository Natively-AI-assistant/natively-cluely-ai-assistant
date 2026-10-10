# Advik Thorambath

Software Engineer, Backend

Hyderabad, Telangana, India | advik@thorambath.example | +91 40 5550 0142 | github.example/athorambath

## Profile

Backend engineer building and running services in Kotlin and Go on PostgreSQL and Kafka since 2020. I work on the Dispatch Core team at Quillhaven Freight Systems, where I own the design of the migration that takes our dispatch datastore off sharded MySQL. Before that I spent two and a half years on the booking path of an intercity bus ticketing platform. Interested in data-heavy backend work and in the operational side of running it.

## Experience

### Quillhaven Freight Systems, Hyderabad

Freight dispatch and shipment-tracking platform for regional trucking carriers.

#### Software Engineer II | March 2023 - Present

- Member of Dispatch Core, a team of three engineers reporting to the engineering manager for dispatch.
- Design owner for Marrowgate, the in-progress move of the dispatch datastore from sharded MySQL 5.7 to PostgreSQL 15: about 2.1 TB in 380 tables across 6 shards, with the cutover planned for February 2024.
- Backfill by change data capture (Debezium through Kafka) with dual writes from the application; nightly row-level checksum comparison is running now.
- The migration is expected to cut database spend by about 25% once the MySQL cluster is retired.
- Built the carrier rate-limiting middleware in Go, a token bucket backed by Redis, in front of the public API.
- Added OpenTelemetry tracing to the dispatch services and built the first Grafana dashboards for the on-call engineer.
- Secondary on-call for the dispatch domain, one week in four.

### Tessarine Mobility, Pune

Intercity bus ticketing platform selling about 55,000 tickets a day.

#### Software Engineer | July 2020 - February 2023

- Built and ran Farecrest, the fare-quote service, in Kotlin on Ktor with PostgreSQL and a Redis cache.
- Replaced application-level seat holds with PostgreSQL advisory locks in the seat-inventory service; double bookings went from 37 a month to fewer than 2.
- Moved booking events from RabbitMQ to Kafka (12 topics) with a two-week dual-publish period.
- On the backend on-call rotation from my second year, including two festival seasons on the booking path.

## Projects

### Farecrest (Tessarine Mobility, 2021 - 2022)

One of 3 engineers; I owned caching and query performance. Removed N+1 queries on the route-and-fare lookup, added partial indexes and put PgBouncer in front of the database. Introduced an in-process plus Redis cache with event-driven invalidation. p95 latency went from 480 ms to 95 ms at a festival-season peak of 3,200 requests per second, and the fleet went from 36 to 22 instances.

### pgslotwatch (open source, 2022)

A small Go command-line tool that reports PostgreSQL replication-slot lag and warns before a slot fills the disk. About 140 GitHub stars.

## Skills

- Languages: Kotlin, Go, SQL
- Data and messaging: PostgreSQL, Kafka, Redis, MySQL, Debezium
- Infrastructure: Kubernetes, AWS (EKS, RDS), Terraform
- Observability: Prometheus, Grafana

## Education

Bachelor of Technology in Computer Science and Engineering, Kesavadri Institute of Technology, Warangal, 2016 - 2020. CGPA 8.41 / 10.

Final-year project: a Raft-based key-value store written in Go.

## Other

- AWS Certified Solutions Architect - Associate (2022)
- Languages: English, Telugu, Hindi

Updated 18 January 2024
