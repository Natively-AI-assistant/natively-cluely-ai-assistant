# SD routing hybrid + sticky answerType

We need ~99% correct `system_design_answer` classification so speakable Delivery Framework actually runs. Deterministic patterns alone miss title/gerund forms and messy speech; an ungated “LLM leftover” path would ship untested. We expand a high-precision deterministic front door (TDD matrix for positives, false friends, title-form, scale-ask) **and** require llm-eval goldens for **every** routing scenario — including fuzzy/ASR and sticky mid-interview — with **no ungated leftover**. When sticky SD session is armed, non-coding/non-DSA turns classify as `system_design_answer` so speakable strip + DF template apply mid-interview.

**Status:** superseded by ADR 0005

## Considered options

1. **Regex-only** — rejected; cannot hit ~99% on titles/ASR/vague scale asks.
2. **LLM-only classifier** — rejected; loses cheap high-precision front door and complicates coding/experience false friends.
3. **Hybrid with LLM only on leftovers, no eval on leftovers** — rejected; user locked **no leftover**.
4. **Hybrid front door + full llm-eval coverage (chosen)** — regex short-circuit OK; every scenario has goldens; sticky answerType change included.

## Consequences

- Extend `SYSTEM_DESIGN_PATTERNS` / planAnswer for title-form, like-X, scale-ask; keep false-friend guards.
- Sticky SD session promotes answerType for non-coding turns (behavior change vs problemKey-only sticky).
- `evals/sd-routing` (or extended speakable-sd) gates all routing cases; ship blocked if regression gate fails.
- No new soft-clarify answerType in v1.
