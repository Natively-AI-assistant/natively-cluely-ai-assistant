# Answering Pipeline Bug Report — August 2026

## Overview

This PR documents **three user-reported bugs** in the answering pipeline (v2.8.5).  
All bugs were discovered from Telegram user reports and validated against the source code  
with static analysis + jcodemunch blast-radius assessment.

**No source-code changes are in this PR** — these are documentation-only fixes for developer review.

---

## Bug Index

| ID | Title | Severity | Files to Fix |
|---|---|---|---|
| [Bug 001](./bug-001-document-grounded-refusal.md) | Document-Grounded Refusal on General Questions | 🔴 High | `AnswerPlanner.ts`, `contextRoute.ts` |
| [Bug 002](./bug-002-screenshot-code-generation.md) | Screenshot Attached but Code Not Generated | 🟠 Medium | `ipcHandlers.ts`, `IntelligenceEngine.ts` |
| [Bug 003](./bug-003-skill-injection-failure.md) | Skill Injection Ignored in V3 Engine | 🟠 Medium | `WhatToAnswerLLM.ts` |

---

## Blast Radius Summary (jcodemunch analysis)

All three bugs touch the core answering loop. Risk is **concentrated** in a small set of files
but the flag `documentGroundedCustomModeActive` fans out to 26 dependent files.

```
documentGroundedCustomModeActive (AnswerPlanner.ts)
  ├── WhatToAnswerLLM.ts            [6 refs — also affected by Bug 003]
  ├── contextRoute.ts               [5 refs — secondary fix site for Bug 001]
  ├── ModesManager.ts               [8 refs]
  ├── conversationHistoryPolicy.ts  [1 ref]
  └── modeProfiles.ts               [1 ref]

buildCustomModeExecutionContract
  ├── IntelligenceEngine.ts         [5 refs — fix site for Bug 002]
  └── ipcHandlers.ts                [6 refs — fix site for Bug 002]

WhatToAnswerLLM (class)
  └── llm/index.ts                  [2 refs]
```

> **⚠️ All confirmed dependents have `has_test_reach: false`** — meaning none of the above files  
> are currently covered by a test that verifies end-to-end answering behaviour.  
> Each bug doc includes a checklist of tests to add or update.

---

## Key Additional Finding (Bug 001)

`documentGroundedFromContract()` in [`modeSourceContract.ts`](../../electron/services/modeSourceContract.ts)  
**already implements the correct guard** (`if (!hasReferenceFiles) return false`).  
It has **zero call-sites** in the entire codebase.  

The recommended fix for Bug 001 is to wire this function in rather than adding a new inline check.

---

## How to Review

1. Read each bug file in [`docs/bugs/`](./) for full root-cause analysis, diffs, and safe-change checklists.
2. Fixes are **surgical** — each change is a single guard condition or a 3-line append.
3. Run `ModePolicyShadowDivergence2026_07_26.test.mjs` and `Issue303SkillInvocation.test.mjs`  
   after implementing fixes to catch regressions early.
