/**
 * The one place ProEntitlementReconciler meets the running app. Everything
 * platform- or Electron-shaped lives here so the reconciler itself stays pure.
 *
 * Nothing in this file branches on the operating system: credentials come from
 * CredentialsManager, the licence from LicenseManager, and the two network calls
 * are plain fetches. Behaviour is the same on macOS and Windows.
 */
import { BrowserWindow } from 'electron';
import { TRIAL_SENTINEL_KEY } from '../config/constants';
import {
  createProEntitlementReconciler,
  type ActivateAnswer,
  type PlanAnswer,
  type ReconcilerStatus,
} from './ProEntitlementReconciler';

const API_BASE = (process.env.NATIVELY_API_URL || 'https://api.natively.software').replace(/\/+$/, '');

type Reconciler = ReturnType<typeof createProEntitlementReconciler>;
let instance: Reconciler | null = null;

/** The premium module is absent from open-source builds; absence means "nothing to do". */
function licenseManager(): any | null {
  try {
    const { LicenseManager } = require('../../premium/electron/services/LicenseManager');
    return LicenseManager.getInstance();
  } catch {
    return null;
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

async function fetchPlan(key: string): Promise<PlanAnswer> {
  const res = await fetch(`${API_BASE}/v1/usage`, {
    headers: { 'x-natively-key': key },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status >= 200 && res.status < 300) {
    const data = (await res.json().catch(() => null)) as any;
    return typeof data?.plan === 'string' ? { ok: true, plan: data.plan } : { ok: false, status: res.status };
  }
  // 401/403 are the server refusing the key. 429 and 5xx say nothing about it.
  return { ok: false, status: res.status, keyRejected: res.status === 401 || res.status === 403 };
}

export function getProEntitlementReconciler(): Reconciler {
  if (instance) return instance;
  instance = createProEntitlementReconciler({
    getApiKey: () => {
      try {
        const { CredentialsManager } = require('./CredentialsManager');
        return CredentialsManager.getInstance().getNativelyApiKey();
      } catch {
        return null;
      }
    },
    isTrialKey: (key) => key === TRIAL_SENTINEL_KEY,
    // No premium module → report "already fine" so the reconciler never runs.
    isPremium: () => { const lm = licenseManager(); return lm ? Boolean(lm.isPremium()) : true; },
    fetchPlan,
    activate: async (key): Promise<ActivateAnswer> => {
      const lm = licenseManager();
      if (!lm) return { success: false, skipped: true };
      return lm.activateWithApiKey(key);
    },
    onActivated: () => broadcast('license-status-changed', { isPremium: true }),
    onStatus: (status: ReconcilerStatus) => broadcast('pro-activation-status', status),
    schedule: (fn, ms) => {
      const t = setTimeout(() => { void fn(); }, ms);
      // A pending retry must never hold the app open on quit.
      if (typeof (t as any).unref === 'function') (t as any).unref();
      return () => clearTimeout(t);
    },
  });
  return instance;
}
