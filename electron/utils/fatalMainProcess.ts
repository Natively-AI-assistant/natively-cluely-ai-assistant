/**
 * One-shot coordinator for genuinely terminal main-process failures.
 *
 * WHY THIS EXISTS
 * ---------------
 * `emergencyCloseDatabase()` in main.ts is irreversible: it calls
 * `closeWithoutCheckpoint()`, which nulls the `DatabaseManager` singleton's
 * handle with no reopen path. Six separate fatal paths used to call it and
 * then simply `return`, leaving Electron fully interactive on top of a dead
 * database. The app looked completely normal — windows, IPC, UI all fine — but
 * `saveMeeting()` hit `if (!this.db)`, logged, and returned `undefined`, so
 * every meeting for the rest of the session was silently lost with no error
 * surfaced to the caller and no banner shown to the user.
 *
 * The invariant: closing the database and exiting the process are ONE atomic
 * decision. If a failure is severe enough to justify destroying the database
 * handle, it is severe enough to end the process. If it is not, the database
 * must stay open (recoverable events — SIGHUP, gpu-process-crashed,
 * child-process-gone — no longer close it at all).
 *
 * DESIGN
 * ------
 * Dependency-injected and free of any direct Electron import, so the policy is
 * testable without a live app. Reentrancy-safe: fatal signals commonly arrive
 * in pairs (the mic and system STT sockets failing in the same tick), and a
 * second close or a second exit must never run. Neither a throwing
 * `closeDatabase` nor a throwing `exit` may propagate — this class is called
 * FROM the crash handlers, so an escaping error would re-enter them.
 */

export interface FatalMainProcessDeps {
    /** Crash-safe database close. Must be idempotent; may throw. */
    closeDatabase: (reason: string) => void;
    /** Terminal process exit. Called exactly once. */
    exit: (code: number) => void;
    /** Optional breadcrumb sink for failures inside the terminal sequence. */
    log?: (message: string) => void;
}

export class FatalMainProcessCoordinator {
    private terminal = false;
    private invocations = 0;
    private reason: string | null = null;

    constructor(private readonly deps: FatalMainProcessDeps) {}

    /**
     * Close the database and end the process. Safe to call from any number of
     * fatal handlers; only the first call has an effect.
     */
    terminate(reason: string, exitCode: number): void {
        this.invocations++;
        if (this.terminal) return;
        this.terminal = true;
        this.reason = reason;

        try {
            this.deps.closeDatabase(reason);
        } catch (error: any) {
            // A crashing process is exactly when the close is most likely to
            // fail. Swallow it and press on — skipping the exit here would
            // recreate the interactive-app-on-a-dead-database state this class
            // exists to prevent.
            try {
                this.deps.log?.(
                    `[FATAL] database close failed during ${reason}: ${error?.message || error}`,
                );
            } catch { /* the breadcrumb is best-effort */ }
        } finally {
            try {
                this.deps.exit(exitCode);
            } catch (error: any) {
                // Nothing left to do — but never throw back into the crash
                // handler that called us.
                try {
                    this.deps.log?.(
                        `[FATAL] exit failed during ${reason}: ${error?.message || error}`,
                    );
                } catch { /* best-effort */ }
            }
        }
    }

    /** True once a terminal sequence has begun. */
    isTerminal(): boolean {
        return this.terminal;
    }

    /** Total terminate() attempts, including those suppressed by the latch. */
    getInvocationCount(): number {
        return this.invocations;
    }

    /** The reason for the FIRST terminate() call — the one that actually ran. */
    getReason(): string | null {
        return this.reason;
    }
}
