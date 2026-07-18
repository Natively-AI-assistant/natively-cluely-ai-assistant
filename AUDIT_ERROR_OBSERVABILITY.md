# Natively — Error Handling & Crash Resilience Audit (Phase 9)

_Production-hardening audit, 2026-07-11._

## Fixed

### [P0 — FIXED] `unhandledRejection` permanently killed the database on the FIRST occurrence, with the app surviving silently

**Problem.** `electron/main.ts`'s `process.on('unhandledRejection', ...)` handler
called `emergencyCloseDatabase()` **unconditionally** on every unhandled
promise rejection. `emergencyCloseDatabase()` is deliberately irreversible —
it closes the shared `better-sqlite3` connection and nulls the
`DatabaseManager` singleton with **no reopen path**, by design, for genuinely
terminal crash paths (SIGTERM/SIGINT, a crash-loop give-up, etc.) so the WAL
is released cleanly before the process dies.

The bug: Node does **not** terminate the process after `unhandledRejection`
when a listener is registered, and this handler never calls `process.exit()`
— confirmed by reading the full handler body. So the app kept running for
the **rest of the session** with a permanently dead database after the
**first** stray unhandled rejection **anywhere** in the codebase — a missing
`.catch()` on any fire-and-forget promise, in `main.ts` itself or any of the
hundreds of async call sites across `ipcHandlers.ts` and the services layer.
`DatabaseManager` has 67 internal `if (!this.db) return` guards, so the app
wouldn't crash outright — every meeting save, transcript persist, and
credential lookup would just silently no-op from that point on. Confirmed
`DatabaseManager.isAvailable()` is never surfaced to the renderer anywhere in
`ipcHandlers.ts` — the user would get zero indication anything was wrong
until their meeting history mysteriously stopped growing, likely long after
the triggering rejection.

This class of bug — "close the DB on every crash-adjacent event, assuming the
process is about to die" — had **already been identified and fixed once**,
for a structurally identical case: `render-process-gone` (2026-07-10, per the
in-file comment). That fix explicitly separated "genuinely terminal" (close
the DB) from "recoverable" (keep the DB open, the main process — which owns
the DB — is unaffected) and added a bounded reload-attempt counter before
escalating to terminal. `unhandledRejection` never received the same
treatment.

**Fix.** Mirrored the exact `render-process-gone` pattern
(`RENDERER_RELOAD_MAX`/`RENDERER_RELOAD_WINDOW_MS`) with a new
`UNHANDLED_REJECTION_MAX = 5` within `UNHANDLED_REJECTION_WINDOW_MS = 60_000`
rolling-window counter. An isolated unhandled rejection is now logged (as
before — nothing about the logging/diagnostics changed) but does **not**
close the database. Only rapid-fire rejections within the window (a genuine
systemic-failure signal, not a single stray missing `.catch()`) escalate to
the terminal, DB-closing path — matching the "give-up" naming/logging
convention already used by the render-process-gone guard.
`uncaughtException`/`SIGTERM`/`SIGINT`/`render-process-gone-loop-giveup`
behavior is unchanged (verified by test).

**Test:** `electron/utils/__tests__/UnhandledRejectionDbSurvival2026_07_11.test.mjs`
— 4 structural assertions (escalation window exists and is `>1` so a single
rejection can't trigger it, `emergencyCloseDatabase` only appears inside the
threshold-guard branch not as a bare statement, the rolling window prunes
stale timestamps, sibling terminal paths are unaffected). main.ts is not
independently unit-testable (it wires the whole app at import time), so this
follows the same structural-test convention this codebase already uses for
other `main.ts`-level lifecycle logic. 4/4 pass. `npm run build:electron` +
`tsc --noEmit` clean.

## Verified — already well-hardened, no fix needed

- **Renderer global error handlers** (`src/main.tsx`): `window.addEventListener('error'/'unhandledrejection')`
  are registered first (before React mounts) and deliberately route through
  `console.error` so the main process's `console-message` listener
  (`WindowHelper.attachRendererDiagnostics`) forwards them to
  `natively_debug.log` — otherwise an early renderer throw before React
  mounts would leave the user on a blank/logo screen with zero trace
  anywhere. Confirmed this is exactly the mechanism behind the prior
  "logo-stuck" incident root-cause work.
- **`render-process-gone`/`gpu-process-crashed`/`child-process-gone`**: already
  extensively hardened (crash-loop-bounded auto-reload with a give-up dialog,
  DB kept open on the recoverable path, closed only on terminal give-up).
  No changes needed beyond confirming the `unhandledRejection` handler now
  follows the same design discipline.
- **Native-arch gate crash** (`[nativeArch]`-prefixed errors): correctly
  `exit(1)`s after a user-facing dialog — this IS a genuinely fatal,
  unrecoverable condition (wrong-architecture native binary), so immediate
  exit is the correct behavior and was left unchanged.
- **Process report redaction on crash**: `writeProcessReport()` strips
  `environmentVariables` from Node's crash report (which otherwise embeds the
  full shell env) and deletes the file entirely rather than shipping it
  unredacted if the strip itself fails — verified in Phase 4.

## Noted but not changed (asymmetry, documented)

`uncaughtException`'s general (non-`[nativeArch]`) fallthrough branch also
does not call `process.exit()`, so it has the same structural shape as the
`unhandledRejection` bug — but `uncaughtException` is a strictly stronger
signal per Node's own guidance ("the process may be in an undefined state"),
unlike a rejected promise, which is a routine, commonly non-fatal JS error
class. Given the audit brief's instruction to preserve existing user-facing
behavior unless clearly unsafe, and that treating "unknown process state" as
fatal-to-persistence is a defensible (if aggressive) choice — whereas doing
the same for a routine rejected promise was not — this asymmetry is
intentional and left as-is rather than expanding scope into the larger
architectural question of whether `uncaughtException` should also exit the
process. Recommended as a follow-up discussion, not a blind fix.
