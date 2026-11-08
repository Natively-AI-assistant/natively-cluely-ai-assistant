import { useCallback, useEffect, useState } from 'react';
import type { AssistLiveRecap } from '../../types/assist';

/**
 * "Last time", when a meeting of a recurring series starts (main:
 * services/assist/AssistService.noteMeetingStarted). Main looks it up after
 * the start, from the previous meeting's saved notes with no model call, and
 * sends it once. The overlay and the notes window both show it; closing it in
 * either closes it in both. It goes when the meeting ends.
 *
 * No i18n and no styles here: the notes window is a light route.
 */
export interface LastTimeRecapState {
  recap: AssistLiveRecap;
  dismiss: () => void;
}

export function useLastTimeRecap(): LastTimeRecapState {
  const [recap, setRecap] = useState<AssistLiveRecap>(null);

  useEffect(() => {
    const api = window.electronAPI;
    let heard = false;
    api?.assistGetLiveRecap?.()
      .then((r) => { if (!heard) setRecap(r ?? null); })
      .catch(() => { /* nothing to show */ });
    const off = api?.onAssistLastTimeRecap?.((r) => { heard = true; setRecap(r ?? null); });
    const offState = api?.onMeetingStateChanged?.((data) => { if (!data?.isActive) setRecap(null); });
    return () => { off?.(); offState?.(); };
  }, []);

  const dismiss = useCallback(() => {
    setRecap(null);
    window.electronAPI?.assistDismissLiveRecap?.()?.catch?.(() => {});
  }, []);

  return { recap, dismiss };
}
