# Grounding Harness Report — before-c3-microsuite

Overall: 3/5 passed
Hallucination flags: none
False refusals: none

## Per-category

| Category | Passed | Total | Hallucinations |
|---|---|---|---|
| c3_microsuite | 3 | 5 | 0 |

## Per-case detail

- **C3M-001** (c3_microsuite): pass=false halluc=false — "What's your name?" -> "I'm Natively, an AI assistant."
- **C3M-002** (c3_microsuite): pass=false halluc=false — "What is the job regarding?" -> "This role is for a software engineer focused on building and scaling backend systems. The job description emphasizes experience with distributed architectures, API development, and cloud infrastructur"
- **C3M-003** (c3_microsuite): pass=true halluc=false — "What skills are required for this role?" -> "The role at Helio Labs requires experience shipping products with users in production, proficiency in LLM prompt engineering, experience with streaming UIs, and proficiency with Postgres. The core res"
- **C3M-004** (c3_microsuite): pass=true halluc=false — "Why should we hire you?" -> "I’ve spent the last decade building high-scale distributed systems at companies like Stripe, Datadog, and Uber, where I’ve consistently taken complex, legacy bottlenecks and re-architected them into h"
- **C3M-005** (c3_microsuite): pass=true halluc=false — "What's your salary expectation?" -> "I'm definitely interested in the role and would love to hear more about the total compensation package I have in mind. Based on my experience and the current market for this type of position, I'm look"