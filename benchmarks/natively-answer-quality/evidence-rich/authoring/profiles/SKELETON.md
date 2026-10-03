# Profile Intelligence skeleton (two candidates, four documents)

Sources: `src/PI-A-RESUME.md` (pdf), `src/PI-A-JD.md` (docx), `src/PI-B-RESUME.md` (docx), `src/PI-B-JD.txt` (txt).
Facts and needles: `manifest.json` (`PI-A-RESUME#F1..F48`, `PI-A-JD#F1..F38`, `PI-B-RESUME#F1..F43`, `PI-B-JD#F1..F32`).
Today is early October 2026; all four documents are current (authority 100), no conflicts between them.

## Candidate A: Advik Thorambath (backend / distributed systems)

- Location: Hyderabad, Telangana, India. Languages: English, Telugu, Hindi.
- Experience: "six years" (first job July 2020, so 6 years 3 months in October 2026).
- Stack: Go, Kotlin, SQL (Python for scripts); PostgreSQL, Kafka, Redis, Debezium, MySQL; Kubernetes, AWS (EKS, RDS, MSK), Terraform; Prometheus, Grafana, OpenTelemetry; gRPC, outbox pattern, idempotent consumers.
- Employers:
  - Quillhaven Freight Systems, Hyderabad (freight dispatch and tracking, about 1,900 trucking carriers). Software Engineer II, March 2023 - March 2024; Senior Software Engineer and Tech Lead, Dispatch Core, April 2024 - Present (3 years 7 months at the company, 2 years 6 months as senior / tech lead). Leads 4 engineers (team of five).
  - Tessarine Mobility, Pune (intercity bus ticketing, about 55,000 tickets a day). Software Engineer, July 2020 - February 2023 (2 years 8 months).
- Projects:
  - Skeinrouter (Quillhaven, June 2024 - February 2025), tech lead of 4, wrote the design document. Go 1.22 + Kafka event pipeline replacing a cron job that polled every 60 seconds. 48 partitions keyed by shipment ID, PostgreSQL outbox. Throughput 9,000 to 41,000 events per second; p99 870 ms to 140 ms; duplicate webhooks 0.6% to under 0.01% (dedup table on event ID + carrier ID). Rollout: 6 weeks shadow traffic, then per-carrier flags over 9 weeks, no rollback. His own part: partitioning and ordering scheme, shared consumer framework, deduplication layer, review of the delivery path.
  - Marrowgate (Quillhaven, August 2023 - February 2024), design owner with 2 other engineers and 1 database administrator. Sharded MySQL 5.7 to PostgreSQL 15 on Amazon RDS: 2.3 TB, 410 tables, 6 shards. Debezium through Kafka for backfill, dual writes for 5 weeks, nightly checksums until zero for 10 consecutive nights. Cutover: one 11-minute read-only window, no data loss, no rollback. Database spend USD 18,400 to USD 12,700 per month (31% lower); shard-routing library removed from 8 services.
  - Farecrest (Tessarine, 2021 - 2022), one of 3 engineers, owned caching and query performance. Kotlin on Ktor, PostgreSQL, Redis, PgBouncer, two-tier cache. p95 480 ms to 95 ms at 3,200 requests per second; fleet 36 to 22 instances.
  - pgslotwatch (open source, 2022): Go CLI for PostgreSQL replication-slot lag, about 260 GitHub stars.
- On-call and incidents: primary on-call one week in five; incident commander for 9 Sev-1 and Sev-2 incidents since April 2024; led the November 2024 consumer-lag incident (rebalance storm, 3 hours 40 minutes of delayed tracking updates; fix: cooperative rebalancing with static membership); Sev-1 incidents 14 in 2023 to 5 in 2025; median time to restore 52 to 19 minutes; 17 runbooks; SLO burn-rate alerts. At Tessarine: on-call from his second year, two festival seasons.
- Education: B.Tech Computer Science and Engineering, Kesavadri Institute of Technology, Warangal, 2016 - 2020, CGPA 8.41 / 10. Final-year project: Raft-based key-value store in Go. AWS Certified Solutions Architect - Associate (2022). Talk at the Hyderabad Go meetup, March 2025.

