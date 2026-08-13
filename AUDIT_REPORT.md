# Natively Full-App Audit — Autopilot Campaign

Started: 2026-08-14
Branch for fixes: `audit/autopilot-2026-08-14` (created lazily at first verified fix; working dir is shared with in-flight work on `fix/answer-policy-and-conversation-state`, 51 dirty files at campaign start — commits will be scoped to audit-touched files only)
Live LLM testing: DeepSeek `deepseek-chat` via `DEEPSEEK_API_KEY` in `.env` (verified present)

## Campaign status

| Phase | Area | Status |
|-------|------|--------|
| 1 | Core runtime & IPC (main/renderer/preload, windows, overlay, audio bridge) | AUDIT PASS IN PROGRESS |
| 2 | STT pipeline | pending |
| 3 | LLM routing & Answer Policy | pending |
| 4 | Knowledge / RAG / OKF | pending |
| 5 | Modes & Profile Intelligence | pending |
| 6 | Backend & licensing | pending |
| 7 | Settings, persistence, updater, packaging | pending |

## Architecture snapshot (from code-review-graph)

29 communities, dominant ones: `electron/services` (915 nodes), `electron` root (611 — main/windows/IPC), `src/components` (391), `electron/audio` (308), `electron/rag` (257), `native-module/src` (195, Rust audio bridge), `electron/llm` (192). No cross-community coupling warnings reported by the graph.

---

# Phase 1 — Core runtime & IPC

Read-only audit pass: 3 parallel explorations dispatched 2026-08-14 —
(a) main process bootstrap / window lifecycle / overlay, (b) IPC contracts / preload / renderer bridge, (c) audio capture native bridge.

Findings will be recorded below in severity order as they are triaged.

Verification baseline (2026-08-14, working tree): `npm run typecheck:electron` → clean (exit 0). Full test-suite baseline deferred until first fix is staged (build mutates `dist/` in a shared workspace).

## Findings — candidate list (audit pass; statuses advance per-finding)

### Sub-area C: audio capture / native bridge (exploration complete)

## F-101 [P1→INVALID] Mic emitted-rate lies when resampler init fails
Phase: 1 | Area: native-module mic DSP / MicrophoneCapture
Status: FOUND → INVALID (2026-08-14)
Verdict reasoning: The code asymmetry is real — the mic DSP thread (lib.rs:516-547) never stores `emitted_rate` back into `self.sample_rate`, unlike the system path (lib.rs:275), and the constructor value is unconditionally 16000. BUT the trigger is unreachable: the passthrough branch only executes when `Resampler::new` fails, and in rubato 0.16.2 (Cargo.lock-pinned) `FftFixedIn::new`'s ONLY fallible check is `validate_sample_rates` (synchro.rs:81-86), which errors solely when input or output rate == 0. cpal never reports a 0 Hz device rate and the output rate is the constant 16000, so `Resampler::new` is total over the real input domain. Every reachable path emits 16 kHz, matching the declared rate. Dead error branch → hypothetical bug → not fixed, per campaign rules.
FOLLOW-UP (hardening, optional): mirror lib.rs:275's store-back in the mic DSP thread so a future rubato upgrade can't resurrect this silently.
Hypothesis: `MicrophoneCapture::new` (native-module/src/lib.rs:435, restart at :481) sets the shared emitted-rate atomic optimistically to 16000; the DSP thread (lib.rs:520-531) can fall back to passthrough at native rate when `Resampler::new` fails but never stores the real rate back to `self.sample_rate` (SystemAudioCapture does at lib.rs:275). `MicrophoneCapture.getSampleRate()` then reports 16000 for 48000 Hz PCM; main.ts:3571-3577 locks STT at 16k → chipmunk audio → garbage user transcript. JS wrapper has no rate poll (unlike SystemAudioCapture.ts:162-163).
Disproof criteria: `Resampler::new` total over all cpal rates; or a mic-DSP writer to `self.sample_rate` missed by the audit.
Confidence: high.

