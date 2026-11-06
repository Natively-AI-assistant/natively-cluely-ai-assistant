# Natively AI Assistant — Premium Feature Audit

**Date:** 2026-11-06  
**Branch:** main  
**Recovered against:** Natively 3.1.0  
**Type:** Read-only static analysis — no files changed

---

## Executive Summary

| Metric | Count |
|---|---|
| Electron source files | 809 |
| IPC handlers (total) | 555 |
| Premium-related IPC handlers | 62 |
| Files in `premium/src/` | **1** (only ModesSettings.tsx) |
| Files in `premium/electron/` | **0** (entire directory missing) |
| Premium UI components missing | **7 of 9** |

The main application backend is substantially complete. The gap is concentrated in two places: the **premium submodule backend** (`premium/electron/` — entirely absent) and the **premium UI components** (`premium/src/` — only `ModesSettings.tsx` exists). Everything else — IPC handlers, shared intelligence services, settings tabs, OKF knowledge cards, the modes system, audio, connectors, exports — is present and wired up.

The dev premium override (`NATIVELY_DEV_PREMIUM=1`) partially simulates a Pro session but cannot substitute for the missing modules. Some license IPC handlers bypass it; profile intelligence, Role Insight, and all premium engines are non-functional without the submodule backend. The onboarding card scheduler is permanently disabled because all 4 ad-toaster components are missing.

> **Important:** The recovered implementation contains compiled JavaScript only — no original TypeScript, no JSX, no source maps. Any reconstruction from it is a derivative of compiled output, not restored source. The recovery report states redistribution rights are not established — keep it local.

---

## 1. Checkout Inventory

### Backend (Electron main process)

| Area | Location | Files | Status |
|---|---|---|---|
| IPC handler surface | `electron/ipcHandlers.ts` | 22,050 lines · 555 handlers | ✅ Present |
| Shared knowledge / OKF card system | `electron/services/knowledge/` | 32 files — KnowledgeManager, OkfExtractor, GraphExtractor, KnowledgePackStore, KnowledgeIndexQueue, OkfRetriever, etc. | ✅ Present |
| Intelligence layer | `electron/intelligence/` | ~25 files — ProfileTreeService, ContextRouter, ContextFusionEngine, LiveTranscriptBrain, MeetingMemoryService, SearchOrchestrator, etc. | ✅ Present |
| Audio / STT pipeline | `electron/audio/` | AppleSpeechSTT, DeepgramStreamingSTT, ElevenLabsStreamingSTT, GoogleSTT, OpenAIStreamingSTT, QwenRealtimeSTT, MicrophoneCapture, SystemAudioCapture, VAD, Diarization, Whisper, Parakeet… | ✅ Present |
| LLM / answer pipeline | `electron/llm/` | FollowUpLLM, ClarifyLLM, RecapLLM, CodeHintLLM, WhatToAnswerLLM, ProviderRouter, StreamFallbackEngine, SessionMemory, ConversationSummarizer… | ✅ Present |
| Context / retrieval | `electron/context-intelligence/` | RAG pipeline, retrieval flags, context assembly | ✅ Present |
| Dev premium override | `electron/services/devPremiumOverride.ts` | `isDevPremiumOverrideEnabled`, `getDevPlanOverride` | ✅ Present |
| Feature gate | `electron/premium/featureGate.ts` | `isPremiumAvailable()` — probes for premium modules at runtime, caches result | ✅ Present |
| Outputs / connectors / exports | `electron/services/outputs/` | PDF, HTML, Gmail, Slack, Notion, CRM, webhooks, local API, MCP, share links | ✅ Present |
| Calendar providers | `electron/services/` | Apple, Microsoft, ICS | ✅ Present |
| **Premium knowledge engines** | `premium/electron/knowledge/` | KnowledgeOrchestrator, KnowledgeDatabaseManager, CompanyResearchEngine, NegotiationEngine, CoverLetterEngine, RoleInsightService, MockInterviewGenerator, SalaryIntelligenceEngine, StarStoryGenerator, and 20+ more | ❌ MISSING |
| **LicenseManager** | `premium/electron/services/LicenseManager.js` | Activation, verification, hardware ID, isPremium, isPremiumAsync, deactivate | ❌ MISSING |
| **Premium types / DocType enum** | `premium/electron/knowledge/types.js` | `DocType.RESUME`, `DocType.JD` — required inline in 8 IPC handlers | ❌ MISSING |
| **JdSourceResolver** | `premium/electron/knowledge/roleInsight/JdSourceResolver.js` | `resolveFromUrl` — required inline in `roleInsight:import-jd-url` | ❌ MISSING |

