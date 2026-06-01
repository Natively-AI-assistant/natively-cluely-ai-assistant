Launching all four agents in
  parallel with distinct scopes to
  find what's still missing for
  production parity with Cluely and
  Final Round AI — after the 12 fixes
  are in.

⏺ 4 background agents launched (↓ to
  manage)
   ├ backend-architect (Research
     competitor architecture gaps)
   ├ code-reviewer (Audit adjacent
     subsystems for same bugs)
   ├ test-engineer (Design behavioral
     E2E test harness)
   └ fullstack-developer (Audit
     renderer-side audio state)

⏺ All four agents launched in
  parallel. Each has a distinct scope:

  - backend-architect — Cluely / Final
   Round AI / Granola public
  engineering research + macOS 26
  Process Tap evolution + production
  Electron audio patterns post-2025;
  identifies what we still DON'T have
  after the 12 fixes (in-band language
   switching, multichannel WS,
  telemetry, speculative WS warmup,
  etc.).
  - code-reviewer — Audits 10 adjacent
   subsystems for the same bug classes
   we just fixed: IntelligenceEngine,
  ProviderRouter, CredentialsManager,
  StealthKeyboardManager, RateLimiter,
   CalendarManager, RAGManager,
  EmbeddingPipeline, OllamaManager,
  NativelyInterface. Same
  FFI/timer/state-machine patterns.
  - test-engineer — Designs the
  behavioural test harness for the 4
  timing offsets (50ms/500ms/2s/5s) we
   never actually executed, plus
  reconnect storm soak + AirPods
  replay + cold-start latency.
  Concrete fixture specs.
  - fullstack-developer —
  Renderer-side audit: Stop/Start
  button debouncing, useEffect dep
  churn, streaming token queue race
  conditions, audio status event
  handling. Differentiates between
  bugs the main-process fixes covered
  vs. genuinely new ones.

  I'll consolidate when they return.

✻ Cogitated for 2m 1s · 4 local agents
   still running

⏺ Agent "Design behavioral E2E test
harness" completed
     
⏺ Test-engineer is in with a concrete
  fixture design: ~1320 LOC, ~24 hours
   across 4 phases to ship the full
  behavioural suite (50ms/500ms/2s/5s
  offset tests + reconnect storm +
  AirPods replay + cold-start
  latency). Three fixtures unlock
  everything: shared
  fakeNativeModule.mjs,
  electronHarness.mjs,
  clockHelpers.mjs.

  Highlights:    
  - Phase 1 (~6 hrs): fake native
  module + electron harness +
  (50ms/500ms/2s/5s) we never actually executed, plus reconnect storm soak + AirPods replay +
  cold-start latency. Concrete fixture specs.
  - fullstack-developer — Renderer-side audit: Stop/Start button debouncing, useEffect dep churn,
   streaming token queue race conditions, audio status event handling. Differentiates between
  bugs the main-process fixes covered vs. genuinely new ones.

  I'll consolidate when they return.

✻ Cogitated for 2m 1s · 4 local agents still running

⏺ Agent "Design behavioral E2E test harness" completed

⏺ Test-engineer is in with a concrete fixture design: ~1320 LOC, ~24 hours across 4 phases to
  ship the full behavioural suite (50ms/500ms/2s/5s offset tests + reconnect storm + AirPods
  replay + cold-start latency). Three fixtures unlock everything: shared fakeNativeModule.mjs,
  electronHarness.mjs, clockHelpers.mjs.

  Highlights:
  - Phase 1 (~6 hrs): fake native module + electron harness + fake-clock docs → unlocks the 50ms
  + 500ms offset tests immediately
  - Phase 2 (~5 hrs): fake WebSocket + _injectDeviceId test hook on DefaultOutputWatcher →
  unlocks 2s/5s offsets + reconnect storm
  - Phase 3 (~8.5 hrs): the four offset tests
  - Phase 4 (~4.5 hrs): cold-start latency budget (~50ms pure JS coordination, real cpal cost
  noted as out-of-scope comment), reconnect storm rewrite (600 cycles × 500ms → assert ≤30
  reconnects), AirPods route-change debounce

  Still waiting on backend-architect (competitor research), code-reviewer (adjacent subsystems),
  and fullstack-developer (renderer audit).

✻ Baked for 14s · 3 local agents still running

