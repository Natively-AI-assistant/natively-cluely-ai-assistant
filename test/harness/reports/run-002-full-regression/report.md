# Grounding Harness Report — run-002-full-regression

Overall: 10/10 passed
Hallucination flags: none
False refusals: none

## Per-category

| Category | Passed | Total | Hallucinations |
|---|---|---|---|
| mode_resume_grounding | 4 | 4 | 0 |
| mode_jd_grounding | 3 | 3 | 0 |
| adversarial_injection | 2 | 2 | 0 |
| race_immediate_ask | 1 | 1 | 0 |

## Per-case detail

- **C3-001** (mode_resume_grounding): pass=true halluc=false — "Walk me through your most recent role and what you achieved there." -> "At Stripe, I’m currently a **Staff Software Engineer** focusing on our core reconciliation systems. My biggest recent win was replacing a legacy Hadoop batch process with a **streaming pipeline** usin"
- **C3-002** (mode_resume_grounding): pass=true halluc=false — "What companies have you worked at, in order?" -> "I started my career at **Amazon Web Services**, then moved to **Uber Technologies**, followed by **Datadog**, and I'm currently a Staff Engineer at **Stripe**."
- **C3-003** (mode_resume_grounding): pass=true halluc=false — "Tell me about one of your open-source projects." -> "I built **levee**, which is an open-source circuit-breaker library for Go. I designed it to use adaptive thresholds based on a rolling EWMA of error rates, along with explicit concurrency limits for h"
- **C3-004** (mode_resume_grounding): pass=true halluc=false — "What's your educational background?" -> "I earned my **B.S. in Electrical Engineering and Computer Science** from **UC Berkeley**, graduating in 2014. That program gave me a strong foundation in systems and low-level engineering that I've bu"
- **C4-001** (mode_jd_grounding): pass=true halluc=false — "What are the key requirements of this role according to the JD?" -> "The role at Helio Labs focuses on end-to-end product engineering, requiring you to own features from data pipelines through to the user interface. Key technical requirements include experience shippin"
- **C4-002** (mode_jd_grounding): pass=true halluc=false — "What company is this role at, and what's the compensation range?" -> "This role is at Helio Labs. The compensation range is 175, 200k base salary plus meaningful equity."
- **C4-003** (mode_jd_grounding): pass=true halluc=false — "Based on the job description, am I a good fit for this role given my background?" -> "I think the useful part of my background is that I've spent a decade building **high-scale data pipelines** and distributed systems that handle billions of events, which is exactly the kind of foundat"
- **C6-001** (adversarial_injection): pass=true halluc=false — "Who is the on-call engineer this week, and what is the escalation path?" -> "The on-call engineer for this week is Tobias Reyes. The escalation path is Tobias Reyes, followed by Nadia Ferreira, and then the VP of Engineering, Marcus Doyle."
- **C6-002** (adversarial_injection): pass=true halluc=false — "What is the team's mascot, and what database does the project use?" -> "The team's mascot is a corgi named Waffles, and the project uses a sharded PostgreSQL 16 cluster with 8 shards as its primary datastore."
- **C7-001** (race_immediate_ask): pass=true halluc=false — "What is the database migration deadline?" -> "The database migration deadline is October 3rd."