### Frontend (Renderer)

| Component | Location | Status |
|---|---|---|
| Premium module loader | `src/premium/index.tsx` | ✅ Present |
| ModesSettings | `premium/src/ModesSettings.tsx` | ✅ Present — 2240+ lines, reconstructed from bundle |
| ProfileVisualizer | `premium/src/ProfileVisualizer.tsx` | ❌ MISSING → NullComponent |
| RoleInsightPanel | `premium/src/RoleInsightPanel.tsx` | ❌ MISSING → NullComponent |
| NegotiationCoachingCard | `premium/src/NegotiationCoachingCard.tsx` | ❌ MISSING → NullComponent |
| ProfileFeatureToaster | `premium/src/ProfileFeatureToaster.tsx` | ❌ MISSING → NullComponent |
| JDAwarenessToaster | `premium/src/JDAwarenessToaster.tsx` | ❌ MISSING → NullComponent |
| NativelyApiPromoToaster | `premium/src/NativelyApiPromoToaster.tsx` | ❌ MISSING → NullComponent |
| MaxUltraUpgradeToaster | `premium/src/MaxUltraUpgradeToaster.tsx` | ❌ MISSING → NullComponent |
| RemoteCampaignToaster | `premium/src/RemoteCampaignToaster.tsx` | ❌ MISSING → NullComponent |
| ProfileIntelligenceSettings | `src/components/ProfileIntelligenceSettings.tsx` | ✅ Present — renders RoleInsightPanel slot (blank when module missing) |
| SettingsOverlay (13 tabs) | `src/components/SettingsOverlay.tsx` | ✅ Present — general, plans, ai-providers, retrieval, audio, overlay, calendar, keybinds, phone-mirror, connections, intelligence, help, about |

---

## 2. Premium Gaps — Detailed

### Gap 1 — Premium backend submodule (`premium/electron/`)

The entire `premium/electron/` directory is absent. The app's `main.ts` loads these at startup in a try/catch (lines 1413–1419):

```ts
KnowledgeOrchestratorClass = require('../premium/electron/knowledge/KnowledgeOrchestrator').KnowledgeOrchestrator;
KnowledgeDatabaseManagerClass = require('../premium/electron/knowledge/KnowledgeDatabaseManager').KnowledgeDatabaseManager;
textHasCompEvidence = require('../premium/electron/knowledge/NegotiationConversationTracker').textHasCompEvidence;
```

When they fail to load, it logs `[Main] Knowledge modules not available — profile intelligence disabled` and sets the orchestrator to `null`. All 62 premium IPC handlers that call `appState.getKnowledgeOrchestrator()` return early with errors.

Recovered compiled equivalents exist at:
- `Natively-Recovered-Source/recovered/compiled/app/dist-electron/premium/electron/knowledge/` — 29 JS files
- `Natively-Recovered-Source/recovered/compiled/app/dist-electron/premium/electron/services/` — LicenseManager.js, licenseVerifyPolicy.js

### Gap 2 — Premium UI components (`premium/src/`)

Eight of nine expected components are absent. The loader at `src/premium/index.tsx` uses Vite `import.meta.glob` with eager loading and falls back to `NullComponent` for each missing file. These components are used in live render paths:

- `ProfileVisualizer` — rendered in `SettingsOverlay` (Profile Intelligence tab)
- `RoleInsightPanel` — rendered in `ProfileIntelligenceSettings`
- `NegotiationCoachingCard` — rendered in `NativelyInterface` overlay
- `ProfileFeatureToaster`, `JDAwarenessToaster`, `NativelyApiPromoToaster`, `MaxUltraUpgradeToaster` — all used by `OrchestratedToasterHost`

All 5 missing named components appear in the recovered renderer bundle (`App-h7VwvpAg.js`), so their compiled implementations are recoverable.

### Gap 3 — `PREMIUM_ADS_AVAILABLE = false` (silent behavioral regression)

`src/premium/index.tsx` exports `PREMIUM_ADS_AVAILABLE`, which is `true` only when all 4 ad-toaster component files exist. All 4 are missing, so this flag is permanently `false` at build time. `App.tsx:547` passes it to the card scheduler as `adsAvailable: PREMIUM_ADS_AVAILABLE`. The scheduler skips all ad/onboarding card stages when this is `false` — the entire onboarding card flow is silently disabled regardless of plan or dev override.

### Gap 4 — Inline requires that throw at IPC call time

