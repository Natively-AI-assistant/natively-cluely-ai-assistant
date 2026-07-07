    # Changelog

    ## [Unreleased]

    ### What's New

    - **JD / Resume JIT pipeline — job-description questions now reach the prompt**: Fixes the class of failures where a question about the *target role* ("what does this role require?", "what are the top skills for this JD?", "does the JD mention salary?") silently dropped the job-description before any prompt was built, so the model answered blind or said it "didn't have the JD". The active JD was always stored, structured, and fresh — the answer classifier simply never routed it. Six new **JD-source answer shapes** are added to `AnswerPlanner`: JD-only (`jd_summary_answer`, `jd_requirements_answer`, `jd_fact_answer`, source-owner `profile_jd`, `jd` layer primary) and resume+JD (`resume_jd_fit_answer`, `resume_jd_gap_answer`, `resume_jd_intro_answer`, source-owner `mixed`, both `resume`+`jd` layers). Routing is driven by a conservative `resolveJdSourceType` resolver placed *early* in the classify chain (before the negotiation/identity/skills/unknown branches that used to swallow these), keyed off **generalized shape cues** — a JD-reference cue (this JD / the role / job description / they require) versus a first-person candidate cue (my / I / should I) — never off any specific JD title, company, project name, or benchmark string. It defers to the proven `JD_FIT_PATTERNS` / `GAP_PATTERNS` branches wherever they already route resume+jd, so only genuinely missed or mis-routed shapes are claimed. Concretely: "tell me about yourself **for this role**" / "walk me through my resume **with this JD in mind**" stop collapsing to `identity_answer` (which forbade jd); "how would you explain your **lack of experience** in the JD requirements" stops collapsing to `technical_concept_answer`; "most relevant **project/internship for this JD**" stops dropping the jd layer; "skills **required for this role**" stops forbidding jd.

    - **Full source-tagged JD evidence in the JIT prompt**: `selectManualProfileEvidence` now emits the *whole* structured JD — requirements, responsibilities, technologies, keywords, nice-to-haves, level, employment type, min-years, summary (source-tagged `profile_jd`, capped) — not just title/company. `ProfileJitPromptBuilder` renders JD and resume evidence in **separate labelled blocks** (`<target_job_evidence>` / `<candidate_resume_evidence>`) with an explicit `<source_separation_rules>` block: a JD requirement may never be presented as the candidate's claimed experience, and a JD requirement the resume doesn't show is a *gap*, never fabricated. JD-fact questions with an absent field (salary/relocation) answer honestly — "the JD does not specify that" — and never ask the user to upload a JD that is already loaded, and never pivot to salary negotiation unless the user explicitly asks how to negotiate.

    - **Honest evidence diagnostics ("layers selected" ≠ "evidence present")**: The misleading `structured_jd_used = Boolean(jd) && layers.includes('jd')` is replaced by `jdEvidenceCount > 0`, measured from the source-tagged `EvidenceItem`s that actually rendered into the prompt. A new per-answer diagnostic object carries `activeJDId/Hash`, `activeResumeId/Hash`, `jdEvidenceCount`, `resumeEvidenceCount`, `hasProfileJDBlock`, `renderedEvidenceSourceTypes`, `exactQuestionIncluded`, `finalGenerationMode`, and `providerActuallyDispatched`. A new canonical `electron/llm/ActiveProfileContext.ts` read-model supplies the provenance (sourceId + content hash) so a JD question can be reconciled end-to-end.

    - **Full-JIT law enforced — AOT prepares evidence, the provider writes every answer**: New `jitFinalAnswerEnforced` feature flag (default ON). The AOT-precomputed intro/identity string is no longer emitted verbatim as the final answer at either `LLMHelper` site (streaming + non-streaming) or via the legacy deterministic profile fast-path in `ipcHandlers`; it is demoted to a `<candidate_identity_fact>` evidence block and the provider generates the user-visible answer just-in-time. The AOT precompute is retained for latency; only the verbatim emit is removed. Bare social greetings ("hi") keep their instant canned reply (a new `isBareGreeting` flag on `PromptAssemblyResult` distinguishes them from factual intros). Flip the flag OFF to restore the legacy fast paths instantly.

    - **Prior-answer contamination containment**: On the manual, non-document-grounded path, candidate/JD answers now wrap the rolling snapshot's prior assistant turns in `<previous_responses trust="low" authority="non_authoritative" purpose="conversation_continuity_only">` so an earlier wrong answer can never re-enter the next prompt as JD/resume evidence — a clean transcript is untouched, and document-grounded strip behavior is unchanged.

    - **Tests & docs**: `electron/llm/__tests__/JdResumeJitPipeline2026_07_07.test.mjs` (37 tests across JD routing, JD evidence, honest absence, resume+JD, resume-only regression, coding regression, telemetry honesty, and an anti-hardcoding mutation block that renames the JD title/technologies, removes salary, renames projects/companies, and paraphrases every question — behavior must hold with zero code change) and `ActiveProfileContext2026_07_07.test.mjs` (6). Read-only verifiers `tools/jd-resume-jit-investigation/verify-jd-{routing,evidence}.mjs` (26/26 + 6/6) drive the real compiled pipeline. Core routing/evidence/policy regression suites stay green (261/261). Full write-up in `docs/JD_RESUME_JIT_IMPLEMENTATION_REPORT.md`; policy in `docs/PROFILE_INTELLIGENCE_FULL_JIT_POLICY.md` gains the "JD as target-role source" and "evidence is proof, layers are not" sections.

    - **Skill deletion in Settings → Skills**: User-installed skills (e.g. `code-simplifier`) now have a per-row delete control — hover-reveal Trash2 icon (also revealed on keyboard focus, with a `[@media(hover:none)]:opacity-100` touch-device fallback that always shows the button on non-hover hardware). The hover-reveal animation matches the meeting-notes action-bar idiom at `MeetingDetails.tsx:696` (subtle `translate-y` slide-up + 160 ms `ease-out` reveal) — both consumers share the same animation contract so users see one consistent reveal pattern across settings panels. First click on the trash enters an inline 2-step confirm row (Cancel + red Delete) with Escape-key dismissal, 6-second auto-cancel, and `aria-live="polite"` for screen readers — replacing the original `window.confirm()` system dialog after a senior-review UX audit. Per-skill in-flight tracking via `deletingIds: Set<string>` prevents double-click races. The delete is TOCTOU-safe: `SkillsManager.deleteSkill()` calls `fs.realpathSync` on both the target and `skillsDir` at delete-time, then `fs.rmSync({recursive:true,force:true})` — meaning a symlink-swap between the initial `loadSkills()` read and the delete is closed by the realpath containment check. Sanitized error messages ("Could not delete skill.") — no internal-implementation detail leaks to the renderer banner. Built-in skills (e.g. `humanize-ai-text`) are protected at three layers and have no delete affordance rendered: (1) `skill.source !== 'builtin'` UI gate, (2) `SkillsManager.deleteSkill()` refuses with a clear error if a direct IPC call slips through, (3) `ensureBuiltinSkills()` would silently re-seed the folder anyway. (`76d531b`, `b1e4fc6`, `3950df8` — 1 file, +56/-112 net for the final shape.) See the **Code Review Fixes (2026-07-06)** section below for the senior review findings and the cumulative UX fixes that shaped this.

    - **LiteLLM AI Gateway**: Added LiteLLM as a built-in provider, giving access to 100+ LLM providers (AWS Bedrock, Google Vertex AI, Azure, Cohere, and more) through a single OpenAI-compatible proxy. Configure the proxy URL and optional virtual key under Settings → AI Providers → LiteLLM Proxy; models are auto-discovered from the proxy and listed with a `litellm/` prefix. Max output tokens default to **Auto** — each model's real output budget is read from the proxy's `/model/info` registry (fallback 8,192) — with a manual dropdown override (4K–1M). Routes through the same data-scope gating, rate-limiting, and abort-aware streaming as every other cloud provider.

    - **Native-module architecture guard (four layers)**: Closes the recurring Rosetta-poisoning bug where `better-sqlite3` / `keytar` `.node` binaries got built for `x86_64` on Apple Silicon Macs (silent `ERR_DLOPEN_FAILED` → "Local database is DISABLED" at startup). Layer 1: shared `electron/lib/nativeArch.{mjs,cjs}` — single source of truth, hardware-arch via `sysctl hw.optional.arm64` (Rosetta-immune). Layer 2: boot-time gate in `electron/nativeArchGate.ts` — module-load-time synchronous check that throws BEFORE any `init_DatabaseManager()` call, so the failure can no longer happen silently; uncaughtException handler renders a native modal dialog with the platform-correct one-line fix and exits 1. Layer 3: `patches/better-sqlite3+12.11.1.patch` + `patches/keytar+7.9.0.patch` — `patch-package` `preinstall` injection so even `npm rebuild <pkg>` / `npm install <pkg>` flows are guarded (re-applies automatically via the postinstall chain). Layer 4: `.husky/pre-commit` runs `verify-native-arch.js` on every commit (chained with the legacy `react-doctor` + `code-review-graph` hooks, which husky 9 had silently bypassed via `core.hooksPath`); CI gains a `Verify native module architecture` step. Drift guard: `electron/lib/__tests__/nativeArchParity.test.mjs` asserts the cjs/esm shims stay byte-equivalent (caught a real drift on first run). User-facing fix command: `arch -arm64 npm run rebuild:native`. (`15a3838` — 13 files, +973/-81.)

    ### Production launch hardening (2026-07-07) — "stuck at logo" on first start

    Fixes for a production-only failure where new users were stuck on the black launch logo / a "Setting up AI memory… 0%" pill on first start, while dev and the developer's own machine worked. Root-caused from five clean reinstall boot-logs. Dev never reproduced it (no asar; the developer already had Ollama models + a warm ONNX runtime).

    - **ONNX runtime peers were sealed inside the asar** (`package.json` `asarUnpack`). The prior fix unpacked `@huggingface/transformers/**`, but its bare-specifier peer dependencies — `onnxruntime-common`, `onnxruntime-node`, `onnxruntime-web`, and `@huggingface/jinja` — are **hoisted to top-level `node_modules`**, so they stayed packed inside `app.asar` while transformers ran from `app.asar.unpacked`. Node's ESM resolver couldn't cross the boundary, producing the every-boot `Cannot find package 'onnxruntime-common' imported from app.asar.unpacked/.../transformers.node.mjs` and breaking **every** on-device model in production (intent classifier, local embedder, Whisper, reranker). Added the full peer closure to `asarUnpack`. `electron-builder.signed.cjs` inherits it via `{ ...base }`.

    - **Preloaded Model-Selector window `kill -9`'d a healthy Ollama on every boot** (`src/components/ModelSelectorWindow.tsx`). The hidden model-selector preload called `getAvailableOllamaModels()`, and on an empty list ran `forceRestartOllama()` — but an empty list is *also* the state of a perfectly healthy daemon with zero models pulled. New users with Ollama installed but no models had their daemon killed on every launch, which aborted the background `nomic-embed-text` embedding pull mid-stream (`[OllamaBootstrap] Pull failed: terminated`) and left the "Setting up AI memory" pill stuck at 0%. Now gated behind a new `is-ollama-reachable` IPC (`LLMHelper.isOllamaReachable()`, a 1.5 s `/api/tags` liveness probe) so a restart only fires when the daemon is genuinely unreachable — an older preload lacking the method degrades safely to never-restart.

    - **`forceRestartOllama` is now non-destructive for user-managed daemons** (`electron/LLMHelper.ts`, `electron/services/OllamaManager.ts`). Even if some other path calls it, it no longer `kill -9`s a reachable daemon the app didn't spawn: it checks `isOllamaReachable()` + the new `OllamaManager.getIsAppManaged()` and skips the destructive path for a reachable, user-managed Ollama.

    - **Ollama embeddings bootstrap is skipped when a cloud provider is configured** (`electron/main.ts` `bootstrapOllamaEmbeddings`). Pulling the 274 MB `nomic-embed-text` on first launch is pure waste for users with an OpenAI/Gemini key (the RAG pipeline resolves to that cloud provider anyway) and was the thing racing the `kill -9`. Plus an in-memory single-flight guard in `OllamaBootstrap` (a `static inFlight` Set, deliberately **not** persisted so a session killed mid-pull still retries next launch) prevents concurrent pulls; the guard release is inside the `try/finally` so a pre-pull DB error can't wedge it permanently.

    - **Splash can never trap the user** (`src/components/StartupSequence.tsx`). Added a 5 s hard-cap fallback alongside the primary 2.2 s dismiss so the launcher is always revealed even if the primary completion is ever prevented.

    - **Renderer diagnostics now reach the log file** (`electron/WindowHelper.ts`, `src/main.tsx`). The main process logged everything but the renderer logged nothing to `~/Documents/natively_debug.log` — which is exactly why the first three "stuck at logo" logs were silent about the renderer. Added `WindowHelper.attachRendererDiagnostics(win, tag)` (launcher + overlay) capturing `console-message` (warn+error), `render-process-gone` (crash + reason/exitCode), `unresponsive`/`responsive` (hang = "stuck at logo"), `did-finish-load`/`dom-ready` (bundle-evaluated proof), and `preload-error`; plus `src/main.tsx` global `error`/`unhandledrejection` handlers, a `[renderer] main.tsx evaluating` marker, and a try/catch around React mount with a `#root not found` fatal log. A future crash or hang on a user's machine now leaves a precise trace.

    ### Improvements & Fixes

    - **Close Settings on outside click + Escape, matching Modes/Profile**: `SettingsOverlay` now closes when you click the dimmed area around the card, mirroring the `e.target === e.currentTarget` backdrop pattern that Modes Manager and Profile Intelligence already used (App.tsx:774/807). Pressing **Escape** closes whichever of the three center overlays is open (top-most-wins order: Settings > Modes > Profile) via a shared listener in App.tsx, plus an internal listener inside `SettingsOverlay` and `ProfileIntelligenceSettings` for consistency. The opacity-slider preview is guarded both with a JS early-return and `pointer-events: none` on the backdrop so dragging the slider can never dismiss Settings mid-drag. (`2299895` — 3 files, +121/-9.)

    - **Prompt caching for Claude Opus 4.8**: `getClaudeCacheMinChars` now matches the whole `claude-opus-4-` family instead of enumerating point releases, so `claude-opus-4-8` uses the correct 4,096-token (16,384-char) cache minimum. It previously fell through to the generic 1,024-token floor, which silently disabled prompt caching for prompts between those two sizes.

    - **Custom Provider (OpenRouter + any cURL gateway) reachable on the typed-chat and voice-Answer paths**: Fixed a regression where the live typed-chat and voice "Answer" cascade silently bypassed the user's configured Custom Provider. The chain now consults `configuredCustomProviders` (preserved across model selections in `setModel`) as a last-resort rung before the "No AI provider configured" throw, and also adds it as a fallback rung in the Natively TTFT race so it can win under the 2.5 s first-token budget. Previously, selecting any non-custom model (e.g. Gemini) caused `setModel` to null out `this.customProvider`, leaving a paid OpenRouter key unused even when every other cloud key was exhausted — the chain only consulted `streamChatWithGemini`'s offline-RAG path, which is never reached from the user's typed-chat or voice path. Both rungs are gated on `!isLocalOnlyMode` and `!(isMultimodal && imagePaths)` so local-only mode and image-bearing requests are unchanged.

    - **DeepSeek 402 Insufficient Balance no longer retries 4–5× per chat**: `streamWithDeepseek` now catches permanent key/billing errors via the existing `isPermanentKeyError` classifier and flips a per-session `deepseekPermanentlyDead` breaker so the chain stops re-attempting the dead endpoint across rotations. The flag resets on either branch of `setDeepseekApiKey` (empty wipe + new key). A one-shot `deepseekSkipWarned` flag suppresses the "permanently disabled" log line so it doesn't spam every chat after the trip.

    - **Tests**: Added `electron/services/__tests__/CustomProviderFallback2026_07_05.test.mjs` with 10 regression tests covering the new fallback chain (`setModel` preservation, picker logic for cloud/custom/empty-curlCommand/no-config cases, DeepSeek 402 breaker, both `setDeepseekApiKey` reset branches, and the `isLocalOnlyMode` gate).

    ### Bug Fixes (2026-07-06 dev-loop hardening)

