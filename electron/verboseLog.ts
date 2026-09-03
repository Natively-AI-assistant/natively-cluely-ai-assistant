/**
 * verboseLog.ts
 * Process-wide debug-logging flag for the electron main process.
 *
 * Import isVerboseLogging() anywhere in main to gate diagnostic logs. The flag
 * is toggled via AppState.setVerboseLogging(), which persists it through
 * SettingsManager as `verboseLogging`.
 *
 * ON means FULL capture (2026-09-03): besides the diagnostic console lines it
 * always gated, it now also opens the four trace producers that previously
 * required env vars on a terminal-launched run — V3 routing, answer text, PI
 * telemetry, structured JSONL — and keeps user content (transcripts,
 * questions, answers) readable in the log instead of redacting it.
 * It NEVER relaxes credential redaction; see utils/redactForLog.ts.
 *
 * ANCHORED ON globalThis, not a module-local `let` (fixed 2026-09-03).
 * scripts/build-electron.js runs esbuild with bundle:true over every .ts as
 * its own entry point, so this module is INLINED into each bundle. The
 * previous module-local flag meant dist-electron/electron/SessionTracker.js
 * and services/StealthKeyboardManager.js each carried their own private
 * `var _verbose = ...` — verified in the built output — so the value main.js
 * set was invisible to them and they stayed at the env-derived default
 * forever. Turning verbose logging OFF in Settings silenced main but not
 * SessionTracker's per-segment STT logging. Same inversion SettingsManager
 * and the context-intelligence debug modules use.
 */
import { setLogRedactionLevel } from './utils/redactForLog';

const FLAG_KEY = '__nativelyVerboseLoggingV1__';

interface FlagHolder { on: boolean }

// Default OFF (changed 2026-09-03). This flag used to default ON because
// "debug logs are essential for diagnosing the user-launches-and-it-dies
// class of crash" (2026-07-09) — but ON now also means FULL CONTENT CAPTURE,
// and defaulting that ON would write every user's transcripts, questions and
// answers verbatim to ~/Documents/natively_debug.log with no action on their
// part. Recording someone's conversations has to be opt-in.
//
// The crash rationale survives the change: main.ts's console patch writes
// EVERY console.log/warn/error to the log file unconditionally, and there are
// ~29 direct logToFile() calls for crashes, startup phases and signals. Only
// the ~15 extra-verbose call sites are gated by this flag, so a default-off
// install still leaves the full crash breadcrumb trail — just with user
// content redacted.
//
// NATIVELY_VERBOSE_LOGGING=1 opts in from a terminal; =0 remains an explicit
// off for anything that used to set it.
function envDefault(): boolean {
    try {
        const v = (process.env.NATIVELY_VERBOSE_LOGGING || '').trim().toLowerCase();
        return v === '1' || v === 'true';
    } catch { return false; }
}

function holder(): FlagHolder {
    const g = globalThis as unknown as Record<string, FlagHolder | undefined>;
    let h = g[FLAG_KEY];
    if (!h) {
        h = { on: envDefault() };
        g[FLAG_KEY] = h;
    }
    return h;
}

/** True when debug logging is on. ON == full capture. */
export const isVerboseLogging = (): boolean => {
    try { return holder().on; } catch { return envDefault(); }
};

/**
 * Set the flag process-wide. Also drives redactForLog's content axis so the
 * two can never disagree — a capture that still redacted the answer would be
 * the exact failure this feature exists to remove. OFF falls back to
 * 'standard' rather than to nothing, because main.ts's console patch writes
 * every console line to the log whether or not this flag is on.
 */
export const setVerboseLoggingFlag = (enabled: boolean): void => {
    try { holder().on = !!enabled; } catch { /* best-effort */ }
    try { setLogRedactionLevel(enabled ? 'full' : 'standard'); } catch { /* best-effort */ }
};
