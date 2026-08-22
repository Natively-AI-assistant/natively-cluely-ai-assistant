# Auto Answer V3 — Campaign Progress

## Status: phase 1 complete

Branch: `feat/auto-answer-v3` (created from `main` @ f7ba73c0, 2026-08-23).
Specs: `docs/specs/auto-answer-v2-spec.md.md` (note: file has a doubled `.md.md` extension on disk),
`docs/specs/auto-answer-v3-amendments.md`. V3 wins on conflict.

Workspace note: at campaign start the tree carried two uncommitted edits that are NOT mine and
were left untouched: a cosmetic `src/components/SettingsOverlay.tsx` change (icon + copy for the
Auto Answer row) and a dirty `natively-api` submodule pointer. Neither will be staged by this campaign.

## Call graph findings (Phase 0)

All line numbers are from `main` @ f7ba73c0. Spec path corrections are marked **[CORRECTION]**.

### 1. Transcript ingestion → Auto Answer trigger (today)

**[CORRECTION]** V2 §51 names `electron/main/AppState.ts`; AppState is the class inside
`electron/main.ts` (no `electron/main/` directory exists).

```
STT provider `transcript` event                      electron/main.ts:3405 (inside createSTTProvider, per channel)
  → intelligenceManager.handleTranscript(segment)     main.ts:3414  (always; partial AND final)
      → IntelligenceEngine.handleTranscript           IntelligenceEngine.ts:548
          → SessionTracker.handleTranscript → addTranscript (returns null on !final)   SessionTracker.ts:478/298
          → interviewer partial → maybeSpeculate(segment)   IE.ts:585  (speculative WTA, see §6)
          → interviewer final  → clears speculativeTimer     IE.ts:586
          → final → detectAndEmitDynamicActions            IE.ts:596
  → if (segment.isFinal && speaker==='interviewer') scheduleAutoAnswer()   main.ts:3438
      scheduleAutoAnswer()                               main.ts:3187
        guards BEFORE arming: _autoAnswerEnabled, isMeetingActive
        clearTimeout(prev); setTimeout(900)  ← each final RESTARTS the timer (starvation residual)
        on fire: evaluateAutoAnswerGate({enabled, meetingActive, generationAtSchedule,
                  generationNow:_meetingGeneration, lastQuestion: getLastInterviewerTurn(),
                  lastAnsweredQuestion, engineAccepting: canAutoAnswer()})   autoAnswerGate.ts:48
          skip → verbose log of reason only (no text)      main.ts:3216
          dispatch → lastAutoAnsweredQuestion = q;
                     handleSuggestionTrigger({context: getFormattedContext(120), lastQuestion, confidence: 0.9})  main.ts:3224
      cancelAutoAnswer()                                 main.ts:3235  (clears timer + lastAutoAnsweredQuestion)
        called from startMeetingTransition (5851), endMeeting (6168), setAutoAnswerEnabled(false) (7572)
```

`IntelligenceManager.canAutoAnswer` (IM.ts:193) → `IntelligenceEngine.canAutoAnswer` (IE.ts:709):
`activeMode ∈ {idle, assist}` AND `Date.now() - lastTriggerTime >= triggerCooldown (3000)`.

`IntelligenceEngine.handleSuggestionTrigger(trigger)` (IE.ts:718):
1. `trigger.confidence < 0.5 → return` (silent, no reason)
2. `planSuggestionTrigger` → `classifyIntent` (ONNX zero-shot) → `planNextAssistantAction` (applies the same 3 s cooldown)
3. silent → emits `suggestion_skipped {reason, question: trigger.lastQuestion, confidence}` ← **transcript text leaves the engine on an event**
4. non-answer kinds → runPlannerDecision (clarify/recap/follow_up_questions/brainstorm)
5. answer → speculative reuse check (see §6) → `runWhatShouldISay(trigger.lastQuestion, trigger.confidence)`

`SuggestionTrigger` = `{context, lastQuestion, confidence}` (SessionTracker.ts:60). No optional fields yet.

Settings: `setAutoAnswerEnabled` (main.ts:7567) calls `SettingsManager.set` with NO try/catch and returns void;
IPC `set-auto-answer-enabled` (ipcHandlers.ts:5810) always returns `{success:true}`; `SettingsOverlay.tsx:2037`
flips local state optimistically and fire-and-forgets the IPC. Persistence failure is invisible.

