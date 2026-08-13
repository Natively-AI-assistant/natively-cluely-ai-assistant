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
Phase: 1 | Area: main.ts wireSystemCapture/wireMicCapture
Status: FOUND
Hypothesis: data-path writes are the only consumers NOT gated on instance identity (main.ts:3487 `this.googleSTT?.write(chunk)`, :3666 mic equivalent; guarded siblings at :3424/:3475/:3518/:3571). A capture that loses ownership of the field without being destroyed keeps pumping PCM into the live STT socket. Reachable when `restartCapturesAfterResume` (no own mutex; clears both recovery mutexes at :3916/:3923) races `handleDefaultOutputChanged` (:4856-4871) — both destroy the same old capture, construct fresh, assign; loser never destroyed.
Trigger: wake-from-sleep coinciding with an output route change (AirPods reconnect on lid open).
Disproof: show endMeeting/abort reaches non-field-referenced captures, or the watcher can't tick between resume and :3986.
Confidence: high (guard asymmetry) / medium (orphan reachability).

## F-103 [P1] Route change permanently lost when handler bails
Phase: 1 | Area: main.ts default-output watcher
Status: FOUND
Hypothesis: watcher advances `_lastObservedDefaultOutputId` (main.ts:4830) BEFORE calling `handleDefaultOutputChanged`, which has four no-work bail-outs (:4856-4868). On bail, the change is swallowed forever by the :4827 equality check; comment at :4866 assumes the watcher will re-fire, but it can't. Loopback stays bound to abandoned device; interviewer transcript dead, no banner (stuck watchdog needs chunkCount===0).
Trigger: output device swap during in-flight system-audio recovery.
Disproof: another writer re-reads the default id into the field after a deferred cycle.
Confidence: high.

## F-104 [P1] Unawaited destroy() races fresh native monitor for HAL lock
Phase: 1 | Area: main.ts recovery + route-change flows
Status: FOUND
Hypothesis: `oldCapture?.destroy()` unawaited at main.ts:4717 and :4879; native `monitor.stop()` runs on setImmediate (SystemAudioCapture.ts:248) while the only intervening await (`resolveMacScreenCaptureCapability`, cache-hit path main.ts:862-901, TTL 3s always warm mid-meeting) resolves in microtasks — so `fresh.start()` (:4743/:4911) constructs the new RustAudioCapture while the dying one holds the CoreAudio tap. Repo documents this exact failure at SystemAudioCapture.ts:170-180 and main.ts:5760-5763 ("0 chunks in 8s" / HAL property-listener deadlock). All other teardown sites await (:4363, :3954, :3982, endMeeting :5776-5783).
Disproof: capability resolver always crosses a macrotask boundary on cache hit; or Rust constructor acquires no HAL resource until start().
Confidence: medium-high.

## F-105 [P1] Mic start() throw kills the system-audio channel too
Phase: 1 | Area: main.ts meeting start / reconfigureAudio / HFP auto-switch
Status: FOUND
Hypothesis: `MicrophoneCapture.start()` rethrows by design (MicrophoneCapture.ts:114, :166), but callers run bare sequences: a throw at main.ts:5579 skips system-audio start at :5584-5586, live indexing :5592, and the output watcher :5607 → wired-but-never-started capture emits no 'start', watchdog never arms, both channels dead behind one generic error. Same shape at :4513-4516; HFP auto-switch (:4610-4616) swallows the rejection into console.warn, silently killing a live meeting.
Trigger: mic open failure (USB device gone, WASAPI exclusive steal, cpal no-supported-format, HFP target unavailable).
Disproof: show start() cannot throw once construction guard at :3762-3776 passed (it can — native open is lazy, happens in start()).
Confidence: high.

