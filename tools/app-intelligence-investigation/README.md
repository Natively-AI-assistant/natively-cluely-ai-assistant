# App Intelligence Investigation Tools

This directory contains **read-only** investigation scripts for the **current** state of the Natively app's intelligence subsystem. They complement (and sit one level above) `tools/profile-intelligence-investigation/`, which focused narrowly on Profile Intelligence. The scripts here aim at the *whole app's* intelligence loop:

* manual chat
* "What to Answer"
* meeting / live transcript
* modes / profile / RAG / OKF / Hindsight interactions
* flags and storage

The scripts are pure. They import only those modules that themselves are pure (no I/O, no DB, no LLM). Where a planned trace would require stateful services (ModesManager, DatabaseManager, LLMHelper), the trace documents **why** and points the investigator at the script that lives one layer up (the provider-backed smoke harness in `tests/e2e-modes/`) for that part of the loop.

## Scripts

| Script | Purpose | Run with |
|---|---|---|
| `trace-app-flow.ts` | Map the manual chat, WTA, and meeting call graphs by static import/function analysis. | `npx tsx tools/app-intelligence-investigation/trace-app-flow.ts` |
| `trace-context-authority-current.ts` | Show the current source-owner decision per turn via `resolveSourceOwnership`. | `npx tsx tools/app-intelligence-investigation/trace-context-authority-current.ts` |
| `trace-prompt-blocks-current.ts` | Show the expected prompt block order in each flow. Labels each block by source. | `npx tsx tools/app-intelligence-investigation/trace-prompt-blocks-current.ts` |
| `trace-memory-loop.ts` | Show the prior-assistant → prompt → SessionTracker → prior-assistant loop. | `npx tsx tools/app-intelligence-investigation/trace-memory-loop.ts` |
| `trace-flags.ts` | Print every relevant flag, default, env override, and where read. | `npx tsx tools/app-intelligence-investigation/trace-flags.ts` |
| `trace-storage-map.ts` | Print the relevant DB schema references observed in source code. | `npx tsx tools/app-intelligence-investigation/trace-storage-map.ts` |

## How to run

These scripts use the project's TypeScript sources directly:

```
npx tsx tools/app-intelligence-investigation/<name>.ts
```

Or build the project first (`npm run build:electron`) and run the compiled output.

## What you will see

- Pure-decision traces (routing, fast-path, prompt order).
- Live-flag maps (defaults and consumers).
- Static-import maps for the major flows.
- DB schema references found in source code (no DB connection required).

## What you will NOT see

- Real LLM output (no provider calls).
- Real retrieval scores (no embeddings).
- DB contents or migrations (no DB connection).

For full-fidelity traces including provider output, the existing E2E harness at `tests/e2e-modes/` is the appropriate venue, gated on `NATIVELY_E2E__*` IPC handlers.

## Safety

These scripts are pure. They import only modules from `electron/llm/*` and `electron/intelligence/intelligenceFlags.ts`. They do **NOT** import:
- `electron/services/ModesManager.ts` (stateful)
- `electron/db/DatabaseManager.ts` (stateful)
- `electron/LLMHelper.ts` (LLM-wired)
- `electron/main.ts` / `electron/ipcHandlers.ts` (Electron-runtime)

If a planned trace would require any of the above, the script documents why it was skipped, instead of silently importing them.

## Files

- `trace-app-flow.ts` — static import map of the three main flows.
- `trace-context-authority-current.ts` — current source-owner decision per turn.
- `trace-prompt-blocks-current.ts` — expected prompt block order + source labels.
- `trace-memory-loop.ts` — prior-assistant → prompt → SessionTracker → prior-assistant.
- `trace-flags.ts` — feature flags + env overrides + consumers.
- `trace-storage-map.ts` — DB schema references in source code.

## When to extend

After any change to:
- `electron/llm/sourceOwnership.ts`
- `electron/llm/customModeExecutionContract.ts`
- `electron/llm/contextRoute.ts`
- `electron/llm/AnswerPlanner.ts`
- `electron/intelligence/intelligenceFlags.ts`
- the prompt-assembly path (`electron/services/context/PromptAssembler.ts`,
  `electron/intelligence/PromptAssemblerV2.ts`,
  `electron/llm/prompts.ts`,
  `electron/llm/tinyPrompts.ts`)

…re-run the affected scripts and compare output.

## Scope

These scripts cover ONLY the **current state**. They document — not propose — what the app does today. Future work (Context OS, EvidencePack, source-registry, mode-aware contracts) is recorded in
`docs/NATIVELY_INTELLIGENCE_SYSTEM_CURRENT_STATE_REPORT.md` §24.