### 2. SessionTracker semantics
- `addTranscript` (298): **returns null on `!final`**; trims; dedups an identical same-role item within 500 ms; pushes
  `{role,text,timestamp,sttProvider?,punctuationSource?}` into `contextItems`; evicts old entries.
- Interim interviewer text is tracked separately (SessionTracker.ts:154/479) and injected into `getContext` via
  `interimInjectionGuard` (599-610).
- `getLastInterviewerTurn()` (655): last FINAL interviewer context item text, or null. It is a single final
  segment — NOT a reconstructed utterance. A 3-final question yields only its last fragment here.
- `getContext(lastSeconds)` (523) → `ContextItem[]` `{role,text,timestamp,...}`.

### 3. LiveTranscriptBrain (electron/intelligence/LiveTranscriptBrain.ts)
- `constructor(session: SessionTrackerLike, extractQuestion?: QuestionExtractorLike|null)` (84). Thin, pure,
  depends only on a `SessionTrackerLike` interface → NO circular-dependency risk for the new subsystem.
- `getLiveWindow(s)` = `session.getContext(s)`; `getHotWindow(s=30)` = window + latest interim interviewer partial.
- `getCurrentQuestion(s=180)` (138) heuristic latest question; `getLiveAnswerContext(s=180)` (208) →
  `{window, currentQuestion, questionType, isFollowUp, rollingSummary}` using the injected extractor, falling back
  to getCurrentQuestion.
- Only construction site today: `IntelligenceEngine.ts:1305` inside runWhatShouldISay (`new LiveTranscriptBrain(this.session, extractLatestQuestion)`) — built per call, not a shared instance.

### 4. transcriptQuestionExtractor.extractLatestQuestion(turns: TranscriptTurn[], windowTurns=6): ExtractedQuestion
- `TranscriptTurn` = `{role:'interviewer'|'user'|'assistant', text, timestamp, punctuationSource?}` (electron/llm/transcriptCleaner.ts:5).
- Output: `{detectedSpeaker, latestQuestion, questionType (identity|profile_detail|jd_alignment|negotiation|behavioral|technical|follow_up|general), isFollowUp, followUpTarget, confidence 0..1, relevantTranscriptWindow, ignoredTranscriptNoise}`.
- Already handles greetings, social pleasantries (confidence capped), imperative asks, punctuation-unavailable providers.

### 5. IntentClassifier ONNX (electron/llm/IntentClassifier.ts)
- Worker-based (`intentClassifierWorker.ts`) transformers.js zero-shot on `Xenova/mobilebert-uncased-mnli`.
- Asset path: packaged → `path.join(process.resourcesPath, 'models')`; dev → `resolveDevModelRoot()` (repo
  `resources/models`, with the documented dist-electron shadowing trap).
- Failure mode: worker timeout (`WORKER_TIMEOUT_MS`) / onnxLoadSentinel poison → classifyIntent falls back to
  regex result; Auto Answer path survives.

### 6. Speculative WTA
- `maybeSpeculate(segment)` (IE.ts:517) on interviewer PARTIALS: requires mode idle/assist, `confidence >=
  SPECULATIVE_MIN_CONFIDENCE`, `words >= SPECULATIVE_MIN_WORDS`, `hasQuestionSignal(text)`; debounced
  `SPECULATIVE_DEBOUNCE_MS`; then `runWhatShouldISay(text, conf, undefined, {speculative:true})`.
- Cache: `speculativeText` (the QUESTION TEXT the speculative run was started for — the key) and
  `speculativeTextExpiry = now + triggerCooldown + 5000` (IE.ts:977). The answer itself streams through the normal
  generation with `isSpeculative` → never emitted to UI (IE.ts:3090).
- Consumer: `handleSuggestionTrigger` (IE.ts:746): if `speculativeText !== null` and not expired, Jaccard
  `speculativeQuestionSimilarity(speculativeText, trigger.lastQuestion) >= SPECULATIVE_SIMILARITY_THRESHOLD (0.75)`
  → "accept": stamps lastTriggerTime/lastTriggerQuestion and RETURNS (the still-running speculative stream becomes
  the answer). Otherwise clears the cache, `++currentGenerationId`, and calls runWhatShouldISay fresh.
