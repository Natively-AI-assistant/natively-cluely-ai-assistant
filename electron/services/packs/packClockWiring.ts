/**
 * The one place PackMeetingClock meets the running app. Everything Electron-
 * shaped lives here so the clock itself stays pure.
 *
 * Nothing in this file branches on the operating system: the key comes from
 * CredentialsManager, the licence from LicenseManager, the timer is a plain
 * setInterval and the tick is a plain fetch. Sleep and wake reach the clock
 * from the existing powerMonitor listeners in main.ts, which Electron emits on
 * macOS and Windows alike. Behaviour is the same on both.
 */
import { BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { TRIAL_SENTINEL_KEY } from '../../config/constants';
import { nativelyApiBase } from '../nativelyApiBase';
import { createPackMeetingClock, type TickAnswer, type TickBody } from './PackMeetingClock';

const API_BASE = nativelyApiBase();

type Clock = ReturnType<typeof createPackMeetingClock>;
let instance: Clock | null = null;

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

async function postTick(key: string, body: TickBody): Promise<TickAnswer> {
  const res = await fetch(`${API_BASE}/v1/pack/meeting-tick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-natively-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, body: data };
}

/**
 * The pack has ended. Ask the server whether Pro still holds: isPremiumAsync
 * revokes a natively_api licence only on a confirmed loss (403
 * subscription_inactive), keeps it on anything transient, and never touches a
 * lifetime or Dodo licence the user also owns.
 */
async function recheckPro(reason: string | undefined, onProLost: () => void): Promise<void> {
  broadcast('pack-ended', { reason: reason ?? null });
  let lm: any = null;
  try {
    const { LicenseManager } = require('../../../premium/electron/services/LicenseManager');
    lm = LicenseManager.getInstance();
  } catch {
    return; // open-source build: no Pro to take away
  }
  let stillPro = true;
  try { stillPro = Boolean(await lm.isPremiumAsync()); } catch (e: any) {
    console.warn('[PackClock] Pro re-check failed (kept as is):', e?.message ?? e);
    return;
  }
  if (stillPro) return;
  console.log('[PackClock] Pro ended with the pack');
  try { onProLost(); } catch (e: any) { console.warn('[PackClock] Pro teardown threw:', e?.message ?? e); }
  broadcast('license-status-changed', { isPremium: false });
}

/**
 * @param onProLost the same premium-only teardown a deactivated licence gets
 *   (active mode cleared, knowledge mode off). Supplied by main.ts, which owns
 *   those objects.
 */
export function getPackMeetingClock(onProLost: () => void = () => {}): Clock {
  if (instance) return instance;
  instance = createPackMeetingClock({
    getApiKey: () => {
      try {
        const { CredentialsManager } = require('../CredentialsManager');
        const key = CredentialsManager.getInstance().getNativelyApiKey();
        return key && key !== TRIAL_SENTINEL_KEY ? key : null;
      } catch {
        return null;
      }
    },
    postTick,
    now: () => performance.now(),
    every: (fn, ms) => {
      const t = setInterval(fn, ms);
      // The clock must never hold the app open on quit.
      if (typeof (t as any).unref === 'function') (t as any).unref();
      return () => clearInterval(t);
    },
    newMeetingId: () => `mtg_${randomBytes(12).toString('hex')}`,
    onPackEnded: (info) => { void recheckPro(info.reason, onProLost); },
    onPackState: (pack) => broadcast('pack-state', pack),
  });
  return instance;
}