Five real bugs the user hit in one working session (live logs from `~/Library/Application Support/natively/logs`), plus a final pre-flight fix uncovered when verifying the dev-loop closed cleanly. All fixes carry regression tests; typecheck + the touched test suites are green. Net: every "not working / not indexing / responses failing" symptom from the original 2026-07-05 report is now closed end-to-end.

#### Critical

- **`processResponse` substring filter was throwing on real answers** (`electron/LLMHelper.ts:1202`). `processResponse` matched `I'm not sure` / `It depends` / `I can't answer` / `I don't know` as **substrings**, so any honest, useful answer merely *containing* one of those phrases (e.g. `"I don't know his exact title, but he's on the platform team"`) was thrown away — silently killing every `tryGenerateResponse` and `generateSummary` fallback chain, surfacing the "Filtered fallback response" error and producing 76-character canned replies. Tightened to an exact match on the entire trimmed/punctuation-stripped response via a new module-scope `isCannedFallbackPhrase()` helper. `SessionTracker.addAssistantMessage` (the same shape of bug, `electron/SessionTracker.ts:276`) got the identical exact-match fix using a local copy of the helper to avoid a cross-module import for one function. Without both fixes, every "honest partial answer" and every "session memory recall" was being silently lost. New regression: `electron/llm/__tests__/CannedFallbackPhraseFilter2026_07_05.test.mjs` (6/6 passing).

- **`@huggingface/transformers` not in `asarUnpack`, breaking IntentClassifier at runtime** (`package.json`). The four ONNX-worker `.js` files (`whisperWorker.js`, `intentClassifierWorker.js`, `localEmbeddingWorker.js`, `localRerankerWorker.js`) are already asar-unpacked, but `node_modules/@huggingface/transformers` itself wasn't — so a dynamic `import()` from an unpacked file couldn't reach back into the packed `node_modules`, producing the user's intermittent `[IntentClassifier] Failed to load zero-shot worker model: Cannot find package '@huggingface/transformers'` error. The naive "add to esbuild externals" fix is a no-op because the import is hidden inside `new Function('return import("@huggingface/transformers")')` specifically to dodge esbuild's static analysis (see `electron/audio/whisper/whisperWorker.ts:11-15` for the rationale). The correct fix is to unpack the package's `node_modules` directory alongside the worker scripts. Added `"**/node_modules/@huggingface/transformers/**"` to `package.json` asarUnpack. New regression assertion: `electron/rag/__tests__/OnnxWorkerIsolationHardening2026_07_05.test.mjs:286-298` (14/14 suite passing).

