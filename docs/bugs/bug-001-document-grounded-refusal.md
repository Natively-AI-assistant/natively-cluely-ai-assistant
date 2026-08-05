# Bug 001 — Document-Grounded Refusal on General / YouTube Questions

## User Reports (Telegram)

> *"I just asked a random question from a YouTube, and it answers: 'This is not directly uploaded document.'"*  
> *"I noticed that instead of generating an answer based on the conversation context, it keeps saying 'no document has been uploaded.'"*

---

## Root Cause

### 1. `documentGroundedCustomModeActive` ignores `hasReferenceFiles`

**File:** [`electron/llm/AnswerPlanner.ts`](../../electron/llm/AnswerPlanner.ts) — line 2335

```typescript
// CURRENT (broken)
const documentGroundedCustomModeActive =
  input.activeMode?.documentGroundedCustomModeActive === true;
```

This reads the pre-computed flag directly from the mode object. The flag is set by `ModesManager` for any mode whose `sourceAuthority` is `reference_files_primary` (or similar) — **even when no files have been uploaded**.  

### 2. The safe guard function exists but is never called

**File:** [`electron/services/modeSourceContract.ts`](../../electron/services/modeSourceContract.ts) — line 730

```typescript
function documentGroundedFromContract(
  contract: ModeSourceContract,
  hasReferenceFiles: boolean,   // ← correctly short-circuits
): boolean {
  if (!hasReferenceFiles) return false;   // ← guard we need
  return contract.sourceAuthority === 'reference_files_only'
    || contract.sourceAuthority === 'reference_files_primary'
    || contract.sourceAuthority === 'reference_files_plus_transcript';
}
```

> **This function has 0 call-sites in the entire codebase** (confirmed via `find_references`).  
> It was built to solve exactly this problem but was never wired in.

### 3. Forced document-grounded routing with empty context

**File:** [`electron/llm/AnswerPlanner.ts`](../../electron/llm/AnswerPlanner.ts) — line 2822

```typescript
if (documentGroundedCustomModeActive && !explicitDocumentModeCodingAsk && !explicitDocumentModeProfileAsk) {
  const docShape = classifyDocumentQuestionShape(question, ...);
  answerType = docShape === 'broad_overview' ? 'lecture_answer' : docShape;
}
```

Because the flag is `true` (incorrectly), the turn is classified as `lecture_answer` / `definitional_answer` / etc.

### 4. Validation fails against empty `docContextBlock`

**Files:** [`electron/ipcHandlers.ts`](../../electron/ipcHandlers.ts) (line 4029) and [`electron/IntelligenceEngine.ts`](../../electron/IntelligenceEngine.ts) (line 3156)

The WTA gate checks that a non-empty `docContextBlock` exists for document-grounded answer types. Since no files were uploaded, the block is empty → validation fails → refusal message returned.

---

## Also Affected: `contextRoute.ts`

**File:** [`electron/llm/contextRoute.ts`](../../electron/llm/contextRoute.ts) — line 76

```typescript
// Same pattern, same bug:
const documentGroundedCustomModeActive = plan.documentGroundedCustomModeActive === true;
```

This copy of the flag is used for conversation-history routing and WhatToAnswerLLM prompt shaping — it inherits the same incorrect `true` value.

---

## Proposed Fix

### Fix A — `AnswerPlanner.ts` (primary routing gate)

```diff
- const documentGroundedCustomModeActive =
-   input.activeMode?.documentGroundedCustomModeActive === true;
+ const hasReferenceFiles = input.activeMode?.hasReferenceFiles === true;
+ const documentGroundedCustomModeActive =
+   input.activeMode?.documentGroundedCustomModeActive === true && hasReferenceFiles;
```

**Alternative (preferred):** wire in the already-existing safe utility:

```diff
+ import { documentGroundedFromContract } from '../services/modeSourceContract';
  // …
- const documentGroundedCustomModeActive =
-   input.activeMode?.documentGroundedCustomModeActive === true;
+ const documentGroundedCustomModeActive =
+   input.activeMode?.sourceContract != null
+     ? documentGroundedFromContract(
+         input.activeMode.sourceContract,         // non-optional after the null check
+         input.activeMode?.hasReferenceFiles === true,
+       )
+     : false;   // no contract → treat as not doc-grounded
```

> **Why the null guard?** `input.activeMode?.sourceContract` has type `ModeSourceContract | undefined`. `documentGroundedFromContract` requires a concrete `ModeSourceContract` as its first argument and immediately reads `.sourceAuthority`, which would throw at runtime (or fail TypeScript checking) when the contract is absent. The ternary ensures the safe-guard function is only invoked when the contract exists.

### Fix B — `contextRoute.ts` (conversation-history / WTA routing)

Apply the same guard so that the `plan` object propagated to WhatToAnswerLLM is consistent:

```diff
- const documentGroundedCustomModeActive = plan.documentGroundedCustomModeActive === true;
+ const documentGroundedCustomModeActive =
+   plan.documentGroundedCustomModeActive === true && (plan.hasReferenceFiles === true);
```

---

## Blast Radius

| Symbol | Confirmed Dependents | Potential (namespace import) |
|---|---|---|
| `documentGroundedCustomModeActive` (AnswerPlanner) | 5 files | 21 files |
| `classifyDocumentQuestionShape` | 3 files | 6 files |
| `buildCustomModeExecutionContract` | 2 files | 4 files |

**High-blast files that must be regression-tested after this fix:**
- `electron/llm/WhatToAnswerLLM.ts` (6 references to the flag)
- `electron/llm/contextRoute.ts` (5 references)
- `electron/services/ModesManager.ts` (8 references)
- `electron/llm/conversationHistoryPolicy.ts`
- `electron/llm/modeProfiles.ts`

**Files with no test coverage flagged by jcodemunch:**
- All confirmed dependents listed above have `has_test_reach: false`
- Recommendation: add a dedicated Jest test for the `documentGroundedFromContract` path with `hasReferenceFiles: false`

---

## Safe-Change Checklist

- [ ] Fix A applied in `AnswerPlanner.ts`
- [ ] Fix B applied in `contextRoute.ts`
- [ ] `documentGroundedFromContract` verified to return `false` when `hasReferenceFiles` is falsy
- [ ] Manual smoke-test: open "General" mode, ask a question, verify no refusal
- [ ] Existing doc-grounded tests still pass when files are uploaded
- [ ] No regression in `ModePolicyShadowDivergence2026_07_26.test.mjs` (tests the `documentGroundedCustomModeActive` flag parity)
