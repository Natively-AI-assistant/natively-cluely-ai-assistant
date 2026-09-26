/**
 * Turns "a Natively API key is saved, its plan includes Pro, but Pro is not
 * active on this device" back into Pro — without the user doing anything.
 *
 * WHY THIS EXISTS (2026-09-22). Pro activation was one-shot: the key-save handler
 * stores the key, then calls LicenseManager.activateWithApiKey once. When
 * /v1/pro/verify answered 5xx (it did, to every request, for ~38 h on
 * 2026-09-19/20) the handler logged it and reported success. Nothing retried:
 * startup only re-validates a licence that is ALREADY stored, the Save button is
 * disabled for a saved key, and a Windows reinstall keeps %APPDATA% so the key
 * survives while the licence stays absent. Customers paid for Ultra, saw their
 * plan, and never got Pro.
 *
 * PURE ON PURPOSE. No Electron, no filesystem, no OS API, no process.platform:
 * every effect is injected. The behaviour is identical on macOS and Windows by
 * construction, and the tests exercise all of it on either.
 *
 * It only ever ADDS entitlement. It never deactivates, never clears a key and
 * never reverts a provider — a refusal or "no Pro" simply ends the attempt. The
 * save handler and LicenseManager.isPremiumAsync own every teardown path.
 *
 * Type-erasable TypeScript only (no enums, no parameter properties): the test
 * imports this source file directly, with no build step.
 */

/** Mirrors natively-api lib/plans.js PRO_PLANS. The test pins the two together. */
export const PRO_CAPABLE_PLANS: ReadonlySet<string> = new Set(['pro', 'max', 'ultra']);

export type ReconcileOutcome =
  | 'not_needed'      // no key, trial sentinel, or Pro already active
  | 'no_entitlement'  // plan is known and does not include Pro — final
  | 'key_rejected'    // the server refused the key — final, not ours to handle
  | 'skipped'         // a lifetime licence is protected — final
  | 'activated'
  | 'retrying'
  | 'gave_up';

export interface PlanAnswer {
  ok: boolean;
  plan?: string;
  status?: number;
  /** The server refused the key (4xx). Anything else that is not ok is transient. */
  keyRejected?: boolean;
}

export interface ActivateAnswer {
  success: boolean;
  skipped?: boolean;
  keyRejected?: boolean;
  status?: number;
  error?: string;
}

export interface ReconcilerStatus {
  state: 'idle' | 'checking' | 'retrying' | 'activated' | 'gave_up' | ReconcileOutcome;
  attempts: number;
  nextRetryInMs?: number;
  lastError?: string;
}

export interface ProReconcilerDeps {
  getApiKey(): string | null | undefined;
  isTrialKey(key: string): boolean;
  isPremium(): boolean;
  fetchPlan(key: string): Promise<PlanAnswer>;
  activate(key: string): Promise<ActivateAnswer>;
  onActivated(): void;
  onStatus?(status: ReconcilerStatus): void;
  /** Returns a cancel function. */
  schedule(fn: () => void | Promise<void>, ms: number): () => void;
  now?(): number;
  log?: { log(...a: unknown[]): void; warn(...a: unknown[]): void };
}

/** Spaced so an outage costs the server a handful of calls per client, not a poll. */
export const RETRY_DELAYS_MS: readonly number[] = [30_000, 120_000, 600_000, 1_800_000, 1_800_000, 3_600_000];
/** Triggers closer together than this share the previous attempt's verdict. */
export const MIN_ATTEMPT_GAP_MS = 20_000;

