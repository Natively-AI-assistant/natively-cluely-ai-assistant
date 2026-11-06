// When the app asks the server whether the Pro licence still holds.
//
// The answer used to be: almost never. The only caller of the server check
// (license:check-premium-async) was a renderer fallback that ran when the local
// licence read FAILED, so a refunded lifetime key, an expired yearly key or a
// cancelled API plan kept Pro on the device indefinitely. The server side had
// already switched them off; nothing in the app asked.
//
// Now the main process asks:
//   - a few seconds after launch (off the startup path);
//   - every 6 hours while the app is open;
//   - on wake from sleep (a laptop closed for days);
//   - when a usage read shows the plan no longer includes Pro.
// One check at a time, and at most one per 10 minutes for the event-driven
// triggers, so the server sees a handful of calls per client a day, not a poll.
// Every Pro surface asks the licence fresh on each use, so the moment a check
// comes back revoked, everything locks.
//
// PURE ON PURPOSE: timers, the resume event and the check itself are injected.
// No process.platform: Electron's powerMonitor 'resume' fires on macOS and
// Windows alike, and the tests run the same on either.

export const FIRST_CHECK_DELAY_MS = 15_000;
export const RECHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const MIN_GAP_MS = 10 * 60 * 1000;

export type RecheckReason = 'launch' | 'interval' | 'resume' | 'usage';

export interface LicenceRecheckDeps {
  /** The check itself (recheckLicence through the IPC wiring). Never assumed not to throw. */
  run(reason: RecheckReason): Promise<unknown>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Subscribes to wake-from-sleep; returns the unsubscribe. */
  onResume?(fn: () => void): () => void;
  now?(): number;
  log?: { log(...a: unknown[]): void; warn(...a: unknown[]): void };
}

export interface LicenceRecheck {
  /** Ask now, unless a check is running or one finished under MIN_GAP_MS ago. */
  trigger(reason: RecheckReason): Promise<void>;
  stop(): void;
}

export function startLicenceRecheck(deps: LicenceRecheckDeps): LicenceRecheck {
  const now = deps.now ?? Date.now;
  let running: Promise<void> | null = null;
  let lastAt = -Infinity;
  let stopped = false;
  const timers = new Set<unknown>();

  const later = (fn: () => void, ms: number): void => {
    if (stopped) return;
    const handle = deps.setTimer(() => { timers.delete(handle); fn(); }, ms);
    timers.add(handle);
  };

  const run = (reason: RecheckReason, force: boolean): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) return running;
    if (!force && now() - lastAt < MIN_GAP_MS) return Promise.resolve();
    lastAt = now();
    running = (async () => {
      try {
        await deps.run(reason);
      } catch (err) {
        deps.log?.warn('[LicenceRecheck] check failed (kept the current state):', err instanceof Error ? err.message : err);
      } finally {
        running = null;
      }
    })();
    return running;
  };

  // The periodic and launch checks always run; the gap only spaces out the
  // event-driven ones (a burst of usage reads, a resume right after launch).
  const tick = (): void => {
    void run('interval', true).finally(() => later(tick, RECHECK_EVERY_MS));
  };
  later(() => {
    void run('launch', true).finally(() => later(tick, RECHECK_EVERY_MS));
  }, FIRST_CHECK_DELAY_MS);

  const unsubscribe = deps.onResume?.(() => { void run('resume', false); });

  return {
    trigger: (reason) => run(reason, false),
    stop: () => {
      stopped = true;
      for (const t of timers) deps.clearTimer(t);
      timers.clear();
      try { unsubscribe?.(); } catch { /* ignore */ }
    },
  };
}

/**
 * The one plan sold without Pro. Named rather than listing the Pro plans, so a
 * new Pro plan (a pack, a yearly tier) never reads as a downgrade; 'trial' and
 * anything unknown are no reason to ask either.
 */
const NO_PRO_PLAN = 'standard';
/** The server's answers that mean the key's Pro is gone (licenseVerifyPolicy's durable set). */
const LOST_ERRORS = new Set(['subscription_inactive', 'key_not_found', 'invalid_key_format']);

/**
 * Does this /v1/usage answer say the API plan no longer includes Pro? Only a
 * reason to ask the licence server; the licence decides, never this.
 */
export function usageSuggestsProLost(answer: { ok: boolean; plan?: unknown; error?: unknown }): boolean {
  if (answer.ok) return typeof answer.plan === 'string' && answer.plan.toLowerCase() === NO_PRO_PLAN;
  return typeof answer.error === 'string' && LOST_ERRORS.has(answer.error);
}