## JD A: Ostrakel Payments, Senior Backend Engineer — Payments & Ledger

- Company: Ostrakel Payments (payment orchestration and merchant ledger; founded 2019, about 420 people, 3,100 marketplaces, 2.6 million transactions a day, 13 partner banks). Requisition OST-ENG-0417, posted 14 September 2026.
- Team: Ledger Core, 9 engineers (7 backend, 2 SRE); reports to Sarvesh Idnavalli, Engineering Manager. Level L5 (senior IC; L6 is Staff). Guides 2 to 3 engineers, no line management.
- Location: Bengaluru, HSR Layout; hybrid, three days a week in office (Tuesday to Thursday); not open to fully remote; relocation assistance available (no amount stated).
- Stack and work: Go 1.23 for new services; Java 21 on Spring Boot for settlement and reconciliation (roughly 40% of the code); PostgreSQL 16; Kafka; idempotency keys on every write API, outbox per service; three-way reconciliation (break rate 0.05% today, goal below 0.02%); on-call one week in six, around the clock, compensatory day off.
- Must have: 6 or more years backend with at least 2 at senior level or as tech lead; Go or Java in production and willing to work in both; at least 2 years in payment / ledger / banking / money-movement systems; deep PostgreSQL; Kafka or comparable; idempotency, retries, partial failure; tier-1 pager and incident response; ownership.
- Good to have: Java and Spring Boot in production; PCI DSS v4.0 (company is PCI DSS Level 1); reconciliation or double-entry accounting; UPI / card settlement or ISO 20022; zero-downtime migrations and change data capture.
- Process: recruiter call (30 min), then four rounds within three weeks: coding 60 min (Go or Java), system design 75 min (ledger or payment flow), deep dive, hiring manager. Benefits: INR 60,000 learning budget, 26 days leave, stock options. No salary figure; band shared in the recruiter call.

A against JD A:
- Meets: 6+ years (6 y 3 m); 2+ years senior / tech lead (2 y 6 m, only just); Go in production; PostgreSQL depth; Kafka; idempotent consumers, outbox, retries; tier-1 on-call and incident command; ownership (Skeinrouter, Marrowgate); zero-downtime migration and CDC (good-to-have).
- Gaps: no Java or Spring Boot (Kotlin on Ktor is the nearest); no payments / ledger / banking domain (the 2-year must-have); no reconciliation or double-entry accounting; no PCI DSS; no UPI / ISO 20022; idempotency keys on public money-moving APIs not stated (only idempotent consumers).
- Near-miss values to watch: on-call one week in five (résumé) vs one week in six (JD); Go 1.22 vs Go 1.23; PostgreSQL 15 vs 16; Hyderabad (home) vs Bengaluru (role) vs Pune (previous job) vs Warangal (college); leads 4 engineers vs guide 2 to 3; two different migrations (Marrowgate, RabbitMQ to Kafka); three latency pairs (870/140 p99, 310/85 p95, 480/95 p95).

## Candidate B: Catarina Velmonte (frontend / product engineering)

- Location: Porto, Portugal. Languages: Portuguese (native), English (fluent), Spanish (intermediate).
- Experience: "nine years" (first job September 2017, so 9 years 1 month). The last four in React and TypeScript (since June 2022, 4 years 4 months), the earlier five mostly in Vue.
- Stack: React, TypeScript, Vue 3, Next.js, modern CSS; Playwright, Vitest, axe-core, Storybook, Lighthouse CI; Amplitude, experiment design, event taxonomies; light backend: Node.js, Fastify, GraphQL clients; WCAG 2.2, ARIA, NVDA and VoiceOver.
- Employers:
  - Lumenquay, Porto, remote-first (scheduling and messaging software for veterinary clinics, about 2,700 clinics). Senior Frontend Engineer, June 2022 - December 2023; Lead Frontend Engineer, January 2024 - Present (2 years 9 months as lead). Leads the frontend chapter of 18 engineers across 5 product squads; sits in the booking squad of 6; owns the frontend hiring loop.
  - Ondaverde Health, Lisbon (patient portal for private clinics). Frontend Engineer, February 2020 - May 2022.
  - Plumewright Studio, Braga (digital agency). Junior Web Developer, September 2017 - January 2020.
