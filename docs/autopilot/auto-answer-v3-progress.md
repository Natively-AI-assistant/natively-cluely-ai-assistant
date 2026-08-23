# Auto Answer V3 — Campaign Progress

## Status: phase 4 complete

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

### Phase 2 — channel state machine and user-silence gating
Rust (`native-module/`):
- `src/channel_state.rs` — NEW: `ChannelStateTracker` (pure, clock-injected `on_edge(channel, speaking, now_ms)`),
  joint states `neither|interviewer_speaking|user_speaking|both`, per-transition timestamps and
  `ms_since_other_edge`; `user_edges_vad_backed` carries the mic-VAD platform split (injected via
  `for_platform(is_windows)`, the same pattern as `for_microphone_on`); process-global instance behind `global()`.
- `src/silence_suppression.rs` — `SpeechEdge {None, Started, Ended}` + `process_edges()`; `process()` is now a
  wrapper with unchanged semantics (existing tests untouched and green).
- `src/lib.rs` — `SpeechEdgeEvent` napi object; both `SystemAudioCapture::start` and `MicrophoneCapture::start`
  gain an OPTIONAL third callback `on_speech_edge`; each capture thread reports its rising/falling edge into the
  shared tracker and forwards the joint transition. A (re)start reports the channel silent. The existing
  `on_speech_ended` bool callback is byte-identical in behaviour.
- `index.d.ts` regenerated by `npm run build:native` (napi-rs).
TS:
- `electron/audio/speechEdge.ts` — NEW: `SpeechEdge` type + `normalizeSpeechEdge` (never throws on a bad payload).
- `electron/audio/SystemAudioCapture.ts`, `MicrophoneCapture.ts` — pass the third callback; emit `'speech_edge'`.
- `electron/main.ts` — both `wire*Capture` forward `'speech_edge'` to `autoAnswerScheduler.noteSpeechEdge` (guarded
  by the `this.xCapture === capture` identity check like the existing handlers); dispatch sets `automatic: true`;
  host exposes `cancelAutomaticAnswer`.
- `electron/intelligence/autoAnswerScheduler.ts` — `noteSpeechEdge()`; fire-time `channelsPermitDispatch()`:
  user speaking → drop `user_answering`; interviewer speaking / `both` / both-ended-within-`OVERLAP_VETO_MS` /
  user-silent-for-less-than-`USER_SILENCE_MS` → HOLD (re-arm) bounded by `HOLD_BUDGET_MS` (then
  `user_answering` if the user is talking, else `incomplete`); user start edge while armed/parked → cancel
  `user_answering`; user start edge while an automatic answer streams → `host.cancelAutomaticAnswer('user_barge_in')`.
  Bleed guard: a user start edge that overlaps interviewer speech only counts as the user when the mic edge is
  VAD-backed (macOS); on the RMS-only Windows mic it falls to the overlap hold instead. Tuning is injectable
  (`AutoAnswerChannelTuning`) so tests isolate each rule; defaults are the named placeholder constants
  `USER_SILENCE_MS=700`, `OVERLAP_VETO_MS=400`, `HOLD_BUDGET_MS=2500`.
- `electron/IntelligenceEngine.ts` — `automaticGenerationId` stamped before the first await of an automatic run
  (and on speculative-accept); `cancelAutomaticAnswer('user_barge_in')` aborts ONLY when the live WTA generation
  is the automatic one (a manual press mints a newer id → untouchable). `IntelligenceManager` proxies it.
- `electron/SessionTracker.ts` — `SuggestionTrigger.automatic?: boolean`.
- Skip reasons added: `user_answering`, `user_barge_in` (+ `incomplete` for the interviewer-never-stops budget).
- `__tests__/fakeClock.mjs` — `advance()` now throws after 10 000 timers (a runaway re-arm loop reads as red, not hung).
- `__tests__/AutoAnswerChannelGate.test.mjs` — NEW: 13 tests (user answers promptly / user silent fast /
  hold-to-exactly-USER_SILENCE_MS / barge-in cancel / RMS-only bleed no-cancel / overlap veto isolated /
  hold budget both reasons / interviewer-resume hold).