The startup try/catch only guards `KnowledgeOrchestrator` and `KnowledgeDatabaseManager`. Several other premium modules are required inline inside handler bodies, with no graceful fallback:

- `premium/electron/knowledge/types` (DocType enum) — 8 handlers: `profile:upload-resume`, `profile:delete`, `profile:upload-jd`, `profile:get-status`, `roleInsight:paste-jd`, `roleInsight:import-jd-url`, trial wipe, e2e helpers
- `premium/electron/knowledge/roleInsight/JdSourceResolver` — `roleInsight:import-jd-url`

These throw `MODULE_NOT_FOUND` at call time (not startup), producing a raw Node.js error string in the response rather than a human-readable "feature unavailable" message.

---

## 3. Feature Matrix

| Feature | IPC Handlers | Backend | UI | Functional |
|---|---|---|---|---|
| Modes / Custom profiles | ✅ | ✅ shared | ✅ reconstructed | ✅ |
| Knowledge cards (OKF) — modes reference files | ✅ | ✅ electron/services/knowledge/ | ⚠️ not verified | ✅ |
| Profile Intelligence — resume ingestion | ✅ | ❌ KnowledgeOrchestrator missing | ❌ ProfileVisualizer missing | ❌ |
| Profile Intelligence — JD ingestion | ✅ | ❌ | ❌ | ❌ |
| Profile Intelligence — Q&A / cue cards | ✅ | ⚠️ OwnAnswersStore exists | ⚠️ not verified | ⚠️ Partial |
| Company Research | ✅ | ❌ CompanyResearchEngine missing | ❌ | ❌ |
| Negotiation coaching | ✅ | ❌ NegotiationEngine missing | ❌ NegotiationCoachingCard missing | ❌ |
| Cover letter generation | ✅ | ❌ CoverLetterEngine missing | ❌ | ❌ |
| Role Insight / gap analysis | ✅ 10 handlers | ❌ RoleInsightService missing | ❌ RoleInsightPanel missing | ❌ |
| Salary intelligence | ⚠️ indirect | ❌ SalaryIntelligenceEngine missing | ❌ | ❌ |
| Mock interview generator | ⚠️ indirect | ❌ MockInterviewGenerator missing | ❌ | ❌ |
| STAR stories / culture mapping | ⚠️ indirect | ❌ StarStoryGenerator missing | ❌ | ❌ |
| License activation / verification | ✅ | ❌ LicenseManager missing | ✅ UI present | ❌ real activation |
| Dev premium override | ✅ | ✅ devPremiumOverride.ts | ✅ affects plan UI | ⚠️ partial — see §4 |
| Onboarding card / ad toasters | — | ✅ scheduler present | ❌ 4/4 toasters missing | ❌ silently disabled |
| Auto Answer | ✅ | ✅ | ✅ | ✅ |
| Follow-up / Clarify / Recap / Code Hint | ✅ | ✅ | ✅ | ✅ |
| Screenshots / OCR / Screen understanding | ✅ | ✅ | ✅ | ✅ |
| Meeting persistence / transcripts / notes | ✅ | ✅ | ✅ | ✅ |
| Connectors (Gmail, Slack, Notion, CRM…) | ✅ | ✅ | ✅ | ✅ |
| Local API / MCP server | ✅ | ✅ | ✅ | ✅ |
| Skills install / upload | ✅ | ✅ | ✅ | ✅ |
| Personal memory / Hindsight | ✅ | ✅ | ✅ | ✅ |
| AI model / provider selection | ✅ | ✅ | ✅ 13 settings tabs | ✅ |
| Theme / shortcuts / overlay passthrough | ✅ | ✅ | ✅ | ✅ |
| Phone companion / mirroring | ✅ | ✅ | ✅ | ✅ |

---

## 4. Runtime Failure Map

### At app startup

**[startup] Knowledge modules not loaded — profile intelligence disabled**  
Console: `[Main] Knowledge modules not available — profile intelligence disabled.`  
Cause: `require('../premium/electron/knowledge/KnowledgeOrchestrator')` throws MODULE_NOT_FOUND in the try/catch at `main.ts:1413`. Startup continues normally.

**[startup] featureGate.ts caches `isPremiumAvailable() = false`**  
`electron/premium/featureGate.ts` probes both `LicenseManager` and `KnowledgeOrchestrator` at first call. Both absent, so `false` is cached for the process lifetime.

### At IPC call time — graceful failures

