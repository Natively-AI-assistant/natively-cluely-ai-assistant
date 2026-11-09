import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { overlayTrialNotice } from '../../lib/trial/overlayTrialNotice.mjs';
import type { OverlayTrialBanner, OverlayTrialChip, OverlayTrialEndReason } from '../../lib/trial/overlayTrialNotice.mjs';
import { classifyAutoTrial } from '../../lib/trial/autoTrial.mjs';

// ─── The free trial, as the meeting overlay sees it ──────────────────────────
// A meeting that starts with no AI starts the trial by itself (main:
// autoStartTrialForMeeting). This hook is the overlay's side of that: it hears
// the start, the failure and the end, keeps the clock, and hands back what to
// draw (src/lib/trial/overlayTrialNotice.mjs decides; TrialNotice.tsx draws).
//
// The facts live in a ref and the clock ticks every second, but state changes
// only when what is DRAWN changes (a banner, or the minute on the countdown).
// NativelyInterface is far too large to re-render once a second.

type Failure = 'unreachable' | 'rate_limited' | 'paused';

export interface OverlayTrialView {
  banner: OverlayTrialBanner | null;
  chip: OverlayTrialChip | null;
  /** Minutes left while the trial is live (the started banner says them). */
  minutesLeft: number | null;
  /** For the ending and ended banners: the clock, or the AI allowance. */
  reason: OverlayTrialEndReason | null;
  /** Why the automatic start failed, while the manual one is on offer. */
  failure: Failure | null;
  /** The manual start is in flight. */
  starting: boolean;
  /** The automatic start is on its way: "Transcription Not Configured" is about to stop being true. */
  pending: boolean;
  /** A meeting is on. Outside one the overlay is hidden, and nothing it computes was seen. */
  active: boolean;
}

export interface OverlayTrial extends OverlayTrialView {
  dismiss: () => void;
  useOwnKeys: () => void;
  seePlans: () => void;
  startManually: () => void;
}

const EMPTY: OverlayTrialView = { banner: null, chip: null, minutesLeft: null, reason: null, failure: null, starting: false, pending: false, active: false };
/** A 'pending' with no answer is dropped after this long (two 10 s attempts and the wait between them). */
const PENDING_MAX_MS = 30_000;

const sameView = (a: OverlayTrialView, b: OverlayTrialView) =>
  a.banner === b.banner && a.failure === b.failure && a.starting === b.starting && a.pending === b.pending && a.active === b.active
  && a.minutesLeft === b.minutesLeft && a.reason === b.reason && !a.chip === !b.chip && a.chip?.tone === b.chip?.tone;

// `reason` goes with ending and ended only (catalogue, 2026-11-03): the funnel
// can then tell a trial whose AI allowance ran out from one whose clock did.
const track = (state: OverlayTrialBanner, action: 'shown' | 'own_keys' | 'plans' | 'start' | 'dismissed', reason?: OverlayTrialEndReason | null) => {
  const props: Record<string, string> = { state, action };
  if (reason && (state === 'ending' || state === 'ended')) props.reason = reason;
  try { window.electronAPI?.funnelTrack?.('trial_notice', props)?.catch?.(() => {}); } catch { /* analytics never breaks the overlay */ }
};

