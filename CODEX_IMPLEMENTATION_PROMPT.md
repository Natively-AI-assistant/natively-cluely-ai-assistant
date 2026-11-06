# Codex Implementation Prompt — Natively AI Assistant Premium Features

---

## Your Mission

You are implementing all missing premium features into the **Natively AI Assistant** Electron app by extracting and reconstructing implementations from a recovered compiled version of the original production app (Natively 3.1.0).

The goal is **complete feature parity**: every premium feature present in the recovered source must be implemented in the Natively AI Assistant `premium/` folder, with the correct folder structure, proper TypeScript/JavaScript code (reconstructed from compiled bundles where necessary), and full integration with the existing IPC handlers and renderer.

Do not stop at analysis or planning. The primary deliverable is **working code**.

---

## Project Paths

| Role | Path |
|---|---|
| **Natively AI Assistant** (target — your working directory) | `/Users/shubhampandey/testing/natively-cluely-ai-assistant/` |
| **Recovered source** (read-only reference) | `/Users/shubhampandey/Desktop/Natively-Recovered-Source/` |
| **Recovered compiled backend** | `/Users/shubhampandey/Desktop/Natively-Recovered-Source/recovered/compiled/app/dist-electron/` |
| **Recovered premium backend** | `/Users/shubhampandey/Desktop/Natively-Recovered-Source/recovered/compiled/app/dist-electron/premium/electron/` |
| **Recovered renderer bundle** | `/Users/shubhampandey/Desktop/Natively-Recovered-Source/recovered/reconstructed/readable/dist/assets/App-h7VwvpAg.js` |
| **Feature inventory** | `/Users/shubhampandey/Desktop/Natively-Recovered-Source/FEATURE_INVENTORY.md` |
| **Module map** | `/Users/shubhampandey/Desktop/Natively-Recovered-Source/docs/features/MODULE_MAP.md` |

---

## Context — What Already Exists

Before implementing anything, understand what is already present and working in the target codebase so you do not create duplicate or competing implementations.

### Already fully implemented (do not duplicate)

- **Modes system backend** — `electron/services/ModesManager.ts`, all modes IPC handlers in `electron/ipcHandlers.ts`
- **OKF knowledge card system** — `electron/services/knowledge/` (32 files: KnowledgeManager, OkfExtractor, GraphExtractor, KnowledgePackStore, KnowledgeIndexQueue, etc.) — handles knowledge packs for modes reference files
- **Intelligence layer** — `electron/intelligence/` (~25 files: ProfileTreeService, ContextRouter, LiveTranscriptBrain, MeetingMemoryService, SearchOrchestrator, ContextFusionEngine, etc.)
- **Audio / STT** — `electron/audio/` — full pipeline including AppleSpeechSTT, DeepgramStreamingSTT, ElevenLabsStreamingSTT, GoogleSTT, OpenAIStreamingSTT, QwenRealtimeSTT, Whisper, Parakeet, VAD, Diarization, MicrophoneCapture, SystemAudioCapture
- **LLM / answer pipeline** — `electron/llm/` — FollowUpLLM, ClarifyLLM, RecapLLM, CodeHintLLM, WhatToAnswerLLM, ProviderRouter, StreamFallbackEngine, SessionMemory
- **All settings tabs** — `src/components/SettingsOverlay.tsx` — 13 tabs fully implemented
- **ModesSettings UI** — `premium/src/ModesSettings.tsx` — 2240+ lines, fully reconstructed
- **Dev premium override** — `electron/services/devPremiumOverride.ts`
- **Feature gate** — `electron/premium/featureGate.ts`
- **IPC handlers** — `electron/ipcHandlers.ts` — ALL 62 premium IPC handlers are already wired and waiting. The handlers exist but return "engine not initialized" because the backend modules they call are missing. Your job is to supply those missing modules, not to write new handlers.

### Already wired — IPC handlers waiting for backend

These handlers exist in `electron/ipcHandlers.ts` and call modules that must exist at the paths listed:

```
premium/electron/knowledge/KnowledgeOrchestrator       ← loaded at main.ts:1414
premium/electron/knowledge/KnowledgeDatabaseManager    ← loaded at main.ts:1415
premium/electron/knowledge/NegotiationConversationTracker ← loaded at main.ts:1416
premium/electron/knowledge/types                       ← inline required in 8 handlers
premium/electron/knowledge/roleInsight/JdSourceResolver ← inline required in roleInsight:import-jd-url
premium/electron/services/LicenseManager               ← required in license:* handlers and proAccess.ts
```