Tests: `cargo test` 26 passed (6 new: 5 channel_state incl. BOTH platform branches via injected flag, 1 SpeechEdge).
`cargo clippy` reports 7 errors, ALL pre-existing on main (keyboard_tap.rs, microphone.rs, sck.rs, silence_suppression
`is_voice`) — verified by stashing; `build:native` (cargo build) succeeds. Auto Answer TS tests: 29/29.
`npm test` → tests 8329 · pass 8259 · fail 7 (identical pre-existing set, diff-verified) · skipped 63. `typecheck:electron` 0 errors. `npm run build` OK.

Mutation probes (channel guards; each deletion reds exactly the named test(s); diff-verified restore):
| Guard | Test that reds |
|---|---|
| user-silence hold (`userSilenceMs - (now - lastUserEndedAt)`) | user silent after a hold: the dispatch is delayed exactly until USER_SILENCE_MS of silence |
| user speaking at fire → drop | user still speaking when the gate fires: dropped as user_answering, never held |
| user start edge cancels armed/parked | user answers promptly: … cancels the candidate; …parked candidate is dropped too (+2 silence tests) |
| overlap veto | overlap veto: both channels active at the boundary holds the dispatch |
| barge-in cancel | barge-in: user speech during a streaming automatic answer cancels it; …RMS-only mic does not cancel |
| hold budget | hold budget: …user_answering; interviewer who never stops: …incomplete |

Validation labels:
- Channel state machine (Rust): **Covered by automated macOS branch tests** and **Covered by automated Windows
  branch tests** (injected flag, run on macOS host); **Build validated on macOS**; **Reviewed but not executed on
  Windows** (cargo build/test not run on a Windows host; the changes are platform-neutral code).
- Gate preconditions / barge-in / skip reasons (TS): **Covered by automated tests** (fake clock).
- Bridge plumbing (napi third callback → capture classes → AppState → scheduler) and
  `IntelligenceEngine.cancelAutomaticAnswer` against a live stream: **Reviewed but not executed**.
  **Requires physical macOS verification** and **Requires physical Windows verification** for the live edge
  timing (real VAD hangovers: 600 ms system / 500 ms mic shift every edge relative to the transcript).

Deviations from spec: (1) the Rust tracker is fed by the suppressor's edges rather than "the existing per-channel
VAD" directly — the suppressor IS the VAD stage on both channels (system audio is RMS-only by design, #127);
(2) the bleed guard (VAD-backed requirement for an overlapping user start) is an addition, not in either spec —
it exists because the Windows mic is RMS-only and interviewer audio through speakers would otherwise cancel
every auto answer on Windows without headphones. Open question for the human: whether barge-in should PAUSE
rather than cancel (spec allows either; cancel was chosen as the simpler, token-saving option).