## F-102 [P1] Orphaned capture instance keeps writing into live STT
Phase: 1 | Area: main.ts wireSystemCapture/wireMicCapture + rebuild flows
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation refined the reachability: recovery and route-change DO guard each other (recovery defers at :4662, route-change at :4868 — the explorer's proposed pairing is actually mutually excluded at entry). The unguarded third party is restartCapturesAfterResume: no mutex, clears both flags (:3916/:3923), and NONE of the three flows re-validate field ownership after their awaits before assigning. The mic-recovery finally block (:5027-5034) already applies exactly this ownership-revalidation pattern to the paused system capture — the flows' own assignments never did.
Repro: scripts/audit/F-102-repro.mjs — live AppState, fake meeting flags, STT stubs (no network), recovery saturated; handleDefaultOutputChanged + restartCapturesAfterResume fired in ONE synchronous turn (both suspend on the capability await; deterministic interleave). PRE-FIX: '(RouteChanged)' fresh constructed/assigned/wired/started, then '(Resume)' assignment overwrote it → orphanCount 1, both instances alive → exit 1.
Root cause: (a) rebuild flows assign into this.systemAudioCapture after awaits without re-checking the null they left (route-change :4880→:4909; recovery :4718→:4741; resume :3986→:4003); (b) the data write :3487 (mic :3666) has no instance-identity guard, unlike siblings :3424/:3475, so the orphan keeps feeding the live STT socket.
Fix: (1) ownership revalidation in all three flows — after the awaits, a non-null field means another flow rebuilt mid-await; keep theirs and return. (2) Instance-identity guards on the data/sample_rate_changed/speech_ended consumers in wireSystemCapture AND wireMicCapture.
E2E verification: repro re-run → exit 0 (aliveCount 1, orphanCount 0, field owns the survivor). Regression pin: electron/services/__tests__/CaptureOwnershipGuards2026_08_14.test.mjs. Adjacent tests green (ZerofillDetectorPeakToPeak, AudioCaptureFailedBroadcastBothSurfaces); typecheck clean; F-103 repro re-run PASS on top of these changes (same handler touched).
Regression check: normal single-flow rebuilds unaffected (field is null when they construct); the identity guards drop only chunks from a capture that already lost ownership (≤ms of teardown-window audio, previously interleaved garbage).
Cross-platform: pure JS state-machine fix, platform-neutral; macOS live-verified, Windows reviewed but not executed.
Commit: 0d0740fe
Hypothesis: data-path writes are the only consumers NOT gated on instance identity (main.ts:3487 `this.googleSTT?.write(chunk)`, :3666 mic equivalent; guarded siblings at :3424/:3475/:3518/:3571). A capture that loses ownership of the field without being destroyed keeps pumping PCM into the live STT socket. Reachable when `restartCapturesAfterResume` (no own mutex; clears both recovery mutexes at :3916/:3923) races `handleDefaultOutputChanged` (:4856-4871) — both destroy the same old capture, construct fresh, assign; loser never destroyed.
Trigger: wake-from-sleep coinciding with an output route change (AirPods reconnect on lid open).
Disproof: show endMeeting/abort reaches non-field-referenced captures, or the watcher can't tick between resume and :3986.
Confidence: high (guard asymmetry) / medium (orphan reachability).

## F-103 [P1] Route change permanently lost when handler bails
Phase: 1 | Area: main.ts default-output watcher
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation sharpened the finding: of the handler's four bails, three (quitting / isCurrentMeeting / switchInProgress) re-check conditions the watcher tick verified synchronously in the same turn and cannot differ — the ONLY reachable swallow path is the recovery mutex at main.ts:4868. The comment above it ("the watcher's setInterval will re-fire and pick up the route change") described intended semantics the code did not have. Only writers of _lastObservedDefaultOutputId: :4804/:4806 (start), :4830 (advance-before-handle), :4842 (stop) — no recovery writer exists.
Repro: scripts/audit/F-103-repro.mjs — drives the LIVE AppState singleton via the main-process module cache (no real devices, no audio, no meeting: fake meeting flags + a spy that lets only the first handler call through, which bails on the held recovery mutex before touching capture state). PRE-FIX: calls=1, observation already advanced at the watcher → route change never retried → exit 1.
Root cause: main.ts:4830 — `_lastObservedDefaultOutputId = currentId` committed BEFORE the fire-and-forget handler ran its bails; nothing rolls it back.
Fix: watcher no longer advances the observation; `handleDefaultOutputChanged(currentId)` receives the observed id and commits it only after passing the recovery-mutex gate (i.e. when the rebuild cycle actually runs). Deferred cycles now re-fire on the next 4s tick, matching the comment's promised semantics.
E2E verification: repro re-run → exit 0 (recovery held: observation NOT consumed; recovery cleared: handler re-fired on subsequent ticks). Regression pin: electron/services/__tests__/RouteChangeNotSwallowed2026_08_14.test.mjs (watcher must not assign after change detection; handler must commit after the recovery gate). 11/11 audit pins + adjacent audio test green; typecheck clean.
Regression check: mid-flight bails after the commit (quit/meeting-gen change at :4886-4888) correctly consume the observation (change moot once the meeting is gone); explicit-device path unaffected (:4815 tick guard precedes everything).
Cross-platform: watcher runs on Windows too (native getDefaultOutputDeviceId exists on both — verified in audit pass); fix is platform-neutral. macOS live-verified; Windows reviewed but not executed.
Commit: d41af23d

### Repro-infrastructure notes (Phase 1)
Bare-file Playwright launches (`electron dist-electron/electron/main.js`) run with app.getAppPath()=dist-electron/electron and userData=~/Library/Application Support/Electron — an ISOLATED scratch profile (user's real data and stored STT/LLM keys are never touched by these repros). Side effect: nativeModuleLoader's dev candidates miss repo/native-module (silent null — F-107's mechanism, observed live); repro scripts that need native audio ensure a gitignored symlink dist-electron/electron/native-module → ../../native-module. AppState singleton is reachable via Module._cache right after boot (the entry is pruned from the cache within seconds — Playwright's electron loader — so stash exports on globalThis immediately).
Hypothesis: watcher advances `_lastObservedDefaultOutputId` (main.ts:4830) BEFORE calling `handleDefaultOutputChanged`, which has four no-work bail-outs (:4856-4868). On bail, the change is swallowed forever by the :4827 equality check; comment at :4866 assumes the watcher will re-fire, but it can't. Loopback stays bound to abandoned device; interviewer transcript dead, no banner (stuck watchdog needs chunkCount===0).
Trigger: output device swap during in-flight system-audio recovery.
Disproof: another writer re-reads the default id into the field after a deferred cycle.
Confidence: high.

## F-104 [P1] Unawaited destroy() races fresh native monitor for HAL lock
Phase: 1 | Area: main.ts recovery + route-change flows
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: resolveMacScreenCaptureCapability's cache-hit (:862-868), dev-bypass (:874-879) and status!=='denied' (:896-901) paths all resolve without leaving the microtask queue; SystemAudioCapture.stop() defers the blocking native monitor.stop() via setImmediate (SystemAudioCapture.ts:248) and destroy() awaits stop (:273-280), so destroy's promise IS the "HAL released" signal — the flows just never awaited it. Native acquisition is lazy (start(), per :234-239), and microtasks drain before the check phase → fresh.start() always precedes the dying monitor's stop on warm-cache paths. The stale comment at the recovery site claimed "no race".
Repro: scripts/audit/F-104-repro.mjs — deterministic ordering assertion through the REAL route-change flow (real wrapper instances; native starts suppressed by the wire interceptor; the old capture's REAL stop() runs the REAL setImmediate deferral against a fake monitor that marks the release moment). PRE-FIX marks: fresh.start → old.nativeStop → exit 1.
Root cause: `oldCapture?.destroy()` fire-and-forget at the recovery flow and route-change flow (every other teardown site awaits — resume :3954/:3982, reconfigure :4363, endMeeting via _pendingTeardown).
Fix: both flows now null the field first (so watcher ticks/other flows observe the teardown) then `await oldCapture?.destroy()`; stale "no race" comment replaced with the actual invariant. Composes with F-102's ownership guards (a flow that loses the field while awaiting defers to the new owner).
E2E verification: repro → exit 0 (old.nativeStop precedes the measured fresh.start). F-102 and F-103 repros re-run PASS on the combined changes (same flows). Pin: electron/services/__tests__/DestroyAwaitedBeforeFreshCapture2026_08_14.test.mjs (1/1). typecheck clean.
Regression check: awaiting adds ≤~300ms (Windows worst case) before a rebuild — inside mutex-held recovery paths where resume/endMeeting already accept the same latency; recovery counter/timer semantics unchanged.
Cross-platform: same deferral exists for WASAPI teardown; fix platform-neutral. macOS live-verified; Windows reviewed but not executed.
Commit: 0d72316a
Hypothesis: `oldCapture?.destroy()` unawaited at main.ts:4717 and :4879; native `monitor.stop()` runs on setImmediate (SystemAudioCapture.ts:248) while the only intervening await (`resolveMacScreenCaptureCapability`, cache-hit path main.ts:862-901, TTL 3s always warm mid-meeting) resolves in microtasks — so `fresh.start()` (:4743/:4911) constructs the new RustAudioCapture while the dying one holds the CoreAudio tap. Repo documents this exact failure at SystemAudioCapture.ts:170-180 and main.ts:5760-5763 ("0 chunks in 8s" / HAL property-listener deadlock). All other teardown sites await (:4363, :3954, :3982, endMeeting :5776-5783).
Disproof: capability resolver always crosses a macrotask boundary on cache hit; or Rust constructor acquires no HAL resource until start().
Confidence: medium-high.

## F-105 [P1] Mic start() throw kills the system-audio channel too
Phase: 1 | Area: main.ts meeting start / reconfigureAudio / HFP auto-switch
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: three bare four-start sequences (meeting start audio block; reconfigureAudio; _doReconfigureSttProvider), each mic-first with user STT / system capture / system STT behind it; MicrophoneCapture.start() rethrows by design (lazy native open). HFP auto-switch (:3624-3626) additionally swallows the reconfigure rejection into console.warn on a LIVE meeting.
Repro: scripts/audit/F-105-repro.mjs — REAL startMeeting() in the isolated scratch app; wire interceptor forces the mic start to throw and records (without running) the system start; spies on sendAudioCaptureFailed/broadcast. PRE-FIX: systemStartCalls=0, watcherArmed=false, genericAudioError=true → exit 1 (both channels dead behind one generic banner; the wired-never-started system capture emits no 'start' so the stuck watchdog never arms).
Root cause: unhandled rethrow crossing channel boundaries in all three bare sequences; the meeting-start catch treats it as a whole-pipeline failure.
Fix: new private startCaptureChannels(context) helper — per-channel try/catch, mic first (HAL ordering preserved), failing channel surfaces a terminal channel-specific sendAudioCaptureFailed banner and the other channel + downstream steps (live indexing, route watcher) proceed. All three sites now call it; the HFP path's swallow is defused because reconfigureAudio no longer rejects on a channel start failure (channel banner surfaces instead).
E2E verification: repro → exit 0 (systemStartCalls=1, watcherArmed=true, specific "Microphone failed to start (AUDIT-FORCED-MIC-FAIL)" banner, no generic broadcast). Pins: CaptureChannelIsolation2026_08_14.test.mjs; all 13 audit pins green; typecheck clean; F-102 and F-104 repros re-run PASS.
Regression check: healthy-path behavior unchanged (both try blocks succeed → identical start order); startedByInit bookkeeping now reflects per-channel outcomes.
Cross-platform: platform-neutral orchestration; macOS live-verified via real startMeeting; Windows reviewed but not executed (WASAPI exclusive-steal is the canonical Windows trigger this fixes).
Commit: (pending — backfilled next update)
Hypothesis: `MicrophoneCapture.start()` rethrows by design (MicrophoneCapture.ts:114, :166), but callers run bare sequences: a throw at main.ts:5579 skips system-audio start at :5584-5586, live indexing :5592, and the output watcher :5607 → wired-but-never-started capture emits no 'start', watchdog never arms, both channels dead behind one generic error. Same shape at :4513-4516; HFP auto-switch (:4610-4616) swallows the rejection into console.warn, silently killing a live meeting.
Trigger: mic open failure (USB device gone, WASAPI exclusive steal, cpal no-supported-format, HFP target unavailable).
Disproof: show start() cannot throw once construction guard at :3762-3776 passed (it can — native open is lazy, happens in start()).
Confidence: high.

## F-106 [P2] MicrophoneCapture leaks an open native handle on start() failure
Phase: 1 | Area: MicrophoneCapture.ts / microphone.rs
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: start()'s catch (MicrophoneCapture.ts:161-167) rethrows leaving this.monitor set; stop() early-returns on !isRecording (:186-188); destroy() awaits that no-op stop then nulls the monitor — the constructed cpal stream (device opened at construction per the wrapper's own lazy-init comment) is dropped without stop. SystemAudioCapture's ORPHAN-HANDLE FIX (:170-199) covers exactly this on the system side; mic never got the mirror.
Repro: scripts/audit/F-106-repro.mjs — the repo's established fake-native-module harness (Module._load hook) against the dist bundle; fake mic native whose start() throws. PRE-FIX: after failed start + stop() + destroy(), native stopCalls === 0 → orphaned open device → exit 1.
Root cause: missing orphan-handle teardown in the mic start-catch; asymmetry with the system wrapper.
Fix: mirrored ORPHAN-HANDLE FIX — the catch nulls this.monitor and stops the dying instance on setImmediate; next start() reconstructs via the lazy-init branch.
E2E verification: repro → exit 0 (stopCalls 1). Suite test added: electron/audio/__tests__/MicFailedStartReleasesHandle2026_08_14.test.mjs (runs under npm test's audio glob; 1/1). Adjacent wrapper tests 10/10 (CaptureStopAwaitable, CaptureRestartRegression, MicRecoveryUsesCanonicalWiring). typecheck clean.
Regression check: retry semantics now match the system wrapper (reconstruct-fresh instead of retry-same-monitor); recovery flows and the audio test already construct new wrappers.
Cross-platform: releases WASAPI device handles deterministically on Windows (exclusive-mode retry unblocked) and clears the macOS orange indicator; platform-neutral JS. macOS-side harness verified; Windows reviewed but not executed.
Commit: (pending — F-110 = 7317b459)
Hypothesis: `MicrophoneStream::new` opens the cpal device at construct (microphone.rs:248). `start()`'s catch (MicrophoneCapture.ts:161-167) rethrows leaving `this.monitor` constructed-but-never-stopped; `destroy()` (:279-290) early-returns from stop() when `!isRecording` then nulls the monitor. SystemAudioCapture has an explicit "ORPHAN-HANDLE FIX" (SystemAudioCapture.ts:189-199); mic has no equivalent. Concrete reachable site: audio test main.ts:5191-5206 — throw after construct → handle unreachable and unstopped (macOS orange dot stays lit; Windows device held against the retry at :5204).
Disproof: napi finalizer runs deterministically at unreachability (it doesn't), or Rust Drop releases device promptly without stop().
Confidence: high.

## F-107 [P2] Absent/wrong-arch native module boots into a silent no-op meeting
Phase: 1 | Area: nativeModuleLoader / SystemAudioCapture / MicrophoneCapture constructors
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-107-repro.mjs — bare-file launch WITHOUT the native-module symlink (the loader's silent-null state observed live during F-103's investigation), real startMeeting(), banner spy. PRE-FIX: zero native-related banners — only unrelated STT-config banners (in a real profile with valid keys there would be NOTHING); watcher unarmed; meeting reports success → exit 1.
Root cause: both wrappers' start() bare-return on missing native class — no 'error', no 'start' (watchdog arms on 'start'), so the degradation had zero surface.
Fix: both start() methods now THROW ('Native audio engine unavailable — …') — matching the mic wrapper's existing construction-failure contract; every call site catches (startCaptureChannels [F-105], recovery, resume, audio test) and surfaces terminal channel banners. Constructors unchanged.
E2E verification: repro → exit 0 (both channels' terminal native banners observed — F-105's helper composing as designed). Adjacent wrapper tests 8/8; typecheck clean. Pin: NativeModuleAbsenceSurfaced2026_08_14.test.mjs (2/2).
FOLLOW-UP: extend the boot arch gate (nativeArch.cjs TARGETS) to verify native-module/index.*.node presence+arch at startup for packaged builds — deferred (packaging-surface change; Phase 7 candidate).
Cross-platform: throw path platform-neutral; the loader's failure modes covered on both (missing binary / wrong arch / asar-unpack regression).
Commit: (pending — F-118 = 3ae78552)
Hypothesis: when `loadNativeModule()` returns null (missing binary, wrong arch, or early-boot `require('electron')` failure which caches null permanently — nativeModuleLoader.ts:180, :220-224, :275-277), both constructors only console.error; both start() methods return without emit('error')/emit('start') → watchdog never arms, device lists empty, meeting reports started (main.ts:5617), zero transcript, zero UI surface. Boot arch gate covers only better-sqlite3 + keytar (nativeArch.cjs:28-31) — native-module/index.*.node unverified.
Trigger: fresh clone without build:native; packaging regression; x64 binary on arm64; early-boot import poisoning the loader cache.
Disproof: a "native available" predicate checked before meeting start that surfaces a banner; or nativeArch.verifyAll covering native-module.
Confidence: high.

### Sub-area C areas verified clean
No child/helper processes in the capture path (all in-process napi threads); nativeModuleLoader path resolution + asar-stub smoke test sound; system-side zero-fill classification intentionally log-only (asserted by tests); default-output watcher works on Windows (eConsole role only — annotated known limitation, not raised); SystemAudioCapture rate-poll teardown correct; peakToPeak stride sampling correct.

### Sub-area A: main process / windows / overlay (exploration complete)

## F-108 [P0] Overlay close handler cancels app quit mid-teardown
Phase: 1 | Area: WindowHelper overlay lifecycle / app quit
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-108-repro.mjs — real app launch (Playwright _electron, existing dist bundle, production file:// renderer). PRE-FIX output: `post-mortem (process STILL ALIVE): {"lifecycle":{"beforeQuit":true,"willQuit":false,"quit":false},"windows":0,"visibleWindows":0}` → exit 1. Overlay visible at quit time asserted inside the script (throws "repro invalid" otherwise).
Root cause: electron/WindowHelper.ts:1168 — overlay 'close' handler preventDefaults purely on `isVisible()`; during quit, Electron's CloseAllWindows sweep hits it AFTER before-quit (main.ts:8149) has closed the DB and scrubbed credentials; the prevented close cancels the quit (is_quitting_ reset), and macOS window-all-closed (main.ts:7996) never quits → windowless post-teardown zombie. The correct flag exists (`setQuitting(true)` at main.ts:8151) — the handler just never consulted it, unlike the launcher handler (:1075).
Fix: overlay close handler now returns early when `appState.isQuitting()` — the close proceeds during quit; user-initiated close (hide, don't destroy) unchanged. Regression test: electron/services/__tests__/OverlayCloseDoesNotCancelQuit2026_08_14.test.mjs pins guard-before-preventDefault for BOTH overlay and launcher handlers.
E2E verification: same repro script, guard disabled via temp edit → exit 1 (reproduced); guard restored → exit 0 (app quits within 12s; before-quit runs once). Adjacent-behavior check inside the script: non-quit overlay close still intercepted (stillExists:true, destroyed:false).
Regression check: 35/35 pass — new test + AudioCaptureFailedBroadcastBothSurfaces + WindowsPlatformParity + CropperWindowHelper.bounds (electron runner); typecheck:electron clean.
Cross-platform: fix is platform-neutral state consultation. macOS: live-verified (repro). Windows: reviewed but not executed — behavior change there is strictly beneficial (single before-quit teardown instead of double; window-all-closed → quit path no longer needed). Requires physical Windows verification for the full quit flow.
Commit: a9d7ea42 (branch audit/autopilot-2026-08-14). Note: first commit attempt swept in another session's staged files (shared index); reset --soft + re-committed with --only pathspec. Foreign staged work preserved.
Hypothesis: overlay 'close' handler (WindowHelper.ts:1168-1179) preventDefaults whenever the overlay is visible with NO isQuitting() guard (launcher's handler at :1075 has one). Quit during a meeting → before-quit (main.ts:8149-8325) runs destructive teardown (DB close :8290, credential scrub :8297-8298, rag.dispose :8254, Ollama stop :8260) → CloseAllWindows hits the visible overlay → preventDefault → Electron resets is_quitting_ → will-quit/quit never fire. Handler's own recovery hides the overlay so remaining windows close → window-all-closed with is_quitting_==false → on macOS (main.ts:7996 only quits off-darwin) a zero-window process survives with nulled SQLite, scrubbed keys, no dock tile; Force Quit required. On Windows window-all-closed → app.quit() recovers but runs before-quit teardown TWICE.
Trigger: tray Quit (main.ts:6673-6677), menu role:quit, or autoUpdater.quitAndInstall (:2871/:2920) while overlay visible — i.e. any quit during a meeting.
Disproof: Electron 43 not delivering 'close' for programmatic close() on the frameless macOS panel; instrument handler + ps for surviving PID.
Confidence: high (mechanism) / medium-high (macOS end state).
Step 1 — CONFIRMED (2026-08-14, own re-read):
- WindowHelper.ts:1168-1179 — overlay 'close' preventDefaults purely on `isVisible()`; no isQuitting() consult. Launcher's handler (:1075) has the guard, and it is only registered off-darwin anyway (:1068).
- main.ts:8151 — before-quit sets `appState.setQuitting(true)` FIRST, so the correct flag exists and is set before any window receives 'close'; the overlay handler simply never reads it. before-quit then synchronously closes the DB (:8286-8293) and scrubs credentials (:8295-8302), with no event.preventDefault() and no app.exit().
- main.ts:7995-7999 — window-all-closed quits only off-darwin. So on macOS a cancelled quit + subsequently-hidden overlay → all windows destroyed → no-op → alive process with closed DB/scrubbed keys.
- Electron semantics: preventing a window close during quit cancels the quit (documented behavior; is_quitting_ reset). Nothing re-issues app.quit() on darwin.
- Extra hazard found during confirmation: overlay recovery calls switchToLauncher() when no meeting is active — i.e. it may CREATE/SHOW a window mid-quit-cancellation, and the launcher 'closed' handler (:1125-1128) itself calls overlayWindow.close(), so the cancellation can arrive via two orderings; both end at the same state.
Disproof criteria NOT met. Proceeding to live reproduction.

## F-109 [P0] child-process-gone / gpu crash permanently kills the DB silently
Phase: 1 | Area: main.ts crash handlers / DatabaseManager
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: render-process-gone (main.ts:8046-8061) inspects reason and keeps the DB open on every recover path, with a comment naming the exact hazard ("irreversible… nulls the singleton DB with no reopen path"); child-process-gone/gpu-process-crashed had no gating at all. DatabaseManager re-read: `openWithWalSelfHeal` (DatabaseManager.ts:258) is only reachable from `init()`/constructor — post-close reopen genuinely impossible. Foreign staged DatabaseManager changes (+193, usage outbox) checked: no reopen path added.
Repro: scripts/audit/F-109-repro.mjs — real app, read `modesGetAll` (8 modes), SIGKILL the GPU child, observe. PRE-FIX: main alive, Chromium relaunched GPU (76757→76810), 'child-process-gone' observed, modesGetAll now 0 → exit 1. Proves the event is recoverable AND the close causes (not prevents) data loss.
Root cause: main.ts:8132-8142 — both handlers call emergencyCloseDatabase unconditionally, inspecting neither details.type nor details.reason, treating a survivable Chromium child restart as app-terminal.
Fix: both handler bodies now gate emergencyCloseDatabase (and stopAppManagedHindsight in the child handler) behind `appState.isQuitting?.()`, matching render-process-gone's "only close the DB on TERMINAL paths" policy. Logging preserved unconditionally.
E2E verification: re-ran repro → exit 0 (GPU killed+relaunched, DB still answers 8 modes). Regression pin: electron/services/__tests__/ChildProcessGoneKeepsDbOpen2026_08_14.test.mjs (asserts isQuitting gate precedes the close call in both handlers). typecheck:electron clean. F-108 pin re-run green (4/4).
Regression check: render-process-gone path untouched; quit path unaffected (before-quit/will-quit still checkpoint+close; the gated close also still fires if a child dies mid-quit).
Cross-platform: platform-neutral policy change; macOS live-verified; Windows reviewed but not executed (same Chromium child-process model applies). FOLLOW-UP logged: SIGHUP handler (main.ts:317-325) closes the DB without exiting — same class, lower reachability; not fixed here (separate finding candidate for Phase 7 signal-handling review).
Commit: e5d72c33
Hypothesis: main.ts:8132-8142 calls emergencyCloseDatabase unconditionally on child-process-gone and gpu-process-crashed, inspecting neither details.type nor details.reason. child-process-gone fires for recoverable/clean child exits (GPU, Utility, clean-exit...); Chromium restarts the child, the main process survives, but closeWithoutCheckpoint (DatabaseManager.ts:196-204) sets db=null with NO reopen path (getInstance returns same instance; all methods `if (!this.db) return;`). Every save/transcript persist silently no-ops thereafter. Repo documents this exact class at main.ts:226-251 and carefully gates render-process-gone (:8046-8061) + unhandledRejection (:269-278) — these two handlers were left ungated. Same class: SIGHUP handler (main.ts:317-325) closes DB but doesn't exit.
Trigger: GPU process restart (driver reset, display sleep/wake, monitor hotplug), any utility-process exit, either platform.
Disproof: child-process-gone never fires in healthy sessions for this app's process set AND gpu crashes always take down main too.
Confidence: high.

## F-110 [P1] Init failure leaves a lock-holding windowless zombie
Phase: 1 | Area: main.ts initializeApp
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: initializeApp().catch closes DB, writes report, logs — never exits (re-read verbatim). Repo names the hazard itself at the verification-flags assert. Injection attempts with realistic external faults documented: corrupted natively-preferences-secure.json SELF-HEALS (CredentialsManager falls through to app-managed fallback with saves disabled — good engineering, noted); read-only userData dir kills Chromium before app code runs (clean exit, not this bug). Neither reaches the catch → added a deterministic env-gated fault hook `NATIVELY_TEST_INIT_FAULT` (inert unless set; same pattern as NATIVELY_E2E / NATIVELY_DEV_BYPASS_SCREEN_TCC hooks) inside the unguarded stretch.
Repro: scripts/audit/F-110-repro.mjs — launch with the fault env. PRE-FIX: process STILL ALIVE 15s after the injected failure with only a hidden helper window (no launcher, no dock tile, single-instance lock held) → exit 1.
Root cause: missing termination in initializeApp's top-level catch; the one guarded fatal path (assertVerificationFlagsOrThrow) exits explicitly and comments why, the generic catch never did.
Fix: catch now ends in app.exit(1) (app.exit, not app.quit — DB already closed, and half-initialized before-quit handlers must not run against missing singletons) + the permanent test hook.
E2E verification: repro → exit 0 (process exits code 1). Healthy-boot regression: F-108 repro (full boot + overlay + quit cycle) re-run PASS. Pin: InitFailureExits2026_08_14.test.mjs (2/2). typecheck clean.
Cross-platform: platform-neutral; the macOS accessory-policy wrinkle makes the zombie invisible there, Windows zombie holds the lock identically. macOS live-verified; Windows reviewed but not executed.
Commit: (pending — backfilled next update; F-105 = f71dc4c8)
Hypothesis: single-instance lock acquired at main.ts:7235; activation policy 'accessory' at :7358 reverted only at :7756. In between, unguarded calls (CredentialsManager.init :7418, AppState.getInstance :7423, initializeIpcHandlers :7438, applyInitialDisguise :7479, createWindow :7690...) unwind to initializeApp().catch (:8334) which logs but never app.exit(). Result: alive process, no window, no dock tile, holds the lock; relaunch hits second-instance → centerAndShowWindow → launcherWindow===null → nothing shows. Repo names this hazard verbatim at :7326-7330 (assertVerificationFlagsOrThrow exits explicitly).
Trigger: any throw in the unguarded init stretch (corrupt credentials store, native load failure in IPC module, disk-full).
Disproof: all those call sites internally exception-proof (missing app.exit in catch is unconditionally true regardless).
Confidence: high.

## F-111 [P2] Quit-time screenshot cleanup is a no-op (privacy/disk leak)
Phase: 1 | Area: main.ts before-quit / ScreenshotHelper
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-111-repro.mjs — live app, marker PNG written into the LIVE helper's screenshotDir and pushed onto its queue, then a normal quit. PRE-FIX: marker survived the quit → exit 1.
Root cause: before-quit constructed a fresh ScreenshotHelper (empty in-memory queues; constructor never scans the dir) and cleared THAT, logging success; the live AppState.screenshotHelper was never touched.
Fix: before-quit now calls `appState.getScreenshotHelper()?.clearQueues()` on the live instance.
E2E verification: repro → exit 0 (queued screenshot deleted during quit). Pin: QuitScreenshotCleanupLiveInstance2026_08_14.test.mjs (1/1). typecheck clean.
FOLLOW-UP: cleanup still deletes only QUEUED files — leftovers from crashed sessions are never swept; a startup directory sweep of userData/screenshots would complete the privacy intent (deferred: redesign beyond minimal fix).
Cross-platform: platform-neutral. macOS live-verified; Windows reviewed but not executed.
Commit: (pending — F-106 = d93ff582)
Hypothesis: before-quit (main.ts:8305-8313) constructs a BRAND-NEW ScreenshotHelper and calls clearQueues(), which deletes only files in the in-memory queue arrays — empty on a fresh instance (constructor never scans the dir, ScreenshotHelper.ts:449-466, 816-839). The real populated instance is AppState.screenshotHelper (main.ts:1476), never cleared. Screenshots of the user's meeting screen accumulate forever in userData/screenshots while the log claims cleared. Constructor also mkdirSync's during shutdown.
Trigger: every clean quit, both platforms.
Disproof: another path (IPC clearQueues :6358, startup sweep) deletes those dirs — none found (no readdirSync in ScreenshotHelper).
Confidence: high.

## F-112 [P3] CropperWindowHelper.dispose() never closes its window
Phase: 1 | Area: CropperWindowHelper
Status: FOUND
Hypothesis: dispose() sets isDisposed=true (:624) then calls closeWindow() (:652) whose guard requires !isDisposed (:606) → guaranteed no-op; window orphaned by `this.cropperWindow = null` (:653). Bounded impact (process exiting) but pollutes window-all-closed accounting during shutdown (interacts with F-108/F-114).
Confidence: high (pure control-flow read).

## F-113 [P2] Cropper bounds frozen at creation; display changes break area capture
Phase: 1 | Area: CropperWindowHelper
Status: FOUND
Hypothesis: createWindow() computes getCombinedDisplayBounds() once (:423); window preloaded at startup (main.ts:1484-1486) and reused forever (hideOrClose only hides; showCropper recomputes only HUD position). No display-added/removed/metrics-changed listeners anywhere in electron/. After monitor/DPI change: uncovered regions unselectable; stale origin makes confirmedListener (:132-136) map coords with stale x/y while validateBounds (:206) checks fresh bounds → :214 rejects → silent no-op on area capture.
Trigger: dock/undock, plug external display, change scaling, then use area screenshot.
Disproof: OS auto-resizes transparent/enableLargerThanScreen windows on reconfiguration (empirical check), or a recreation path exists (none found).
Confidence: medium-high.

## F-114 [P3] Dev-mode launcher close leaves the zombie it claims to prevent
Phase: 1 | Area: WindowHelper dev close path
Status: FOUND
Hypothesis: dev exception (WindowHelper.ts:1069-1074) relies on window-all-closed → app.quit(), but hidden preloaded windows (settings + model selector, main.ts:7798-7799; cropper :1484-1486; popoverCatcher WindowHelper.ts:1464-1510) are never closed, so window-all-closed never fires → dev zombie holding lock, port 5180, DB handles (the exact state the comment says it prevents).
Confidence: high. Dev-only.

## F-115 [P2] Overlay-aux guard loses group listeners on overlay recreate (latent)
Phase: 1 | Area: WindowHelper overlay aux windows
Status: FOUND
Hypothesis: all group listeners registered only in createOverlayAuxWindows(), which bails at :1528 `if (this.pillWindow || this.toggleWindow) return` — keyed on aux state, not overlay identity. Launcher 'closed' handler (:1125-1128) closes overlay (preventDefault'ed if visible) then nulls the reference regardless → overlay survives unreferenced, aux windows stay alive → next createWindow() builds a new overlay that short-circuits at :1528: no pill/toggle/move-resize sync; stale aux remain AppKit children of the dead overlay.
Trigger: launcher destroyed while overlay visible (macOS launcher has NO close interception — :1068 gates off-darwin; concrete instance today is the F-108 quit sequence).
Disproof: "launcher destroyed while overlay visible" unreachable (showOverlay in ipcHandlers:762 currently unused by src/) — reachability medium.
Confidence: medium.

### Sub-area A areas verified clean
sendToWindow guards every send (main.ts:2126-2135) — no unguarded webContents.send found; macOS weld hide/show asymmetry correctly compensated; content-protection reassert coherent across all five window classes; group-drag re-entrancy sound; single-instance lock loss uses app.exit(0) correctly.
### Sub-area B: IPC contracts / preload (exploration complete)

## F-116 [P2] stealthTapRefreshIme missing from preload — IME re-probe silently dead
Phase: 1 | Area: preload bridge / stealth tap
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: main registers 'stealth-tap:refresh-ime' on all three platform branches (main.ts:1717/:1735/:1747); renderer calls `window.electronAPI?.stealthTapRefreshIme?.()` (NativelyInterface.tsx:7317); electron.d.ts:549 declares it; preload exposes only the other five stealthTap* methods.
Repro: scripts/audit/F-116-repro.mjs — live bridge probe. PRE-FIX: typeof undefined at the real window → exit 1.
Root cause: missing preload link in a three-surface contract; the two existing source-regex tests each pin only one end.
Fix: `stealthTapRefreshIme: () => ipcRenderer.invoke('stealth-tap:refresh-ime')` added to preload impl + interface (with rationale comment).
E2E verification: repro → exit 0 (function, invoked:true against the LIVE darwin handler, returned its real IME decision). Adjacent suites 29/29 (StealthBlockInputFocusGuards, ImeDetectorCache). Pin: PreloadStealthTapBridgeComplete2026_08_14.test.mjs — generic: EVERY renderer-invoked stealthTap* must exist in preload (kills the whole drift class) + channel wiring assert. typecheck clean.
Cross-platform: channel registered on darwin/win32/other — bridge fix serves all.
Commit: (pending — F-111 = e7d41f4b)
Hypothesis: three-way drift — main handler registered on all platform branches (main.ts:1717/:1735/:1747), renderer calls `window.electronAPI?.stealthTapRefreshIme?.()` (NativelyInterface.tsx:7317), declared in electron.d.ts:549, but preload.ts exposes only the other five stealthTap* methods (:2412-2416, interface :777-784) — the `?.()` swallows undefined silently. CJK IME users who add an input source mid-session keep the stale mount-time auto-engage value → tap swallows keystrokes before IME composition (the exact failure main.ts:1704-1719 documents preventing). Two source-regex tests each verify one END (ImeDetectorCache :172 main side; StealthBlockInputFocusGuards :349 renderer side); neither asserts the preload link.
Disproof: alternate spelling/second preload — greps negative.
Confidence: high.

## F-117 [P2] e2eInvoke is an ungated passthrough to all ~349 production channels
Phase: 1 | Area: preload bridge containment
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-117-repro.mjs — two launches. PRE-FIX without NATIVELY_E2E: e2eInvoke exposed AND successfully invoked a production channel (get-meeting-active) → exit 1.
Root cause: the exposure comment assumed NATIVELY_E2E gated the surface; it gates only the __e2e__:* handler REGISTRATION — the channel argument reaches any production handler.
Fix: e2eInvoke now exposed via a conditional spread only when `process.env.NATIVELY_E2E === '1'` (preload reads env); interface made optional; F-118's repro updated to set the env (only consumers are test probes, which already set it — zero shipped-code consumers, verified).
E2E verification: repro → exit 0 (undefined without env; functional with env — probes preserved). F-118 repro re-run PASS under the gate. typecheck clean. Pin: E2eInvokeGated2026_08_14.test.mjs (1/1).
Cross-platform: platform-neutral.
Commit: (pending — F-107 = 5ce9cd87)
Hypothesis: preload.ts:2643-2644 exposes `e2eInvoke(channel, ...args) → ipcRenderer.invoke(channel, ...)` unconditionally; comment claims "no-op in shipped app" but NATIVELY_E2E gates only the `__e2e__:*` HANDLERS (ipcHandlers.ts:12832), not the channel argument. Any renderer code can invoke `quit-app`, `set-openai-api-key`, `delete-meeting`... defeating the curated bridge. No injection vector established (react-markdown; the one innerHTML sink is DOMPurify'd) — containment break, not demonstrated exploit.
Disproof: build-time strip via esbuild define, or main-side channel/sender allow-list — neither found.
Confidence: high.

## F-118 [P2] Live-RAG failure double-signals: error event + fallback → torn UI row
Phase: 1 | Area: ipcHandlers rag:query-live / NativelyInterface
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Repro: scripts/audit/F-118-repro.mjs — fake live-ready RAG manager on the real AppState whose queryMeeting throws a non-fallback error; real handler invoked from a bridge window with an onRAGStreamError subscriber. PRE-FIX: {success:false} return AND {live:true} error event both observed → exit 1.
Root cause: the live catch emitted a terminal error event AND returned the fallback-triggering result; the renderer executes both UI actions (staple error + clear streaming; then stream fallback tokens into the torn row).
Fix: live handler no longer emits rag:stream-error (console.error + comment retained); the {success:false} fallback return owns the UX. Meeting/global handlers unchanged (no fallback exists for those classes — their terminal events are correct).
E2E verification: repro → exit 0 (events:[], fallback return only). Pin: LiveRagSingleSignal2026_08_14.test.mjs (2/2 — live emits none; meeting/global keep theirs). typecheck clean.
Cross-platform: platform-neutral.
Commit: (pending — F-119 = 37acd593)
NOTE (campaign incident, resolved): running bare `npm run build` for F-119's renderer validation triggered `npm run clean`, which deletes dist-electron/ — broke subsequent repro launches until `npm run build:electron` + the native-module symlink were restored. Rule for the rest of the campaign: NEVER run bare `npm run build`; use `vite build` directly if renderer output is needed.
Hypothesis: ipcHandlers.ts:10231-10233 sends terminal `rag:stream-error` {live:true} AND returns {success:false}; renderer error handler (NativelyInterface.tsx:5649-5668) staples `[RAG Error: …]` into the last bubble and clears streaming state, while :5969-5977 reads success:false as "fall through to normal chat" and starts streamGeminiChat into the same torn-down row. Only one signal should fire.
Trigger: live meeting + JIT RAG + provider failure mid-generation (429/network/5xx).
Disproof: a discriminator check dropping {live:true} in onRAGStreamError — none (:5649 destructures only {error}).
Confidence: high.

## F-119 [P2] ollama-error broadcast has zero listeners
Phase: 1 | Area: LLMHelper → renderer error surface
Status: FOUND → CONFIRMED → REPRODUCED → ROOT-CAUSED → FIXED-VERIFIED
Step 1 confirmation: LLMHelper.notifyRendererOllamaError (:1832-1837) broadcasts 'ollama-error' from three failure sites (:1791, :1823, :1827); repo-wide the producer was the only reference. The Launcher's pull-status banner union has had a 'failed' state since day one that nothing ever set — the intended surface existed, unwired.
Repro: scripts/audit/F-119-repro.mjs — PRE-FIX (stale bundle): typeof onOllamaError === 'undefined' at the live bridge → exit 1. POST-FIX: bridge exposes it AND a real main-side 'ollama-error' broadcast reaches a renderer subscriber with payload intact → exit 0.
Root cause: producer-only channel; missing preload link + missing renderer consumer.
Fix: preload `onOllamaError` (subscribe/unsubscribe sibling pattern) + interface + electron.d.ts entry; App.tsx consumes it into the existing banner's 'failed' state (8s auto-dismiss), registered/cleaned alongside the pull listeners. LLMHelper untouched (its foreign in-flight diff also untouched).
E2E verification: repro pre/post as above; vite renderer build clean; typecheck:electron clean. Pin: OllamaErrorReachesRenderer2026_08_14.test.mjs (2/2 — preload wiring + App.tsx consumption).
Cross-platform: platform-neutral.
Commit: (pending — F-116 = 4d2726bf)
Hypothesis: LLMHelper.ts:1837 (notifyRendererOllamaError, from fallback-failure path :1827) broadcasts 'ollama-error' to every window; no ipcRenderer.on('ollama-error') in preload, no onOllamaError anywhere in src/. When Ollama is down AND fallback fails, the deliberate user-facing notification goes nowhere — user sees a hang. Pre-existing (not from in-flight diff).
Disproof: dynamic-channel listener — preload's only variable-channel on() is PROCESSING_EVENTS.*, which lacks ollama-error.
Confidence: high.

## F-120 [P3] Orphan broadcast channels (settings sync + embedding degradation invisible)
Phase: 1 | Area: bridge drift
Status: FOUND
`code-verification-changed` (ipcHandlers.ts:5473), `embedding:fallback-activated` (EmbeddingPipeline.ts:512), `embedding:space-persist-failed` (EmbeddingPipeline.ts:655) — one producer each, zero consumers. Settings toggle never propagates to other windows; silent embedding degradation invisible despite a working banner pattern for sibling channels (preload.ts:2314-2342).
Confidence: high.

## F-121 [P3] Dead bridge surface (drift generator)
Phase: 1 | Area: preload/ipcHandlers
Status: FOUND
`toggle-advanced-settings` invoked by preload (preload.ts:1334) with no main handler (silent "No handler registered" for future callers). 20 handlers with no preload invoker, incl. the dead duplicated curl-provider CRUD set (`save/get/delete-curl-provider`, `switch-to-curl-provider`, `switch-to-custom-provider`) alongside the live custom-provider set (preload.ts:2142-2144).
Confidence: high.

## F-122 [P3] rag:stream-* discriminator populated at every send site, read at none
Phase: 1 | Area: RAG streaming IPC contract
Status: FOUND
Main emits {meetingId,chunk} / {live:true,chunk} / {global:true,chunk} on one channel (ipcHandlers.ts:10137/:10212/:10258); preload type omits `live` (preload.ts:2345); all three consumers destructure {chunk} only (NativelyInterface.tsx:5601, GlobalChatOverlay.tsx:246, MeetingChatOverlay.tsx:342). MeetingChatOverlay and GlobalChatOverlay are siblings in the same Launcher renderer and abortPriorRAGQueriesOfClass supersedes only within a class → cross-class cross-talk possible; no user path forcing overlap established (honest: contract defect, not demonstrated cross-talk).
Confidence: high (contract) / low (user-visible harm).

### Sub-area B disproved during exploration
`unguarded-event-sender-send` — 30 unguarded event.sender.send sites are all contained: sendChunk→sendChunkGated→onToken is awaited inside raceStreamWithDeadline (liveDeadlines.ts:273), so destroyed-sender throws become handled invoke rejections, never reaching the unhandledRejection→emergencyCloseDatabase escalation.

### Sub-area B areas verified clean
345/346 invoke channels have handlers; no duplicate registration (safeHandle/safeOn remove first); preload listener add/remove symmetric (net +1 is a module-scope singleton); contextIsolation+nodeIntegration correct on all five window classes; single exposeInMainWorld; streaming supersession (_chatStreamsBySender + streamId + abort) sound incl. cancellation; uncommitted ipcHandlers/LLMHelper diffs check out (usage instrumentation idempotent via terminated flag).

---

## Phase 1 read-only audit pass — COMPLETE (2026-08-14)

22 candidate findings: 2 P0, 5 P1, 9 P2, 5 P3, 1 already INVALID (F-101).

Processing queue (severity order):
1. F-108 [P0] overlay close cancels quit — Step 1 CONFIRMED, Step 2 in progress
2. F-109 [P0] child-process-gone kills DB permanently
3. F-102 [P1] orphan capture double-writes STT
4. F-103 [P1] route change permanently lost
5. F-104 [P1] unawaited destroy races fresh monitor
6. F-105 [P1] mic start() throw kills system channel
7. F-110 [P1] init failure leaves lock-holding zombie
8. F-106..F-119 [P2], then P3s (F-112, F-114, F-120, F-121, F-122)