### Already wired — UI loader waiting for components

`src/premium/index.tsx` uses `import.meta.glob` to load these files and falls back to `NullComponent` when absent. Add these files and they automatically activate:

```
premium/src/ProfileVisualizer.tsx
premium/src/RoleInsightPanel.tsx
premium/src/NegotiationCoachingCard.tsx
premium/src/ProfileFeatureToaster.tsx
premium/src/JDAwarenessToaster.tsx
premium/src/NativelyApiPromoToaster.tsx
premium/src/MaxUltraUpgradeToaster.tsx
premium/src/RemoteCampaignToaster.tsx
```

---

## What You Must Build

### Part A — Backend: `premium/electron/`

Create the full premium backend directory structure by extracting and reconstructing from the recovered compiled files. The compiled source for every module listed below exists at:

```
/Users/shubhampandey/Desktop/Natively-Recovered-Source/recovered/compiled/app/dist-electron/premium/electron/
```

**Required folder structure:**

```
premium/
  electron/
    knowledge/
      KnowledgeOrchestrator.ts       ← core: orchestrates all profile intelligence
      KnowledgeDatabaseManager.ts    ← SQLite schema and persistence for profile data
      AOTPipeline.ts                 ← ahead-of-time pipeline for JD processing
      CompanyResearchEngine.ts       ← company research from JD/name
      ContextAssembler.ts            ← assembles context from profile + meeting
      CoverLetterEngine.ts           ← cover letter generation
      CultureValuesMapper.ts         ← culture and values extraction
      DocumentChunker.ts             ← document splitting for indexing
      DocumentReader.ts              ← PDF/DOCX/text reading
      GapAnalysisEngine.ts           ← skills gap analysis
      HeuristicExtractor.ts          ← heuristic-based entity extraction
      HybridSearchEngine.ts          ← BM25 + semantic hybrid search
      IntentClassifier.ts            ← intent classification for routing
      LiveNegotiationAdvisor.ts      ← real-time negotiation guidance
      MockInterviewGenerator.ts      ← mock interview question generation
      NativelySearchProvider.ts      ← Natively search API adapter
      NegotiationConversationTracker.ts ← tracks negotiation conversation state + textHasCompEvidence()
      NegotiationEngine.ts           ← negotiation strategy generation
      PostProcessor.ts               ← post-processing for extracted content
      ProfileContextBuilder.ts       ← builds context from structured profile
      SalaryIntelligenceEngine.ts    ← salary estimation and benchmarking
      StarStoryGenerator.ts          ← STAR story generation from profile
      StructuredExtractor.ts         ← structured data extraction from documents
      StructuredJDNormalizer.ts      ← normalizes job description to structured format
      StructuredResumeNormalizer.ts  ← normalizes resume to structured format
      TavilySearchProvider.ts        ← Tavily web search adapter
      TechnicalDepthScorer.ts        ← scores technical depth of content
      jsonExtract.ts                 ← JSON extraction utilities
      llmUtils.ts                    ← LLM utility functions shared by knowledge modules
      skillsUtil.ts                  ← skills normalization utilities
      types.ts                       ← DocType enum, shared types (CRITICAL — required by 8 IPC handlers)
      roleInsight/
        AssessmentValidator.ts
        CoverageCalculator.ts
        EvidenceRetriever.ts
        HardGateEvaluator.ts
        JdSourceResolver.ts          ← CRITICAL — required by roleInsight:import-jd-url handler
        RequirementAssessor.ts
        RequirementExtractor.ts
        RequirementNormalizer.ts
        RoleInsightDatabase.ts
        RoleInsightEngine.ts
        RoleInsightService.ts        ← top-level service (attachRoleInsight in main.ts:3027)
        index.ts
        skillOntology.ts
        types.ts
    services/
      LicenseManager.ts              ← CRITICAL — required by all license:* IPC handlers
      licenseVerifyPolicy.ts
```

### Part B — Frontend: `premium/src/`

Reconstruct the following UI components from the recovered renderer bundle (`App-h7VwvpAg.js`). Every one of these is confirmed present in the bundle. Use the same search-and-reconstruct methodology used for `ModesSettings.tsx`.

```
premium/src/
  ProfileVisualizer.tsx          ← Profile Intelligence settings panel visualizer
  RoleInsightPanel.tsx           ← Role Insight analysis panel
  NegotiationCoachingCard.tsx    ← Live negotiation coaching card in overlay
  ProfileFeatureToaster.tsx      ← Profile feature discovery toaster
  JDAwarenessToaster.tsx         ← Job description awareness toaster
  NativelyApiPromoToaster.tsx    ← Natively API promo toaster
  MaxUltraUpgradeToaster.tsx     ← Max/Ultra upgrade toaster
  RemoteCampaignToaster.tsx      ← Remote campaign toaster
```

