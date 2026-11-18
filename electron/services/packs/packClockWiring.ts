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
// One per process, not per bundle (every .ts file is its own esbuild bundle;
// see nativelyPlanLimitEvents.ts): ipcHandlers.ts reaches main.ts's clock here.
const CLOCK_KEY = Symbol.for('natively.packMeetingClock');
const clockHolder = globalThis as unknown as { [CLOCK_KEY]?: Clock | null };

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
 * Is the key metered again? A plain usage read: 200 means the server accepts
 * it (the top-up webhook adds hours to the same key and drops its cache), a
 * refusal or any failure means not yet. Bills nothing.
 */
async function isKeyLive(key: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/v1/usage`, {
      headers: { 'x-natively-key': key },
      signal: AbortSignal.timeout(10_000),
    });
    return res.status === 200;
  } catch (e: any) {
    // Unreachable reads the same as "not topped up" to the clock; say which (#759).
    console.warn(`[PackClock] pack re-check could not reach the server: ${e?.message ?? e}${e?.cause?.code ? ` (${e.cause.code})` : ''}`);
    return false;
  }
}

/**
 * A paused meeting's pack is live again. Pro comes back through the usual
 * reconciler (it re-activates a natively_api licence when /v1/usage names a
 * Pro plan), and the windows drop their "pack ended" notices.
 */
function packRenewed(): void {
  broadcast('pack-renewed', {});
  try {
    const { getProEntitlementReconciler } = require('../proEntitlementWiring');
    void getProEntitlementReconciler().run('pack-renewed').catch(() => { /* re-checked on its own schedule */ });
  } catch { /* open-source build: no Pro to restore */ }
}

/**
 * The pack has ended. Ask the server whether Pro still holds: isPremiumAsync
 * revokes a natively_api licence only on a confirmed loss (403
 * subscription_inactive), keeps it on anything transient, and never touches a
 * lifetime or Dodo licence the user also owns.
 */
async function recheckPro(reason: string | undefined, onProLost: () => void): Promise<void> {
  // Windows hear only a pack that the server says has ended (its
  // pack_ended_reason: 'hours_used' | 'window_closed'). The clock also lands
  // here for any key refused as subscription_inactive, such as a lapsed monthly
  // plan, which must still get the Pro re-check below but is not a pack: the
  // overlay would tell its owner "Your pack has ended" every meeting.
  if (reason) broadcast('pack-ended', { reason });
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

// The Pro teardown main.ts supplies, kept per process. Only a caller that
// passes one sets it: other callers (ipcHandlers' checkProNow) ask for the clock
// with no argument and must not replace the real teardown with nothing.
const PRO_LOST_KEY = Symbol.for('natively.packProLost');
const proLostHolder = globalThis as unknown as { [PRO_LOST_KEY]?: () => void };
const proLost = (): (() => void) => proLostHolder[PRO_LOST_KEY] ?? (() => {});

/**
 * Re-check Pro now, with the same teardown a pack end gets. For the plan's key
 * coming back after a pack (nativelyPackFallback.ts): no "pack ended" notice,
 * the pack clock says that itself when it is the pack that ended.
 */
export function recheckProNow(): Promise<void> {
  return recheckPro(undefined, proLost());
}

/**
 * @param onProLost the same premium-only teardown a deactivated licence gets
 *   (active mode cleared, knowledge mode off). Supplied by main.ts, which owns
 *   those objects; every other caller passes nothing.
 */
export function getPackMeetingClock(onProLost?: () => void): Clock {
  if (onProLost) proLostHolder[PRO_LOST_KEY] = onProLost;
  const existing = clockHolder[CLOCK_KEY];
  if (existing) return existing;
  const instance = clockHolder[CLOCK_KEY] = createPackMeetingClock({
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
    onPackEnded: (info) => {
      // A held pack key standing in for a used-up plan: the plan's key goes
      // back in use (nativelyPackFallback.ts) before Pro is re-checked.
      // In that order: the key in use settles first, so Pro is re-checked
      // against what is actually in use. The teardown is read at the time, not
      // from whichever caller created the clock.
      void (async () => {
        try {
          const { currentNativelyPackFallback } = require('./nativelyPackFallback') as typeof import('./nativelyPackFallback');
          await currentNativelyPackFallback()?.check('pack_ended');
        } catch { /* no fallback wired */ }
        await recheckPro(info.reason, proLost());
      })();
    },
    isKeyLive,
    onPackRenewed: packRenewed,
    onPackState: (pack) => broadcast('pack-state', pack),
    counts: () => {
      const { packHoursCountNow } = require('../proAccess') as typeof import('../proAccess');
      return packHoursCountNow();
    },
  });
  return instance;
}

/** The clock if main.ts has made it, else null (never makes one: main.ts owns its Pro teardown). */
export function packMeetingClockIfStarted(): Clock | null {
  return clockHolder[CLOCK_KEY] ?? null;
}
