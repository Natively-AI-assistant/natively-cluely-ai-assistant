/**
 * The one place the connection check meets the running app (2026-11-18, #759):
 * real probes, the Electron proxy setting, the funnel report and the window
 * notice. The decisions are in connectivityDiagnosis.ts and connectivityWatcher.ts.
 *
 * No platform branches: the probes are Node's own, the proxy setting is
 * Electron's session.resolveProxy (system proxy on both OSes), and the
 * certificate undo is a Node call.
 */
import { BrowserWindow, session } from 'electron';
import { nativelyApiBase } from './nativelyApiBase';
import { diagnoseConnection } from './connectivityDiagnosis';
import { createRealProbes } from './connectivityProbes';
import { createConnectivityWatcher, settleRetry, type FailureReason } from './connectivityWatcher';
import { dropSystemCertificates, restoreSystemCertificates, getSystemCertificateStats } from '../utils/systemCertificates';
import { funnelTelemetry } from './FunnelTelemetry';
import { wrapFetchForApiFailures } from './apiFailureHook';
import { describeProbeError } from '../rag/providers/probeError';

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

let lastDiagnosis: { reason?: string; verdict?: string; report?: Record<string, unknown> } | undefined;

/** The most recent connection check, for the diagnostic report. */
export function getLastDiagnosis() {
  return lastDiagnosis;
}

export function createAppConnectivityWatcher(retry: () => Promise<string>) {
  return createConnectivityWatcher({
    diagnose: (reason: FailureReason) => diagnoseConnection(
      createRealProbes({
        resolveProxy: (url) => session.defaultSession.resolveProxy(url),
        certStats: getSystemCertificateStats,
        // With Usage statistics off the check still runs and the person still sees the result, but it
        // makes no request to anyone but Natively (PRIVACY.md): the control sites are not asked.
        ...(funnelTelemetry.isEnabled() ? {} : { controlUrls: [] }),
      }),
      new URL(nativelyApiBase()).hostname,
      { reason },
    ),
    track: (props) => {
      lastDiagnosis = { reason: String(props.reason), verdict: String(props.verdict), report: { ...props } };
      return funnelTelemetry.track('connect_diag', props);
    },
    notify: (notice) => broadcast('connect-diagnosis', notice),
    heal: () => dropSystemCertificates(),
    restore: () => { restoreSystemCertificates(); },
    retry,
    log: (message) => console.log(message),
  });
}

const retryAfterHeal = (): Promise<string> => settleRetry(
  () => {
    const { getProEntitlementReconciler } = require('./proEntitlementWiring') as typeof import('./proEntitlementWiring');
    return getProEntitlementReconciler().run('retry');
  },
  async () => { await fetch(`${nativelyApiBase()}/v1/plans`, { signal: AbortSignal.timeout(8000) }); return true; },
);

let shared: ReturnType<typeof createAppConnectivityWatcher> | null = null;

/** One watcher for every trigger, so they share one 30-minute throttle. */
export function getAppConnectivityWatcher() {
  return (shared ??= createAppConnectivityWatcher(retryAfterHeal));
}

/** A failed call to Natively, from anywhere in the main process. Never throws. */
export function reportApiFailure(reason: FailureReason, description: string | undefined): void {
  try { void getAppConnectivityWatcher().onFailure(reason, description).catch(() => { /* best effort */ }); } catch { /* best effort */ }
}

/** Start the connection check for any failed fetch to the Natively API. Call once, after .env is loaded. */
export function installApiFailureHook(): void {
  try {
    if (typeof globalThis.fetch !== 'function') return;
    globalThis.fetch = wrapFetchForApiFailures(globalThis.fetch, {
      apiOrigin: new URL(nativelyApiBase()).origin,
      onFailure: reportApiFailure,
      describe: describeProbeError,
    });
  } catch { /* the app works without it */ }
}
