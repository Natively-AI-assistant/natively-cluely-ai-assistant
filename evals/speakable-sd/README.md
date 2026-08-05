# evals/speakable-sd — LLM-EDD for speakable system-design answers

**Surface under test:** SD answer contract + TI system-design prompt pack  
**Mutable:** `electron/llm/AnswerPlanner.ts` (`SYSTEM_DESIGN_TEMPLATE`), `electron/llm/prompts.ts` (`MODE_TECHNICAL_INTERVIEW_PROMPT` / `SHARED_CODING_RULES`), sim tone strings  
**Immutable during a run:** `cases.jsonl`, `threshold.yaml`, graders in the runner  

Deterministic strip/repair/compress gates stay on `/tdd`. This suite gates the **probabilistic** prompt seam.

## Suites

| Suite | What it runs | Gate |
|-------|----------------|------|
| `regression` | **Contract** checks — no API. Asserts `formatAnswerPlanForPrompt` / TI prompt text carry Delivery Framework + one-slice + DSA bans | **YES** — NO-SHIP if any fail |
| `capability` | **Live** Gemini turn (optional). Shape graders on model output | Track only until graduated |

## Run

```bash
# Contract gate only (default, free, CI-safe)
npm run eval:speakable-sd

# Include live capability cases (needs GEMINI_API_KEY)
SPEAKABLE_SD_EVAL_LIVE=1 npm run eval:speakable-sd
```

Exit **0** = SHIP (regression gate). Exit **1** = NO-SHIP.

## Failure harvest (sources)

| id | Source |
|----|--------|
| `sd-contract-ticketmaster-df` | Local dogfood 2026-08-05 — "Design a service similar to ticketmaster" got blog dump; STRICT template was old multi-section |
| `sd-contract-no-old-sections` | Same — "Use exactly these sections / Clarify Requirements:" must never return |
| `sd-contract-ti-speakable` | Speakable-sd ticket 03 — TI `<system_design>` speakable bans |
| `sd-contract-coding-untouched` | Speakable-sd AC — coding/DSA still get six-heading contract |
| `sd-live-ticketmaster-opener` | Same dogfood — opener should be Requirements slice, not HLD essay |

## Promote

New dogfood failure → new case (or stronger assert) before closing.  
Stable live capability (≥0.9 over several runs) → retag `suite: regression` + document `trials`.