⏺ Agent "Audit adjacent subsystems for same bugs" completed

⏺ Code-reviewer back: 12 adjacent-subsystem findings, with 4 HIGH-severity, 5 MEDIUM, 3 LOW. None
   at the audio-lifecycle "Critical" tier (no V8-teardown FFI crashes), but real issues.
     
  The 4 HIGHs all share patterns we just fixed in the audio layer but in different subsystems:

  1. CalendarManager.refreshAccessToken() fired as floating promise from sync init →
  unhandled-rejection + race with disconnect() deleting the token file → silent sign-out on next
  launch.
  2. CalendarManager.scheduleReminders — orphan setTimeouts survive disconnect() → privacy leak:
  reminder banner with event title pops AFTER the user revoked calendar access.
  3. CalendarManager has no dispose() and isn't wired into before-quit — OAuth loopback HTTP
  server stays bound to port 11111 during V8 teardown.
  4. IntelligenceEngine.reset() doesn't plumb AbortSignal into
  whatToAnswerLLM.generateStream(...) — billing accrues for 5–30s after reset, and two streams
  can race in the next meeting. (Same class as audio Issue 11, just on the LLM stream side.)

  Mediums include: IntelligenceEngine.reset() doesn't reset DynamicActionEngine (ghost cards from
   prior meeting), OllamaManager.pollInterval not nulled after clearInterval, PhoneMirrorService
  WS ping intervals fire after WS half-destroyed, ProviderRouter.circuitBreakers Map never pruned
   (with 'gemini' vs 'gemini_flash' naming inconsistency), StealthKeyboardManager native tap
  never disposed.

  Clean subsystems: ProviderRouter CircuitBreaker state machine, streamingTokenQueue.mjs,
  RAGManager._reprocessInFlight guard.

  Still waiting on backend-architect and fullstack-developer.

✻ Baked for 24s · 1 local agent still running

⏺ Agent "Audit renderer-side audio state" completed

⏺ Fullstack-developer back. 10 renderer findings. The main-process fixes covered or made
  invisible 4 of them, but 3 are genuinely new and surface because the main-process is now fast:
     
  F-6 (CRITICAL, new): streamingTokenQueue.mjs has no AbortController scoping. On session-reset,
  streamingMsgIdRef, streamingTextRef, streamingNodeRef, streamingIntentRef, streamingRafRef,
  tokenBufRef are NOT cleared. Late intelligenceSuggestedAnswerToken events from meeting A drain
  through preload into meeting B's first bubble. Idempotency relies entirely on id matching —
  which is the next bug.

  F-8 (MEDIUM, now reachable): streamingMsgIdRef = Date.now().toString(). Before the audio fixes,
   end→start had a ~300ms gap; now sub-millisecond. Same-ms ID collision drops the first token of
   the new stream because applyFirstStreamingToken thinks it's a late mount on the finalized
  previous row.


  F-1 (CRITICAL, classic): Stop button in TopPill.tsx:88-102 has no disabled prop. Double-click
  fires two endMeeting IPCs. Survivable thanks to your idempotent teardown, but the second IPC
  still races the launcher window-swap.

  F-2 (HIGH): Start button has no in-flight guard during the 5–7s audio init. Double-click stacks
   two startMeeting IPCs AND writes localStorage.natively_last_meeting_start = Date.now() twice,
  corrupting the duration-threshold check.

  Covered by main-process fixes (no action needed):
  - F-9: setIsExpanded(true) racing user collapse during teardown — sub-frame now thanks to fix
  #6's synchronous window swap.
  - F-10: Launcher initial-fetch promise resolving after unmount — mounted flag already handles
  it.
  - F-7: [isExpanded] deps on size-reporter — IPC handlers themselves use [], only ResizeObserver
   churn.

  Priority order:
  1. F-6 (streaming refs) — directly contradicts main-process abort intent
  2. F-1 + F-2 (button debounce) — visible to any user who double-clicks
  3. F-8 (id collision) — now reachable because end→start is fast
  4. F-3 (isProcessingMeeting stuck on abort)
  5. F-4 (banner dedup), F-5 (missing ?.)

  Still waiting on backend-architect for competitor research. I'll consolidate everything once
  that lands.

✻ Cooked for 24s · 1 local agent still running

⏺ Agent "Research competitor architecture gaps" completed