export function useOverlayTrial(): OverlayTrial {
  const facts = useRef({
    expiresAt: null as number | null,
    announcedAt: null as number | null,
    liveThisMeeting: false,
    startFailed: null as Failure | null,
    dismissed: {} as { started?: boolean },
    starting: false,
    pendingSince: null as number | null,
    // How long a trial lasts, from the server's own two times: it caps what a
    // clock running behind the server would otherwise show.
    durationMs: null as number | null,
    // The AI allowance is in its last quarter (main, from the status poll),
    // and what ended the trial when main said so.
    allowanceLow: false,
    endedBy: null as OverlayTrialEndReason | null,
    // Assumed on only where it cannot be asked (an older preload).
    meetingActive: (typeof window !== 'undefined' && !window.electronAPI?.getMeetingActive) as boolean,
  });
  const reported = useRef(new Set<OverlayTrialBanner>());
  const [view, setView] = useState<OverlayTrialView>(EMPTY);

  const refresh = useCallback(() => {
    const f = facts.current;
    const now = Date.now();
    if (f.pendingSince !== null && now - f.pendingSince > PENDING_MAX_MS) f.pendingSince = null;
    if (f.meetingActive && f.expiresAt !== null && f.expiresAt > now) f.liveThisMeeting = true;
    const notice = overlayTrialNotice({
      now,
      expiresAt: f.expiresAt,
      announcedAt: f.announcedAt,
      liveThisMeeting: f.liveThisMeeting,
      startFailed: f.startFailed,
      dismissed: f.dismissed,
      durationMs: f.durationMs,
      allowanceLow: f.allowanceLow,
      endedBy: f.endedBy,
    });
    const next: OverlayTrialView = {
      banner: notice.banner,
      chip: notice.chip,
      minutesLeft: notice.minutesLeft,
      reason: notice.reason,
      failure: f.startFailed,
      starting: f.starting,
      pending: f.pendingSince !== null,
      active: f.meetingActive,
    };
    setView((prev) => (sameView(prev, next) ? prev : next));
  }, []);

  useEffect(() => {
    const f = facts.current;
    const api = window.electronAPI;
    const forgetTrial = () => { f.expiresAt = null; f.announcedAt = null; f.liveThisMeeting = false; f.durationMs = null; f.allowanceLow = false; f.endedBy = null; };
    const lengthOf = (startedAt?: string, expiresAt?: string, limitMs?: number) => {
      if (typeof limitMs === 'number' && limitMs > 0) return limitMs;
      const span = Date.parse(expiresAt ?? '') - Date.parse(startedAt ?? '');
      return Number.isFinite(span) && span > 0 ? span : null;
    };

    // The clock runs only while there is something to count: a trial that has
    // not run out (in a meeting or between two), or a start in flight. It
    // re-reads the wall clock each second rather than sleeping on it, so a
    // machine that wakes after the expiry says so within a second (as
    // useTrialExpiry does). With no trial, or one that has run out, there is no
    // timer: the overlay lives for the whole session, in every install.
    let ticker: ReturnType<typeof setInterval> | null = null;
    const update = () => {
      refresh();
      const counting = f.pendingSince !== null || (f.expiresAt !== null && f.expiresAt > Date.now());
      if (counting && ticker === null) ticker = setInterval(update, 1000);
      if (!counting && ticker !== null) { clearInterval(ticker); ticker = null; }
    };

    // Whether a meeting is on. Asked once for an overlay that opens mid-meeting;
    // an event that arrives first knows better than the answer still in flight.
    let heardMeeting = false;
    api?.getMeetingActive?.().then((isActive) => {
      if (heardMeeting) return;
      f.meetingActive = !!isActive;
      update();
    }).catch(() => {});

    // A trial already running when the overlay opens (Settings, an earlier
    // launch): the countdown, with nothing to announce.
    api?.getLocalTrial?.().then((local) => {
      if (f.expiresAt !== null) return; // a start arrived first; it knows better
      if (local?.hasToken && local.expiresAt && !local.expired) {
        const at = Date.parse(local.expiresAt);
        if (Number.isFinite(at)) { f.expiresAt = at; f.durationMs = lengthOf(local.startedAt, local.expiresAt); }
      }
      update();
    }).catch(() => {});

    const offs = [
      api?.onTrialStarted?.((data) => {
        const at = Date.parse(data?.expiresAt ?? '');
        if (!Number.isFinite(at)) return;
        f.expiresAt = at;
        f.durationMs = lengthOf(data?.startedAt, data?.expiresAt, data?.limits?.duration_ms);
        f.announcedAt = Date.now();
        f.startFailed = null;
        f.allowanceLow = false;
        f.endedBy = null;
        // The trial is announced BEFORE transcription is rebuilt for it, and
        // that rebuild takes seconds (it waits for the meeting's audio
        // start-up, stops the captures and builds them again). Until main says
        // what transcription is now (onSttConfigChanged below), "Transcription
        // Not Configured" is still on its way out, so it stays held back.
        // Dropped here, it sat beside "Free trial started".
        f.pendingSince = f.meetingActive ? Date.now() : null;
        f.dismissed = {};
        update();
      }),
      api?.onMeetingStateChanged?.((data) => {
        heardMeeting = true;
        f.meetingActive = !!data?.isActive;
        // A meeting that ends takes its trial talk with it. The session reset
        // alone does not do it: at the end of a meeting main sends that BEFORE
        // it flips this flag, so "live in this meeting" was true again a
        // moment later, and a trial that then ran out between meetings sat as
        // "Free trial ended" in the hidden overlay for the next meeting to open on.
        if (!f.meetingActive) { f.liveThisMeeting = false; f.announcedAt = null; f.startFailed = null; f.pendingSince = null; f.dismissed = {}; }
        update();
      }),
      // The fallback has no close, so it has to go by itself once the meeting
      // has AI another way: a key saved mid-meeting, or transcription set up.
      // Left up, its Start button would move someone off the key they just saved.
      api?.onCredentialsChanged?.(() => {
        if (!f.startFailed) return;
        api?.getStoredCredentials?.().then((c) => {
          if (c?.hasOwnAiKey || c?.hasNativelyKey) { f.startFailed = null; update(); }
        }).catch(() => {});
      }),
      api?.onSttConfigChanged?.((data) => {
        let changed = false;
        if (data?.configured && f.startFailed) { f.startFailed = null; changed = true; }
        // Main says this once, when a rebuild is done. With a trial held, that
        // is the rebuild the trial asked for: whatever it found, the wait is over.
        if (f.pendingSince !== null && f.expiresAt !== null) { f.pendingSince = null; changed = true; }
        if (changed) update();
      }),
      // The trial's AI allowance ran out before its clock: main moved the expiry
      // to now, and this is the 30-minute end, "Free trial ended" with See plans,
      // at the moment the answers stopped.
      // Otherwise bought, keyed, or left through own keys: the trial is no longer the story.
      api?.onTrialEnded?.((data) => {
        const endedAt = Date.parse(data?.expiresAt ?? '');
        if (data?.choice === 'allowance' && Number.isFinite(endedAt) && f.expiresAt !== null) {
          f.expiresAt = Math.min(f.expiresAt, endedAt);
          f.endedBy = 'allowance';
        } else {
          forgetTrial();
        }
        f.startFailed = null;
        update();
      }),
      // About two answers left (main: the trial:status poll, every 30 s while
      // it stays so): the same warning as five minutes before the clock.
      api?.onTrialAllowanceLow?.(() => {
        if (f.expiresAt === null || f.expiresAt <= Date.now() || f.allowanceLow) return;
        f.allowanceLow = true;
        update();
      }),
      api?.onTrialAutoStart?.((data) => {
        if (data.state === 'pending') f.pendingSince = Date.now();
        else f.pendingSince = null;
        if (data.state === 'failed') f.startFailed = data.reason;
        update();
      }),
      // A new meeting: what was said, closed or failed in the last one is over.
      // Main sends this in the same breath as it asks for the trial, before any
      // reply can arrive, so a start is never wiped by its own meeting's reset.
      api?.onSessionReset?.(() => {
        f.announcedAt = null;
        f.liveThisMeeting = false;
        f.startFailed = null;
        f.dismissed = {};
        f.pendingSince = null;
        reported.current.clear();
        update();
      }),
    ];
    return () => {
      if (ticker !== null) clearInterval(ticker);
      for (const off of offs) { try { off?.(); } catch { /* window closing */ } }
    };
  }, [refresh]);

  // Each banner is reported once per meeting, when it first appears, and only
  // in a meeting: a trial that outlives its meeting warns and ends in a hidden
  // overlay, and nobody saw that.
  useEffect(() => {
    if (!view.active || !view.banner || reported.current.has(view.banner)) return;
    reported.current.add(view.banner);
    track(view.banner, 'shown', view.reason);
  }, [view.banner, view.active, view.reason]);

  const banner = view.banner;
  const reason = view.reason;
  const actions = useMemo(() => ({
    dismiss: () => {
      // Only the started banner has a close.
      if (banner !== 'started') return;
      facts.current.dismissed.started = true;
      track(banner, 'dismissed');
      refresh();
    },
    useOwnKeys: () => {
      if (banner) track(banner, 'own_keys', reason);
      window.electronAPI?.openSettingsTab?.('ai-providers');
    },
    seePlans: () => {
      if (banner) track(banner, 'plans', reason);
      window.electronAPI?.openSettingsTab?.('plans');
    },
    startManually: () => {
      const f = facts.current;
      if (f.starting) return;
      f.starting = true;
      track('failed', 'start');
      refresh();
      void (async () => {
        let outcome: ReturnType<typeof classifyAutoTrial> = 'failed';
        try { outcome = classifyAutoTrial(await window.electronAPI?.startTrial?.('overlay')); } catch { /* 'failed' */ }
        f.starting = false;
        // 'started' is announced by main (trial-started) and handled above.
        if (outcome === 'rate_limited') f.startFailed = 'rate_limited';
        else if (outcome === 'failed') f.startFailed = 'unreachable';
        // Too many trials from this network, or the day's ceiling: not final
        // and not this device's doing, so the banner stays and says so.
        else if (outcome === 'network_limited') f.startFailed = 'paused';
        // Used up, or a machine that cannot have one: nothing left to offer here.
        else if (outcome !== 'started') f.startFailed = null;
        refresh();
      })();
    },
  }), [banner, reason, refresh]);

  return useMemo(() => ({ ...view, ...actions }), [view, actions]);
}