export function createProEntitlementReconciler(deps: ProReconcilerDeps) {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? console;
  let inFlight: Promise<ReconcileOutcome> | null = null;
  let cancelRetry: (() => void) | null = null;
  let failures = 0;
  let attempts = 0;
  let lastAttemptAt = 0;
  let lastOutcome: ReconcileOutcome | null = null;
  let status: ReconcilerStatus = { state: 'idle', attempts: 0 };

  const publish = (next: ReconcilerStatus) => {
    status = next;
    try { deps.onStatus?.(next); } catch { /* a listener must not break reconciliation */ }
  };

  const clearRetry = () => { if (cancelRetry) { cancelRetry(); cancelRetry = null; } };

  const finish = (outcome: ReconcileOutcome, lastError?: string): ReconcileOutcome => {
    clearRetry();
    if (outcome !== 'gave_up') failures = 0;
    lastOutcome = outcome;
    publish({ state: outcome, attempts, lastError });
    return outcome;
  };

  const transient = (why: string): ReconcileOutcome => {
    failures++;
    clearRetry();
    if (failures > RETRY_DELAYS_MS.length) {
      log.warn(`[ProReconciler] giving up for now after ${failures} failed attempts — ${why}`);
      failures = 0;                       // a later real trigger starts a fresh series
      return finish('gave_up', why);
    }
    const delay = RETRY_DELAYS_MS[failures - 1];
    log.warn(`[ProReconciler] Pro could not be confirmed (${why}) — retrying in ${Math.round(delay / 1000)}s`);
    cancelRetry = deps.schedule(() => { cancelRetry = null; return attempt('retry').then(() => undefined); }, delay);
    lastOutcome = 'retrying';
    publish({ state: 'retrying', attempts, nextRetryInMs: delay, lastError: why });
    return 'retrying';
  };

  async function attemptOnce(reason: string, hint?: { plan?: string }): Promise<ReconcileOutcome> {
    const key = deps.getApiKey();
    if (!key || deps.isTrialKey(key) || deps.isPremium()) return finish('not_needed');

    attempts++;
    lastAttemptAt = now();
    publish({ state: 'checking', attempts });

    // The plan first: most keys are `standard`, and they must not each cost a
    // /v1/pro/verify on every launch. /v1/usage is a call the app makes anyway.
    // A caller that has JUST read the plan from /v1/usage passes it in, so the
    // trigger does not cost a second identical request.
    let plan: PlanAnswer;
    if (hint?.plan) plan = { ok: true, plan: hint.plan };
    else try { plan = await deps.fetchPlan(key); } catch (e: any) { return transient(`plan lookup failed: ${e?.message ?? e}`); }
    if (!plan.ok) {
      if (plan.keyRejected) { log.warn('[ProReconciler] the server refused the key — leaving it to the save flow'); return finish('key_rejected'); }
      return transient(`plan lookup answered ${plan.status ?? 'nothing'}`);
    }
    if (!plan.plan || !PRO_CAPABLE_PLANS.has(plan.plan)) return finish('no_entitlement');

    log.log(`[ProReconciler] (${reason}) plan "${plan.plan}" includes Pro but Pro is inactive here — activating`);
    let res: ActivateAnswer;
    try { res = await deps.activate(key); } catch (e: any) { return transient(`activation threw: ${e?.message ?? e}`); }

    if (res.success) {
      log.log('[ProReconciler] Pro activated.');
      try { deps.onActivated(); } catch (e: any) { log.warn('[ProReconciler] onActivated threw:', e?.message ?? e); }
      return finish('activated');
    }
    if (res.skipped) return finish('skipped', res.error);
    if (res.keyRejected) return finish('key_rejected', res.error);
    // The plan says Pro and verify did not confirm it: a 5xx, a network error, an
    // odd body — or "no Pro" from a server that just told us otherwise. All of
    // them are "ask again later", none of them is a verdict.
    return transient(res.status ? `verify answered ${res.status}` : (res.error || 'verify did not confirm'));
  }

  function attempt(reason: string, hint?: { plan?: string }): Promise<ReconcileOutcome> {
    if (inFlight) return inFlight;
    // An external trigger inside the gap — or while a retry is already queued —
    // gets the standing verdict. Only the scheduled retry may break the wait.
    if (reason !== 'retry' && lastOutcome && (cancelRetry || now() - lastAttemptAt < MIN_ATTEMPT_GAP_MS)) {
      if (!deps.isPremium() || lastOutcome === 'activated') return Promise.resolve(lastOutcome);
    }
    inFlight = attemptOnce(reason, hint)
      .catch((e: any): ReconcileOutcome => transient(`unexpected: ${e?.message ?? e}`))
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    /** Safe to call from anywhere, as often as you like. */
    run: (reason: string, hint?: { plan?: string }): Promise<ReconcileOutcome> => attempt(reason, hint),
    /** Key cleared or app quitting: cancel the pending retry and forget the series. */
    stop(): void { clearRetry(); failures = 0; lastOutcome = null; lastAttemptAt = 0; publish({ state: 'idle', attempts }); },
    snapshot: (): ReconcilerStatus => status,
  };
}
