/**
 * What the app does with a failed connection to Natively (2026-11-18, #759).
 *
 * The Pro check keeps saying "plan lookup failed: fetch failed". This notices a
 * failure that looks like the network, asks connectivityDiagnosis why, tells the
 * person in plain words, reports it (the funnel decides whether telemetry is on),
 * and for the one cause the app can undo — a stale OS certificate store — undoes
 * it for this session and asks again.
 *
 * PURE ON PURPOSE: every effect is injected, nothing here is platform-specific.
 * It never throws into the caller (it runs from a status callback) and never runs
 * twice at once or more than once per MIN_GAP_MS, so an outage costs one check,
 * not a probe per retry.
 *
 * Type-erasable TypeScript only (the test imports this file directly).
 */
import type { Diagnosis } from './connectivityDiagnosis';

export const MIN_GAP_MS = 30 * 60_000;

export type FailureReason = 'key_saved' | 'pro_check' | 'api_call';

export interface WatcherNotice { verdict: string; message: string; healed: boolean }

export interface WatcherDeps {
  diagnose(reason: FailureReason): Promise<Diagnosis>;
  /** Report props for connect_diag. */
  track(props: Record<string, string | number | boolean>): unknown;
  /** Show the person what was found. */
  notify(notice: WatcherNotice): void;
  /** Undo the stale certificate merge for this session. False when it could not. */
  heal(): boolean;
  /** Take the undo back. Called when it did not fix anything: it is process-wide, so it stays only if it worked. */
  restore?(): void;
  /** Run the Pro check again right now. */
  retry(): Promise<string>;
  now?(): number;
  log?(message: string): void;
}

/**
 * Whether a Pro-check failure text is about reaching the server, as opposed to
 * the server answering (a status) or refusing the key.
 */
export function looksLikeNetworkFailure(lastError: string | undefined): boolean {
  if (!lastError) return false;
  // "refused" alone is not enough: ECONNREFUSED is a connection that never happened.
  if (/answered\s+\d{3}|server refused|refused the key|refused by server/i.test(lastError)) return false;
  return /plan lookup failed|activation threw|fetch failed|network error|verify did not confirm|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EPROTO|ENET|EHOST|CERT_|certificate|UNABLE_TO_|socket hang up|timeout|abort/i.test(lastError);
}

/** After heal() the Pro check got an answer from the server, whatever the answer was. */
const ANSWERED = new Set(['activated', 'no_entitlement', 'key_rejected', 'skipped', 'not_needed']);

/**
 * After the certificate undo, did a request to Natively get an answer? The Pro
 * check says so when it had something to check. With nothing to check (a trial,
 * no key, a plan without Pro) a plain request to Natively stands in.
 */
export async function settleRetry(reconcile: () => Promise<string>, plainRequest: () => Promise<boolean>): Promise<string> {
  try {
    const outcome = await reconcile();
    if (outcome !== 'not_needed') return outcome;
  } catch { /* fall through to the plain request */ }
  try { return (await plainRequest()) ? 'activated' : 'retrying'; } catch { return 'retrying'; }
}

export function createConnectivityWatcher(deps: WatcherDeps) {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  let inFlight = false;
  let lastRunAt = -Infinity;

  async function onFailure(reason: FailureReason, lastError: string | undefined): Promise<void> {
    if (!looksLikeNetworkFailure(lastError)) return;
    if (inFlight || now() - lastRunAt < MIN_GAP_MS) return;
    inFlight = true;
    lastRunAt = now();
    try {
      const d = await deps.diagnose(reason);
      let healed = false;
      if (d.heal === 'drop_system_ca') {
        try {
          if (deps.heal()) {
            healed = ANSWERED.has(await deps.retry());
            if (!healed) { try { deps.restore?.(); } catch { /* best effort */ } }
          }
        } catch (e: any) { log(`[ConnectDiag] heal failed: ${e?.message ?? e}`); }
      }
      try { deps.track({ ...d.report, healed }); } catch { /* telemetry is best effort */ }
      try { deps.notify({ verdict: d.verdict, message: d.userMessage, healed }); } catch { /* the notice is best effort */ }
      log(`[ConnectDiag] verdict ${d.verdict}${healed ? ' (healed)' : ''}`);
    } catch (e: any) {
      log(`[ConnectDiag] diagnosis failed: ${e?.message ?? e}`);
    } finally {
      inFlight = false;
    }
  }

  return { onFailure };
}