- The key is the question STRING; there is no questionId/generation key. V3 Amendment 6 builds on this.

### 7. Manual WTA and 'superseded'
- Manual hotkey/button → `IntelligenceManager.runWhatShouldISay(question?, conf?, images?, {skipCooldown, forceFresh,...})`.
- `runWhatShouldISay` (IE.ts:899): `forceFresh && !speculative` clears the speculative cache; `shouldThrottleTrigger`
  (triggerGate.ts) bypassed by skipCooldown/images/speculative; then **`whatToAnswerCancellationToken.abort('superseded')`**
  + background tokens aborted; `generationId = ++currentGenerationId`; `setMode('what_to_say')`; non-speculative stamps
  `lastTriggerTime` immediately. This is why an auto trigger must never reach runWhatShouldISay while a manual stream
  is live: canAutoAnswer's mode check is the ONLY guard.

### 8. Native → main VAD bridge (per channel, per platform)
- Rust `SilenceSuppressor::process(frame) -> (FrameAction, speech_just_ended)` (native-module/src/silence_suppression.rs:232).
  Two-stage gate: adaptive RMS, then WebRTC VAD when `use_vad`.
  - System audio (interviewer): `for_system_audio()` — `use_vad:false` on EVERY platform (#127), hangover 600 ms.
  - Microphone (user): `for_microphone_on(is_windows)` — VAD ON on macOS, OFF on Windows (PR #497); hangover 500 ms.
    Test pattern with injected flag: `test_microphone_vad_is_platform_scoped` (line 480).
- Both capture threads (`SystemAudioCapture::start` lib.rs:180, `MicrophoneCapture::start` lib.rs:462) accept
  `on_speech_ended: Option<ThreadsafeFunction<bool>>` and call it with `Ok(true)` on the ended edge only
  (lib.rs:354-358, 616-620). **There is NO speech_started event on the bridge today**, and NO joint state.
- TS: `SystemAudioCapture.ts:146` / `MicrophoneCapture.ts:156` re-emit `'speech_ended'` (ignoring the bool).
  main.ts wires `capture.on('speech_ended')` → `googleSTT?.notifySpeechEnded?.()` (3833) / `googleSTT_User` (4021).
  RestSTT.notifySpeechEnded starts the upload (REST providers); streaming providers mostly no-op.
- No STT adapter consumes Deepgram `speech_final`/`UtteranceEnd` (DeepgramStreamingSTT.ts:206 reads `is_final`
  only). Soniox receives `<end>` and only logs it (SonioxStreamingSTT.ts:329). Provider EOT signals are
  currently dropped on the floor — Phase 5 input.

### 9. Debounce / cooldown / dedup / generation interaction (today)
- Debounce: 900 ms, restarted on every interviewer final (no cap) → a provider emitting finals < 900 ms apart
  starves it (the known residual).
- Cooldown: engine `triggerCooldown` 3000 ms checked twice (canAutoAnswer before classify; planner after).
- Dedup: exact string `question === lastAutoAnsweredQuestion` in the gate + planner `lastTriggerQuestion`.
- Generation: `_meetingGeneration` captured at arm time, compared at fire time; cancelAutoAnswer on start/stop.
- A transient gate rejection (engine busy / cooldown) DROPS the candidate permanently — no re-arm.

### 10. Test infrastructure
- Runner: `node:test` (`*.test.mjs`), importing COMPILED output from `dist-electron/` (esbuild bundle per entry,
  `scripts/build-electron.js`). `npm test` = build:electron + the main globs under `ELECTRON_RUN_AS_NODE=1 electron --test`.
  `electron/intelligence/__tests__/**` runs under the SEPARATE `npm run test:intelligence` target (not in `npm test`).
- Existing gate tests: `electron/services/__tests__/AutoAnswer.test.mjs` (gate cases + mutation-probe style
  "healthy baseline" + `canAutoAnswer` by poking `engine.activeMode` / `engine.lastTriggerTime`).
- **No fake-clock abstraction exists in the repo** (grep for Clock/FakeClock: none). Timer tests poke `Date.now()`
  deltas. The campaign introduces `Clock` in `electron/intelligence/autoAnswer/AutoAnswerClock.ts`.
- Rust: `cargo test` in `native-module/`, injected-flag pattern in silence_suppression.rs tests.

### 11. Model assets
- Bundled via `resources/models/` → electron-builder `extraResources {from: resources/models/, to: models/}`;
  required list + verify in `scripts/download-models.js` (`REQUIRED_MODEL_FILES`), plus
  `electron/services/LocalFallbackAssets.ts` and `scripts/verify-packaged-local-assets.mjs`.
- Raw-ONNX (non transformers.js) pattern: `electron/audio/whisper/nemotron/nemotronEngine.ts` uses
  `onnxruntime-node` `InferenceSession.create(path, getBoundedOnnxSessionOptions(...))` → Smart Turn follows this.
- **[CORRECTION]** V3 Amendment 6 says "bundled bge-small-en-v1.5". It is NOT bundled. The bundled local embedder is
  `Xenova/all-MiniLM-L6-v2` (384-d) via `electron/rag/providers/LocalEmbeddingProvider.ts`; `Xenova/bge-reranker-base`
  is a cross-encoder reranker, not an embedder. Dedup layer 3 / speculative reuse will use all-MiniLM-L6-v2
  (same "zero new download weight" property). Recorded as a spec deviation.

### 12. Transcript text leak surface (today)
- `IntelligenceEngine.emit('suggestion_skipped', {question})` (IE.ts:733) carries question text (in-process event).
- `[TRACE:LONGCTX] question_extracted` (IE.ts:1256) logs JSON that may include question text (trace-gated).
- main.ts auto-answer skip log prints reason only. Speculative logs print lengths only.
- `TelemetryService` has a sanitizer that strips transcript-shaped fields (main.ts:6535 comment).

### 13. Overlay suggestion surface (for Phase 6)
- `IntelligenceEngine.emit('dynamic_action_emitted')` → main.ts:6530 → IPC `intelligence-dynamic-action` to launcher +
  overlay → `src/components/dynamic-actions/DynamicActionCard.tsx` / `DynamicActionBar.tsx`. Reuse this for the offer card.

### 14. Baseline test counts (clean `main` @ f7ba73c0, macOS host, 2026-08-23)
`npm test` (build:electron + main globs): **tests 8300 · pass 8230 · fail 7 · skipped 63** (exit 1).
Pre-existing failures (recorded, NOT fixed, must not grow):
- 2x `OllamaManagerGating2026_07_07.test.mjs` (lines 77, 105) — the allowed Ollama-on-host environmental pair.
- 2x `ModesManager.test.mjs` (126, 137) — "MODE_TEMPLATES enumerates every production mode" / "seeded note sections" — pre-existing, unrelated (Call Center mode landed in b059be20).
- 3x `ProviderVisibilityFilters.test.mjs` (34, 55, 108) — pre-existing, unrelated (Groq retirement migration ac896ee9).
`KnowledgeIngestSpaceMetadata` did not fail on this checkout (submodule tree present).
`npm run test:intelligence`: **tests 1897 · pass 1885 · fail 3** — all pre-existing in
`electron/context-intelligence/__tests__/BuiltinModeAdoption2026_08_09.test.mjs` (73, 102) and
`ModePolicyRegistry.test.mjs` (20) (built-in mode count drift after Call Center landed). Recorded, not fixed.

## Per-phase log

### Phase 0 — forensics
- No behaviour changes. Call graph, spec corrections, test infra, asset pipeline, leak surface and baseline
  counts recorded above.
- Key corrections to the specs: AppState lives in `electron/main.ts`; no fake-clock infra exists; the bridge has
  NO `speech_started` event and no joint channel state; Deepgram `speech_final`/Soniox `<end>` are dropped today;
  the bundled embedder is all-MiniLM-L6-v2, not bge-small; `electron/intelligence/**` tests are NOT in `npm test`.
- Validation label: n/a (documentation only).

### Phase 1 — hotfixes on the existing trigger
Branch note: a parallel session committed `d780eb16 fix(settings): tighten the Auto Answer row's copy and icon`
directly onto `feat/auto-answer-v3` between Phase 0 and this commit (the cosmetic SettingsOverlay edit noted at
campaign start). Not mine; history left untouched.

- `electron/intelligence/autoAnswer/AutoAnswerClock.ts` — NEW: `Clock` interface + `systemClock` (V2 §33).
- `electron/intelligence/autoAnswer/__tests__/fakeClock.mjs` — NEW: deterministic FakeClock (advance runs due timers in order).
- `electron/intelligence/autoAnswerScheduler.ts` — NEW: the timer half extracted from AppState. `HARD_CAP_MS=2500`
  from the first final of an accumulation; single-slot `PendingAutoAnswer` with `PENDING_TTL_MS=6000`, rearmed on
  `mode_changed→idle` (fast path) and a `PENDING_RETRY_MS=500` poll (cooldown has no event); dropped on TTL, newer
  final, live-turn mismatch, or `cancel()`. All guards still flow through `evaluateAutoAnswerGate`.
- `electron/main.ts` — AppState wires `AutoAnswerScheduler` (scheduleAutoAnswer/cancelAutoAnswer now delegate);
  `mode_changed` 'idle' → `noteEngineIdle()`; dispatch passes NO confidence; `setAutoAnswerEnabled` returns whether
  `SettingsManager.set` persisted and leaves the in-memory flag untouched on refusal.
- `electron/ipcHandlers.ts` — `set-auto-answer-enabled` returns `{success:false, error}` on persistence failure.
- `electron/preload.ts`, `src/types/electron.d.ts` — `setAutoAnswerEnabled` result gains `error?`.
- `src/components/SettingsOverlay.tsx` — optimistic toggle rolls back on `{success:false}` or throw (same pattern as
  `handleAiLanguageChange`).
- `electron/SessionTracker.ts` — `SuggestionTrigger.confidence` is now optional.
- `electron/IntelligenceEngine.ts` — `handleSuggestionTrigger` only early-returns on an EXPLICIT `< 0.5`; absent
  confidence → planner falls through to `intentResult.confidence` (`?? 0`, the planner's `||` fallthrough) and
  `runWhatShouldISay` keeps its 0.8 default.
- `package.json` — `npm test` now also runs `electron/intelligence/autoAnswer/__tests__/**/*.test.mjs`.
- `electron/intelligence/autoAnswer/__tests__/AutoAnswerScheduler.test.mjs` — NEW: 16 tests, fake clock, zero sleeps.

Test results: `npm test` → tests 8316 · pass 8246 · fail 7 (the identical pre-existing 7, verified by diffing the
failing-test list against baseline) · skipped 63. Existing `AutoAnswer.test.mjs` 11/11 still pass.
`typecheck:electron` clean · `typecheck:ts7` (renderer) clean · `npm run build` OK.

Mutation probes (guard deleted → exactly this test reds → restored; diff-verified restore):
| Guard | Test that reds |
|---|---|
| hard cap (`min(DEBOUNCE, capRemaining)`) | hard cap: finals faster than the debounce still fire at HARD_CAP_MS |
| pending TTL | pending: expires after PENDING_TTL_MS without firing |
| pending dropped on newer final | pending: a newer interviewer final supersedes the parked candidate |
| pending turn must still be the live turn | pending: the slot does not fire if the latest turn changed underneath it |
| pending cleared on cancel() | pending: meeting stop drops the parked candidate |
| dedup (`lastAnsweredQuestion`) | an unchanged last turn is not re-dispatched after the cooldown |
| generation check | a stop→start inside the debounce window drops the timer |
| enabled precondition | toggle OFF: nothing is armed and nothing fires |

Validation labels:
- Hard cap, pending TTL/rearm/drop, dedup, generation, toggle-off: **Covered by automated tests** (scheduler
  unit, fake clock). The AppState→scheduler wiring itself (host callbacks, mode_changed hookup):
  **Reviewed but not executed** (typecheck + build only; no live meeting run).
- Settings persistence propagation (main → IPC → renderer rollback): **Reviewed but not executed** (typechecks
  on both sides; no degraded-store run).
- `confidence: 0.9` removal: **Covered by automated tests** for the type contract (build/typecheck) and
  **Reviewed but not executed** for the planner fallthrough at runtime (existing planner tests exercise
  `confidence || intentResult.confidence`).

Deviations from spec: none. Open questions for the human: none.

## Known residuals

## Abort record (if any)
