import React, { useCallback, useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import { useT } from '../i18n';

type SharedDesktopStatus = Awaited<ReturnType<NonNullable<Window['electronAPI']>['sharedDesktopStatus']>>;

/** Status is file-backed (a session can be started/stopped from a terminal too), so poll it. */
const POLL_MS = 3000;

/**
 * Linux only: starts/stops the "shared desktop" — a nested display with its own
 * Brave (Natively extension loaded) to screen-share in meetings, while Natively
 * stays on the real desktop and its screenshots follow the nested display.
 */
export function SharedDesktopPill({ isLight }: { isLight: boolean }) {
  const t = useT();
  const api = window.electronAPI;
  const [status, setStatus] = useState<SharedDesktopStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api?.sharedDesktopStatus) return;
    setStatus(await api.sharedDesktopStatus());
  }, [api]);

  useEffect(() => {
    if (api?.platform !== 'linux') return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [api, refresh]);

  if (api?.platform !== 'linux' || !status) return null;

  const blocked = !status.supported || !status.extensionReady;
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(status.running ? await api.sharedDesktopStop() : await api.sharedDesktopStart());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const label = busy
    ? (status.running ? t('Stopping…') : t('Starting…'))
    : status.running
      ? t('Shared desktop on')
      : t('Shared desktop');
  const title = error
    ?? (blocked
      ? status.unavailableReason
      : status.running
        ? t('Share this display ({display}) in your meeting. Click to stop.').replace('{display}', status.display ?? '')
        : t('Open a separate desktop to screen-share. Natively stays visible only to you.'));

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy || (blocked && !status.running)}
      title={title}
      className={`flex items-center gap-2 border rounded-full px-3 py-1.5 text-xs font-medium shrink-0 select-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
        error
          ? 'border-red-500/40 text-red-400'
          : status.running
            ? (isLight ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600' : 'border-emerald-500/30 bg-emerald-400/10 text-emerald-400')
            : (isLight ? 'bg-bg-elevated border-border-muted shadow-sm text-text-secondary' : 'bg-[#101011] border-border-muted text-text-secondary')
      }`}
    >
      {status.running && !busy ? (
        <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-emerald-400" />
      ) : (
        <Monitor size={14} strokeWidth={2} className="shrink-0" />
      )}
      <span>{error ? t('Shared desktop failed') : label}</span>
    </button>
  );
}