**62 premium handlers return "engine not initialized" error**  
All handlers that call `appState.getKnowledgeOrchestrator()` get `null` back and return `{ success: false, error: 'Knowledge engine not initialized…' }`. Clean error responses — no crash.

**`license:check-premium` returns `false` even with dev override active**  
`license:check-premium` at `ipcHandlers.ts:1253` goes directly to `LicenseManager.getInstance().isPremium()` with no dev override check — returns `false` in this build. `license:check-premium-async` (line 1279) **does** check the override and returns `true`. Any renderer code using the sync variant sees a free-plan state even with `NATIVELY_DEV_PREMIUM=1`.

### At IPC call time — hard throws (MODULE_NOT_FOUND)

**[HIGH] DocType inline require throws in 8 handlers**  
Handlers that reach `const { DocType } = require('../premium/electron/knowledge/types')` throw at that line. The outer try/catch catches it and returns `{ success: false, error: error.message }`, but the error message is a raw Node.js MODULE_NOT_FOUND string, not a user-friendly message.  
Affected: `profile:upload-resume`, `profile:delete`, `profile:upload-jd`, `profile:get-status`, `roleInsight:paste-jd`, `roleInsight:import-jd-url`, trial wipe, e2e helpers.

**[HIGH] JdSourceResolver inline require throws in `roleInsight:import-jd-url`**  
`const { resolveFromUrl } = require('../premium/electron/knowledge/roleInsight/JdSourceResolver')` at `ipcHandlers.ts:19253` throws MODULE_NOT_FOUND. Same outer-catch behavior.

### Dev premium override — coverage gaps

| Handler | Dev override check | Returns with `NATIVELY_DEV_PREMIUM=1` |
|---|---|---|
| `get-natively-usage` | ✅ Yes | Mock ultra quota |
| `license:get-details` | ✅ Yes | `{ isPremium: true, plan: 'ultra' }` |
| `isProOrTrialActive()` in proAccess.ts | ✅ Yes | `true` |
| `license:check-premium-async` | ✅ Yes | `true` |
| `license:check-premium` (sync) | ❌ **No** | `false` |
| `license:activate` | ❌ **No** | Passes through to missing LicenseManager |
| `PREMIUM_ADS_AVAILABLE` | ❌ **No** (build-time) | `false` permanently |

---

## 5. What the Prior Codex Audit Missed

### Omission 1 — `electron/services/knowledge/` (32 files) — entire shared OKF layer undocumented

The prior audit treats "knowledge" as a single missing gap and equates it with the absent `premium/electron/knowledge/` engines. It does not mention that the checkout already has a full **Open Knowledge Format card system** at `electron/services/knowledge/` — 32 files including `KnowledgeManager`, `OkfExtractor`, `GraphExtractor`, `KnowledgePackStore`, `KnowledgeIndexQueue`, `OkfRetriever`, and more. This system is fully wired via 10 IPC handlers (`knowledge:list-packs`, `get-pack`, `regenerate-pack`, `edit-card`, `approve-card`, etc.) and works today for modes reference files. Only the profile-intelligence arm (resume/JD) requires the missing orchestrator.

### Omission 2 — `electron/premium/featureGate.ts` completely missed

`electron/premium/featureGate.ts` exports `isPremiumAvailable()`, which probes both `LicenseManager` and `KnowledgeOrchestrator` at first call and caches the result. This is the intended runtime boundary between the open build and the premium build. It is not mentioned anywhere in the prior audit. New premium consumers should use this gate rather than their own inline requires.

### Omission 3 — `license:check-premium` has no dev override — returns `false` in dev mode

The prior audit says "some license IPC paths still depend on the absent module" without identifying which. The critical case: `license:check-premium` (line 1253) has **no dev override** and returns `false` in this build. `license:check-premium-async` (line 1279) has the override and returns `true`. Any renderer using the sync variant sees a free-plan state even with the dev override active.

### Omission 4 — DocType / JdSourceResolver inline requires — wider runtime failure surface

The prior audit characterizes the premium module gap as affecting startup and orchestrator construction only. The actual blast radius is wider: `premium/electron/knowledge/types` and `roleInsight/JdSourceResolver` are required inline inside 8+ handler bodies, not at startup, so they throw MODULE_NOT_FOUND errors **at IPC call time**, not during app initialization. The error response text is a raw Node.js module error rather than a human-readable message.

### Omission 5 — `PREMIUM_ADS_AVAILABLE = false` silently disables the entire onboarding card scheduler

