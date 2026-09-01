# IntelligenceEngine — Architecture Critique & Recommended Fixes

> **Scope**: `electron/IntelligenceEngine.ts` (5,094 lines) and `electron/llm/` module  
> **Author**: Architecture review, August 2026  
> **Status**: Findings only — no code changed in this PR

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Unnecessary Complexity](#1-unnecessary-complexity)
3. [Unneeded / Dead Features](#2-unneeded--dead-features)
4. [Features with the Wrong Approach](#3-features-with-the-wrong-approach)
5. [Severity Summary Table](#severity-summary-table)
6. [Recommended Refactor Direction](#recommended-refactor-direction)

---

## Executive Summary

`IntelligenceEngine.ts` suffers from **progressive defensive accumulation**: every time the model produced a bad output, a new post-stream repair pass was bolted on. After many iterations this has produced:

- A 5,094-line file containing what should be 6–8 separate modules
- A single function (`runWhatShouldISay`) that is ~2,400 lines long
- Up to 3 sequential blocking LLM regeneration calls *after* an answer has already streamed to the UI
- Regex-based failure detectors that break with each new model provider
- Disabled features that still run classifiers and consume CPU on every request

The core insight: **the repair cascade is compensating for a weak primary prompt.** The right fix is upstream (stronger prompt constraints, structured output) not downstream (regex + LLM repair passes).

---

## 1. Unnecessary Complexity

### 1.1 God File: `IntelligenceEngine.ts` is 5,094 lines

**File**: [`electron/IntelligenceEngine.ts`](../../electron/IntelligenceEngine.ts)

One file contains all of:
- Mode routing and lifecycle (`idle`, `assist`, `what_to_say`, `follow_up`, `recap`, `clarify`, `manual`, `follow_up_questions`, `code_hint`, `brainstorm`)
- Speculative pre-fetch logic + debouncing
- Context assembly (profile, transcript, JD, screen, docs, custom mode contract)
- Streaming + AbortController cancellation
- 7+ distinct post-stream validation and repair passes, each with their own LLM calls
- Telemetry marking (`PiLatencyTrace`)
- Session persistence (`session.addAssistantMessage`)

**Impact**: Impossible to unit-test individual stages. A change to the profile repair logic requires understanding 2,400 lines of context. Onboarding a new developer onto this file is a multi-day task.

**Recommended Fix**:

Extract into purpose-built modules:
```
electron/intelligence/
  WtaPipeline.ts          ← orchestrator only (~200 lines)
  stages/
    PlanStage.ts          ← planAnswer(), answerPlan
    ContextStage.ts       ← candidateProfile, docContext, JD assembly
    GenerateStage.ts      ← raceStreamWithDeadline, streaming tokens
    ValidateStage.ts      ← all post-stream guards (no LLM calls)
    RepairStage.ts        ← bounded LLM repair (if needed at all)
    PersistStage.ts       ← session.addAssistantMessage, emit
```

Each stage takes a `WtaContext` object and returns an updated one. Independently testable.

---

### 1.2 The Post-Stream Repair Cascade

**File**: [`electron/IntelligenceEngine.ts`](../../electron/IntelligenceEngine.ts), lines ~2800–3800

After the initial answer streams to the UI, the pipeline runs **8+ sequential passes**:

| Phase | Gate | Extra LLM call? | Worst-case latency added |
|-------|------|-----------------|--------------------------|
| 1 | Leaked schema stubs / JSON envelopes | ❌ regex | ~0ms |
| 2 | Scaffold misfire detection | ❌ regex | ~0ms |
| 3 | Document-grounded answer validation | ✅ full regen | 4–7s |
| 4 | Profile evidence validation (hallucinated metrics, identity leaks) | ✅ full regen | 4–7s |
| 5 | `sanitizeCandidateAnswer` | ❌ regex | ~0ms |
| 6 | Assistant voice misfire guard | ❌ regex | ~0ms |
| 7 | False-no-content-claim guard | ❌ regex | ~0ms |
| 8 | Answer relevance guard (NLI, **currently disabled**) | ✅ full regen | 4–7s |
| Always | `cleanAnswerArtifacts`, `compressToSpeakable` | ❌ | ~0ms |

In the worst case (Phase 3 + Phase 4 both trigger), **14 additional seconds of latency** accrue after the answer the user already saw starts streaming. The regenerated text then silently replaces the streamed row.

**The UX problem**: The user sees a bad answer streaming in. The system detects it, regenerates behind the scenes, then swaps the row. This is jarring and untrustworthy.

**The code smell**: After every repair, `isLeakedAnswerArtifact()` is re-checked:
```ts
// From lines 3249, 3443, 3790 — the same check, three times:
&& !isLeakedAnswerArtifact(repairedTrim)
```
This is the clearest symptom that each repair can reintroduce the same class of failures as the original generation. The validation logic has no stable foundation.

**Recommended Fix**:

1. **Move profile and identity constraints into the primary prompt** as hard-formatted instructions. Most of Phase 4 (identity leak, false refusal) should never reach post-stream — the model should be unable to produce these shapes if the primary prompt is correctly specified.
2. **Use structured output / `response_format: json_schema`** where the provider supports it (OpenAI, Gemini) to eliminate the schema-stub / JSON-envelope repair gates entirely (Phases 1 & 2).
3. **Reduce post-stream repair to one optional LLM pass** that only fires if the output fails a deterministic structural check — and only runs for the doc-grounded path where factual accuracy checking is genuinely needed post-generation.

---

### 1.3 `AnswerPlanner.ts` is 211KB

**File**: [`electron/llm/AnswerPlanner.ts`](../../electron/llm/AnswerPlanner.ts) — 211,175 bytes

A single file containing prompt templates, routing logic, policy rules, type definitions, and business logic all mixed together. No individual component can be imported, tested, or modified without loading the entire 211KB module.

**Recommended Fix**: Split into a directory:
```
electron/llm/answerPlanner/
  index.ts                    ← re-exports public surface
  types.ts                    ← AnswerPlan, DocumentQuestionShape, etc.
  router.ts                   ← planAnswer(), routing decisions
  policy.ts                   ← profileContextPolicy, voicePerspective rules
  templates/
    candidate/                ← interview answer templates
    document/                 ← doc-grounded templates
    assistant/                ← meeting/lecture/sales templates
    coding/                   ← DSA/system design templates
```

---

### 1.4 Manual Path / WTA Path Code Duplication

**Files**: [`electron/IntelligenceEngine.ts`](../../electron/IntelligenceEngine.ts), [`electron/ipcHandlers.ts`](../../electron/ipcHandlers.ts), [`electron/llm/manualProfileIntelligence.ts`](../../electron/llm/manualProfileIntelligence.ts) (89KB)

Throughout `IntelligenceEngine.ts`, comments repeatedly say *"mirrors the same guard added to ipcHandlers.ts"* — indicating that every bug fix must be applied in two places:

```
// From line 3239:
// NON-REGRESSION LENGTH FLOOR (root-cause fix, 2026-07-23,
// mirrors the same guard added to ipcHandlers.ts's manual-chat regen path)
```

```
// From line 3476:
// Campaign 2 longsession run-023 finding (2026-07-18): ...
// The manual path (ipcHandlers.ts, same sanitizer) already has this
// exact `needsFallback` branch — mirrored here.
```

This is textbook maintenance debt. Both paths share identical post-processing needs but don't share code.

**Recommended Fix**: Extract a shared `AnswerPostProcessor` class that both the WTA auto-trigger path and the manual chat path call. Post-processing logic lives in one place.

---

## 2. Unneeded / Dead Features

### 2.1 Answer Relevance Guard (Phase 8) — Disabled in Production, Still Runs Classifier

**File**: [`electron/IntelligenceEngine.ts`](../../electron/IntelligenceEngine.ts), lines ~3617–3804  
**Flag**: `isIntelligenceFlagEnabled('answerRelevanceGuardLive')` — **OFF by default**

```ts
if (!isIntelligenceFlagEnabled('answerRelevanceGuardLive')) {
    // observe-only: classifier still runs, result is logged, fullAnswer never mutated
    trace.mark('validation_completed', { reason: 'answer_relevance_observe_only' });
} else {
    // ... hundreds of lines of repair logic ...
}
```

The guard was disabled because validation (run-032) proved it *made correct answers worse* — it flagged correct answers as irrelevant and regenerated them into worse versions. Despite being disabled, it still:
- Runs `checkAnswerRelevance()` (NLI inference via `IntentClassifier.ts`) on **every** non-speculative, non-coding answer
- Emits a trace mark
- The full repair code path (repair prompt, `raceStreamWithDeadline`, re-check, acceptance logic) sits in the live file, misleading readers into thinking it's active

**Recommended Fix**: 
- Delete the entire Phase 8 repair block
- If telemetry is still needed, move the `checkAnswerRelevance` call to a background analytics path that never touches `fullAnswer`
- Recalibrate the classifier against real score distributions before re-enabling

---

### 2.2 `detectRefinementIntent` — Possibly Dead Code in Main WTA Flow

**File**: [`electron/IntelligenceEngine.ts`](../../electron/IntelligenceEngine.ts), lines 81–100

```ts
function detectRefinementIntent(userText: string): { isRefinement: boolean; intent: string } {
    const refinementPatterns = [
        { pattern: /make it longer|expand on this|elaborate more/i, intent: 'expand' },
        { pattern: /rephrase that|say it differently|put it another way/i, intent: 'rephrase' },
        // ...5 more patterns
    ];
    ...
}
```

This function is called in `handleTranscript` at line 559 (on the user's speaker segment), which triggers `runFollowUp`. However, it is:
- **Not connected to the WTA path** at all
- Triggered on the raw STT token-by-token transcript, which means it fires on "make it longer" only if the user says that *exact phrase* aloud in the meeting
- The `intent` string it returns is passed to `runFollowUp(intent, ...)` but `runFollowUp` does not appear to actually use the intent string to modify its behavior

**Recommended Action**: Audit whether `runFollowUp` uses the `intent` parameter. If not, remove `detectRefinementIntent` and the intent passing. If yes, document the feature and add a test — it's currently invisible.

---

### 2.3 Multiple Single-Shot Modes Are Thin Duplicates

**File**: [`electron/IntelligenceEngine.ts`](../../electron/IntelligenceEngine.ts)

`runBrainstorm`, `runCodeHint`, `runClarify`, `runFollowUpQuestions` are all `IntelligenceMode` variants that each:
- Set up their own `AbortController`
- Have their own error handling boilerplate
- Call a single LLM function and emit the result

They could be unified into a single `runOneshot(mode: IntelligenceMode, prompt: string)` helper, reducing ~300 lines to ~60.

---

## 3. Features with the Wrong Approach

### 3.1 Post-Stream Repair is the Wrong UX Model

Already covered in §1.2 above. To summarize the UX impact clearly:

```
Timeline (worst case, Phase 3 + 4 both fire):

0ms    → Answer starts streaming to user
2000ms → Stream completes. User reads the answer.
2001ms → Phase 3 (doc-grounded validation) starts LLM call
7000ms → Phase 3 repair completes. User still reading.
7001ms → Phase 4 (profile validation) starts LLM call
14000ms→ Phase 4 repair completes. Row is silently swapped.
```

The user is reading and possibly acting on the first version of the answer while the system is swapping it out under them. This is worse than showing nothing while a correct answer generates.

**Recommended Fix**: Show a loading skeleton ("Thinking…") and only render the final, validated answer. One generation, one render. This is what every major AI assistant does.

---

### 3.2 Regex-Based LLM Failure Detection

**File**: [`electron/llm/`](../../electron/llm/) — multiple files

Functions like `isLeakedSchemaStub`, `isLeakedJsonEnvelope`, `isLeakedInternalTagBlock`, `isFalseNoContentClaim`, `detectAssistantVoiceMisfire` are regex-based detectors for specific failure phrasings from specific model versions.

Each was added to fix a specific observed regression:
- `isLeakedJsonEnvelope` — added when a specific provider started wrapping answers in JSON
- `detectAssistantVoiceMisfire` — added because *"smaller models over-apply the prompt's identity reply"*
- `isFalseNoContentClaim` — added because *"M3 over-applies the system-prompt refusal"*

**Why this fails**: Each new model or model version produces different failure phrasings. The guard list grows with every provider integration. These are per-model bugs, not general solutions.

**Recommended Fix**:
1. **Use `response_format: { type: "json_schema", ... }`** for providers that support it (OpenAI, Gemini). Constrain the output shape at the API level — the model *cannot* produce JSON envelopes or schema stubs if it's required to emit a specific schema.
2. For providers without structured output: write **one general-purpose output validator** that checks structural invariants (is it valid prose? does it start with a refusal phrase?) rather than a growing list of named pattern guards.
3. **Model-specific quirks belong in the provider adapter layer** (`ProviderRouter.ts`), not scattered as top-level flags in the answer pipeline.

---

### 3.3 Dynamic `require()` in the Hot Answer Path

**File**: [`electron/IntelligenceEngine.ts`](../../electron/IntelligenceEngine.ts), line ~3298

```ts
const { allowsEvidence } = require('./intelligence/context-os') as typeof import('./intelligence/context-os');
```

This is a synchronous dynamic `require()` inside the hot WTA path, wrapped in a `try/catch` that fails open (`return true`). Problems:
- Bypasses TypeScript's module graph analysis
- Prevents tree-shaking
- The `try/catch` silently grants permission if the require fails — a security-adjacent default that should be the opposite

**Recommended Fix**: Convert to a static import at the top of the file. The module is always needed when Context OS is active; there's no legitimate reason for it to be dynamic.

---

### 3.4 `sanitizeManualContextText` Called Per-Field with Inconsistent Limits

**File**: [`electron/IntelligenceEngine.ts`](../../electron/IntelligenceEngine.ts), lines ~3354, ~3368, ~3734

```ts
// Doc-grounded repair:
IntelligenceEngine.sanitizeManualContextText(candidateProfile, 8000)
IntelligenceEngine.sanitizeManualContextText(question, 1000)

// Profile repair:
IntelligenceEngine.sanitizeManualContextText(candidateProfile, 8000)
IntelligenceEngine.sanitizeManualContextText(question, 1000)

// Relevance repair:
IntelligenceEngine.sanitizeManualContextText(candidateProfile, 8000)  // 8000
IntelligenceEngine.sanitizeManualContextText(relevanceQuestion, 1000) // 1000
```

The same sanitization is copy-pasted at 3 repair call sites with manually typed limits. If the profile limit changes, it must be updated in 3 places.

**Recommended Fix**: Assemble the context object once at the start of `runWhatShouldISay`:

```ts
const sanitizedCtx = {
    profile: sanitize(candidateProfile, MAX_PROFILE_CHARS),
    question: sanitize(resolvedQuestion, MAX_QUESTION_CHARS),
    docContext: sanitize(docContextBlock, MAX_DOC_CHARS),
};
```

Pass `sanitizedCtx` through to all repair sites. One assembly, zero drift.

---

## Severity Summary Table

| Problem | Severity | File(s) |
|---------|----------|---------|
| `runWhatShouldISay` is ~2,400 lines | 🔴 Critical | `IntelligenceEngine.ts` |
| Post-stream repair cascade with 2–3 sequential LLM calls | 🔴 Critical | `IntelligenceEngine.ts` |
| Answer relevance guard disabled but classifier still runs on every call | 🟡 Medium | `IntelligenceEngine.ts` |
| `AnswerPlanner.ts` at 211KB, no internal module split | 🟡 Medium | `llm/AnswerPlanner.ts` |
| Regex-based LLM failure detection growing per provider/version | 🟡 Medium | `llm/` (multiple files) |
| Manual path / WTA path post-processing duplicated | 🟡 Medium | `IntelligenceEngine.ts`, `ipcHandlers.ts` |
| Dynamic `require()` in hot path with fail-open catch | 🟡 Medium | `IntelligenceEngine.ts` |
| `detectRefinementIntent` possibly unused / unverified | 🟠 Low-Medium | `IntelligenceEngine.ts` |
| Sanitization limits copy-pasted at 3 repair call sites | 🟠 Low | `IntelligenceEngine.ts` |
| `runBrainstorm` / `runCodeHint` / `runClarify` boilerplate duplication | 🟠 Low | `IntelligenceEngine.ts` |

---

## Recommended Refactor Direction

The following is a prioritized sequence — each step is independently mergeable:

### Step 1 (Highest ROI): Delete the disabled relevance guard (Phase 8)
- Remove ~200 lines from the hot path
- Stop running NLI classification on every answer
- Zero risk: it's already disabled

### Step 2: Extract `WtaPipeline` with explicit named stages
- Move the 2,400-line function into a class with stage methods
- Each stage becomes independently unit-testable
- No behavior change required at this step

### Step 3: Unify post-processing into `AnswerPostProcessor`
- Both `IntelligenceEngine.ts` (WTA) and `ipcHandlers.ts` (manual) call the same class
- Eliminates all "mirrors the same guard" comment patterns

### Step 4: Replace post-stream repair with pre-generation constraints
- Move profile/identity rules into the primary prompt template
- Enable `response_format` structured output for OpenAI/Gemini providers
- Target: reduce post-stream repair to **zero LLM calls** on the happy path

### Step 5: Split `AnswerPlanner.ts`
- Pure refactor, no behavior change
- Enables per-template unit tests

### Step 6: Replace per-model regex guards with provider-adapter pattern
- Each provider adapter handles its own output normalization
- Core pipeline sees clean, normalized strings only
