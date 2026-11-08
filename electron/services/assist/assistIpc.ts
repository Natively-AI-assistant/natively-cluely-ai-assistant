// assistIpc.ts
//
// The renderer's way in to the assist features (AssistService). Registered
// once from ipcHandlers, like registerDiagramIpc. Every handler answers
// without throwing: a failure comes back as an empty result or `{ ok: false }`
// with the cause in words.
//
// The one OS call is opening a mail draft: only a `mailto:` link built by the
// renderer's reminder drafts (src/lib/reminderDrafts.mjs), short enough for
// the mail client on Windows (which cuts long mailto links), opened in the
// user's mail app. Natively never sends mail itself.

import { getAssistService } from './AssistService';

type SafeHandle = (channel: string, listener: (event: any, ...args: any[]) => any) => void;

/** Longest mailto link opened: Windows' shell cuts them near 2,000 characters. */
export const MAILTO_MAX_LENGTH = 1900;

/** A link the mail-draft handler will open: mailto only, no line breaks, bounded. */
export function isOpenableMailto(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > MAILTO_MAX_LENGTH || /[\r\n]/.test(url)) return false;
  try {
    return new URL(url).protocol === 'mailto:';
  } catch {
    return false;
  }
}

export function registerAssistIpc(
  safeHandle: SafeHandle,
  opts: {
    getSetting(key: string): unknown;
    setSetting(key: string, value: unknown): boolean;
    sender(): { name: string | null; email: string | null; google: boolean };
    openExternal(url: string): Promise<void>;
  },
): void {
  const svc = () => getAssistService();

  safeHandle('assist:get-daily-brief', async (_e, events: unknown) => {
    try { return svc()?.getDailyBrief(events as any) ?? { meetings: [] }; } catch { return { meetings: [] }; }
  });
  safeHandle('assist:get-meeting-brief', async (_e, event: unknown, o?: { refresh?: boolean }) => {
    const s = svc();
    if (!s) return { ok: false, error: 'Natively is still starting. Try again in a moment.' };
    try {
      return { ok: true, brief: await s.getMeetingBrief(event as any, { refresh: o?.refresh === true }) };
    } catch {
      return { ok: false, error: 'The brief could not be put together for this event.' };
    }
  });
  safeHandle('assist:get-catch-up', async () => {
    try { return svc()?.getCatchUp() ?? null; } catch { return null; }
  });
  safeHandle('assist:dismiss-catch-up', async (_e, key: unknown) => {
    if (typeof key !== 'string') return { ok: false };
    try { svc()?.dismissCatchUp(key); return { ok: true }; } catch { return { ok: false }; }
  });
  safeHandle('assist:get-live-recap', async () => {
    try { return svc()?.getLiveRecap() ?? null; } catch { return null; }
  });
  safeHandle('assist:dismiss-live-recap', async () => {
    try { svc()?.dismissLiveRecap(); } catch { /* nothing to hide */ }
    return { ok: true };
  });
  // Settings › Calendar: the catch-up after back-to-back meetings. Unset = on.
  safeHandle('assist:get-catch-up-enabled', async () => opts.getSetting('assistCatchUpEnabled') !== false);
  safeHandle('assist:set-catch-up-enabled', async (_e, on: unknown) => {
    if (typeof on !== 'boolean') return { success: false };
    if (!opts.setSetting('assistCatchUpEnabled', on)) return { success: false, error: 'settings_store_degraded' };
    return { success: true };
  });
  // Who a reminder draft is signed by, and whether Gmail can open it (a Google calendar).
  safeHandle('assist:get-sender', async () => {
    try { return opts.sender(); } catch { return { name: null, email: null, google: false }; }
  });
  safeHandle('assist:open-mail-draft', async (_e, url: unknown) => {
    if (!isOpenableMailto(url)) return { ok: false, error: 'This draft is too long to open in your mail app.' };
    try {
      await opts.openExternal(url);
      return { ok: true };
    } catch {
      return { ok: false, error: 'No mail app opened. The draft is on your clipboard instead.' };
    }
  });
}
