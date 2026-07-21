# Profile Intelligence Investigation Tools

This directory contains **read-only** investigation scripts for the Natively Profile Intelligence subsystem. They exercise the pure-decision modules in `electron/llm/*` and `electron/intelligence/*` to expose current runtime behavior. They do **NOT** modify state, do **NOT** call any provider, do **NOT** touch the database.

## Scripts

| Script | Purpose | Run with |
|---|---|---|
| `trace-routing.ts` | Trace `planAnswer` + `decideProfileIntelligence` + `buildContextRoute` for a fixed set of questions. Emits answerType, layer set, perspective, sensitivity gate. | `npx tsx trace-routing.ts` |
| `trace-fastpath.ts` | Trace the deterministic fast-path (`tryBuildManualProfileFastPathAnswer`) against a structured profile + JD. Reports which regex class matched. | `npx tsx trace-fastpath.ts` |
| `trace-prompt-order.ts` | Emit the expected prompt block order for a question + mode + custom context. Labels each block by source. | `npx tsx trace-prompt-order.ts` |
| `trace-conflict.ts` | Play the canonical conflict test case + 5 synthetic conflict cases. Emits routing, fast-path outcome, observed failure mode, suspected root cause. | `npx tsx trace-conflict.ts` |

## How to run

These scripts use the project's TypeScript sources directly. They require either:

- `npx tsx tools/profile-intelligence-investigation/trace-routing.ts`
- OR build the project first (`npm run build:electron`) and run the compiled output.

## What you will see

The scripts output plain-text traces to stdout. Example:

```
Case: canonical_conflict_test
Question: "Are you currently working anywhere?" | Source: what_to_answer | Mode: general | Profile: true | JD: true
------------------------------------------------------------
answerType             : unknown_answer
profileContextPolicy   : allowed
voicePerspective       : assistant_explanation
requiredContextLayers  : live_transcript, active_mode
forbiddenContextLayers : (none)
...
```

## What you will NOT see

- The actual LLM-generated answer (no provider call).
- The actual prompt bytes shipped over the wire (would require IPC + renderer).
- The actual retrieval scores (would require embeddings + a real query).

For full-fidelity traces including provider output, the existing E2E harness at `tests/e2e-modes/` is the appropriate venue, gated on `NATIVELY_E2E__*` IPC handlers.

## When to use these

- After any change to `electron/llm/AnswerPlanner.ts`, `electron/llm/ProfileIntelligenceRouter.ts`, `electron/llm/contextRoute.ts`, or `electron/llm/manualProfileIntelligence.ts`: run all four scripts. Compare output before/after.
- During conflict-policy design: extend `trace-conflict.ts` with new cases.
- During prompt-assembler work: extend `trace-prompt-order.ts` with new blocks.

## Safety

These scripts are pure. They import `electron/llm/*` modules which themselves are pure (no I/O, no DB, no LLM). Do not add imports that pull in `electron/services/ModesManager.ts`, `electron/db/DatabaseManager.ts`, or `electron/LLMHelper.ts` — those have side effects.

## Files

- `trace-routing.ts` — pure routing trace.
- `trace-fastpath.ts` — deterministic fast-path trace.
- `trace-prompt-order.ts` — expected prompt block order.
- `trace-conflict.ts` — canonical + 5 synthetic conflict cases.