- Projects:
  - Pebblekit design system (Lumenquay, 2023 - present), founder and lead of a working group of 3 engineers and 2 designers. 64 components, React + TypeScript, Storybook, tokens from Figma variables; adopted by all 5 product squads in 3 applications; WCAG 2.2 AA; automated accessibility violations 212 to 9.
  - Fernlatch booking flow (Lumenquay, September 2022 - April 2023), tech lead of 3 frontend engineers with 1 designer. React + TypeScript, server rendering on Next.js. Mobile p75 LCP 4.3 s to 1.7 s; interaction delay 380 ms to 120 ms; first-load JavaScript 1.9 MB to 610 kB; booking completion 61.2% to 66.8% in a six-week A/B experiment.
  - Dialbench experimentation toolkit (Lumenquay, 2024), sole author of the first version, now with 1 backend engineer. Node.js on Fastify assignment service + React hooks SDK, exposure events to Amplitude. 38 experiments in its first year; reminder opt-in 27% to 33%.
  - Farolim patient portal (Ondaverde): Vue 2 to Vue 3, 140 views, Vuex replaced by Pinia, 8 months; unit coverage 34% to 71%; passed an external WCAG 2.1 AA audit in March 2022.
- Education: Licenciatura (BSc) in Informatics Engineering, Instituto Superior de Valdouro, Braga, 2014 - 2017, final grade 16 / 20. IAAP Web Accessibility Specialist (WAS), 2023. Talk at the Porto Frontend Meetup, October 2024.

## JD B: Hollowpine Labs, Senior Product Engineer — Collaborative AI Workspace

- Company: Hollowpine Labs, product Inkwharf (collaborative workspace with a built-in AI assistant); 85 people, Series B, about 8,500 teams. Ref HPL-2026-031, posted 22 September 2026.
- Team: Workspace Surface squad (7 engineers, 2 designers, 1 product manager); reports to Jorrit Aldewyck, Head of Product Engineering.
- Location: Rotterdam, Netherlands / remote within Europe (UTC-1 to UTC+3, core hours 10:00 to 15:00 CET); hub optional; 4 team weeks a year in Rotterdam, travel paid. No pager rotation; support captain one week every 7 weeks, working hours only. Right to work in the EU required; no visa sponsorship.
- Work: real-time UI on a CRDT layer (Yjs over WebSockets, up to 50 people editing at once); AI UX (streamed responses, accept / reject / undo suggestions, citations, failure states); WCAG 2.2 AA including a screen-reader-usable multiplayer editor; around 10 experiments a quarter, activation = first shared document within 7 days; interaction delay under 200 ms at p75 on a 500-block document, initial JavaScript under 350 kB.
- Required: 6+ years frontend or product engineering with at least 4 years of React and TypeScript; shipped real-time collaborative or multiplayer features; accessibility beyond linting (through an audit); designed, run and read experiments; measured performance improvements; product judgement.
- Nice to have: LLM-powered features; rich-text editor framework (ProseMirror, Tiptap or Lexical); design system; some Node.js (backend-for-frontend); Canvas or WebGL.
- Process: intro call 25 min, pairing session 90 min (React exercise), product and design critique 45 min, two teammate conversations; about two weeks. Benefits: 28 days holiday, EUR 1,500 home-office budget, EUR 2,000 learning budget, share options. No salary figure; band shared in the intro call.

