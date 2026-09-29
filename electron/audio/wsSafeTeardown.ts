/**
 * Safe teardown for a WebSocket that may still be CONNECTING (F-201).
 *
 * ws@8's close() on a CONNECTING socket routes through abortHandshake(),
 * which UNCONDITIONALLY emits 'error' on the next tick ("WebSocket was
 * closed before the connection was established"). The strip-then-close
 * pattern (`ws.removeAllListeners(); ws.close();`) therefore produces a
 * listener-less 'error' emit, which Node promotes to a process-level
 * uncaughtException — and main.ts answers uncaughtException with
 * emergencyCloseDatabase(), which is irreversible (no reopen path): every
 * meeting save and transcript persist silently no-ops for the rest of the
 * session. Live-reproduced through the real OpenAI provider in
 * scripts/audit/F-201-repro.mjs. (The same class was fixed for
 * NativelyProSTT on main in 21c4e22f; this helper is the branch-local mitigation for every
 * strip-then-close site.)
 *
 * Stripping listeners before close() is intentional at these sites (in-flight
 * kernel events must not mutate state for a discarded socket) — the fix is to
 * re-attach a no-op error sink so the abort error (or any socket error during
 * the close handshake) is consumed instead of escaping.
 */
export function safeDetachAndClose(
    ws:
        | {
              removeAllListeners(): unknown;
              on(event: 'error', listener: (...args: unknown[]) => void): unknown;
              close(): unknown;
          }
        | null
        | undefined,
): void {
    if (!ws) return;
    try {
        ws.removeAllListeners();
    } catch {
        /* already torn down */
    }
    try {
        ws.on('error', () => {
            /* consumed — see module doc */
        });
    } catch {
        /* emitter gone */
    }
    try {
        ws.close();
    } catch {
        /* already closed */
    }
}
