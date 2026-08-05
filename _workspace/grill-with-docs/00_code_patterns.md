# Code patterns — SD routing (`planAnswer`)

## Relevant Files
- `electron/llm/AnswerPlanner.ts:626-640` — `SYSTEM_DESIGN_PATTERNS`: `system design` | `design (a|an|the)` | design/architect/build+scalable|distributed… | classic nouns (rate limiter, url shortener, chat/notification system)
- `electron/llm/AnswerPlanner.ts:2525-2536` — SD branch: patterns + `!hasWriteCodeVerb` + explain/what-is deferral unless design/scalable/architect present
- `electron/llm/AnswerPlanner.ts:2518-2524` — Natively product-about beats SD
- `electron/llm/AnswerPlanner.ts:2548-2558` — `isHypotheticalTech` → `technical_concept_answer` (“how would you…”) when no write-code verb — **competes with SD** for scale/architect phrasing
- `electron/llm/AnswerPlanner.ts:1893-1894` — `isCodingAnswerType` = coding_question | dsa_question only (SD is non-coding)
- `evals/speakable-sd/cases.jsonl` — contract asserts `answer_type` for Ticketmaster opener; not a routing matrix

## Potential Contradictions
- **Gerund/title miss**: `design (a|an|the)` does not match “Designing a Scalable Ticketing Platform” → falls through (observed `general_meeting_answer`); dogfood title ≠ SD
- **Experience guard** deliberately requires design/build imperative with scalable|distributed — good for “years on distributed systems” but misses title-only “Scalable Ticketing Platform”
- **Classic noun list** is tiny (4 phrases); Ticketmaster/Bitly/YouTube-style “like X” rely on `design (a|an|the)` only
- **“how would you scale/architect…”** may hit hypothetical tech before/without SD depending on pattern order and verbs
- Speakable surface assumes SD typing; weak router → wrong template (GENERAL / concept) even with DF STRICT template fixed

## Naming Inconsistencies
- “system design” (human) vs `system_design_answer` (code) vs Delivery Framework (speakable output) — same intent, three names
- “misroute” in speakable glossary = DSA repair/lump; engineers also say “misroute” for wrong answerType

## Routing Order Snapshot (brief)
… meeting → sales → lecture → **product-about** → **system_design** → debugging → **hypothetical tech** → technical_concept → dsa → coding …