- **`set-gemini-api-key` / `set-openai-api-key` never told the embedder, so reference files stayed `lexical_only` until app restart** (`electron/ipcHandlers.ts:3580, 3644`). Both handlers updated the LLMHelper for chat but never called `ragManager.initializeEmbeddings(...)` after the key changed — only `ProcessingHelper.loadStoredCredentials` (boot) and `AppState.bootstrapOllamaEmbeddings` (Ollama-pull completion) ever did. A key entered live via the Settings UI never reached the embedder, so ModeHybridRetriever kept logging `[ModeHybridRetriever] Embedding provider unavailable, using lexical fallback` for the rest of the session. Mirrors the existing `AppState.bootstrapOllamaEmbeddings` pattern at `electron/main.ts:1176-1182`: after saving the key, also call `ragManager.initializeEmbeddings({...})` and `appState.scheduleModeReferenceIndexRetry()`, gated on `keyChanged` to avoid redundant work on re-saves. New regression: `electron/services/__tests__/ApiKeySetterEmbeddingRetry2026_07_05.test.mjs` (3/3 passing, plus explicit "Groq is not an embedding provider" test so reviewers don't add a needless re-init there).

#### High

- **`ModeContextRetriever.ensureHybridRetriever` was constructing a doomed retriever on a cold-start race** (`electron/services/ModeContextRetriever.ts:1513`). Whenever a query raced ahead of `AppState.initializeRAGManager()` (or that init threw), the previous code path constructed a brand-new `new EmbeddingPipeline(db, vectorStore)` with `provider === null` and cached it as `_hybridRetriever`. Nothing in the cached retriever was ever initialized, so `ModeHybridRetriever.isEmbeddingAvailable()` returned `false` forever for that one instance — `setSharedEmbeddingPipeline()`'s cache-invalidation only helps if it is ever called at all; if `RAGManager` init failed it never is. Fix: return `null` (and touch no DB) whenever `_sharedEmbeddingPipeline` is null, letting callers take their existing lexical-fallback path and try again cheaply on the next call. The `setSharedEmbeddingPipeline()` setter's null-out of `_hybridRetriever` is preserved as the "RAGManager did init, real pipeline is available" case. New regression: `electron/services/__tests__/ModeContextRetrieverPipelineRace2026_07_05.test.mjs` (4/4 passing).

- **`EmbeddingPipeline.isReady()` returned `true` during the local provider's cold-load window** (`electron/rag/EmbeddingPipeline.ts:159`). `LocalEmbeddingProvider` is assigned to `this.provider` the instant `_doInitialize()` resolves it (the constructor is cheap — no worker spawn, no ONNX load), but the actual model load happens lazily inside `ensureLoaded()` and can take up to 60 s cold. `isReady()` previously only checked `provider !== null`, so it reported `true` during that whole cold-start window. `ModeHybridRetriever.isEmbeddingAvailable()` gates on this synchronously inside a live per-query retrieval budget — during the cold window it took the hybrid branch and then stalled up to 60 s on `getEmbeddingForQuery()`. Fix: added an optional synchronous `isLoaded?(): boolean` to `IEmbeddingProvider` (only `LocalEmbeddingProvider` implements it, returning its real `loaded` field). `EmbeddingPipeline.isReady()` now reads `provider.isLoaded?.() ?? true` — cloud HTTP providers (Gemini/OpenAI/Ollama) have no warm-up state, so the `?? true` default preserves their existing behavior exactly. New regression: `electron/rag/__tests__/EmbeddingPipelineIsReadyColdStart2026_07_05.test.mjs` (3/3 passing — covers cold→warm→cold-again transition AND the no-regression cloud-provider case).

#### Dev-loop fix

- **`npm start` (→ `app:dev` → `electron:dev`) couldn't find `dist-electron/electron/main.js`** (`package.json`). The `build` script ran `clean && tsc && vite build` — the renderer build only — so after `clean` wiped `dist-electron/` nothing ever re-created it. `electron:dev` called `npm run build && electron .`, found nothing under `dist-electron/electron/`, and exited with the user's `"Cannot find module .../dist-electron/electron/main.js"` error. Fix: `electron:dev` is now `npm run build && npm run build:electron && cross-env NODE_ENV=development electron .` — `build:electron` runs AFTER `build`'s `clean` step (otherwise `clean` would wipe the just-built electron bundle). Matches the `electron:build` pattern already in use.

- **Dev Electron.app shows 3 Dock icons on `npm start`** (`scripts/patch-electron-plist.js` + `package.json:14` postinstall). Three icons appear because (1) the stock dev `node_modules/electron/dist/Electron.app/Contents/Info.plist` has no `LSUIElement=1` (macOS paints a generic "Electron" tile at process-spawn, before any JS runs), (2) `main.ts:5957-5958 applyInitialDisguise()` triggers a LaunchServices re-register that paints a "Natively" tile, (3) `main.ts:6098-6100 setActivationPolicy('regular')` after `createWindow()` promotes a third visible tile. The in-code fix (`accessory` clamp before rename, `regular` promotion after `createWindow()`, both in `e5edd87`) is correct but cannot prevent the OS from painting the spawn-time tile. The `patch-electron-plist.js` postinstall patch that injects `LSUIElement=1` was never run on this machine. The fix: run `node scripts/patch-electron-plist.js` once, which writes `LSUIElement=1` into the dev `Info.plist`. With that in place, dev launches show exactly one "Natively" tile (matching the prod signed-build behavior). If LaunchServices has cached a stale identity, the canonical macOS follow-up is `lsregister -f -R .../Electron.app`.

#### Out of scope after investigation (deliberately NOT changed)

- **`WhatToAnswerLLM` reference-files "ScopeFallback" / "Ollama unavailable, omitting from context"` was a deliberate privacy safeguard, not a bug.** Cross-verified against `electron/llm/ProviderRouter.ts:5-6` (type), `src/components/settings/AIProvidersSettings.tsx:1665-1704` (UI — "Cloud provider data scopes — fail-closed cloud share controls"), and the same exact pattern repeated verbatim in `MeetingPersistence.ts:265` for `post_call_summary`. A reference-file payload reaches the cloud embedding provider whenever a cloud embedder is active; routing around the Ollama-availability check when a cloud embedder is reachable would silently violate a user's explicit "don't send my reference files to the cloud" opt-out. Documented in this changelog as out-of-scope after the original "fix" was reverted, so future readers don't re-propose the same misdiagnosis.

### Seminar-mode (document-grounded) RAG hardening (2026-07-06)

Architecture-discovery pass followed by the top-5 fixes on the `hardening/v2.7.0` branch, addressing the recurring failure mode where seminar/custom-mode questions (e.g. "What are the two research questions?", "What GPU was used for training?", "What is a Vision-Language-Action model?", "What was the total cost of building the teleoperation system?") answered from the abstract / methodology / teleoperation section instead of the dedicated answer section. Root cause: the doc-grounded `lecture_answer` path was chunk-only with no OKF-card augmentation on the WTA path, no entity-anchor on the lexical rescue, no question-shape routing to `definitional_answer` / `list_answer` / `exact_numeric_answer` / `document_absent_fact_refusal`, and several production flag defaults at OFF (OKF, cross-encoder rerank, graph expansion, confidence gate). Five reports produced under `docs/` (`AI_ARCHITECTURE_MAP.md`, `SEMINAR_MODE_REQUEST_FLOW.md`, `RETRIEVAL_SYSTEMS_COMPARISON.md`, `FAILURE_ANALYSIS_BEFORE_FIX.md`, `FIX_PLAN_AFTER_ARCHITECTURE_REVIEW.md`); the 5 flag flips and 4 of the 5 plan fixes are now in code. Typecheck clean (no new errors vs HEAD). Functional test of `classifyDocumentQuestionShape` on the 6 benchmark questions confirms the expected AnswerType for each (Q1/Q3/Q4 → `list_answer`; Q2 → `definitional_answer`; Q5 → `exact_numeric_answer`; Q6 → `document_absent_fact_refusal`).

#### Production flag flips — always ON

Five `electron/intelligence/intelligenceFlags.ts` defaults flipped from `false` / `isInternalDevTestContext()` to `true` per user directive. SettingsManager overrides and `NATIVELY_*` env overrides still take precedence — these only change the default when neither is set. (5 files + 2 collateral, +20/-13.)

- `ragConfidenceGate` (`electron/intelligence/intelligenceFlags.ts:208`). Default OFF → ON. Emits the `confidence` field on every `ModeRetrievedContext` so downstream consumers (local rerank escalation, debug IPC) have a real signal.
- `ragLocalRerank` (`:211`). Default OFF → ON. bge-reranker-base cross-encoder re-orders the top-30 candidates on manual/follow-up queries whose confidence gate trips. Prewarmed at mode activation so cold-load cost doesn't gate TTFT.
- `ragSpeculativeRerank` (`:217`). Default OFF → ON. Extends the same rerank escalation to the LIVE WTA path inside the existing `raceWithBudget(1500ms)` envelope. Falls through to lexical on overrun.
- `okfHybridRetrieval` (`:224`). Default `isInternalDevTestContext()` (OFF in production) → ON. OKF Knowledge Cards augment retrieval; **synthesis-question types (`research_questions`, `objectives`, `main_topic`, `summary`, `problem_statement`, `conclusion`) return ALL cards in document order** — the dominant recovery lever for Q1 and Q3.
- `okfGraphExpansion` (`:227`). Default OFF → ON. Entity/relation BFS over OKF packs (depth ≤2) appends graph hints after cards. Provides related-concept disambiguation for definitional questions (Q2).

Collateral flips (same `isInternalDevTestContext()` pattern, flipped for consistency): `okfKnowledgePacks` (`:221`), `okfMarkdownExport` (`:222`).

Side effect: `docGroundedFalseRefusalRepair` is no longer inert. That flag (already default ON) was previously gated on `okfHybridRetrieval` for the `hasEntityEvidence` derivation that powers the false-refusal gate. With OKF ON, the false-refusal repair can now fire when the model says "I could not find that" despite strong retrieved evidence.

Not flipped: `ragRrfFusion` (no live consumer wired), all profile-side flags (`okfProfilePacks` / `okfProfileHybridRetrieval` / etc.), `hindsightMemory` / `hindsightLiveRecall`, `promptAssemblerV2` (shadow only), Profile Intelligence / Profile Graph wiring (gated by code, not flags).

#### Fix 1b — WTA path consumes OKF cards (`electron/services/ModesManager.ts`, `electron/llm/WhatToAnswerLLM.ts`)

Added `ModesManager.buildOkfAugmentedContextBlock(modeContextBlock, query, pinnedModeId?)` (~60 LOC) — mirrors the manual-path OKF block at `LLMHelper.ts:4640-4704`. Calls `queryOkfCards` per file (with `QuestionClassifier.classifyQuestion`), sorts scored cards across files, takes top-6, formats via `formatCardsForPrompt`, optionally appends graph hints via `GraphRetriever.expandGraph`, then prepends ahead of raw chunks via `buildOkfEvidenceBlock`. Returns `modeContextBlock` unchanged when the flag is off, when there are no reference files, or when no pack has cards yet (additive, never destructive). Threaded through the `ModesManagerType` type in `WhatToAnswerLLM.ts` and called at line ~333 right after the chunk retrieval. Guarded by `forceDocumentGrounding` and `typeof modesManager.buildOkfAugmentedContextBlock === 'function'` (backward compatible with older module shapes). Closes the synthesis-question gap on the WTA path; Q1, Q3, Q4 benefit on the manual path AND the WTA path.

#### Fix 2 — Identity-block suppression on entity queries (already in place, verified)

The fix-plan called for suppressing `<document_identity>` on entity-specific queries. Verified that both retrievers already gate identity on `isBroadDocumentQuery`: `electron/services/ModeContextRetriever.ts:849-850` and `electron/services/modes/ModeHybridRetriever.ts:1105`. The `classifyDocumentQuestionShape` heuristic in `electron/llm/documentGroundedPrompt.ts:320-332` already returns `broad_overview` only for true broad questions ("what is this document about", "summarize", "overview", "main topic", "high-level", "gist"). All 6 benchmark questions have question shapes other than `broad_overview`, so identity is correctly suppressed. No code change needed.

#### Fix 3 — Entity-anchor guard on the lexical synonym rescue (`electron/services/ModeContextRetriever.ts:1189-1227`)

The synonym rescue admitted any chunk containing a generic section word ("abstract", "methodology", "phase", "stage"), which let the abstract chunk beat the precise answer chunk whenever the answer chunk happened to not contain the synonym. Added an entity-anchor gate: when the query has entity terms (extracted via the existing `extractHighSignalEntityTerms`), a synonym-rescued chunk must ALSO contain at least one entity term (lowercased, pure-numbers filtered out). When entity-anchor is active, the synonym-hint weight drops from 0.40 → 0.30 so the base score + entity match dominates. Falls through to the original behaviour for entity-less queries (broad/vague questions) so the existing rescue is preserved. The abstract chunk no longer wins over the precise answer chunk on Q2 ("What is a Vision-Language-Action model?"), Q4 ("What objects were used in the robotic tasks?"), and Q5 ("What GPU was used for training?").

#### Fix 4 — Question-shape classifier surgical fix (`electron/llm/documentGroundedPrompt.ts:320-345`)

The AnswerTypes `definitional_answer`, `list_answer`, `exact_numeric_answer`, `document_absent_fact_refusal`, and `document_followup_answer` already existed (AnswerPlanner.ts:29-33) and were already wired through `requiredLayersFor` (AnswerPlanner.ts:1513-1519), `formatAnswerPlanForPrompt` (AnswerPlanner.ts:1458-1467), and the doc-grounded `planAnswer` dispatch (AnswerPlanner.ts:2264-2273). The templates `DOCUMENT_DEFINITION_TEMPLATE`, `DOCUMENT_LIST_TEMPLATE`, `DOCUMENT_NUMERIC_TEMPLATE`, `DOCUMENT_ABSENT_FACT_TEMPLATE`, and `DOCUMENT_FOLLOWUP_TEMPLATE` already existed (AnswerPlanner.ts:333-337). `planAnswer` already called `classifyDocumentQuestionShape` and routed to the new types when `documentGroundedCustomModeActive`.

The only real defect was in `classifyDocumentQuestionShape`: the definitional regex had an over-aggressive negative lookahead that excluded "model", which mis-routed "What is a Vision-Language-Action model?" to `lecture_answer` instead of `definitional_answer`. Replaced the broken regex with a clean 3-flag check: `looksDefinitional && !looksLikeList && !looksLikeSpec`, where:
- `looksDefinitional` matches `^define|definition of|what does .+ mean|what is (?:a|an|the)? ...|what are (?:a|the)? ...$` (allows hyphens in the noun so "Vision-Language-Action" routes correctly; no `\b` at the end because `-` isn't a word char)
- `looksLikeList` matches explicit number words (`two|three|four|...|\d+`) or list markers (`list|which|state rq|all the`)
- `looksLikeSpec` matches numeric/size/value probes (`how many`, `what gpu|memory|rate|size`, `used for training|inference`, etc.)

Functional test on the 6 benchmark questions after the fix: Q1/Q3/Q4 → `list_answer`; Q2 → `definitional_answer` (was `lecture_answer`); Q5 → `exact_numeric_answer`; Q6 → `document_absent_fact_refusal`. Q2 now routes through `DOCUMENT_DEFINITION_TEMPLATE` and `requiredLayersFor` keeps `reference_files` required.

#### Source-isolation and WTA close-out (2026-07-06)

Follow-up commit `27ab03a` closes the high-risk gaps from the seminar-mode architecture review and hardens all document-grounded custom modes, not just the original seminar fixture.

- **Document-grounded WTA now validates and repairs answers instead of trusting the first generation.** `IntelligenceEngine` calls the document-grounded validator on WTA answers, attempts a bounded repair when the answer is incomplete, rejects repairs that invent numeric values not present in the evidence block, and fails closed with a safe refusal when the repair is still untrusted. This directly closes the prior gap where WTA could still confabulate on absent facts or partial numeric/list answers even though the manual path was better guarded. Regression coverage: `electron/llm/__tests__/DocGroundedCompleteness2026_07_05.test.mjs`.

- **WTA retrieves by the planned/latest question, not by the whole transcript blob.** `WhatToAnswerLLM` now uses `answerPlan.question.trim() || cleanedTranscript` as the retrieval query. This prevents stale transcript context (profile projects, earlier answers, unrelated chat history) from pulling the retriever toward the wrong source when the active mode is a document-grounded custom mode.

- **Forced document-grounded retrieval is hybrid-first again.** `ModesManager.buildRetrievedActiveModeContextBlockHybrid` no longer short-circuits `forceDocumentGrounding` to the lexical-only path. It tries `ModeHybridRetriever.retrieve(...)` first and falls back to lexical only when hybrid reports `usedFallback` or throws. `ModeHybridRetriever.retrieve` now accepts `forceDocumentGrounding`, builds the document identity block itself, and keeps the identity block gated to broad overview questions only so fact/list/definition questions rank precise chunks above abstract metadata. Regression coverage: `electron/services/__tests__/HybridDocumentGroundingPath.test.mjs`.

- **Custom-mode source isolation is centralized and enforced.** New `customModeExecutionContract` logic defines which context layers each custom/document-grounded mode is allowed to use, suppressing profile/JD/resume/company/persona/custom-notes/coding-template leakage unless the active mode explicitly permits that source. This is the guard that prevents TalentScope/project/coding scaffold drift from leaking into seminar/thesis answers. Regression coverage: `electron/llm/__tests__/CustomModeSourceIsolation2026_07_06.test.mjs` and related WTA/source-isolation tests.

- **Seminar fixture now tests realistic document-grounded behavior end-to-end.** `SeminarPresentationAssistant.test.mjs` covers 17 uploaded-thesis facts (main topic, OpenVLA/OpenVLA-OFT, AutoGen, Mercury X1 DOF/sensors, ROS#/Unity/Meta Quest 3/cameras, LoRA, Success Rate/MSE, project phases, semantic/prompt-complexity/self-awareness benchmarks), stale-profile drift isolation, deletion cleanup, binary-like noise, and prompt-injection wrapping. The focused suite is green: `npm run build:electron` plus `ELECTRON_RUN_AS_NODE=1 electron --test ...` reported **46/46 passing** for the document-grounding close-out set.

- **Local ONNX/reranker worker hardening landed with the same pass.** Local embedding/rerank workers now isolate ONNX/transformers loading behind worker entrypoints, add thread/config hardening, and move bge-reranker assets to the download path instead of vendoring the huge tokenizer payload in the repo. This keeps the always-on rerank flags from turning first-use model loading into a live-answer stall.

#### Remaining gaps (deferred)

- **WTA-path OKF augmentation still depends on OKF packs being already generated.** The `KnowledgeManager.generateForFile` path is async + single-flight; on the first WTA turn after upload, the pack may not be ready and augmentation can fall through to chunk-only. Warm generation at upload/index completion remains the mitigation.
- **First-token latency needs live smoke coverage under a cold local model cache.** The deterministic worker/reranker tests cover the code paths, but a packaged-app smoke should still verify that a completely cold bge/ONNX cache degrades to lexical within the WTA budget instead of blocking the live answer.

### Code Review Fixes (2026-07-06)

Hardening pass from a launch-log code review on the `hardening/v2.7.0` branch. Eight items: two CRITICAL, two HIGH, two MEDIUM, two LOW.

#### Critical

- **Native module rebuild for Apple Silicon (better-sqlite3, keytar)**: Resolved `ERR_DLOPEN_FAILED` from an x86_64 `.node` binary on arm64 hardware (Rosetta-drift during a prior install). Rebuilt both modules from source against the real hardware arch via `scripts/rebuild-native-electron.js`. Verified arm64 via `file` + `lipo -info`. Smoke load test + `ReferenceFilePageCountPersistence.test.mjs` (5/5) green under `ELECTRON_RUN_AS_NODE`. Required version bump `better-sqlite3` 12.6.2 → 12.11.1 to compile against the current Electron V8 headers.
- **PhoneMirror LAN-bind confirmation dialog + bind-address UI**: Closing the plaintext-HTTP-on-LAN attack surface on `0.0.0.0:4123`. The first `phone-mirror:set-lan` flip to ON per session now triggers a native `dialog.showMessageBoxSync` ("Allow LAN access? This will bind Natively to 0.0.0.0:4123 so any device on this Wi-Fi network can connect with the pairing token. Continue?" — Cancel is the default button). On Cancel the toggle stays off and the UI does not flip optimistically. Phone token is regenerated on every `exposeOnLan` transition (already in place; now documented). Settings now surfaces the live bind address in the Enable row — `On — port 4123 · bound to 0.0.0.0 (LAN) · 0 phones connected` vs `bound to 127.0.0.1 (loopback only)`.

#### High

- **Vite dynamic-import warnings resolved**: Two modules were both statically AND dynamically imported, defeating code-splitting. Dropped the dead dynamic import of `analytics.service` in `ConnectCalendarButton.tsx` (use the static import — calendar button cannot render before the app shell). Dropped the dead dynamic import of `orchestrator` in `App.tsx` (already statically imported by both `App.tsx` itself and `OrchestratedToasterHost.tsx`). Vite build is now clean of dynamic-import warnings for these two modules.
- **Renderer bundle vendor split**: Added `build.rollupOptions.output.manualChunks` to `vite.config.mts`, partitioning deps into seven vendor buckets (`react-vendor`, `animation-vendor`, `icon-vendor`, `radix-vendor`, `markdown-vendor`, `media-vendor`, `data-vendor`). Renderer main entry dropped from **2.38 MB raw / 662 kB gzip** to **1.32 MB raw / 328 kB gzip**. Largest single chunk is now `markdown-vendor` at 628 kB (dominated by `react-syntax-highlighter` — orthogonal follow-up).

#### Medium

- **`ModelVersionManager` tier label split**: Operator-facing summary was collapsing T2 and T3 into a single slot (`T1=… | T2/T3=…`), which silently drops `tier3` from telemetry if a third tier is populated. Reformatted both the Vision and Text summaries to `T1=… | T2=… | T3=…`.
- **Whisper Apple Silicon dtype default**: Default per-module dtype on Apple Silicon flipped from uniform `fp32` to `WHISPER_SAFE_DTYPE` (fp32 encoder + q8 decoders) — ~4× size and latency win on CoreML-backed inference with negligible WER impact. New `whisperAppleSiliconDtype` setting (`fp32` / `q8` / `q4` / `int8` / `mixed`) lets users opt back to fp32 if a particular model's quantized variant regresses on their hardware.

#### Low / Verified

- **`HindsightManager` round-4 `isAppManaged` fix verified intact**: The debounced-Settings-save clobbering bug (orphan server tree, held port 8888) stays fixed. Guards at line 573 (`if (!isAppManaged) broadcastStatus('ready')`) and line 935 (`stopSync` bail-out) are present and correct.

### Skills Delete Subsystem (2026-07-06)

The skill-delete feature in commit `76d531b` was reviewed by the `code-reviewer` agent and the user's `/humanize-ai-text is deletable` report. Two real findings, plus a documented defense-in-depth path.

#### High

- **Builtin classification now checks the parsed id, not just the folder name** (`bbed668`): `SkillsManager.loadUserSkills()` was classifying a skill as `'builtin'` only via `BUILTIN_SKILL_IDS.has(entry.name)` — the on-disk folder name. The seeded `humanize-text` folder has `name: humanize-ai-text` in its SKILL.md frontmatter (the slug is what the user sees as the `/skill id`), so the parsed `skill.id` and the folder name diverge. The original logic happened to work for today's install but was fragile to any folder rename (a maintainer adding a version suffix, a user's manual edit via the "open skills folder" escape hatch, a migration) — the rename would silently re-classify the builtin as `'userData'` and make it deletable. Fix: `BUILTIN_SKILL_IDS` now includes **both** `'humanize-text'` (folder) and `'humanize-ai-text'` (parsed id); classification accepts a match against either key. New regression test renames the seeded folder to a non-builtin name and asserts the parsed-id fallback still classifies it correctly AND that `deleteSkill('humanize-ai-text')` is STILL refused. Locks the contract — a future contributor who "simplifies" the check back to folder-only will fail the test on the spot. The SkillsManager comment block now also documents the requirement to keep `SkillsManager.BUILTIN_SKILL_IDS` in sync with `SkillValidator.DEFAULT_BUILTIN_SKILL_IDS` whenever a new builtin ships (the upload pipeline uses the validator's set for collision detection; the manager's set for source classification — adding a builtin requires updating both).

- **TOCTOU window in `deleteSkill` closed via `fs.realpathSync`** (part of `76d531b`): The first version of `deleteSkill` resolved the path to delete via `path.dirname(skill.filePath)` and used `path.resolve()` for the containment check before `fs.rmSync(realTargetDir, {recursive:true,force:true})`. This was vulnerable to a symlink-swap between `loadSkills()` and the delete: an attacker with write access to the skills dir could replace the skill folder with a symlink pointing elsewhere, and `rmSync`'s `force: true` would happily follow the symlink and wipe an arbitrary directory outside `skillsDir`. Fix: derive the target from `path.join(this.skillsDir, folderName)` (independent of any prior stat), then `fs.realpathSync` both the target and `skillsDir` at delete-time and verify the resolved target still starts with the resolved `skillsDir`. Error messages are sanitized ("Could not delete skill.") — the resolved realpath is NEVER leaked to the renderer (would expose internal paths). New regression test plants a `victim` dir outside `skillsDir`, swaps the skill folder for a symlink to the victim, and asserts the victim file survives intact + the error message doesn't leak path information.

#### Verified / Documented Only

- **Defense-in-depth gate at `/skill-name` invocation site** (part of `76d531b`): Verified that `NativelyInterface.tsx:3838`'s `onGeminiStreamError` handler already calls `flushToken()` + `setIsProcessing(false)` + clears `chatStreamIdRef` (and `inputValue` is cleared on submit at line 4176 BEFORE the IPC call), so the disabled-skill error path leaves no stale chat-panel state. No fix needed; documented for the next reviewer.

#### UX Polish

- **Hover-reveal animation matches the meeting-notes idiom** (`084252d`): The Trash2 button wrapper originally used a plain `opacity-0 group-hover:opacity-100 transition-opacity` fade — functional but inconsistent with the rest of the app's settings surfaces, where the meeting-notes action bar at `MeetingDetails.tsx:696` establishes the canonical hover-reveal contract (subtle `translate-y-1` slide-up + 160 ms `ease-out`, gated on `[@media(hover:hover)]` for mouse-capable devices, `[@media(hover:none)]:opacity-100` always-visible fallback for touch hardware, plus `group-focus-within` so keyboard users can tab to the button and see it appear). Matching the same idiom means every settings panel that exposes a hover action reveals the affordance with the same timing and easing — users see one consistent reveal pattern across Settings panels. The test regex was widened from `[\s\S]{0,1600}` to `[\s\S]{0,6000}` between the click-trash button and the inline confirm handle to accommodate the larger block in the same conditional ternary.

- **Replace `window.confirm()` with inline two-step confirmation** (`b1e4fc6`): The original delete handler popped a system `confirm()` dialog — jarring in an otherwise modern settings panel (drop-target depth tracking, byte-counted preview card, animated file-tree disclosure) and a pattern that no other settings panel in the app uses (`PhoneMirrorSettings`, `LocalWhisperModelPanel`, `AIProvidersSettings` all use either inline confirm or a soft-delete pattern). Fixed by replacing the system dialog with an inline two-step confirmation row:
  - **First click on the trash icon** → row enters "confirm mode". The trash icon is replaced inline with a `Cancel` button + a red `Delete this skill` button, with the skill name echoed next to them ("Delete code-simplifier?"). Both buttons are *always visible* (no hover-reveal) because the user has already committed to the action.
  - **Second click on the red Delete** → invokes `skillsDelete` IPC (with the per-skill `deletingIds` in-flight guard + banner hygiene from the senior review still in place).
  - **Escape key** dismisses the confirm — `useEffect` keydown listener attached only while `confirmingId` is non-null.
  - **6s auto-cancel** if the user walks away mid-confirm — `setTimeout` cleared on commit + on manual cancel, so a fast user never sees the row snap out of confirm mode unexpectedly.
  - **Only one row can be in confirm mode at a time** (single `confirmingId: string | null` state, not per-row booleans) — matches the user's mental model and prevents the visual confusion of two rows waiting simultaneously.
  - **`aria-live="polite"` on the confirm group** so screen readers announce the new controls when the row enters confirm mode. `role="group"` + `aria-label="Confirm delete <name>"` give explicit context.
  - **Per-button `disabled={deletingIds.has(skill.id)}`** during the actual delete + label flips to "Deleting…" so the user gets visual feedback that the action is in flight (closes the existing TOCTOU window between click and IPC return).
  - **Test surface updated** in `SkillsIpcWiring.test.mjs`: swapped the positive `window\.confirm\([^)]*Delete/` assertion for three — `doesNotMatch` on the system dialog, positive match for `confirmingId` state machinery, positive match for the "Delete this skill" inline button. `Trash2` lookahead relaxed from 1600 → 6000 chars to accommodate the larger inline confirm block nested under the same conditional. 21/21 pass.

- **Standardized the Built-in/Local badge position to match `AIProvidersSettings`** (`1ea78fa`): The badge had been moved twice in rapid succession (commit `fa27a87` placed it at the very left of the row, commit `b6a23fa` placed it after the `/id` slug in the left cluster) — both reasonable choices but neither rooted in a convention, so the user cycled through both. Final position is now **anchored to the standardized convention used by the closest analog in the app**: `AIProvidersSettings.tsx:1364-1370` (Ollama model list — name on the left, type pill anchored to the right edge before any actions). The badge moved to the first child of the right cluster, so the row shape is now identical for every row regardless of `skill.source` — the only difference between Built-in and Local rows is the presence of the hover-reveal delete slot. Putting the pill in the same slot across all settings panels means the user's eye can find it without re-learning the layout per panel. 21/21 node --test pass, tsc --noEmit clean.

- **Aligned the Built-in and Local badge x-position across rows** (`f0f1bfb`): Despite the standardization above, the badge still sat at different x-coordinates between rows because of (a) text-length differences ("Built-in" is 8 chars, "Local" is 5 chars) and (b) the hidden-but-layout-occupying trash icon (~30px + gap-1) pushing the Local badge leftward. Fixed with two parts: (1) `w-12 text-left` on the badge span so both texts start at the same left edge within the 48px badge slot, (2) `minWidth: 60px` inline-styled wrapper around the delete affordance so its layout space is reserved uniformly across every row (including built-ins where the actual button content is omitted). The visible badge now sits at the exact same x-coordinate in every row.

- **Removed the Built-in/Local badge entirely** (`3950df8`): Following a request — 'remove the local built in thing' — after 5 commit-cycles positioning the badge (left edge of row, after `/id`, right cluster matching `AIProvidersSettings`, then a same-x-coordinate alignment), the badge itself was removed. The functional distinction is still enforced at three layers: (1) UI gate (`{skill.source !== 'builtin' && ...}` hides the delete button on built-in rows), (2) server-side `SkillsManager.deleteSkill()` refusal with the "Built-in skills cannot be deleted" error, (3) `ensureBuiltinSkills()` would silently re-seed the folder anyway. After the removal, every row has the same right-side structure (empty for built-ins, hover-reveal delete for user-installed) — the visual asymmetry between the two row shapes is now the only indicator of which is which. The 60px slot reservation that anchored the badge x-coordinate was also removed (it existed solely to align the badge); the natural button width is stable without it.

### Crash & Launch Fixes (2026-07-06)

Black-screen and silent-crash debugging pass on the `hardening/v2.7.0` branch, traced from the user's `MEASURE_LATENCY=true npm start` log. Three distinct root causes, all fixed and verified via Chrome DevTools Protocol.

#### Critical

- **`electron:dev` npm script was missing the `build:electron` step**: A prior onboarding commit silently dropped `node scripts/build-electron.js` from the dev script, replacing it with `npm run build` (which only compiles the renderer). Without `build:electron`, `dist-electron/electron/main.js` was never produced, Electron's Node bootstrap threw `Cannot find module ...` on `require()` of the missing entry, and the process exited with code 1 and zero stdout/stderr — manifesting as "the app crashed with no error message." Script restored to `npm run build && npm run build:electron && cross-env NODE_ENV=development electron .` so both bundles are always present.

- **Black-screen from `.mjs`/`.ts` module-shadowing (Vite extension precedence)**: Latent module-resolution landmine that surfaced the instant the renderer was actually reachable. Vite's default extension order (`['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']`) silently resolves any unqualified import (no extension) to the `.mjs`/`.js` twin of a `.ts`/`.tsx` basename — including no-op test stubs and stale manually-compiled copies. The actual trigger was `src/lib/onboarding/orchestrator.mjs` (a no-op test stub with a non-referentially-stable `getSnapshot()`) being picked over `orchestrator.ts` (the real `OnboardingOrchestrator`); feeding the unstable snapshot into React's `useSyncExternalStore` triggered "Maximum update depth exceeded" during the commit phase, unmounting the entire React tree, and leaving the window blank while the main-process log stayed completely green. Fixed all current instances and closed the whole bug class:
  - `src/App.tsx`, `src/components/onboarding/OrchestratedToasterHost.tsx`, `src/lib/onboarding/orchestrator.ts` — unqualified orchestrator / persistence imports now use explicit `.ts` extensions.
  - `src/components/NativelyInterface.tsx` — explicit `.ts` on the `rollingTranscriptState` import (was silently resolving to a stale hand-compiled `.js` sibling instead of the live `.ts` source).
  - `premium/src/RemoteCampaignToaster.tsx` — explicit `.ts` on the `useAdCampaigns` import.
  - `electron/utils/rollingTranscriptState.js` — deleted (stale committed build artifact; its only test consumer reads from `dist-electron/` output).
  - 11 stale `.js` build artifacts in `premium/src/` deleted (`JDAwarenessToaster.js`, `MaxUltraUpgradeToaster.js`, `ModesSettings.js`, `NativelyApiPromoToaster.js`, `NegotiationCoachingCard.js`, `PremiumPromoToaster.js`, `PremiumUpgradeModal.js`, `ProfileFeatureToaster.js`, `ProfileVisualizer.js`, `RemoteCampaignToaster.js`, `useAdCampaigns.js`) — zero live consumers; all references in `src/premium/index.tsx` already use fully-qualified `.tsx`/`.ts` globs.
  - `vite.config.mts` — added `resolve.extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json']` so `.ts`/`.tsx` always win over `.js`/`.mjs` project-wide as one-line defense-in-depth.
  - `src/lib/onboarding/orchestrator.mjs` — hardened the no-op stub's `getSnapshot()` to return a single cached module-level snapshot (referentially stable across calls) so any future unqualified import that still hits the stub cannot trigger the React infinite-render cycle.

- **`src/main.tsx` referenced the undeclared global `process`**: `document.documentElement.setAttribute('data-platform', window.electronAPI?.platform ?? process?.platform ?? '')` ran at module top-level inside the renderer (`contextIsolation: true` / `nodeIntegration: false`). `process` isn't `undefined` here — it's literally undeclared — and optional chaining `?.` does not protect against referencing an undeclared identifier, so the line threw `ReferenceError: process is not defined` synchronously, aborted the module before `ReactDOM.createRoot(...).render(<App/>)`, and produced a black window with no renderer-side diagnostics. Replaced with `typeof process !== 'undefined' ? process.platform : ''` (the only safe check). Repo-wide sweep confirmed no other unguarded `process` / `require` / `__dirname` / `__filename` / `global` / `Buffer` references in `src/` or `premium/src/` (`process.env.NODE_ENV` hits are safe — Vite inlines them at build time).

#### Side effect (silent dead-code surfaced)

- **Onboarding orchestrator was silently `no-op`'d in the running app**: Before the module-shadowing fix, every `getOrchestrator()` call resolved to the `.mjs` stub, meaning the entire onboarding feature (permissions toaster, browser-extension toaster, profile/modes onboarding gates, trial promo, support/donation toaster, ad rotation gating, review prompt) had been wired up correctly in source but produced zero effects in the running app for weeks. It only became visible once `useSyncExternalStore` was introduced, which is why this "hardening" branch's headline onboarding feature had appeared to land cleanly while users never actually saw any of the toaster flows. Explicit-extension fix restores the real orchestrator in production.

### Local-Reranker SIGTRAP & Multi-ONNX Hardening (2026-07-06)

A 16 GB MacBook Air (`Mac16,12`) running live transcription + LLM streaming crashed with `SIGTRAP / EXC_BREAKPOINT` inside `onnxruntime::BFCArena::Extend → posix_memalign` in a Node.js `worker_threads.Worker`, traced through `InferenceSession::Run → ExecuteKernel → Add<float>::Compute → Tensor::Tensor → BFCArena::Alloc → CPUAllocator::Alloc → posix_memalign` (live crash report at `~/Library/Logs/DiagnosticReports/Electron-2026-07-06-034833.ips`). Root cause: the `ragLocalRerank` flag had been flipped to `default: true` (in `electron/intelligence/intelligenceFlags.ts:211`) while the bge-reranker-base cross-encoder model was **not yet bundled** — the cold-load + cold-inference of the 266 MB q8 ONNX model on a 16 GB box under peak multi-ONNX + LLM streaming pressure tripped `posix_memalign`. The reranker was the immediate trigger, but the underlying race surface (concurrent `InferenceSession::Run` calls contending for the native BFCArena) spans all four local ONNX consumers: `LocalEmbeddingProvider`, `LocalReranker`, `IntentClassifier`'s zero-shot worker, and Whisper's STT worker. A senior code review surfaced 2 CRITICALs, 2 HIGHs, and 7 MEDIUM/LOWs on the per-loader band-aid; all are addressed below. Net: 8 files modified + 3 new files; typecheck clean; existing hardening test suite (`OnnxWorkerIsolationHardening2026_07_05.test.mjs`) green; ~288 MB removed from the installer (reranker is now lazy-downloaded).

#### Critical

- **Shared cross-loader ONNX gate (`electron/utils/onnxThreadConfig.ts`)** — replaces the per-loader memory check that previously masked the reranker crash surface while leaving the multi-ONNX race intact. New exports:
  - `acquireOnnxSlot(priority?: 'normal' | 'high'): Promise<() => void>` — async semaphore with FIFO waiters. Default cap is **2 concurrent sessions** (`NATIVELY_ONNX_MAX_CONCURRENT_SESSIONS`, live env re-read on every call); Whisper claims `'high'` priority so its streaming loop acquires before queued normal-priority consumers (RAG embeds, intent classification, rerank). Does **not** preempt a running session — only re-orders the waiters, so a session already executing will finish its current `Run()` cleanly.
  - `hasEnoughMemoryForOnnxSession(): boolean` — `os.freemem() / 1024^3 >= NATIVELY_ONNX_MIN_FREE_GB` (default `2.0` GB). Fails **open** if `os.freemem()` itself throws (rare sandboxed Linux configs).
  - `getMinFreeGBForOnnxSession()`, `getMaxConcurrentOnnxSessions()` — live env-aware getters for instrumentation and tests.
  - `__resetOnnxGateForTests()` — test-only reset of the in-flight counters + waiter queues.

  All four consumers (`LocalReranker`, `LocalEmbeddingProvider`, `IntentClassifier`, `LocalWhisperSTT` in both its cold-start path **and** the `modelPreloader` warm path) now `await acquireOnnxSlot(...)` + check `hasEnoughMemoryForOnnxSession()` before posting `init` to their worker, and release the slot in the worker's `error`/`exit` handlers (and `beginWorkerTermination` for Whisper's clean-shutdown path). A gate refusal is **non-fatal** everywhere — `LocalEmbeddingProvider` falls through to lexical retrieval, `IntentClassifier` falls to regex-only, `LocalReranker` returns `null` from `rerank()` (caller keeps the cosine top-K), `LocalWhisperSTT` stalls its streaming loop (which is already stall-tolerant via `pendingAudio` queue + backoff) and surfaces an error event so the UI can offer cloud STT. Critically, gate refusals do **not** latch the per-consumer `loadFailed` flag (which is reserved for actual load errors) — a later, less-pressured moment will retry automatically. Slot ownership transfers cleanly when `modelPreloader.takeWarmWorker(modelId)` hands a warm worker to `LocalWhisperSTT`: the preloader installs `__slotRelease` on the worker object, the consumer's own error/exit listeners release the slot via the same idempotent function (no double-release). The Whisper preloader silently skips on gate refusal (does **not** surface as a worker `error`, which would trigger `modelPreloader.ts:30`'s persisted 5-min failure cooldown and block future preloads of the same model).