⏺ All four agents back. Here's the consolidated answer to your question.

  Why Cluely / Final Round AI don't have these issues

  The honest answer from the backend-architect research is: they're not more sophisticated than 
  you — they sidestep the problem entirely.

  - Cluely (reverse-engineered by Prathit Joshi, May 2025) is a plain Electron app with
  BrowserWindow({transparent, alwaysOnTop}), clipboard + screenshots + mic only. No system audio 
  capture at all in the original product. No Rust native module. Most users run one short
  interview per launch — the lifecycle bugs you fixed simply never trigger in their flow.
  - Final Round AI — no engineering blog, no GitHub. Their Glassdoor + listings imply they use
  Recall.ai's hosted SDK (YC W20) — they outsourced the lifecycle problem to a $/session API.
  - Granola — engineering blog has zero audio posts. Reverse-engineered API docs show server-side
   STT only. Reddit consensus: native Swift + ScreenCaptureKit, not Electron. Their bug class
  doesn't exist because the runtime doesn't have V8 teardown races.
  - Closest analog to your stack: Pickle's open-source Glass (7.5k stars, JS Electron,
  pickle-com/glass). Their sttService.js has patterns you don't have yet (see gaps 3 + 4 below).
  
  What's left after the 12 fixes — prioritized
  
  Tier 1 — Ship before next release (genuinely new bugs)

  These came out of the renderer + adjacent-subsystem audits. They're new bug classes, not gaps
  in the audio layer.

  1. F-6 (CRITICAL, renderer) — src/lib/streamingTokenQueue.mjs has no session-epoch scoping.
  Late intelligenceSuggestedAnswerToken events from meeting A drain through preload into meeting
  B's first bubble. streamingMsgIdRef, streamingTextRef, streamingNodeRef, streamingIntentRef,
  streamingRafRef, tokenBufRef are NOT cleared on onSessionReset. Fix: add monotonic
  sessionEpochRef; queueToken drops tokens stamped with earlier epoch.
  2. F-1 + F-2 (HIGH, renderer) — Stop button + Start button have no in-flight guard.
  TopPill.tsx:88-102 has no disabled prop. Double-click stacks two IPCs; Start case corrupts
  localStorage.natively_last_meeting_start. ~30 lines to fix.
  3. F-8 (MEDIUM, now reachable) — streamingMsgIdRef = Date.now().toString(). Sub-millisecond
  Start→Stop→Start (now possible after audio fixes) → same-ms ID collision → first token of new
  stream silently dropped. Fix: ${Date.now()}-${crypto.randomUUID().slice(0,8)}.
  4. IntelligenceEngine.reset() HIGH (code-reviewer) — whatToAnswerLLM.generateStream(...) has no
   AbortSignal plumbed. On reset(), currentGenerationId bumps but the LLM stream burns 5–30s of
  billing AND can race a new meeting's stream. Same class as audio Issue 11, just on the LLM
  side.
  5. CalendarManager HIGH (code-reviewer) — scheduleReminders setTimeouts survive disconnect() →
  privacy leak: notification with event title pops after user revoked Calendar. Also no dispose()
   hook on before-quit → OAuth loopback HTTP server bound during V8 teardown.

  Estimated effort for Tier 1: ~1.5 days. Pure renderer + LLM-stream + CalendarManager work. No
  new architecture.

  Tier 2 — Architectural improvements that close the competitor gap (weeks)
  
  1. Multichannel single WebSocket — Deepgram multichannel=true&channels=2, AssemblyAI v3. Halves
   your WS lifecycle surface. Eliminates "mic transcript arrived but system didn't" race. Days.
  Highest leverage/cost ratio.
  2. In-band language switching — replace the language_detected → reconnect → 250ms debounce path
   with session.update / UpdateConfiguration control message on the existing socket. Eliminates
  1–2 second transcription gap on language switch. Days per provider.
  3. Proactive session renewal with overlap — Glass uses SESSION_RENEW_INTERVAL_MS = 20min +
  SOCKET_OVERLAP_MS = 2s. New socket comes up, both run 2s, old closes. Fixes "transcription died
   at minute 28" in long meetings. Days.
  4. Keep-alive heartbeat — KEEP_ALIVE_INTERVAL_MS = 60s with provider-specific no-op. You
  currently rely on audio frames as implicit keep-alive; fails during silence/mute. Day per 
  provider.
  5. Speculative WS warmup — open TLS+auth when the launcher mounts; reuse on Start. Cuts
  perceived cold-start by 200–800ms. With 5s grace before opening to avoid quota burn on launcher
   toggling. Days.

  Tier 3 — Foundational (months)
  
  1. Unified SCStream on macOS 15+ — SCStreamConfiguration.captureMicrophone = true +
  microphoneCaptureDeviceID. Single SCStream produces both .audio and .microphone outputs from
  one delegate queue. Eliminates the entire dual-pipeline class (half your 12 fixes exist because
   of mic/system duality). Add as if #available(macOS 15.0) path with current 14.4 path as
  fallback. Weeks.
  2. Native lifecycle ownership (Rust-side) — move start/stop/abort into the Rust module behind a
   single fd/pipe. TS sends signals only. Issue 12 (before-quit V8 teardown) exists because TS
  owns lifecycle; this eliminates that bug class entirely. AudioCap and Glass's SystemAudioDump
  binary do this. Weeks.
  3. Structured concurrency primitive (LifecycleScope) — replace ad-hoc AbortController + 
  Promise<void> pairs with a single LifecycleScope abstraction (rust-side CancellationToken with
  parent/child cascade). Future-proofs against the next class of "endMeeting fired while X was
  happening" bugs. Week.
  4. Production telemetry for race conditions — LifecycleTransitionMetric { from, to, durationMs,
   abortedMidFlight }. You currently can't tell if Issue 3 is fixed in production; only
  user-reported. Week.
  5. Device hot-plug without restart — SCK 15 supports swapping microphoneCaptureDeviceID on a
  running stream; cpal supports Stream::pause() + rebuild without process teardown. AirPods
  connect/disconnect mid-meeting no longer drops 2–3s of transcript. Week.

  Tier 4 — Test infrastructure (~24 hours from test-engineer's spec)
  
  The 60 structural tests pin wiring but never drive real timing. Test-engineer's fixture spec:
  - Phase 1 (~6 hrs): fakeNativeModule.mjs + electronHarness.mjs + clockHelpers.mjs → unlocks
  50ms + 500ms offset tests
  - Phase 2 (~5 hrs): fakeWebSocket.mjs + DefaultOutputWatcher._injectDeviceId test hook →
  unlocks 2s/5s offsets + reconnect storm soak
  - Phase 3 (~8.5 hrs): four behavioural offset tests (endMeeting at 50ms / 500ms / 2s / 5s
  during init)
  - Phase 4 (~4.5 hrs): cold-start latency budget, reconnect storm rewrite (600 cycles → assert
  ≤30 reconnects), AirPods route-change debounce

  Total ~1320 LOC, ~24 engineering hours.

  CalendarManager work. No new architecture.

  Tier 2 — Architectural improvements that close the competitor gap (weeks)

  1. Multichannel single WebSocket — Deepgram multichannel=true&channels=2,
   AssemblyAI v3. Halves your WS lifecycle surface. Eliminates "mic
  transcript arrived but system didn't" race. Days. Highest leverage/cost
  ratio.
  2. In-band language switching — replace the language_detected → reconnect
   → 250ms debounce path with session.update / UpdateConfiguration control
  message on the existing socket. Eliminates 1–2 second transcription gap
  on language switch. Days per provider.
  3. Proactive session renewal with overlap — Glass uses
  SESSION_RENEW_INTERVAL_MS = 20min + SOCKET_OVERLAP_MS = 2s. New socket
  comes up, both run 2s, old closes. Fixes "transcription died at minute
  28" in long meetings. Days.
  4. Keep-alive heartbeat — KEEP_ALIVE_INTERVAL_MS = 60s with
  provider-specific no-op. You currently rely on audio frames as implicit
  keep-alive; fails during silence/mute. Day per provider.
  5. Speculative WS warmup — open TLS+auth when the launcher mounts; reuse
  on Start. Cuts perceived cold-start by 200–800ms. With 5s grace before
  opening to avoid quota burn on launcher toggling. Days.

  Tier 3 — Foundational (months)

  1. Unified SCStream on macOS 15+ —
  SCStreamConfiguration.captureMicrophone = true +
  microphoneCaptureDeviceID. Single SCStream produces both .audio and
  .microphone outputs from one delegate queue. Eliminates the entire
  dual-pipeline class (half your 12 fixes exist because of mic/system
  duality). Add as if #available(macOS 15.0) path with current 14.4 path as
   fallback. Weeks.
  2. Native lifecycle ownership (Rust-side) — move start/stop/abort into
  the Rust module behind a single fd/pipe. TS sends signals only. Issue 12
  (before-quit V8 teardown) exists because TS owns lifecycle; this
  eliminates that bug class entirely. AudioCap and Glass's SystemAudioDump
  binary do this. Weeks.
  3. Structured concurrency primitive (LifecycleScope) — replace ad-hoc
  AbortController + Promise<void> pairs with a single LifecycleScope
  abstraction (rust-side CancellationToken with parent/child cascade).
  Future-proofs against the next class of "endMeeting fired while X was
  happening" bugs. Week.
  4. Production telemetry for race conditions — LifecycleTransitionMetric {
   from, to, durationMs, abortedMidFlight }. You currently can't tell if
  Issue 3 is fixed in production; only user-reported. Week.
  5. Device hot-plug without restart — SCK 15 supports swapping
  microphoneCaptureDeviceID on a running stream; cpal supports
  Stream::pause() + rebuild without process teardown. AirPods
  connect/disconnect mid-meeting no longer drops 2–3s of transcript. Week.

  Tier 4 — Test infrastructure (~24 hours from test-engineer's spec)

  The 60 structural tests pin wiring but never drive real timing.
  Test-engineer's fixture spec:
  - Phase 1 (~6 hrs): fakeNativeModule.mjs + electronHarness.mjs +
  clockHelpers.mjs → unlocks 50ms + 500ms offset tests
  - Phase 2 (~5 hrs): fakeWebSocket.mjs +
  DefaultOutputWatcher._injectDeviceId test hook → unlocks 2s/5s offsets +
  reconnect storm soak
  - Phase 3 (~8.5 hrs): four behavioural offset tests (endMeeting at 50ms /
   500ms / 2s / 5s during init)
  - Phase 4 (~4.5 hrs): cold-start latency budget, reconnect storm rewrite
  (600 cycles → assert ≤30 reconnects), AirPods route-change debounce

  Total ~1320 LOC, ~24 engineering hours.

  My recommended sequence
  The 60 structural tests pin wiring but never drive real timing. Test-engineer's fixture spec:
  - Phase 1 (~6 hrs): fakeNativeModule.mjs + electronHarness.mjs + clockHelpers.mjs → unlocks 50ms + 500ms offset tests
  - Phase 2 (~5 hrs): fakeWebSocket.mjs + DefaultOutputWatcher._injectDeviceId test hook → unlocks 2s/5s offsets + reconnect storm soak
  - Phase 3 (~8.5 hrs): four behavioural offset tests (endMeeting at 50ms / 500ms / 2s / 5s during init)
  - Phase 4 (~4.5 hrs): cold-start latency budget, reconnect storm rewrite (600 cycles → assert ≤30 reconnects), AirPods route-change debounce

  Total ~1320 LOC, ~24 engineering hours.

  My recommended sequence

  1. This week: Tier 1 (1.5 days). The renderer fixes neutralize the visible double-click bugs and seal the streaming token leak that your audio fixes
  accidentally exposed by making end→start fast.
  2. Next sprint: Tier 2 #1 (multichannel WS) and Tier 2 #5 (speculative warmup). Days each, biggest user-visible wins. Cuts cold-start by ~1s and halves
  your STT-quota burn.
  3. Following sprint: Tier 4 behavioural test infrastructure (~24 hrs). Gives you the regression net to refactor confidently in Tier 3.
  4. Quarter: Tier 3 #1 (unified SCStream on macOS 15) — this is the architectural shift that puts you ahead of Cluely / Final Round AI by closing the
  dual-pipeline gap they sidestep by not capturing both sources.

  The honest competitor framing: after the 12 fixes you've shipped, you're already more lifecycle-correct than Cluely. Granola is ahead because they're
  Swift-native. Final Round outsourced. The remaining gap to "production-grade meeting AI" is in the renderer (Tier 1), feature parity around session
  renewal/keep-alive/multichannel (Tier 2), and going native on macOS 15+ (Tier 3). None of it is exotic.

  Want me to start on Tier 1?

✻ Cooked for 1m 34s