## F-106 [P2] MicrophoneCapture leaks an open native handle on start() failure
Phase: 1 | Area: MicrophoneCapture.ts / microphone.rs
Status: FOUND
Hypothesis: `MicrophoneStream::new` opens the cpal device at construct (microphone.rs:248). `start()`'s catch (MicrophoneCapture.ts:161-167) rethrows leaving `this.monitor` constructed-but-never-stopped; `destroy()` (:279-290) early-returns from stop() when `!isRecording` then nulls the monitor. SystemAudioCapture has an explicit "ORPHAN-HANDLE FIX" (SystemAudioCapture.ts:189-199); mic has no equivalent. Concrete reachable site: audio test main.ts:5191-5206 — throw after construct → handle unreachable and unstopped (macOS orange dot stays lit; Windows device held against the retry at :5204).
Disproof: napi finalizer runs deterministically at unreachability (it doesn't), or Rust Drop releases device promptly without stop().
Confidence: high.

## F-107 [P2] Absent/wrong-arch native module boots into a silent no-op meeting
Phase: 1 | Area: nativeModuleLoader / SystemAudioCapture / MicrophoneCapture constructors
Status: FOUND
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
Commit: (pending)
Hypothesis: main.ts:8132-8142 calls emergencyCloseDatabase unconditionally on child-process-gone and gpu-process-crashed, inspecting neither details.type nor details.reason. child-process-gone fires for recoverable/clean child exits (GPU, Utility, clean-exit...); Chromium restarts the child, the main process survives, but closeWithoutCheckpoint (DatabaseManager.ts:196-204) sets db=null with NO reopen path (getInstance returns same instance; all methods `if (!this.db) return;`). Every save/transcript persist silently no-ops thereafter. Repo documents this exact class at main.ts:226-251 and carefully gates render-process-gone (:8046-8061) + unhandledRejection (:269-278) — these two handlers were left ungated. Same class: SIGHUP handler (main.ts:317-325) closes DB but doesn't exit.
Trigger: GPU process restart (driver reset, display sleep/wake, monitor hotplug), any utility-process exit, either platform.
Disproof: child-process-gone never fires in healthy sessions for this app's process set AND gpu crashes always take down main too.
Confidence: high.

## F-110 [P1] Init failure leaves a lock-holding windowless zombie
Phase: 1 | Area: main.ts initializeApp
Status: FOUND
Hypothesis: single-instance lock acquired at main.ts:7235; activation policy 'accessory' at :7358 reverted only at :7756. In between, unguarded calls (CredentialsManager.init :7418, AppState.getInstance :7423, initializeIpcHandlers :7438, applyInitialDisguise :7479, createWindow :7690...) unwind to initializeApp().catch (:8334) which logs but never app.exit(). Result: alive process, no window, no dock tile, holds the lock; relaunch hits second-instance → centerAndShowWindow → launcherWindow===null → nothing shows. Repo names this hazard verbatim at :7326-7330 (assertVerificationFlagsOrThrow exits explicitly).
Trigger: any throw in the unguarded init stretch (corrupt credentials store, native load failure in IPC module, disk-full).
Disproof: all those call sites internally exception-proof (missing app.exit in catch is unconditionally true regardless).
Confidence: high.

## F-111 [P2] Quit-time screenshot cleanup is a no-op (privacy/disk leak)
Phase: 1 | Area: main.ts before-quit / ScreenshotHelper
Status: FOUND
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
Status: FOUND
Hypothesis: three-way drift — main handler registered on all platform branches (main.ts:1717/:1735/:1747), renderer calls `window.electronAPI?.stealthTapRefreshIme?.()` (NativelyInterface.tsx:7317), declared in electron.d.ts:549, but preload.ts exposes only the other five stealthTap* methods (:2412-2416, interface :777-784) — the `?.()` swallows undefined silently. CJK IME users who add an input source mid-session keep the stale mount-time auto-engage value → tap swallows keystrokes before IME composition (the exact failure main.ts:1704-1719 documents preventing). Two source-regex tests each verify one END (ImeDetectorCache :172 main side; StealthBlockInputFocusGuards :349 renderer side); neither asserts the preload link.
Disproof: alternate spelling/second preload — greps negative.
Confidence: high.

## F-117 [P2] e2eInvoke is an ungated passthrough to all ~349 production channels
Phase: 1 | Area: preload bridge containment
Status: FOUND
Hypothesis: preload.ts:2643-2644 exposes `e2eInvoke(channel, ...args) → ipcRenderer.invoke(channel, ...)` unconditionally; comment claims "no-op in shipped app" but NATIVELY_E2E gates only the `__e2e__:*` HANDLERS (ipcHandlers.ts:12832), not the channel argument. Any renderer code can invoke `quit-app`, `set-openai-api-key`, `delete-meeting`... defeating the curated bridge. No injection vector established (react-markdown; the one innerHTML sink is DOMPurify'd) — containment break, not demonstrated exploit.
Disproof: build-time strip via esbuild define, or main-side channel/sender allow-list — neither found.
Confidence: high.

## F-118 [P2] Live-RAG failure double-signals: error event + fallback → torn UI row
Phase: 1 | Area: ipcHandlers rag:query-live / NativelyInterface
Status: FOUND
Hypothesis: ipcHandlers.ts:10231-10233 sends terminal `rag:stream-error` {live:true} AND returns {success:false}; renderer error handler (NativelyInterface.tsx:5649-5668) staples `[RAG Error: …]` into the last bubble and clears streaming state, while :5969-5977 reads success:false as "fall through to normal chat" and starts streamGeminiChat into the same torn-down row. Only one signal should fire.
Trigger: live meeting + JIT RAG + provider failure mid-generation (429/network/5xx).
Disproof: a discriminator check dropping {live:true} in onRAGStreamError — none (:5649 destructures only {error}).
Confidence: high.

## F-119 [P2] ollama-error broadcast has zero listeners
Phase: 1 | Area: LLMHelper → renderer error surface
Status: FOUND
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