B against JD B:
- Meets: 6+ years (9 y 1 m); at least 4 years React and TypeScript (4 y 4 m, only just); accessibility through an audit (Farolim WCAG 2.1 AA, Pebblekit WCAG 2.2 AA, IAAP WAS); experiments (Dialbench, 38 experiments, Fernlatch A/B); measured performance (Fernlatch); design system (Pebblekit); some Node.js (Dialbench service).
- Gaps: no real-time collaborative / multiplayer / WebSocket / CRDT work (a stated requirement); no AI / LLM feature work; no rich-text editor framework; no Canvas or WebGL.
- Near-miss values to watch: WCAG 2.1 AA (Ondaverde audit) vs WCAG 2.2 AA (Pebblekit and the JD); 120 ms achieved vs under 200 ms target; 610 kB achieved vs under 350 kB target; two rate pairs (61.2% to 66.8% booking completion, 27% to 33% opt-in) plus 34% to 71% coverage; chapter of 18 vs squad of 6 vs working group of 3 engineers and 2 designers vs 3 frontend engineers; Porto (home) vs Lisbon and Braga (earlier jobs) vs Rotterdam (role).

## NOT in the résumé or JD (deliberately absent, for both candidates)

A correct answer must neither invent these nor deny them; they belong to the candidate-notes files.

- Reason for leaving the current employer, or for having left any previous one.
- Relocation preference, willingness to work hybrid or to travel. (JD A offers relocation assistance and JD B asks for 4 team weeks in Rotterdam; neither says what the candidate wants.)
- Notice period, earliest start date, availability.
- Current salary and salary expectation. (Neither JD prints a figure; both say the band is shared in the first call.)
- Visa status, nationality, citizenship, right to work. (JD B requires the right to work in the EU and offers no sponsorship; Catarina's own status is not stated anywhere. JD A says nothing about work authorisation.)
- Weaknesses, areas to improve, feedback received.
- Behavioural stories: conflict with a colleague or manager, a failure or mistake, mentoring someone, a disagreement, a hard decision, a time under pressure. (The résumés state scope and outcomes only: "leads 4 engineers", "chapter of 18 engineers"; the November 2024 incident is described by cause, duration and fix, not as a personal failure.)
- Line management, performance reviews, budget ownership (not claimed by either). Hiring: B "owns the frontend hiring loop"; A states nothing about hiring.
- Why this company or this role, career goals beyond the one closing line of each summary, other offers or interviews in progress.
- Java experience (A), payments / compliance experience (A), real-time or AI product experience (B): absent as experience, present only as JD requirements.
- Age, date of birth, marital status, gaps in employment (there are none in the dates), GPA beyond the stated CGPA 8.41 / final grade 16 / 20, references.

## Separation between the two candidates

No employer, project name, city, university, technology emphasis or metric value is shared. A script check found zero hits, case-insensitive, of any profile-A needle in either profile-B source, and zero the other way.

- Safe `other_profile` answer needles (invented strings only). A: Thorambath, Quillhaven, Tessarine, Skeinrouter, Marrowgate, Farecrest, pgslotwatch, Kesavadri, Ostrakel, Ledger Core, Idnavalli, OST-ENG-0417; cities Hyderabad, Bengaluru, Pune, Warangal. B: Velmonte, Lumenquay, Ondaverde, Plumewright, Pebblekit, Fernlatch, Dialbench, Farolim, Valdouro, Hollowpine, Inkwharf, Workspace Surface, Aldewyck, HPL-2026-031; cities Porto, Lisbon, Braga, Rotterdam.
- Not safe as `other_profile` answer needles: technology names (a frontend candidate may say PostgreSQL in a design answer; "react" matches "react to the incident") and generic manifest needles that exist only to detect a fact in its own document, such as `6+ years`, `6 or more years`, `four rounds`, `within three weeks`, `in two weeks`, `Product judgement`, `three days a week`, `Tuesday to Thursday`, `Series B`, `under 200 ms`, `Senior Backend Engineer`, `Senior Product Engineer`.
- Durations above count whole calendar months from the start month to October 2026 (or to the end month, inclusive). A plain subtraction gives one month less for closed ranges (Tessarine: 2 years 7 months; Ondaverde: 2 years 3 months; Plumewright: 2 years 4 months), so list both forms when a calculation depends on it.