---

## Implementation Rules

### Source priority (in order)

1. **Recovered compiled backend** (`recovered/compiled/app/dist-electron/premium/electron/`) — read the compiled JS, understand the logic, reconstruct as clean TypeScript. Do not blindly copy minified code — rewrite as readable, properly typed TypeScript.
2. **Recovered renderer bundle** (`App-h7VwvpAg.js`) — for UI components, search by component name or surrounding patterns. The bundle is 74,585 lines of formatted readable JS. Extract and reconstruct as TSX.
3. **Module map** (`docs/features/MODULE_MAP.md`) — maps every compiled file to its original TypeScript path and approximate line number. Use this to verify you are reading the right compiled file.

### Critical rules

- **Do not write anything from scratch.** Every implementation must be derived from the recovered source code — either from the compiled backend files or from the renderer bundle. If the exact logic exists in a compiled file, use that logic.
- **Do not use placeholders, stubs, or dummy implementations.** Every function must have real logic extracted from the recovered source.
- **Do not duplicate existing implementations.** The OKF card system, intelligence layer, audio pipeline, and all IPC handlers are already in the codebase. Only add what is in `premium/`.
- **Follow existing code conventions.** The codebase uses TypeScript with strict types, React hooks for UI state, `safeHandle` for IPC, `app.getPath()` for paths (never hardcoded), `path.join()` for all path construction.
- **Cross-platform required.** Natively supports both macOS and Windows. Any path construction, file operations, or native integrations must use `node:path`, `node:os`, and `app.getPath()`. Never use hardcoded `/tmp`, `/Users`, or Windows-only paths. If a module has platform-specific behavior, implement both paths.
- **TypeScript must compile.** Run `npx tsc --noEmit` after implementing each file. Fix all type errors before moving on. Do not suppress errors with `any` unless the recovered source itself uses dynamic typing.

### Integration points to respect

The existing IPC handlers in `electron/ipcHandlers.ts` call specific methods on the orchestrator. Do not change the handler code — your backend must implement the interface those handlers expect. Key methods the orchestrator must implement (from handler call sites):

```ts
// From ipcHandlers.ts call sites:
orchestrator.ingestDocument(filePath: string, docType: DocType): Promise<{ success: boolean; error?: string }>
orchestrator.deleteDocumentsByType(docType: DocType): Promise<void>
orchestrator.setKnowledgeMode(enabled: boolean): void
orchestrator.activeResume: { structured_data: any } | null
orchestrator.processQuestion(question: string): Promise<any>
orchestrator.getCompanyDossier(): Promise<any>
orchestrator.researchCompany(name: string, force: boolean): Promise<any>
orchestrator.generateNegotiation(force: boolean): Promise<any>
orchestrator.generateCoverLetter(force: boolean): Promise<any>
orchestrator.getNegotiationState(): Promise<any>
orchestrator.resetNegotiation(): Promise<void>
orchestrator.attachRoleInsight(sqliteDb: any): void
orchestrator.getRoleInsightService(): RoleInsightService | null
// Profile pack methods:
orchestrator.exportProfilePack(): Promise<{ success: boolean; path?: string; fileCount?: number; error?: string }>
orchestrator.listProfilePacks(): Promise<{ id: string; fileName: string; cardCount: number }[]>
orchestrator.getProfilePack(kind: string): Promise<any>
```

LicenseManager must implement (from `ipcHandlers.ts` and `proAccess.ts` call sites):

```ts
LicenseManager.getInstance(): LicenseManager
manager.isPremium(): boolean
manager.isPremiumAsync(): Promise<boolean>
manager.activateLicense(key: string): Promise<{ success: boolean; error?: string }>
manager.deactivate(): Promise<void>
manager.getLicenseDetails(): Promise<{ isPremium: boolean; plan?: string }>
manager.getHardwareId(): string
```

The `types.ts` file must export at minimum:

```ts
export enum DocType {
  RESUME = 'resume',
  JD = 'jd',
  // ... other types as found in recovered source
}
```

---

## Implementation Process

Follow this exact sequence:

### Step 1 — Analyze the recovered premium compiled files

For each file in `recovered/compiled/app/dist-electron/premium/electron/`:
- Read the compiled JS
- Identify: class name, constructor arguments, public methods, dependencies imported
- Note what other premium modules it imports (to establish build order)
- Note what shared modules it imports from `../../electron/` (already exist in target)

