# Bug 002 — Screenshot Attached but Code Not Generated

## User Report (Telegram)

> *"when i take a screenshot and chat shows screenshot attached, and i ask to give me the code, it doesn't give me the code"*

---

## Root Cause Chain

### 1. `hasScreenContext` omitted in manual-chat IPC handler

**File:** [`electron/ipcHandlers.ts`](../../electron/ipcHandlers.ts) — inside `_geminiChatStreamHandler` (~line 1163)

When `buildV3Prompt` is called for the `gemini-chat-stream` IPC path, `hasScreenContext` is **completely absent** from the argument object:

```typescript
const composed = await buildV3Prompt({
  surface: 'manual-chat',
  pathTag: 'ipc',
  question: String(message || ''),
  modeTemplateType: rawMode,
  modeUniqueId: modeInfo?.id ?? null,
  attachedSourceCount: files.length,
  // … other fields …
  // hasScreenContext: ← MISSING
});
```

The field defaults to `undefined` / `false` inside `buildV3Prompt`.

### 2. `IntelligenceEngine` only checks `options.screenContext`, not `imagePaths`

**File:** [`electron/IntelligenceEngine.ts`](../../electron/IntelligenceEngine.ts) — inside `runWhatShouldISay` (~line 2494)

```typescript
// CURRENT (broken):
hasScreenContext: Boolean(options?.screenContext),
```

`options.screenContext` is the **OCR object** built from the periodic screen-capture service — it is not set for manually-attached screenshots sent through `imagePaths`. When a user attaches a screenshot through the chat UI, `imagePaths` is populated but `screenContext` is `null`, so `hasScreenContext` is `false`.

### 3. Turn classifier misses `SCREEN_SPECIFIC` / `SCREEN_FACT`

**File:** [`electron/context-intelligence/question/turn-classifier.ts`](../../electron/context-intelligence/question/turn-classifier.ts)

The classifier uses `hasScreenContext` to mark turns as screen-anchored. With `hasScreenContext: false`, a query like *"give me the code"* receives no screen-related label.

### 4. Coding persona never activated

**File:** [`electron/llm/AnswerPlanner.ts`](../../electron/llm/AnswerPlanner.ts)

Without a `SCREEN_SPECIFIC` or `CODING_TASK_RE` match, the orchestrator falls through to a generic `general_meeting_answer` type and never activates the coding persona or code-extraction prompt.

> **Note:** the phrase *"give me the code"* does not match `CODING_TASK_RE` (which requires verbs like write / implement / solve). The primary fix must therefore be at the `hasScreenContext` propagation level, not keyword-tuning.

---

## Proposed Fixes

### Fix A — `electron/ipcHandlers.ts`

Inside `_geminiChatStreamHandler`, pass `hasScreenContext` from `imagePaths`:

```diff
  const composed = await buildV3Prompt({
    surface: 'manual-chat',
    pathTag: 'ipc',
    question: String(message || ''),
    modeTemplateType: rawMode,
    modeUniqueId: modeInfo?.id ?? null,
    attachedSourceCount: files.length,
    attachedFileNames: (files as Array<{ fileName?: string }>)
      .map((f) => f.fileName ?? '').filter(Boolean),
    profileSourceCount: v3ProfileCounts.profileResume + ...,
    resolvedProfileSources: v3ProfileResolved,
    extraAllowedSourceTypes: extraSourceTypes,
    debugSources: v3DebugSources as never,
    deferDebugCompletion: true,
    requestId: `v3-${myStreamId}`,
    requestSequence: myStreamId,
+   hasScreenContext: Boolean(imagePaths && imagePaths.length > 0),
  });
```

### Fix B — `electron/IntelligenceEngine.ts`

Expand the `hasScreenContext` guard to cover the `imagePaths` channel:

```diff
- hasScreenContext: Boolean(options?.screenContext),
+ hasScreenContext: Boolean(
+   options?.screenContext || (imagePaths && imagePaths.length > 0)
+ ),
```

---

## Blast Radius

| Symbol / File | Confirmed Dependents | Risk |
|---|---|---|
| `ScreenContextService` | `IntelligenceEngine`, `IntelligenceManager`, `WhatToAnswerLLM` | Low — existing callers only read `captureScreen()`, not `imagePaths` |
| `buildCustomModeExecutionContract` | `IntelligenceEngine` (×5), `ipcHandlers` (×6) | Medium — touches both primary entry points |
| `ipcHandlers.ts` change | Only `gemini-chat-stream` handler | Low — scoped to manual-chat surface |
| `IntelligenceEngine.ts` change | All `runWhatShouldISay` callers | Medium — also affects overlay auto-answer flow |

**Regression risk for overlay auto-answer:**  
The overlay path sends both `options.screenContext` (OCR object) and `imagePaths`. After Fix B, both still resolve to `true` — no behaviour change for the existing overlay path.

**Test file to update:**  
- [`electron/services/__tests__/IntelligenceEngineScreenContext.test.mjs`](../../electron/services/__tests__/IntelligenceEngineScreenContext.test.mjs) — add a case where `screenContext` is `null` but `imagePaths` is non-empty, assert `hasScreenContext === true`.

---

## Safe-Change Checklist

- [ ] Fix A applied in `ipcHandlers.ts`
- [ ] Fix B applied in `IntelligenceEngine.ts`
- [ ] Manual smoke-test: attach a screenshot in manual chat, type "give me the code", verify coding response
- [ ] Overlay auto-answer with screen capture still works (no regression)
- [ ] `IntelligenceEngineScreenContext.test.mjs` updated with new `imagePaths`-only case
