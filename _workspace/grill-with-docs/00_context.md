# Context — SD routing boundary grill

## Known Terms
(from docs/speakable-sd/CONTEXT.md — **output** contract, not routing)

- **Speakable SD surface**: speakable contract when `answerType === system_design_answer` (product TI + T2)
- **Speakable SD answer / length / diagram / interviewer / enforcement / root cause**: output + enforcement (see CONTEXT.md)
- **Delivery Framework**: Requirements → Core Entities → API → optional Data Flow → HLD → Deep Dives

## Locked Decisions (ADRs)
- **0003 Speakable SD enforcement**: defense in depth (prompt untangle + repair gate + post-strip). Assumes correct `system_design_answer` typing; does **not** define classification rules.

## Flagged Ambiguities
- Glossary locks **what to do after** routing to SD; it does **not** define **when** an utterance is SD vs coding vs experience vs concept vs product-about.
- `speakable-sd-root-cause` mentions "misroute" but treats it as repair/DSA lump, not classifier coverage.

## Gaps (this grill’s focus)
- No glossary for **SD routing positive signals** (imperative design, “like Ticketmaster”, classic problem nouns)
- No glossary for **SD routing false friends** (years on distributed, write code for rate limiter, explain caching, Natively architecture)
- No decision on **title/gerund** forms (“Designing a Scalable Ticketing Platform”)
- No decision on **ambiguous scale/how-would-you** without design verb
- No decision on **sticky SD session** vs reclassify every turn
- No decision on **regex-only vs hybrid LLM classifier** for ~99% messy ASR/vague speech
- No decision on **clarify-when-uncertain** vs force a type