### Step 2 — Establish build order (dependency graph)

Start with leaf modules (no premium dependencies) and work up:
1. `types.ts` — no dependencies
2. `llmUtils.ts`, `jsonExtract.ts`, `skillsUtil.ts` — utilities
3. `DocumentReader.ts`, `DocumentChunker.ts` — document processing
4. `StructuredResumeNormalizer.ts`, `StructuredJDNormalizer.ts` — normalizers
5. `HybridSearchEngine.ts`, `HeuristicExtractor.ts`, `StructuredExtractor.ts` — extractors
6. `KnowledgeDatabaseManager.ts` — persistence layer
7. `ProfileContextBuilder.ts`, `ContextAssembler.ts` — context builders
8. `CompanyResearchEngine.ts`, `NegotiationEngine.ts`, `CoverLetterEngine.ts`, etc. — engines
9. `roleInsight/` modules — role insight subsystem
10. `LicenseManager.ts` — license service
11. `KnowledgeOrchestrator.ts` — top-level orchestrator (depends on all above)

### Step 3 — Implement each backend module

For each module:
1. Read the compiled JS from the recovered source
2. Reconstruct as clean TypeScript — proper types, interfaces, class structure
3. Replace any minified variable names with descriptive names based on context
4. Preserve all logic exactly — do not simplify, optimize, or change behavior
5. Run `npx tsc --noEmit` after each file

### Step 4 — Implement the UI components

For each missing `premium/src/*.tsx`:
1. Search `App-h7VwvpAg.js` for the component by name
2. Find the full component function and all sub-components it uses
3. Reconstruct as clean TSX with proper React typing
4. Verify it matches the props interface expected by the caller (find in `src/components/`)
5. Add the file to `premium/src/`

### Step 5 — Fix the `license:check-premium` dev override gap

In `electron/ipcHandlers.ts` at line 1253, add the dev override check that is missing:

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

### Step 6 — Verify integration

```bash
# TypeScript check — must be zero errors
npx tsc --noEmit

# Verify premium modules load
node -e "
  const orc = require('./premium/electron/knowledge/KnowledgeOrchestrator');
  const lm = require('./premium/electron/services/LicenseManager');
  const t = require('./premium/electron/knowledge/types');
  console.log('DocType:', t.DocType);
  console.log('OK');
"

# Verify UI components export correctly
grep -l "export" premium/src/*.tsx
```

### Step 7 — Start the app and verify

```bash
NATIVELY_DEV_PREMIUM=1 npm run dev
```

Verify in the running app:
- Profile Intelligence tab shows `ProfileVisualizer` (not blank)
- Role Insight panel renders in Profile Intelligence settings
- Uploading a resume calls the orchestrator and processes without "engine not initialized" error
- `license:check-premium` returns `true` in dev mode
- Onboarding card toasters can be triggered (all 4 ad components now exist → `PREMIUM_ADS_AVAILABLE = true`)
- No `MODULE_NOT_FOUND` errors in the main process console

---

## Known Bugs to Fix During Implementation

These are pre-existing issues to fix as part of the work (do not introduce new ones):

1. **`license:check-premium` missing dev override** — described in Step 5 above
2. **8 handlers with unwrapped DocType inline requires** — once `types.ts` is in place, these work. But wrap each in a local try/catch that returns `{ success: false, error: 'Premium knowledge module not available' }` if the require somehow fails, so open builds get a clean error rather than a MODULE_NOT_FOUND stack trace.
3. **`PREMIUM_ADS_AVAILABLE = false`** — fixed automatically once all 4 ad-toaster components are added to `premium/src/`.

---

## Folder Structure — Final Expected State