- **Reranker lazy-download replaces the unconditional 283 MB bundle** — the bundled `resources/models/Xenova/bge-reranker-base/` directory has been deleted from the install (`extraResources` still ships `all-MiniLM-L6-v2` + `mobilebert-uncased-mnli`, both small + always used). The 266 MB q8 ONNX model now downloads on first document-grounded mode activation via the existing `LocalModelDownloadService` infrastructure. **NEW** files:
  - `electron/rag/rerankerDownloadProvider.ts` — provider factory mirroring `createWhisperDownloadProvider` (`LocalModelDownloadService.ts:617`); `name: 'reranker'`; `isModelCached` checks `<userData>/local-models/Xenova/bge-reranker-base/onnx/model_quantized.onnx` (zero-byte guard); `deletePartial` is a recursive `fs.rmSync` on the model dir; `spawnWorker` constructs a small dedicated download worker speaking the service's `progress`/`ready`/`error` protocol (NOT the reranker's `requestId`-based inference protocol — they're different workers); `buildInitMessage` returns `{ type: 'init', modelId, cacheDir, dtype: 'q8' }`. Cache directory resolution has a `HOME`-based fallback for `ELECTRON_RUN_AS_NODE` test/probe mode where `app.getPath('userData')` isn't ready.
  - `electron/rag/rerankerDownloadWorker.ts` — separate worker that loads the model via `AutoTokenizer.from_pretrained` + `AutoModelForSequenceClassification.from_pretrained({ dtype: 'q8', progress_callback, session_options: getBoundedOnnxSessionOptions() })` and reports progress with byte-weighted aggregation across files. Uses the shared `getBoundedOnnxSessionOptions()` so the download itself can't pressure the BFCArena.

  Registered in `electron/main.ts` next to the whisper provider (in a try/catch — provider registration is non-fatal, so a missing `@huggingface/transformers` doesn't block app boot). `electron/services/ModesManager.ts:prewarmModeReferenceIndex` now branches: if `LocalReranker.isCached()` returns `true`, just `prewarm()` (existing path); if `false`, kick off `LocalModelDownloadService.getInstance().start('reranker', 'Xenova/bge-reranker-base#q8')` (idempotent — a parallel request from another mode activation just attaches to the same in-flight download). `LocalReranker.resolveModelPath()` now checks the user-data cache first, then bundled `process.resourcesPath/models` (legacy fallback for users with a prior v2.7.x bundle), then `app.getAppPath()/resources/models` at three relative depths — verified by the same `tokenizer.json` marker probe used in `LocalEmbeddingProvider.resolveModelPath`. `scripts/download-models.js` now **skips** the reranker download step entirely (was the bundle-source-of-truth) with a comment explaining the new lazy path.

#### High

- **Live env re-read for the memory floor** (`electron/utils/onnxThreadConfig.ts:readMinFreeGB`). The previous per-loader implementation captured the env var at module-load time (`const MIN_FREE_MEM_GB_FOR_RERANKER_LOAD = Number.parseFloat(...)`), breaking the sibling-flags convention where `readIntEnv('NATIVELY_ONNX_INTRA_OP_THREADS', ...)` re-reads on every call so a debug shortcut like `NATIVELY_RERANKER_MIN_FREE_GB=0.1` from the renderer console takes effect immediately. The shared gate re-reads on every `acquireOnnxSlot` / `hasEnoughMemoryForOnnxSession` call, matching the existing pattern. (Also: `>= 0` instead of `> 0` for the threshold so `0` disables the floor cleanly — the original `> 0` rejected `'0'` as invalid and silently fell back to the default `2.0` GB.)

- **`rag_rerank_unavailable` telemetry event** (`electron/services/modes/ModeHybridRetriever.ts`). When the reranker is requested (the `ragLocalRerank` flag is on, mode has reference files) but `LocalReranker.isAvailable()` returns `false`, emit a throttled (once per minute per process) telemetry event with `reason: 'not_cached' | 'load_failed' | 'unknown'`. This closes the silent-null-return failure mode where the reranker silently no-ops with no signal in telemetry — a single `rag_rerank_unavailable` event in the field would have surfaced the SIGTRAP root cause within one query rather than waiting for a stack-trace crash report. Telemetry never blocks the live answer path (guarded by an inner try/catch).

- **`LocalReranker.resolveModelPath()` mirrors `LocalEmbeddingProvider.resolveModelPath()`** — the same candidate-search pattern (env override, packaged `resourcesPath/models`, then `app.getAppPath()/resources/models` at three relative depths, with `tokenizer.json` as the existence marker) so the reranker works in every launch context (`electron .` from the repo, packaged prod, Playwright-driven `dist-electron/main.js`). Adds a `<userData>/local-models` candidate so the lazy-download cache is found. Falls back to `process.resourcesPath || appPath || process.cwd()` if nothing matches (worker gets *something* coherent, will try `local_files_only` in prod or `allowRemoteModels` in dev).

#### Medium / Low (driving test)

- `electron/rag/__tests__/OnnxWorkerIsolationHardening2026_07_05.test.mjs` — sets `process.env.NATIVELY_ONNX_MIN_FREE_GB = '0'` and `process.env.NATIVELY_ONNX_MAX_CONCURRENT_SESSIONS = '99'` at the top of the file so the gate stays permissive during worker-isolation tests (these tests validate isolation, not the gate). Without this, the test environment's <2 GB free would refuse every load and the suite would fail on a permission error rather than testing what it's supposed to. All 4 suite tests pass.
- 15+ related tests pass with no regression: `HeuristicExtractor.test.mjs`, `HybridDocumentGroundingPath.test.mjs`, `KnowledgeOrchestratorIngest.test.mjs`, `LocalRerankerModel.test.mjs`.
- Standalone gate probe `/tmp/gate-probe.mjs` (not committed) verifies: gate basics, blocks at the cap and unblocks on release, respects priority (high blocked by normal queue), live env re-read on `hasEnoughMemoryForOnnxSession`, `isCached` returns false on empty cache + true on populated cache with HOME-fallback. All 4 sub-tests pass.
- Worker probe `/tmp/reranker-probe.mjs` (from earlier, before bundle was deleted) confirmed: 30-pair batch inference completes in 2195 ms with semantically correct scores — the same forward-pass shape that crashed the live app, but now running cleanly through the worker-thread isolation + bounded `getBoundedOnnxSessionOptions()` (intra/inter-op = 1).

#### Verified properties

- Crash forensics from `Electron-2026-07-06-034833.ips` — the worker is `WorkerThread` (Node's `worker_threads`, not an OS pthread spawned by ORT), so the crash was actually inside the `localRerankerWorker.ts:22-39` host. The gate closes that surface: at most 2 ONNX sessions alive simultaneously, and any session refused under `<2 GB` free memory falls back to non-ONNX behavior.
- `Mac16,12` (16 GB M4 Air) at the time of the crash had 7 worker threads + 59 total threads; current `vm_stat` shows ~185 MB free, well under the 2 GB floor — meaning on this machine, `LocalReranker.ensureLoaded()` would refuse the model load outright. The retriever falls through to cosine top-K ordering, the user sees correct retrieval, and the app stays alive.
- Bundle size: `resources/models/` was 518 MB → 230 MB after deletion (288 MB removed). On a packaged installer that's a ~280 MB download shrink for the >80% of users who never invoke a custom document-grounded mode.

### Known Follow-ups (not fixed in this pass)

The review surfaced pre-existing structural issues that this commit intentionally does **not** change. Flagged for a follow-up commit:

- `package.json` at repo root has no `devDependencies` block. `electron`, `@electron/rebuild`, `@types/electron`, `@types/ws`, `@types/better-sqlite3` are all missing, so `npm ci` does not install them and `tsc --noEmit` produces hundreds of phantom module-not-found errors. A fresh clone will break the rebuild step.
- No `preinstall` guard against running `npm install` under Rosetta on Apple Silicon — a future contributor would silently regress the native module ABI mismatch fixed here.
- No `scripts.build` at repo root. Build is invoked via `scripts/build-electron.js` + `vite build` directly. Worth adding for CI parity.

    ### Full-JIT Profile Intelligence Hardening (2026-07-08)

    Converts the profile-intelligence path from deterministic final-answer rendering to **deterministic evidence selection + provider-generated just-in-time (JIT) final answers**. The durable law: AOT/deterministic code may only select evidence, compute metadata, resolve source ownership, and build compact prompts — it must never emit a user-visible final profile answer. Every user-visible profile answer is now one of exactly four modes: `jit_llm`, `jit_llm_repaired`, `source_safe_refusal` (a source-switch/insufficient-source line with no profile facts), or `provider_error_no_answer` (a provider-failure line with no profile facts, never stored as authoritative memory). The forbidden paths — `atomic_deterministic`, `deterministic_fast_path`, `aot_final_answer`, `cached_final_answer`, `template_final_answer` — are eliminated from the user-visible answer.

    #### New modules

    - **`electron/llm/FinalAnswerGenerationPolicy.ts`** — the final-answer law. `evaluateFinalAnswerPolicy`, `assertNoForbiddenFinalAnswerPath`, `legacyFastPathToForbiddenPath`, `finalAnswerRequiresProvider`, and `decideSessionWritePolicy` (which returns `store_conversational_only` / `store_non_authoritative` / `do_not_store`). Rejects user-visible deterministic/template/cached answers and blocks SessionTracker storage for provider-error/no-answer, critical unrepaired validator failures, and source-contract failures.
    - **`electron/llm/ProfileJitPromptBuilder.ts`** — compact provider prompt builder. Emits the exact user question in a `<question trust="untrusted" data_only="true">` tag, a bounded `<allowed_evidence>` block with source labels/refs/confidence, a no-hallucination rule, and explicit missing-info/conflict instructions. Filters evidence by the source contract's `allowedSources` / `forbiddenSources`, and splits JD (target-role) evidence from resume (candidate) evidence into separate labelled blocks so a JD requirement can never be fused into claimed candidate experience.
    - **`electron/llm/sourceOwnership.ts`** — resolves `SourceOwner` (`profile` / `reference_files` / `transcript` / `mixed` / `unknown`) from active-mode source authority and profile policy. Explicit profile asks in reference-file/transcript-only modes become a source-switch clarification rather than a profile leak.

    #### Behavioral changes

    - **Evidence selectors, not answer builders**: `manualProfileIntelligence.ts` now exposes `selectManualProfileEvidence` returning evidence with no final `answer` string; `profileAnswerBackend.ts` exposes `buildManualProfileEvidenceRoute` (deprecated alias kept, evidence-only). `buildLiveFallbackAnswer` always returns `null`, so provider stalls can never fall back to canned profile prose.
    - **Manual chat (`gemini-chat-stream`)** plans the answer, resolves source ownership, selects evidence only when ownership permits, prepends a compact JIT prompt, and streams the final answer from the provider. Deterministic profile prose is no longer streamed on the fast path, provider-outage repair, sanitizer repair, or assistant-voice-misfire repair — those emit source-safe/provider-error lines instead.
    - **WTA (What-to-Answer)** identity fallback now grounds on selected JIT evidence rather than `<candidate_identity_fact>` prose; the deterministic live fallback is removed.
    - **Staged source-owner enforcement** via `NATIVELY_SOURCE_OWNER_ENFORCEMENT_STAGE` (`off` / `observe` / `soft_block` / `enforce`), consumed at the manual + WTA ownership gates: `off` restores the legacy permissive guard (opt-in only), every other stage honors the resolver, so live behavior is enforce-by-default and leak-safe.
    - **Hindsight recall** is now owner-gated (permitted only for `mixed`/`transcript` owners; blocked for `reference_files`/`profile`/`unknown`) and wrapped in a `<long_term_memory trust="low" authority="non_authoritative">` envelope. Prior assistant responses are continuity/referent-only, never source evidence.
    - **SessionTracker writes** are gated by the write policy on both the manual completion store (including `logUsage` + `conversationMemoryV2` record) and the WTA path (`addAssistantMessage` + `pushUsage`), so provider-error/no-answer artifacts never become authoritative memory or land in the saved meeting's usage.

    #### Tests

    New: `FinalAnswerGenerationPolicy.test.mjs`, `ProfileJitPromptBuilder.test.mjs`, `SourceOwnerEnforcement.test.mjs`. Rewritten evidence-only: `manualProfileIntelligence.test.mjs`, `profileAnswerBackend.test.mjs`. Updated: `CustomModeSourceIsolation2026_07_06.test.mjs`. Focused suites pass 37/37, source isolation passes 37/37 in `NATIVELY_SOURCE_OWNER_ENFORCEMENT_STAGE=enforce`, full `tsc --noEmit` clean. Two code-reviewer passes closed 1 CRITICAL (inert session-write gate on the main completion store) + 4 lower-severity findings (dead staged-enforcement accessor, ungated Hindsight recall, WTA `pushUsage` store-gate asymmetry, profile-evidence double-injection). See `docs/PROFILE_INTELLIGENCE_FULL_JIT_POLICY.md` and `docs/PROFILE_INTELLIGENCE_FULL_JIT_IMPLEMENTATION_REPORT.md`.

## [2.7.0] - 2026-06-05

    ### What's New

    - **Profile Intelligence Router (v2)**: Advanced domain classification (Coding, System Design, Behavioral, Negotiation) propagating constraints directly to LLM streaming paths.
    - **DeepSeek AI Support**: Native integration of DeepSeek's advanced reasoning models via custom cURL OpenAI-compatible API providers.
    - **Two New Meeting UI Themes**: Beautiful Liquid Glass and Modern Dark themes to completely redefine the real-time overlay visual experience.
    - **Answer-Type Constraints & Follow-Up Resolver**: Context-aware follow-up resolution with strict output formatting layout constraints (short, detailed, bulleted, code-only).
    - **Eager Code UI Expansion**: Growth-holds CSS elements to eagerly size overlays before React code-block mounting to prevent layout shifts.
    - **PI Latency Tracer (`PiLatencyTracer`)**: Telemetry to track reasoning, validation, and routing latencies to guarantee sub-500ms responsiveness.
    - **Evidence Validator & Live Deadlines**: Cross-validates claims made in meetings and displays real-time countdowns for live assessment deadlines.
    - **Single-Click In-App Updates**: Seamless update loops directly inside the desktop application.

    ### Improvements & Fixes

    - **Audio Stack & TCC Permission Hardening**: Hardened credentials management by eliminating racing set-provider IPCs and resolved macOS system audio process tapping/TCC permission gates to guarantee robust capture streams.
    - **Production-Grade API Audit (server.js)**:
      - Resolved ElevenLabs open -> session_started audio gap on failover/reconnect.
      - Fixed mic-only billing bypass with active/recent system presence checks.
      - Fixed stream-abort billing leaks by moving billing triggers to the stream `finally` block.
      - Patched language regex prompt injection security vulnerablities on `/v1/chat/completions`.
      - Implemented webhook processing retries with 3-attempt exponential backoff.
      - Fixed fallback-seconds double counting on STT reconnect-after-failover.
      - Integrated HTTP keep-alive connection pooling via undici agent.
      - Resolved DNS lookup cache thrashing during key-rotation reconnect storms.
      - Sanitized admin endpoint `provider-health` key leak.
      - Added a 34-unit test suite (`unit-fixes.test.mjs`) to verify server logic.

    ## [2.6.0] - 2026-05-15

    ### What's New

    - **Phone Link Integration**: Connect iOS or Android devices as remote mics or companion screens.
    - **TinyPrompts™ Engine**: System prompts optimized for local SLMs (Ollama, Qwen 2.5:4B, Llama 3.2).
    - **Codex CLI Integration**: Sandboxed code execution and terminal tasks via `gpt-5.3-codex`.
    - **Auto-Calendar Sync**: Calendar connectors (Google Calendar, Outlook) for prep context.
    - **Smart Task Sync**: Auto-extract action items and export to Jira, Linear, or Asana.
    - **Speaker Identification**: Real-time speaker diarization tagging transcript names.

    ### Improvements & Fixes

    - **Advanced Stealth Features**: Activity Monitor evasion, process name disguising, and strict timeout management.
    - **Scroll & Layout**: Scroll keybinds for mouse-free navigation and horizontal layout code line rendering fixes.
    - **OpenAI Realtime GA**: Upgraded OpenAI realtime streaming STT connection to the new GA session schema.

    ## [2.5.0] - 2026-04-25

    ### What's New

    - **Modes Manager**: Toggle between 7 tailored personas (General, Technical Interview, Looking for Work, Sales, Recruiting, Team Meet, and Lecture) with custom templates.
    - **Custom Context & Notes**: Paste up to 8,000 characters of instructions, crib sheets, or credentials, auto-injected as XML blocks.
    - **10-Minute Free Trial**: Free trial system with HWID+IP anti-abuse protections.
    - **Permissions Onboarding Toaster**: macOS/Windows onboarding toaster for TCC permissions.

    ### Improvements & Fixes

    - **STT Connection Pools & Key Pools**: Round-robin pools (up to 6 keys for Deepgram and ElevenLabs), failover logic, and shadow-probe watchdogs.
    - **Bluetooth/AirPods Conflict Resolution**: Autodetects macOS CoreAudio conflicts and switches to built-in mic.
    - **Reliable Screenshot Capture**: Hardened multi-screenshot capture with `Cmd+Shift+Enter` single-trigger analysis.
    - **Dodo Webhook Billing Hardening**: Refactored payment processing webhook endpoints, splitting them into `/webhooks/dodo/api` and `/webhooks/dodo/pro`.

    ## [2.4.0] - 2026-04-10

    ### What's New & Improvements

    - **Permissions Check IPC**: IPC bridges for TCC and audio check.
    - **Log Forwarding**: Added `open-log-file` and console logging forwarding to `~/Documents/natively_debug.log`.
    - **Tavily Multi-Key Search Pool**: Tavily search key pool supporting up to 11 keys with round-robin rotation, automatic credit tracking, and exhaustion alerts.
    - **Ad Campaigns Engine**: Cooldown logic and targeting for Pro upgrade campaigns.

    ## [2.0.7] - 2026-03-20

    ### What's New
    
    - **Single-Trigger Analysis**: Added a new global keybind (`Cmd+Shift+Enter`) for "Capture and Process" to instantly take a screenshot and run AI analysis.
    - **Tavily Search Integration**: Replaced Google Custom Search Engine with the Tavily Search API. Features advanced depth and raw content extraction for vastly improved RAG and Company Research.
    - **Enhanced Company Dossiers**: Massively expanded the Premium Profile Intelligence UI. Now includes interview difficulty badges, a 5-star work culture grid with sub-dimensions, employee reviews with sentiment analysis, critics/complaints tracking, and core benefits pills.

    ### Improvements
    
    - **AI Language Strict Enforcement**: Rewrote the AI language enforcement pipeline. Native languages (Spanish, French, etc.) are now strongly prioritized over system prompt defaults using a triple-layer strict injection, guaranteeing the AI never incorrectly defaults back to English.
    - **Model Selection Accuracy**: Rewrote `LLMHelper` routing logic to guarantee your specifically selected cloud provider model (e.g., `gpt-4o`, `claude-3-5-sonnet`) is rigorously respected during vision fallbacks, multimodal processing, and streaming.
    - **Robust AI Fallbacks**: Added Gemini Flash and local Ollama models to the structured generation fallback chains, ensuring features like resume parsing work continuously even when primary models face rate limits or outages.
    - **Smoother Animations**: Mac window transitions now utilize zero-opacity pre-hiding to eliminate jarring animation flashes during rapid screenshot captures.
    
    ### Fixes
    
    - Fixed a bug where custom cURL endpoints and the "What to Say" auto-suggestion path would occasionally bypass the user's language preferences.
    - Fixed the OpenAI API validation ping by upgrading the deprecated connection test model to `gpt-4o-mini`.
    - Fixed UI sync issues where the AI response language dropdown could fall out of sync with the backend upon an IPC failure via a new optimistic playback system.
    - Removed unused dead user interface components and completely sanitized legacy template variables from core system prompts.

    ## [2.0.5] - 2026-03-15

    ### Improvements

    - **Stealth Mode UI**: The Process Disguise selector is now visually disabled and locked while Undetectable mode is active, preventing accidental state mismatches.
    - **State Synchronization**: Greatly improved internal state synchronization across all application windows (Settings, Launcher, Overlay).

    ### Fixes

    - **Infinite Feedback Loops**: Completely eliminated the bug where toggling Undetectable mode would sometimes cause the app to rapidly toggle itself on and off.
    - **Delayed Dock Reappearance**: Fixed a regression where the macOS dock icon would mysteriously reappear several seconds after entering stealth mode if a disguise had recently been changed.
    - **Initial State Loading**: Fixed an issue where the Settings UI would briefly show incorrect toggle states when first opened.
    - **macOS OS-level Events**: Hardened the app against macOS `activate` events (like clicking the app in Finder) accidentally breaking stealth mode.

    ### Technical

    - Refactored IPC (Inter-Process Communication) listeners for `SettingsPopup` and `SettingsOverlay` to use a strict one-way (receive-only) data binding pattern.
    - Added strict management and cancellation of `forceUpdate` timeouts during stealth mode transitions.
    - Added explicit type safety for the new getters in `electron.d.ts`.

    ## [2.0.4] - 2026-03-14

    ### Summary

    Version 2.0.4 introduces a massive architectural overhaul to the native audio pipeline, guaranteeing production-ready stability, true zero-allocation data transfer, and instantaneous STT responsiveness with WebRTC ML-based VAD.

    ### What's New

    - **Two-Stage Silence Processing**: Replaced basic RMS noise gating with a two-stage pipeline combining an adaptive RMS threshold and WebRTC Machine Learning VAD. Rejects typing, fan noise, and non-speech sounds before they bill STT APIs.
    - **Zero-Copy ABI Transfers**: Transitioned the `ThreadsafeFunction` bridging to direct `napi::Buffer` (Uint8Array) allocations, completely eliminating V8 garbage collection pressure during continuous capture.
    - **Sliding-Window RAG**: Implemented a 50-token semantic overlap in `SemanticChunker.ts` to prevent conversational context loss across chunk boundaries.

    ### Improvements

    - **Latency & Responsiveness Tuning**: Stripped redundant TS debouncing, slashed `MIN_BUFFER_BYTES`, and reduced native hangover, achieving a ~300ms reduction in end-to-end transcription latency. short utterances ("Yes", "Stop") no longer sit trapped in the buffer.
    - Removed floating-point division truncation for superior downsampling from 44.1kHz external microphones.

    ### Fixes

    - Fixed a critical bug where the native Rust monitor returned a hardcoded `16000Hz` while actually streaming 48kHz audio. Now syncs true hardware sample rates.
    - Resolved the "Input missing" silent crash bug on microphone restarts by properly recreating the CPAL stream.
    - Restored the 10s continuous speech backstop for REST APIs to prevent unbounded buffer growth.
    - Added missing `notifySpeechEnded()` properties and cleaned up dangerous type casts.

    ### Technical

    - Audio processing transitioned entirely to strict ABI memory bridging (`napi::Buffer`)
    - Re-architected native silence_suppression state machine around WebRTC VAD inputs.

    ## [2.0.3] - 2026-03-13

    ### What's New

    - **Dynamic AI Model Selection:** Replaced static model lists with dynamic dropdowns. Your preferred models synced from providers (like OpenAI, Anthropic, Google) now automatically appear across the entire app.
    - **Multimodal Resilience:** Added a "Smart Dynamic Fallback" using Groq Llama 4 Scout. If default vision models fail or get rate-limited during screen analysis, Natively instantly reroutes the image to ensure uninterrupted performance.
    - **Multiple Screenshot Support:** The Natively Interface can now handle and process multiple attached screenshots simultaneously instead of just one.
    - **Improved Settings UX:** API keys now auto-save after 5 seconds of inactivity, and selecting a preferred model immediately updates the rest of the application without requiring a page reload.

    ### Architecture & Fixes

    - **Better Embeddings:** Migrated from Gemini Embedding to a completely new and more robust embedding architecture.
    - **Claude Fixes:** Resolved max_tokens and context limits issues specific to Anthropic Claude interactions.
    - **DRY Refactoring:** Centralized model configuration strings across the codebase to ensure easier future updates.

    ## [2.0.2] - 2026-03-10

    ### Summary

    v2.0.2 focuses on fixing Windows system audio capture, improving RAG stability, and resolving critical Soniox STT configuration issues.

    ### What's New

    - Fully functional system audio capture for Windows
    - Introduced system for manual transcript finalization and interim/final bridging during recordings

    ### Improvements

    - Migrated to `app.getAppPath()` for reliable cross-platform resource discovery
    - Ensured `sqlite-vec` compatibility and fixed embedding queue management
    - Upgraded `@google/genai` and optimized embedding dimensionality for lower latency

    ### Fixes

    - Improved Soniox STT streaming reliability, manual flushing, and configuration persistence
    - Resolved application entry point and module resolution issues in production builds
    - Fixed transcript bridging for manual recording mode
    - Corrected stealth activation and window focus inconsistencies

    ### Technical

    - Dependency updates for `@google/genai`
    - Cleaned up native compiler warnings for Windows
    - Fixed module resolution for internal Electron paths

    ## [2.0.1] - 2026-03-06

    ### New Features

    - **Premium Profile Intelligence**: Job Description (JD) and Resume context awareness, company research, and negotiation assistance.
    - **Live Meeting RAG**: Instant intelligent retrieval of context directly during a live meeting using local vectors.
    - **Soniox Speech Provider**: Added support for ultra-fast and highly accurate streaming STT with Soniox.
    - **Multilingual Support**: Choose from various response languages, set speech recognition matching specific accents and dialects.

    ### Improvements & Fixes

    - Fixed numerous issues and merged 3 community pull requests to improve overall stability.

    ## [1.1.8] - 2026-02-23

    ### Summary

    Patch update addressing OpenAI GPT 5.x compatibility and increasing token output limits for all providers.

    ### What's New

    - Replaced deprecated `max_tokens` parameter with `max_completion_tokens` required by GPT 5.x models.
    - Increased max output tokens for OpenAI (GPT 5.2) and Claude (Sonnet 4.5) to 65,536.
    - Increased max output tokens for Groq (Llama 3.3 70B) to 32,768.

    ### Improvements

    - Improved response length capabilities across all text-generation AI models.
    - Updated connection test model to use `gpt-5.2-chat-latest` instead of the deprecated `gpt-3.5-turbo`.

    ### Fixes

    - Fixed 400 error when using OpenAI GPT 5.x models for text queries and toggle actions.

    ### Technical

    - Replaced `max_tokens` with `max_completion_tokens` in `LLMHelper.ts` and `ipcHandlers.ts`.

    ## [1.1.7] - 2026-02-20

    ### Summary

    Security hardening, memory optimization, and stability improvements for a more robust and reliable experience.

    ### What's New

    - API rate limiting to prevent 429 errors on free-tier plans (Gemini, Groq, OpenAI, Claude)
    - Cross-platform screenshot support (macOS, Linux, Windows)
    - Official website link added to the About section

    ### Improvements

    - Smarter transcript memory management with epoch summarization instead of hard truncation — no more losing early meeting context
    - API keys are now scrubbed from memory on app quit to minimize exposure window
    - Credentials manager now overwrites key data before disposal for enhanced security
    - Helper process renaming for improved stealth in Activity Monitor

    ### Fixes

    - Fixed V8/Electron entitlements crash on Intel Macs by including entitlements.mac.plist during ad-hoc signing
    - Fixed process disguise not applying correctly when undetectable mode is toggled on
    - Fixed usage array capping with dedicated helper method to prevent unbounded growth

    ### Technical

    - Added `RateLimiter` service (token bucket algorithm with configurable burst and refill rates)
    - Added `PRIVACY.md` and `SECURITY.md` policy documents
    - Refactored ad-hoc signing script with helper renaming and proper entitlements flow
    - Version bump to 1.1.7

    ## [1.1.6] - 2026-02-15

    ### New Features

    - **Speech Providers**: Added support for multiple speech providers including Google, Groq, OpenAI, Deepgram, ElevenLabs, Azure, and IBM Watson.
    - **Fast Response Mode**: Introduced ultra-fast text responses using Groq Llama 3.
    - **Local RAG & Memory**: Full offline vector retrieval for past meetings using SQLite.
    - **Custom Key Bindings**: Added ability to customize global shortcuts for easier control.
    - **Stealth Mode Improvements**: Enhanced disguise modes (Terminal, Settings, Activity Monitor) for better privacy.
    - **Markdown Support**: Improved Markdown rendering in the Usage section for better readability of AI responses.
    - **Image Processing**: Integrated `sharp` for optimized image handling and faster analysis.

    ### Improvements & Fixes

    - Fixed various UI bugs and focus stealing issues.
    - Improved application stability and performance.

    ## [1.1.5] - 2026-02-13

    ### Summary

    The Stealth & Intelligence Update: Enhances stealth capabilities, expands AI provider support, and improves local AI integration.

    ### What's New

    - **Native Speech Provider Support:** Added Deepgram, Groq, and OpenAI speech providers.
    - **Custom LLM Providers:** Connect to any OpenAI-compatible API including OpenRouter and DeepSeek.
    - **Smart Local AI:** Auto-detection of available Ollama models for local AI.
    - **Global Spotlight Search:** Toggle chat overlay with Cmd+K (macOS) and Ctrl+K (Windows/Linux).
    - **Masquerading Mode:** Appear as system processes like Terminal or Activity Monitor.
    - **Improved Stealth Mode:** Enhanced activation and window focus transitions.

    ### Improvements

    - **Natural Responses:** Updated system prompts for more concise and natural responses.
    - **Conversational Logic:** Reduced robotic preambles and unnecessary explanations.
    - **Performance:** Improved UI scaling and reduced speech-to-text latency.

    ### Fixes

    - No critical fixes reported in this release.

    ### Technical

    - Internal logic refinements for improved conversational flow.
    - Updater and background process stability improvements.

    #### macOS Installation (Unsigned Build)

    If you see "App is damaged":

    1. Move the app to your Applications folder.
    2. Open Terminal and run: `xattr -cr /Applications/Natively.app`

    ## [1.1.4] - 2026-02-12

    ### What's New in v1.1.4

    - **Custom LLM Providers:** Connect to any OpenAI-compatible API (OpenRouter, DeepSeek, commercial endpoints) simply by pasting a cURL command.
    - **Smart Local AI:** Enhanced Ollama integration that automatically detects and lists your available local models—no configuration required.
    - **Refined Human Persona:** Major updates to system prompts (`prompts.ts`) to ensure responses are concise, conversational, and indistinguishable from a real candidate.
    - **Anti-Chatbot Logic:** Specific negative constraints to prevent "AI-like" lectures, distinct "robot" preambles, and over-explanation.
    - **Global Spotlight Search:** Access AI chat instantly with `Cmd+K` / `Ctrl+K`.
    - **Masquerading (Undetectable Mode):** Stealth capability to disguise the app as common utility processes (Terminal, Activity Monitor) for discreet usage.