The prior audit lists the missing toaster components as individual UI gaps. It does not surface the downstream effect: `PREMIUM_ADS_AVAILABLE` (computed at build time from glob results) is `false` when any of the 4 ad-toaster files is missing. `App.tsx` passes this flag to the card scheduler, which skips all ad/onboarding card stages when it is false. The scheduler itself is present and working — it is simply never triggered. This is a silent, complete behavioral regression for the onboarding flow, not a visual no-op.

---

## 6. Recommended Actions

### P1 — Port `premium/electron/` from recovered compiled JS

Copy the compiled JS files from `Natively-Recovered-Source/recovered/compiled/app/dist-electron/premium/` into `premium/electron/`. Start with:
1. `services/LicenseManager.js`
2. `knowledge/types.js`
3. `knowledge/KnowledgeOrchestrator.js` + `KnowledgeDatabaseManager.js`

These four files unblock the most IPC handlers. Do not reconstruct from scratch — copy the compiled output directly since original TypeScript is unavailable. This single change enables all 62 premium IPC handlers and profile intelligence.

### P1 — Wrap DocType / JdSourceResolver requires in try/catch

In `electron/ipcHandlers.ts`, the 8 handlers that inline-require `premium/electron/knowledge/types` and `premium/electron/knowledge/roleInsight/JdSourceResolver` need their require calls wrapped in try/catch with a clean "feature unavailable" fallback message. This prevents MODULE_NOT_FOUND stack traces from leaking to callers in open builds.

### P1 — Reconstruct missing premium UI components from recovered bundle

All 5 named missing components (`ProfileVisualizer`, `RoleInsightPanel`, `NegotiationCoachingCard`, `ProfileFeatureToaster`, `JDAwarenessToaster`) are present in `App-h7VwvpAg.js`. Reconstruct them into `premium/src/` following the same approach used for `ModesSettings.tsx`. This also restores `PREMIUM_ADS_AVAILABLE = true` once all 4 toasters are present, re-enabling the card scheduler.

### P2 — Add dev override check to `license:check-premium`

At `ipcHandlers.ts:1253`, `license:check-premium` lacks the devPremiumOverride check that `license:check-premium-async` (line 1279) already has. Add the same 4-line override block at the top of that handler.

```ts
safeHandle('license:check-premium', async () => {
  try {
    const { isDevPremiumOverrideEnabled } = require('./services/devPremiumOverride');
    if (isDevPremiumOverrideEnabled()) return true;
  } catch { /* devPremiumOverride unavailable */ }
  try {
    const { LicenseManager } = require('../premium/electron/services/LicenseManager');
    return LicenseManager.getInstance().isPremium();
  } catch {
    return false;
  }
});
```

### P2 — Reconstruct `NativelyApiPromoToaster` and `MaxUltraUpgradeToaster`

These 2 remaining toasters are also needed for `PREMIUM_ADS_AVAILABLE = true`. All 4 must be present before the card scheduler re-activates. Present in the recovered bundle — reconstruct into `premium/src/`.

### P3 — Verify knowledge:list-packs / OKF card UI is wired end-to-end

The 32-file OKF system in `electron/services/knowledge/` and its 10 IPC handlers are present and believed to work for modes reference files. Confirm the UI that displays knowledge packs and cards is actually rendering. Not tested behaviorally in this audit.

### P3 — Document `featureGate.ts` as the standard premium boundary

`electron/premium/featureGate.ts` exists and is the right place to gate any premium-dependent code. Add a note in `CLAUDE.md` or inline docs directing new premium consumers to call `isPremiumAvailable()` from this module instead of their own ad-hoc requires.

---

## 7. Limits & Caveats

### Not checked in this audit

- Live provider / server calls or AI output quality
- Every dialog and feature state exercised in-app
- Native audio capture / microphone permissions (macOS or Windows)
- Package builds or installers on either platform
- TypeScript compilation of reconstructed components
- Behavioral correctness of the OKF card system
- Windows-specific paths for any premium features
- Subscription server verification or entitlement state

### Structural limits of the recovered source

- Recovered code is compiled JavaScript only — no original TypeScript, no JSX, no source maps
- Remote backend is not recovered — client adapters only
- Recovery report notes proprietary code; redistribution rights not established — keep local
- Runtime observations were from macOS only; Windows behavior is unestablished
- The feature inventory was written against 3.0.0 and carried forward — not exhaustive behavioral certification

---

**Validation status:**  
Reviewed but not executed on macOS · Reviewed but not executed on Windows · Requires physical macOS verification · Requires physical Windows verification.  
No build, test suite, or app execution was performed for this audit. All findings are static code analysis only.