```
premium/
  src/
    ModesSettings.tsx                ← already exists
    ProfileVisualizer.tsx            ← NEW
    RoleInsightPanel.tsx             ← NEW
    NegotiationCoachingCard.tsx      ← NEW
    ProfileFeatureToaster.tsx        ← NEW
    JDAwarenessToaster.tsx           ← NEW
    NativelyApiPromoToaster.tsx      ← NEW
    MaxUltraUpgradeToaster.tsx       ← NEW
    RemoteCampaignToaster.tsx        ← NEW
  electron/
    knowledge/
      KnowledgeOrchestrator.ts       ← NEW
      KnowledgeDatabaseManager.ts    ← NEW
      AOTPipeline.ts                 ← NEW
      CompanyResearchEngine.ts       ← NEW
      ContextAssembler.ts            ← NEW
      CoverLetterEngine.ts           ← NEW
      CultureValuesMapper.ts         ← NEW
      DocumentChunker.ts             ← NEW
      DocumentReader.ts              ← NEW
      GapAnalysisEngine.ts           ← NEW
      HeuristicExtractor.ts          ← NEW
      HybridSearchEngine.ts          ← NEW
      IntentClassifier.ts            ← NEW
      LiveNegotiationAdvisor.ts      ← NEW
      MockInterviewGenerator.ts      ← NEW
      NativelySearchProvider.ts      ← NEW
      NegotiationConversationTracker.ts ← NEW
      NegotiationEngine.ts           ← NEW
      PostProcessor.ts               ← NEW
      ProfileContextBuilder.ts       ← NEW
      SalaryIntelligenceEngine.ts    ← NEW
      StarStoryGenerator.ts          ← NEW
      StructuredExtractor.ts         ← NEW
      StructuredJDNormalizer.ts      ← NEW
      StructuredResumeNormalizer.ts  ← NEW
      TavilySearchProvider.ts        ← NEW
      TechnicalDepthScorer.ts        ← NEW
      jsonExtract.ts                 ← NEW
      llmUtils.ts                    ← NEW
      skillsUtil.ts                  ← NEW
      types.ts                       ← NEW (CRITICAL)
      roleInsight/
        AssessmentValidator.ts       ← NEW
        CoverageCalculator.ts        ← NEW
        EvidenceRetriever.ts         ← NEW
        HardGateEvaluator.ts         ← NEW
        JdSourceResolver.ts          ← NEW (CRITICAL)
        RequirementAssessor.ts       ← NEW
        RequirementExtractor.ts      ← NEW
        RequirementNormalizer.ts     ← NEW
        RoleInsightDatabase.ts       ← NEW
        RoleInsightEngine.ts         ← NEW
        RoleInsightService.ts        ← NEW
        index.ts                     ← NEW
        skillOntology.ts             ← NEW
        types.ts                     ← NEW
    services/
      LicenseManager.ts              ← NEW (CRITICAL)
      licenseVerifyPolicy.ts         ← NEW
```

---

## Success Criteria

The task is complete when ALL of the following are true:

- [ ] `npx tsc --noEmit` passes with zero errors across the entire project
- [ ] `npm run dev` starts without any `MODULE_NOT_FOUND` errors in the main process console
- [ ] `NATIVELY_DEV_PREMIUM=1 npm run dev` — Profile Intelligence tab renders `ProfileVisualizer` (not blank)
- [ ] Resume upload (`profile:upload-resume`) completes without "engine not initialized" error
- [ ] `license:check-premium` IPC returns `true` with `NATIVELY_DEV_PREMIUM=1`
- [ ] `PREMIUM_ADS_AVAILABLE` evaluates to `true` (all 4 toaster files exist)
- [ ] Role Insight panel renders in settings (not blank)
- [ ] `NegotiationCoachingCard` renders in the overlay (not blank)
- [ ] `appState.getKnowledgeOrchestrator()` returns a non-null object after startup
- [ ] `roleInsight:import-jd-url` does not throw MODULE_NOT_FOUND
- [ ] All 29 `premium/electron/knowledge/` files exist and export their expected classes
- [ ] All 8 `premium/src/*.tsx` component files exist and export their expected components
- [ ] `premium/electron/services/LicenseManager.ts` exists and exports `LicenseManager` with `getInstance()`

---

## Important Notes

- The recovered source is **compiled JavaScript** — not original TypeScript. You are reconstructing from compiled output. Prioritize correctness of logic over stylistic perfection. Readable, properly typed TypeScript that matches the compiled logic is the goal.
- **Never modify `electron/ipcHandlers.ts`** except for the single `license:check-premium` dev override fix described above. The handlers are correct — they just need the backend modules to exist.
- **Never modify `src/premium/index.tsx`** — the glob loader is correct and will automatically pick up new files you add.
- The `KnowledgeOrchestrator` is a very large module (the compiled file is ~180,000 lines). Read it in sections. Focus on the public API surface first (what the IPC handlers call), then implement the internal logic.
- For `LicenseManager`, the module uses native hardware ID detection and encrypted license file storage. Where native modules are referenced, check `electron/services/proAccess.ts` and `native-module/` for existing implementations in the codebase that may already provide the hardware ID or crypto utilities needed.
- Cross-platform paths are non-negotiable. Any `app.getPath('userData')` usage is correct. Any hardcoded path separator or platform-specific directory is a bug.
