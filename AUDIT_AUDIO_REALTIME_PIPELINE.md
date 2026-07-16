# Natively — Audio/Transcription/Realtime Pipeline Audit (Phase 7)

_Production-hardening audit, 2026-07-11._

> **Reconstruction note**: rebuilt after a shared-workspace branch switch lost
> the original working-tree file (see `AUDIT_VERIFICATION_REPORT.md`). Content
> matches the original; the cited fix was independently re-verified present
> and passing (2/2 + full audio suite 269/277, matching the pre-established
> pre-existing-failure baseline) in the final working tree before this file
> was rewritten.

## Fixed

### [P2 — FIXED] LocalWhisperSTT zombie streaming loop on worker-spawn failure

Already fixed and tested in Phase 1 — recorded here for pipeline
completeness. `start()`'s spawn-failure catch now tears the instance back to
a clean inactive state instead of leaving a 12s self-chaining streaming timer
running with `worker === null`. Test:
`LocalWhisperSpawnFailTeardown2026_07_10.test.mjs`, 1/1 pass.

### [P1 — FIXED] STT endpoint SSRF (region/base-URL injection)

Already fixed and tested in Phase 2 — recorded here for pipeline
completeness. Test: `sttEndpointValidation.test.mjs`, 28/28 pass.

### [P2 — FIXED] ModelPreloader's stale `error`/`exit` listeners double-fired after worker handoff

**Problem.** `ModelPreloader.takeWarmWorker()` handed off a pre-warmed
Whisper worker to `LocalWhisperSTT` but only removed its own `message`
listener — **not** `error` or `exit`. Node's `EventEmitter` (which `Worker`
extends) fires **every** registered listener for an event, not just the
most recent. The consumer (`LocalWhisperSTT.attachWorkerListeners()`)
installs its own complete `message`/`error`/`exit` handlers immediately
after taking the worker — so a transient error on the worker *after*
handoff (e.g. mid-recording, while the model is demonstrably working fine)
fired **both** the consumer's handler AND the preloader's now-orphaned
`error` handler, which calls `recordFailure(modelId)`. That silently
poisons a 5-minute "recent failure" cooldown that gates `preload()`'s
pre-warming for that model. Net effect: one transient in-recording error →
the *next* meeting's Whisper pre-warm silently skips for up to 5 minutes —
"transcription is slow to start" with no visible error.

Notably, the code already had a comment above `takeWarmWorker` describing
this exact bug and claiming it was fixed — the comment's stated fix
(remove `message`/`error` listeners) didn't match what the code actually did
(only `message`), and there was already a fully-written regression test
file (`ModelPreloaderTakeWarmWorker.test.mjs`) asserting the correct,
complete behavior. The fix had been designed and tested but never actually
applied to the source.

**Fix.** `takeWarmWorker()` now calls `w.removeAllListeners('message')`,
`w.removeAllListeners('error')`, and `w.removeAllListeners('exit')` before
returning the worker. Verified the consumer's own exit/error handlers
already independently release the ONNX slot via `this.slotRelease` (read
from the worker's stashed `__slotRelease` on handoff) — removing the
preloader's listeners does not create a slot-release gap.

**Test:** `ModelPreloaderTakeWarmWorker.test.mjs` (pre-existing, previously
red against the unfixed source) — 2/2 pass. Full audio suite: 269/277 pass
(the 8 failures are pre-existing, confirmed unrelated via git-stash diff —
stale source-pattern assertions in `ipcHandlers`/`main.ts`-adjacent tests
predating this session).

## Verified — Phase 0 candidates that did NOT hold up on inspection

- **`RestSTT.write()` unbounded `chunks[]`** — refuted. `flushAndUpload`
  drains the buffer synchronously before the network `await`; the 10s
  safety-net interval + 30s axios timeout bound any unflushed window to
  ~one cycle (~5.7MB @48kHz stereo/16-bit), freed every cycle.
- **`OpenAIStreamingSTT.setApiKey()` "leaked key continues in REST mode"** —
  refuted. `_restFlushAndUpload()` reads `this.apiKey` **live** on every
  upload (REST requests build fresh headers each call). `setApiKey()`
  already sets `this.apiKey` unconditionally before the WS-mode reconnect
  branch, so the very next REST upload uses the rotated key.
- **`MeetingPersistence`/`DatabaseManager.saveMeeting` "unbounded transcript
  write blocks the main process"** — refuted with a real benchmark.
  `SessionTracker.getFullTranscript()` is bounded via
  `compactTranscriptIfNeeded()` (fires above 1800 raw segments, evicts the
  oldest 500 into an epoch summary). Benchmarked a synthetic 1800-row
  `better-sqlite3` transaction under the real Electron ABI: **1.1ms**.
