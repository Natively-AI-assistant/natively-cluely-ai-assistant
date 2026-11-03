/**
 * What the first log write of a process does to natively_debug.log.
 *
 * Every Natively process shares one debug log. A launch while Natively is
 * already running starts a second process that only asks for the
 * single-instance lock and exits — but its first write (the lock report) used
 * to reset the log first: truncated, or rotated to .prev. The running app's
 * whole session was gone. User export 2026-11-03 (Windows 3.0.0): 10 lines,
 * "log opened (prior=truncated) … Another instance is already running.
 * Exiting this instance.", sent to show transcription reconnecting after
 * 10-15 s — the evidence was the part that had been wiped.
 *
 * A process that lost the lock now only appends. Pure, so both branches run
 * under plain node --test.
 */

/** Whether this process holds the single-instance lock, once it has asked. */
export type StartupLogLock = 'unknown' | 'held' | 'lost';

export type StartupLogAction = 'truncate' | 'rotate' | 'append';

/**
 * `priorSessionClean` is read lazily: deciding it (LifecycleTracker) is a
 * question about the running app's session, which a losing process must not
 * ask, let alone record anything for.
 */
export function startupLogAction(lock: StartupLogLock, priorSessionClean: () => boolean): StartupLogAction {
    if (lock === 'lost') return 'append';
    return priorSessionClean() ? 'truncate' : 'rotate';
}

/** The marker line each process writes when it first opens the log. */
export function startupLogMarker(action: StartupLogAction, facts: {
    isoTime: string; pid: number; version: string; platform: string; arch: string;
}): string {
    const prior = action === 'truncate'
        ? 'prior=truncated'
        : action === 'rotate'
            ? 'prior=rotated-to-prev'
            : 'second launch, running session log kept';
    return `${facts.isoTime} [STARTUP] log opened (${prior}) pid=${facts.pid} version=${facts.version} platform=${facts.platform} arch=${facts.arch}\n`;
}