### Phase 3 — the AutoAnswer subsystem
`electron/intelligence/autoAnswer/` (all NEW):
- `AutoAnswerTypes.ts` — V2 §4 verbatim + V3: `TranscriptEndpointEvent.confidence?`, skip reasons
  `user_answering`/`user_barge_in` (+ the PR #497/Phase 1 lifecycle reasons), `AutoAnswerPolicyAction` with `offer`,
  `AutoAnswerCandidate` (carries `meetingGeneration` from accumulation START), structured telemetry event shape.
- `AutoAnswerTurnManager.ts` — V2 §5-§8: partial+final ingestion; utterance reconstruction (`joinFinals`); quiet
  window = pace preset `QUIET_WINDOW_MS {fast 700, balanced 1100, relaxed 1800}` restarted by every interviewer
  final/partial/speech-start; `HARD_CAP_MS=2500` from the first final (Phase 1 folded); user final or
  `CANDIDATE_GAP_MS=4000` closes the accumulation; undispatched commits are REVISED in place by a fast continuation
  (`REVISION_WINDOW_MS=1500`, extended to the gap by `holdOpen()` when the detector said incomplete) but NEVER by a
  final that follows a sentence already closed with terminal punctuation (`looksLikeContinuation`); provider
  endpoints commit immediately with source+confidence (Phase 5 consumes this).
- `AutoAnswerDetector.ts` — V2 §9-§17: wraps `extractLatestQuestion` (canonical layer, NOT duplicated) and reuses
  `questionShapes.ts`; adds completion (bare interrogative stub / dangling tail / ellipsis), dialogue acts
  (pause_request via `WAIT_IDIOM`, confirmation, rhetorical, backchannel, statement, social, coding/behavioral/
  technical/follow_up/general), directedness (2nd person / imperative vs exposition), and the composite
  `answerability` ON THE EXTRACTOR'S SCALE (measured: interrogatives 0.95, imperatives 0.80, "One more question —
  tell me…" 0.40 → `IMPERATIVE_ASK_FLOOR`, rhetorical 0.80 → act cap, "How would you" 0.95 → incomplete). Named
  constants `ANSWER_THRESHOLD=0.88`, `SPECULATION_THRESHOLD=0.82`, `WAIT_THRESHOLD=0.65`, per-source
  `ENDPOINT_BONUS`/`ENDPOINT_COMPLETION`, `ACT_CAP`, all commented unfitted.
- `AutoAnswerDedup.ts` — V2 §21/V3 A6: normalized equality → existing `speculativeQuestionSimilarity` (Jaccard,
  reused not rewritten; `DEDUP_JACCARD_THRESHOLD=0.80`, ambiguity band ≥0.25) → embedding cosine on survivors only
  (`REUSE_THRESHOLD=0.90`), cached by questionId, window `DEDUP_WINDOW=5`. Embedder injected; absent/failing →
  cheap layers decide.
- `AutoAnswerQueue.ts` — V2 §22: `MAX_QUEUE_DEPTH=1` single slot, same-id replace, oldest evicted,
  `QUEUE_TTL_MS=6000`, generation eviction.
- `AutoAnswerPolicy.ts` — V2 §40/V3 A4: PURE; CALLS `evaluateAutoAnswerGate` for the lifecycle half (the 11 gate
  tests keep their exact meaning — `autoAnswerGate.ts` is kept, not deleted) then the ternary `auto|offer|silent`
  + `wait|queue`; manual precedence before anything else; thresholds injected (Phase 6 per-mode).
- `AutoAnswerChannelGate.ts` — the Phase 2 dual-channel logic extracted as a pure verdict (`dispatch|hold|drop`).
- `AutoAnswerController.ts` — the facade: state machine (V2 §18), ids `${meetingGen}-q${seq}` (V2 §20), generation
  guards (V2 §28/§46: meeting at accumulation start, question identity, async-stale re-check), telemetry (V2 §29,
  NO text — a test greps every event), every skip reason machine-readable (V2 §30), speculative reuse keyed by
  questionId then embedding cosine then the engine's Jaccard (V3 A6). `ingest()` returns before touching state
  when the toggle is OFF.
- `__tests__/harness.mjs`, `AutoAnswerController.test.mjs` (51), `AutoAnswerComponents.test.mjs` (25). The Phase
  1/2 scheduler tests were PORTED onto the controller (every scenario kept), `autoAnswerScheduler.ts` and its two
  test files removed (the direct `scheduleAutoAnswer` path is gone per the spec).

Integration:
- `electron/main.ts` — AppState constructs the controller (host callbacks over IntelligenceManager; telemetry →
  `TelemetryService.track` with ids/acts/scores only; embedder lazily `new LocalEmbeddingProvider()`); the transcript
  handler calls `controller.ingest(segment)` for EVERY segment (any speaker, partial or final); `speech_edge` →
  `controller.onSpeechEdge`; `startMeetingTransition` → `onMeetingStart`; stop / toggle-off → `onMeetingStop`;
  `mode_changed idle` → `onEngineIdle`.
- `electron/IntelligenceManager.ts` — narrow APIs (V2 §43): `getLiveTranscriptBrain()` (ONE lazily built brain over
  the stable session — the canonical read surface, V2 §11), `runAutoAnswer`, `isManualAnswerActive`,
  `noteAutoAnswerCandidate`, `getSpeculativeSnapshot`.
- `electron/IntelligenceEngine.ts` — `runAutoAnswer(question, {reuseSpeculative})` delegates to
  `handleSuggestionTrigger` with the optional identity fields (V2 §44, no second generation stack);
  `handleSuggestionTrigger` accepts keyed reuse without Jaccard; `maybeSpeculate` stamps the controller's candidate
  id on the speculative cache (`speculativeQuestionId`); `isManualAnswerActive`, `getSpeculativeSnapshot`.
- `electron/SessionTracker.ts` — `SuggestionTrigger` gains optional `questionId, answerability, dialogueAct,
  isFollowUp, endpointSource, candidateGeneration, reuseSpeculative` (V2 §26; existing callers untouched).

Deviations from spec (recorded):
- Layer-3 embeddings use the bundled `Xenova/all-MiniLM-L6-v2` (384-d) — bge-small is NOT bundled (Phase 0 §11).
- Speculation is not started by the controller; the engine's existing `maybeSpeculate` on interviewer partials IS
  the speculative WTA infrastructure (V2 §19 "do not duplicate"). The controller keys that cache to its candidate
  id and marks state `speculating`; a second speculative trigger would double-spend tokens.
- Balanced quiet window moves 900 → 1100 ms (the prompt's Phase 5 preset values); Phase 5 fusion shrinks it for
  confident endpoints.
- `confirmation` ("Can you hear me?") is reported under skip reason `not_question` (the V2 §30 enum has no
  `confirmation`; the dialogue act still says `confirmation` in telemetry).
- V2 §3's `AutoAnswerDecision.ts`/`AutoAnswerQuestion.ts` are folded into Types/Detector (the prompt's file list
  governs). `AutoAnswerDedup.ts` and `AutoAnswerChannelGate.ts` are additional files inside the subsystem directory.

Mutation probes (each deletion → exactly the named test(s) red; diff-verified restore):
| Guard | Test that reds |
|---|---|
| dedup cheap layers (controller) | dedup: a paraphrase…; dedup layer 3… |
| dedup verdict (policy) | Policy: healthy input…; both dedup tests |
| meeting generation (policy gate + dispatch re-check, deleted TOGETHER) | generation guard: a stop→start…; Policy: healthy input… |
| async stale re-check after the embedder await | generation guard (async path)… — this probe also exposed and fixed a real bug: in-flight was marked before the await, so a stale drop left Q2 queued forever |
| manual precedence (policy) | manual precedence: …never superseded; Policy: manual precedence…; Policy: healthy input… |
| single-flight queue (policy) | Policy: healthy input… |
| user-silence hold (channel gate) | user silent: …USER_SILENCE_MS…; generation guard: a newer question…; channel gate: reset… |
| hard cap (turn manager) | hard cap: …HARD_CAP_MS (controller + TurnManager) |
| dispatch-time question-identity line in `dispatch()` and the hold-timer identity line | NO test reds when deleted — they are unreachable defense in depth (a new commit always clears the old hold timer first; the queue path checks identity on its own line). Kept because V2 §46 mandates the check; recorded honestly as redundant. |

Tests: Auto Answer suite 76/76 (zero real sleeps). Existing `AutoAnswer.test.mjs` (gate + canAutoAnswer) 11/11.
`typecheck:electron` 0 errors · `typecheck:ts7` (renderer) 0 errors · `npm run build` OK · `npm test` tests 8376 · pass 8306 · fail 7 (identical pre-existing set, diff-verified) · `test:intelligence` 1897 / 1885 / 3 (identical pre-existing set).

Validation labels:
- Subsystem behaviour (turn reconstruction, detector bands, dedup, queue, policy, state machine, generation guards,
  channel gating, telemetry shape, toggle-OFF): **Covered by automated tests**.
- AppState/IntelligenceManager/IntelligenceEngine wiring (host callbacks, `runAutoAnswer` → planner →
  `runWhatShouldISay`, keyed speculative reuse against a live speculative stream, LocalEmbeddingProvider in the
  main process): **Reviewed but not executed** (typecheck + build + existing engine tests only; no live meeting).
- **Requires physical macOS verification** and **Requires physical Windows verification** for the end-to-end
  toggle-ON behaviour with a real STT provider.

Open questions for the human: (1) the balanced window 900→1100 ms; (2) whether `offer` should already be wired
to a surface in Phase 3 (it is telemetry-only until Phase 6 by design).

### Phase 4 — replay harness, provider-dialect parity, adversarial fixtures, offline evaluator
- `__tests__/replay.mjs` — fixture loader, dialect adapters, `replay()` (runs a fixture through the real controller on
  the fake clock), `judge()`. Dialects: `canonical`, `flux` (turn-level final + EndOfTurn confidence 0.8), `nova`
  (is_final fragments + speech_final + UtteranceEnd at +1000), `assemblyai` (finals + end_of_turn 0.85), `elevenlabs`
  (finals only), `rest-whisper` (one batch final per utterance at +800 upload latency, no partials/endpoints).
- `__tests__/fixtures/*.json` — 34 fixtures, generated from one script for consistency: 8 positives, fragmented,
  no-punctuation, 10 negatives, continuation, dedup pair, follow-up ("And why?"), question-then-continued-speech,
  manual precedence, stop/restart, user-answers-promptly, user-silent-fast-fire, interviewer self-answer within hold,
  cross-channel overlap, code-switching pause, barge-in, 2× declarative (`expectedFail: true`).
- `__tests__/AutoAnswerReplay.test.mjs` — bucket coverage test; per-fixture canonical assertion (expectedFail fixtures
  are asserted to STILL fail so the flag can only be flipped deliberately); per-fixture parity across all dialects
  (shouldAnswer / question / triggerCount identical; latency free). **No `knownGap` was needed — REST-Whisper parity
  holds** because the quiet window operates on batch finals too.
- `__tests__/evaluator.mjs` + `npm run test:auto-answer:eval` (separate slow target, `--gate` fails on any false or
  premature trigger) and `npm run test:auto-answer` (the subsystem suite alone).

Harness findings that changed the subsystem (all now tested):
1. Provider-endpoint dialects commit INSTANTLY, which exposed that "user silent for USER_SILENCE_MS" was only a
   backward-looking check. It is now a post-commit window measured from the interviewer's end of speech
   (`lastInterviewerEndedAt`), so an instant endpoint still gives the user 700 ms to start answering first. A
   quiet-window commit has already waited, so no latency is added there.
2. User speech that BEGAN while the interviewer was still talking is an `overlap` (hold within budget), not
   `user_answering` (drop) — the cross-channel-overlap fixture diverged by dialect before this.
3. An accumulation abandoned by a user turn now emits `user_answering` (TurnManager `onDiscard`) — it was a silent drop.
4. Detector: `SELF_ANSWERED` ("Why do we shard by user id? Because hot keys." → rhetorical) and `DEFERRAL`
   ("How would you scale this if... Actually, before that, let me…" → pause_request).

Evaluator (204 runs = 34 × 6): question_precision 1.0 · question_recall 0.90 (the 12 expected-fail declarative runs
are the only misses) · answer_opportunity_precision 1.0 · recall 0.90 · false_trigger_rate 0 · duplicate_trigger_rate 0 ·
premature_trigger_rate 0 · question_reconstruction_accuracy 1.0 · endpoint_to_decision_ms median: canonical/elevenlabs/
rest-whisper 1100, flux/nova/assemblyai 850 · median_decision_to_first_token_ms: null (no LLM offline) ·
calibration: 0.9-1.0 bucket n=129 observed precision 0.93, 0.4-0.5 n=12 precision 1.0 (candidates inside positive
fixtures that are not the dispatched question), ≤0.3 precision 0. Calibration is heuristic-vs-label only; it is NOT a
probability until the audio corpus exists (V3 Amendment 8 — human work, out of scope).

Tests: Auto Answer suite 147/147 (76 unit + 71 replay/parity). `npm test` → tests 8447 · pass 8377 · fail 7 (identical
pre-existing set) · skipped 63. `typecheck:electron` 0 errors.
Validation labels: replay harness, dialect parity, adversarial buckets, evaluator: **Covered by automated tests**.
Dialect adapters are MODELS of provider behaviour (from the providers' documented event shapes), not recordings —
**Requires physical verification** against each live provider remains (V2 §48 step 9).
Deviations: the fixture `follow_up` judges `isFollowUp` on the SECOND dispatch in a dedicated test (the first
dispatch is the Redis question). Open questions: none.

## Known residuals

## Abort record (if any)
