import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, ArrowUpRight, Bell, CalendarDays, CalendarRange, Check, Info, Link2, ListChecks, Loader2, PhoneOff, RefreshCw, ScreenShare, Video } from 'lucide-react';
import { useLanguage, useT } from '../../i18n';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { Collapse, CollapseItem, Presence, SettingsMotionReady, SwapLabel, useMotionReadyAfter, useSettledFlag } from './SettingsRow';
import { SettingsToggle } from './SettingsToggle';
import { readCalendarSnapshot, unfinishedEvents, writeCalendarSnapshot } from '../../lib/calendarSnapshot.mjs';
import './CalendarSettings.css';
import { isMac } from '../../utils/platformUtils';

/*
  Settings › Calendar, in the language of Profile Intelligence and the Modes
  Manager (CalendarSettings.css has the tokens, PI's own): a page label over one
  grey line; the account as PI shows the attached resume, or PI's empty box
  with one pill when there is none; a hero number ("5 meetings in the next 7
  days · next in 12 minutes"), the way PI's Profile leads with years of
  experience; one section card per day, each meeting a "Title · Google Meet"
  row with its time on the right, the soonest wearing the Modes Manager's
  Active pill; the synced calendars in a card of their own; and an info
  footnote.
*/

interface CalendarStatus {
  connected: boolean;
  email?: string;
  name?: string;
}

/** A calendar source as main reports it (CalendarManager.getSourceStatuses). */
type SourceId = 'google' | 'outlook' | 'apple' | 'ics';
interface CalendarSource {
  id: SourceId;
  state: 'connected' | 'disconnected' | 'unconfigured' | 'notAllowed';
  account?: string;
  detail?: string;
  lastRefresh?: { at: number; ok: boolean };
}

interface SyncedCalendar {
  id: string;
  name: string;
  primary: boolean;
  color?: string;
}

interface UpcomingEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  link?: string;
}

/** Where a meeting link opens, named the way the apps name themselves. */
const providerOf = (link?: string): string | null => {
  if (!link) return null;
  const u = link.toLowerCase();
  if (u.includes('meet.google.com')) return 'Google Meet';
  if (u.includes('zoom.us')) return 'Zoom';
  if (u.includes('teams.microsoft.com') || u.includes('teams.live.com')) return 'Microsoft Teams';
  if (u.includes('webex.com')) return 'Webex';
  return null;
};

// Clock times read like the Launcher's meeting list and calendar card: "2:25 pm".
const clockFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
const rangeOf = (start: Date, end: Date) =>
  end > start ? clockFormat.formatRange(start, end).toLowerCase() : clockFormat.format(start).toLowerCase();
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const capitalize = (text: string, lang: string) => text.charAt(0).toLocaleUpperCase(lang) + text.slice(1);

/** Within this many minutes of its start, a meeting wears the countdown pill. */
const RELATIVE_MINUTES = 60;
/** A meeting can be started from here from this many minutes before its start. */
const START_LEAD_MINUTES = 15;

/** "45 min", "1 hr", "1 hr 30 min", in the interface language. */
function durationLabel(minutes: number, lang: string): string {
  const unit = (value: number, u: 'hour' | 'minute') =>
    new Intl.NumberFormat(lang, { style: 'unit', unit: u, unitDisplay: 'short' }).format(value);
  if (minutes < 60) return unit(minutes, 'minute');
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${unit(h, 'hour')} ${unit(m, 'minute')}` : unit(h, 'hour');
}


/** The time now, every 30s while `enabled`, so "In 12 minutes" stays true. */
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

/** Google's "G", in Google's colours: the account is a Google one. */
const GoogleMark: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
    <g transform="matrix(1, 0, 0, 1, 27.009001, -39.238998)">
      <path fill="#4285F4" d="M -3.264 51.509 C -3.264 50.719 -3.334 49.969 -3.454 49.239 L -14.754 49.239 L -14.754 53.749 L -8.284 53.749 C -8.574 55.229 -9.424 56.479 -10.684 57.329 L -10.684 60.329 L -6.824 60.329 C -4.564 58.239 -3.264 55.159 -3.264 51.509 Z" />
      <path fill="#34A853" d="M -14.754 63.239 C -11.514 63.239 -8.804 62.159 -6.824 60.329 L -10.684 57.329 C -11.764 58.049 -13.134 58.489 -14.754 58.489 C -17.884 58.489 -20.534 56.379 -21.484 53.529 L -25.464 53.529 L -25.464 56.619 C -23.494 60.539 -19.444 63.239 -14.754 63.239 Z" />
      <path fill="#FBBC05" d="M -21.484 53.529 C -21.734 52.809 -21.864 52.039 -21.864 51.239 C -21.864 50.439 -21.734 49.669 -21.484 48.949 L -21.484 45.859 L -25.464 45.859 C -26.284 47.479 -26.754 49.299 -26.754 51.239 C -26.754 53.179 -26.284 54.999 -25.464 56.619 L -21.484 53.529 Z" />
      <path fill="#EA4335" d="M -14.754 43.989 C -12.984 43.989 -11.404 44.599 -10.154 45.789 L -6.734 42.369 C -8.804 40.429 -11.514 39.239 -14.754 39.239 C -19.444 39.239 -23.494 41.939 -25.464 45.859 L -21.484 48.949 C -20.534 46.099 -17.884 43.989 -14.754 43.989 Z" />
    </g>
  </svg>
);

/** "next in 12 minutes", "next in 3 hours", or nothing when it's further off. */
function nextLabel(mins: number, lang: string, t: (s: string) => string): string | null {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (mins <= 0) return t('one happening now');
  if (mins < 60) return `${t('next')} ${rtf.format(mins, 'minute')}`;
  if (mins < 24 * 60) return `${t('next')} ${rtf.format(Math.round(mins / 60), 'hour')}`;
  return null;
}

/**
 * The hero count, as Transitions.dev "Number pop-in": when it changes (a
 * meeting booked or cancelled while the pane is open) the digits re-enter with
 * a blurred slide, from below when it goes up and from above when it goes down.
 * The first paint does not animate; the pane's own entrance covers that.
 */
const DigitPop: React.FC<{ value: number }> = ({ value }) => {
  const prev = useRef(value);
  const [change, setChange] = useState<{ gen: number; up: boolean }>({ gen: 0, up: true });
  useLayoutEffect(() => {
    if (prev.current === value) return;
    const up = value > prev.current;
    prev.current = value;
    setChange((c) => ({ gen: c.gen + 1, up }));
  }, [value]);
  const chars = String(value).split('');
  return (
    <span
      key={change.gen}
      className={`t-digit-group${change.gen > 0 ? ' is-animating' : ''}`}
      style={{ '--digit-dir-y': change.up ? 1 : -1 } as React.CSSProperties}
    >
      {chars.map((ch, i) => (
        <span
          key={i}
          className="t-digit"
          data-stagger={i === chars.length - 2 ? '1' : i === chars.length - 1 && chars.length > 1 ? '2' : undefined}
        >
          {ch}
        </span>
      ))}
    </span>
  );
};

/** Microsoft's four squares: the account is a Microsoft one (Outlook, Microsoft 365). */
const MicrosoftMark: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
    <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
    <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
    <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
    <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
  </svg>
);

const GOOGLE_CALENDAR_URL = 'https://calendar.google.com/';
// macOS only: the Apple Calendar row never exists elsewhere, and this scheme opens nothing there.
const APPLE_CALENDAR_PRIVACY_URL: string | null = isMac ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars' : null;

/** What each source row says about itself while it is not connected. */
const SOURCE_COPY: Record<SourceId, { title: string; hint: string }> = {
  google: { title: 'Google Calendar', hint: 'Gmail or Google Workspace' },
  outlook: { title: 'Outlook', hint: 'Microsoft 365 or Outlook.com' },
  apple: { title: 'Apple Calendar', hint: 'Every calendar in the Calendar app' },
  ics: { title: 'Calendar link', hint: 'A private .ics address from any calendar' },
};

const SourceMark: React.FC<{ id: SourceId; size?: number }> = ({ id, size = 16 }) => {
  if (id === 'google') return <GoogleMark size={size} />;
  if (id === 'outlook') return <MicrosoftMark size={size} />;
  if (id === 'apple') return <CalendarDays size={size} style={{ flexShrink: 0 }} aria-hidden="true" />;
  return <Link2 size={size} style={{ flexShrink: 0 }} aria-hidden="true" />;
};

/** "Updated just now", "Updated 4 min ago", or the plain word for a refresh that failed. */
function refreshLabel(last: CalendarSource['lastRefresh'], now: number, lang: string, t: (s: string) => string): string | null {
  if (!last) return null;
  if (!last.ok) return t('Couldn’t update');
  const mins = Math.max(0, Math.round((now - last.at) / 60_000));
  if (mins < 1) return t('Updated just now');
  return `${t('Updated')} ${new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' }).format(-mins, 'minute')}`;
}

export const CalendarSettings: React.FC = () => {
  const t = useT();
  const { lang } = useLanguage();
  const theme = useResolvedTheme();
  const reduceMotion = useReducedMotion();

  // Opens from what this window last saw (the Launcher warms it after startup),
  // so a visit shows the week at once; the fetches below then refresh it in
  // place. "Loading your meetings…" is only for a window that has never seen it.
  const [status, setStatus] = useState<CalendarStatus | null>(() => readCalendarSnapshot().status);
  const [calendars, setCalendars] = useState<SyncedCalendar[]>(() =>
    (readCalendarSnapshot().status?.connected && readCalendarSnapshot().calendars) || []);
  const [events, setEvents] = useState<UpcomingEvent[] | null>(() =>
    readCalendarSnapshot().status?.connected ? unfinishedEvents(readCalendarSnapshot().events, Date.now()) : null);
  useEffect(() => {
    if (status === null) return;
    writeCalendarSnapshot({ status, events, calendars: status.connected ? calendars : null });
  }, [status, events, calendars]);
  // Which source is connecting or disconnecting, if any (one at a time).
  const [busy, setBusy] = useState<{ id: SourceId; kind: 'connecting' | 'disconnecting' } | null>(null);
  // Every source this computer offers (Apple Calendar on macOS only: main leaves it out elsewhere).
  const [sources, setSources] = useState<CalendarSource[] | null>(null);
  // The calendar link being typed, or null while its field is closed.
  const [icsDraft, setIcsDraft] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTurns, setRefreshTurns] = useState(0);
  // A manual Refresh ends on "Up to date" with a check for a moment, so a click
  // that changed nothing still gets an answer.
  const [refreshed, setRefreshed] = useState(false);
  useEffect(() => {
    if (!refreshed) return;
    const timer = window.setTimeout(() => setRefreshed(false), 1600);
    return () => window.clearTimeout(timer);
  }, [refreshed]);
  // A refused connect, per source, in the sentence main wrote (never a code).
  const [errors, setErrors] = useState<Partial<Record<SourceId, string>>>({});
  // Disconnecting throws away the sign-in (or the link), so the first click
  // asks, in the row itself (the pill turns red, the line asks, Cancel
  // appears), and the second disconnects. The question lapses on its own.
  const [confirming, setConfirming] = useState<SourceId | null>(null);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(null), 6000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const connected = !!status?.connected;
  const motionReady = useMotionReadyAfter(status !== null);
  // The spinner only for a refresh that runs long enough to be worth one: the
  // click's own turn already answers a quick one, and a spinner that crossfades
  // in and straight back out on top of it read as two motions (Skills' rule).
  const refreshingShown = useSettledFlag(refreshing);
  const now = useNow(connected);
  // The day cards rise in once, when the week first shows. After that (the
  // entrance takes 700ms at most), a meeting the background refresh adds or
  // drops grows or folds in place (CollapseItem) instead of replaying the rise.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (entered || events === null) return;
    const timer = window.setTimeout(() => setEntered(true), 800);
    return () => window.clearTimeout(timer);
  }, [entered, events]);

  // A running meeting hides Start Natively (the Launcher's button does the same
  // check); asked again on every 30s tick.
  const [meetingActive, setMeetingActive] = useState(false);
  useEffect(() => {
    let live = true;
    window.electronAPI?.getMeetingActive?.()
      .then((active) => { if (live) setMeetingActive(!!active); })
      .catch(() => {});
    return () => { live = false; };
  }, [now]);

  // Meeting detection: offer to start when a call begins (main's MeetingDetector).
  // Works with or without a calendar, so it shows either way. Saved first; a
  // failed save puts the switch back.
  const [detect, setDetect] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    window.electronAPI?.getMeetingDetectionEnabled?.()
      .then((on) => { if (live) setDetect(on !== false); })
      .catch(() => { if (live) setDetect(true); });
    return () => { live = false; };
  }, []);
  const detectRef = useRef(detect);
  detectRef.current = detect;
  const toggleDetect = useCallback(() => {
    const was = detectRef.current;
    if (was === null) return;
    setDetect(!was);
    window.electronAPI?.setMeetingDetectionEnabled?.(!was)
      .then((r) => { if (!r?.success) setDetect(was); })
      .catch(() => setDetect(was));
  }, []);

  // Start automatically (under Detect meetings): a detected call starts after
  // the offer's 10 s countdown unless Not now. Off unless turned on. Same
  // save-first pattern as Detect meetings.
  const [autoStart, setAutoStart] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    window.electronAPI?.getMeetingAutoStartEnabled?.()
      .then((on) => { if (live) setAutoStart(on === true); })
      .catch(() => { if (live) setAutoStart(false); });
    return () => { live = false; };
  }, []);
  const autoStartRef = useRef(autoStart);
  autoStartRef.current = autoStart;
  const toggleAutoStart = useCallback(() => {
    const was = autoStartRef.current;
    if (was === null) return;
    setAutoStart(!was);
    window.electronAPI?.setMeetingAutoStartEnabled?.(!was)
      .then((r) => { if (!r?.success) setAutoStart(was); })
      .catch(() => setAutoStart(was));
  }, []);

  // How long before a calendar meeting the reminder comes: 1, 2 or 5 minutes.
  const [reminderLead, setReminderLead] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    window.electronAPI?.getCalendarReminderMinutes?.()
      .then((m) => { if (live) setReminderLead(typeof m === 'number' ? m : 2); })
      .catch(() => { if (live) setReminderLead(2); });
    return () => { live = false; };
  }, []);
  const reminderLeadRef = useRef(reminderLead);
  reminderLeadRef.current = reminderLead;
  const chooseReminderLead = useCallback((minutes: number) => {
    const was = reminderLeadRef.current;
    if (was === null || was === minutes) return;
    setReminderLead(minutes);
    window.electronAPI?.setCalendarReminderMinutes?.(minutes)
      .then((r) => { if (!r?.success) setReminderLead(was); })
      .catch(() => setReminderLead(was));
  }, []);

  // End meetings automatically when the call ends (main's MeetingEndDetector).
  // Same save-first pattern as Detect meetings.
  const [autoStop, setAutoStop] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    window.electronAPI?.getMeetingAutoStopEnabled?.()
      .then((on) => { if (live) setAutoStop(on !== false); })
      .catch(() => { if (live) setAutoStop(true); });
    return () => { live = false; };
  }, []);
  const autoStopRef = useRef(autoStop);
  autoStopRef.current = autoStop;
  const toggleAutoStop = useCallback(() => {
    const was = autoStopRef.current;
    if (was === null) return;
    setAutoStop(!was);
    window.electronAPI?.setMeetingAutoStopEnabled?.(!was)
      .then((r) => { if (!r?.success) setAutoStop(was); })
      .catch(() => setAutoStop(was));
  }, []);

  // The catch-up after back-to-back meetings (main: services/assist).
  // Same save-first pattern as Detect meetings. Unset = on.
  const [catchUp, setCatchUp] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    window.electronAPI?.getCatchUpEnabled?.()
      .then((on) => { if (live) setCatchUp(on !== false); })
      .catch(() => { if (live) setCatchUp(true); });
    return () => { live = false; };
  }, []);
  const catchUpRef = useRef(catchUp);
  catchUpRef.current = catchUp;
  const toggleCatchUp = useCallback(() => {
    const was = catchUpRef.current;
    if (was === null) return;
    setCatchUp(!was);
    window.electronAPI?.setCatchUpEnabled?.(!was)
      .then((r) => { if (!r?.success) setCatchUp(was); })
      .catch(() => setCatchUp(was));
  }, []);

  // Snapshot shared screens (main: ScreenShareContext). Off unless turned on.
  // Same save-first pattern as Detect meetings.
  const [snapshots, setSnapshots] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    window.electronAPI?.getScreenShareSnapshots?.()
      .then((on) => { if (live) setSnapshots(on === true); })
      .catch(() => { if (live) setSnapshots(false); });
    return () => { live = false; };
  }, []);
  const toggleSnapshots = useCallback(() => {
    const was = snapshots;
    if (was === null) return;
    setSnapshots(!was);
    window.electronAPI?.setScreenShareSnapshots?.(!was)
      .then((r) => { if (!r?.success) setSnapshots(was); })
      .catch(() => setSnapshots(was));
  }, [snapshots]);

  // Stealth-gated calendar polling: no calendar egress while undetectable
  const [isDetectable, setIsDetectable] = useState(true);
  useEffect(() => {
    let eventSeen = false;
    let disposeListener: (() => void) | undefined;
    if (window.electronAPI?.onUndetectableChanged) {
      disposeListener = window.electronAPI.onUndetectableChanged((undetectable) => {
        eventSeen = true;
        setIsDetectable(!undetectable);
      });
    }
    if (window.electronAPI?.getUndetectable) {
      window.electronAPI.getUndetectable()
        .then((undetectable) => { if (!eventSeen) setIsDetectable(!undetectable); })
        .catch(() => {});
    }
    return () => { if (disposeListener) disposeListener(); };
  }, []);

  useEffect(() => {
    let live = true;
    window.electronAPI?.getCalendarStatus?.()
      .then((s) => { if (live) setStatus(s ?? { connected: false }); })
      .catch(() => { if (live) setStatus({ connected: false }); });
    return () => { live = false; };
  }, []);

  // Where every source stands. Asked on open, after each connect or
  // disconnect, with each minute's refresh (the "Updated" line), and when the
  // window comes back (from System Settings, after allowing Calendars).
  const loadSources = useCallback(() => window.electronAPI?.getCalendarSources?.()
    .then((list) => { if (Array.isArray(list)) setSources(list); })
    .catch(() => {}), []);
  useEffect(() => {
    void loadSources();
    const onFocus = () => { void loadSources(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadSources]);

  // Connected or disconnected elsewhere (the Launcher's Connect, a grant revoked
  // during a refresh): the pane follows.
  useEffect(() => window.electronAPI?.onCalendarConnectionChanged?.((isConnected) => {
    window.electronAPI?.getCalendarStatus?.()
      .then((s) => setStatus(s ?? { connected: isConnected }))
      .catch(() => setStatus({ connected: isConnected }));
    void loadSources();
    if (!isConnected) {
      setConfirming(null);
      setEvents(null);
      setCalendars([]);
    }
  }), [loadSources]);

  // While connected: the next 7 days, every minute (the Launcher's cadence), and
  // the calendars they come from. Stealth-gated: no calendar egress while undetectable.
  const loadEvents = useCallback(() => window.electronAPI?.getUpcomingEvents?.()
    .then((list) => setEvents(list || []))
    .catch((err) => console.error('[CalendarSettings] Failed to fetch upcoming events:', err))
    .finally(() => { void loadSources(); }), [loadSources]);
  useEffect(() => {
    if (!connected || !isDetectable) return;
    let live = true;
    void loadEvents();
    const interval = window.setInterval(() => { if (live && isDetectable) void loadEvents(); }, 60_000);
    return () => { live = false; window.clearInterval(interval); };
  }, [connected, loadEvents]);

  // The calendars ticked in Google Calendar: only Google has that list.
  const googleConnected = sources
    ? sources.some((src) => src.id === 'google' && src.state === 'connected')
    : connected;
  useEffect(() => {
    if (!googleConnected || !isDetectable) {
      if (!googleConnected) setCalendars([]);
      return;
    }
    let live = true;
    window.electronAPI?.getSyncedCalendars?.()
      .then((list) => { if (live) setCalendars(list || []); })
      .catch((err) => console.error('[CalendarSettings] Failed to fetch synced calendars:', err));
    return () => { live = false; };
  }, [googleConnected]);

  const connectSource = async (id: SourceId) => {
    // The calendar link first opens its field; Add then connects with what was pasted.
    if (id === 'ics' && icsDraft === null) {
      setIcsDraft('');
      return;
    }
    setBusy({ id, kind: 'connecting' });
    setErrors((e) => ({ ...e, [id]: undefined }));
    try {
      // Google keeps its own path (the Launcher's Connect uses it too).
      const res = id === 'google'
        ? await window.electronAPI.calendarConnect()
        : await window.electronAPI.calendarSourceConnect?.(id, id === 'ics' ? (icsDraft ?? '') : undefined);
      if (res?.success) {
        if (id === 'ics') setIcsDraft(null);
        setStatus(await window.electronAPI.getCalendarStatus());
      } else {
        setErrors((e) => ({ ...e, [id]: res?.error || t('Natively couldn’t connect this calendar. Try again in a minute.') }));
      }
    } catch (err: any) {
      console.error('[CalendarSettings] Connect failed:', err);
      setErrors((e) => ({ ...e, [id]: t('Natively couldn’t connect this calendar. Try again in a minute.') }));
    } finally {
      setBusy(null);
      void loadSources();
    }
  };

  const disconnectSource = async (id: SourceId) => {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    setConfirming(null);
    setBusy({ id, kind: 'disconnecting' });
    try {
      if (id === 'google') await window.electronAPI.calendarDisconnect();
      else await window.electronAPI.calendarSourceDisconnect?.(id);
      const next = await window.electronAPI.getCalendarStatus();
      setStatus(next);
      if (!next?.connected) {
        setEvents(null);
        setCalendars([]);
      } else {
        void loadEvents();
      }
    } catch (err) {
      console.error('[CalendarSettings] Disconnect failed:', err);
    } finally {
      setBusy(null);
      void loadSources();
    }
  };

  const refresh = async () => {
    setRefreshTurns((n) => n + 1);
    setRefreshed(false);
    if (!window.electronAPI?.calendarRefresh) return;
    setRefreshing(true);
    try {
      const res = await window.electronAPI.calendarRefresh();
      await loadEvents();
      // Only when Google answered: offline, the list shown is the last one.
      if (res?.fresh !== false) setRefreshed(true);
    } catch (err) {
      console.error('[CalendarSettings] Refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  };

  // The next 7 days, soonest first, one card per day.
  const sorted = useMemo(
    () => [...(events ?? [])].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    [events],
  );
  const days = useMemo(() => {
    const groups: { key: string; label: string; day: number; date: string; items: UpcomingEvent[] }[] = [];
    const nowDate = new Date(now);
    sorted.forEach((ev) => {
      const start = new Date(ev.startTime);
      const key = start.toDateString();
      let group = groups.find((g) => g.key === key);
      if (!group) {
        const days = Math.round((startOfDay(start) - startOfDay(nowDate)) / 86_400_000);
        group = {
          key,
          label: days <= 1
            ? capitalize(new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(days, 'day'), lang)
            : start.toLocaleDateString(lang, { weekday: 'long' }),
          day: start.getDate(),
          date: start.toLocaleDateString(lang, { weekday: 'long', month: 'long', day: 'numeric' }),
          items: [],
        };
        groups.push(group);
      }
      group.items.push(ev);
    });
    return groups;
  }, [sorted, now, lang]);

  // When any meeting can be joined, every row keeps a Join-sized slot, so the
  // times line up in one column instead of jumping right where there's no link.
  const hasLinks = sorted.some((ev) => !!ev.link);
  const firstMins = sorted.length ? Math.round((new Date(sorted[0].startTime).getTime() - now) / 60_000) : null;
  const next = firstMins === null ? null : nextLabel(firstMins, lang, t);
  // Before main answers (an older main has no list), Google alone, as before.
  const sourceList: CalendarSource[] = sources ?? [{ id: 'google', state: status?.connected ? 'connected' : 'disconnected', account: status?.name || status?.email, detail: status?.name ? status?.email : undefined }];

  /*
    One row per calendar source, in the shape of the account row this pane
    always had (PI's attached-file row): the source's mark, what it is or which
    account, and one pill. Connected rows say when they last updated and
    disconnect with the same in-row question. A row that cannot connect here
    says why in one plain line.
  */
  const sourceRow = (src: CalendarSource) => {
    const copy = SOURCE_COPY[src.id];
    const isBusy = busy?.id === src.id;
    const asking = confirming === src.id;
    const linked = src.state === 'connected';
    const disconnectLabel = isBusy && busy?.kind === 'disconnecting' ? t('Disconnecting…') : t('Disconnect');
    const connectLabel = isBusy && busy?.kind === 'connecting' ? t('Connecting…') : src.id === 'ics' && icsDraft !== null ? t('Add') : t('Connect');
    const refreshed = linked ? refreshLabel(src.lastRefresh, now, lang, t) : null;
    const note = src.state === 'unconfigured'
      ? (src.id === 'outlook' ? t('Not available in this version yet') : t('Needs a newer version of Natively'))
      : src.state === 'notAllowed'
        ? t('Natively isn’t allowed to read your calendars')
        : t(copy.hint);
    return (
      <div key={src.id}>
        <div className="cp-file">
          <SourceMark id={src.id} />
          <span className="cp-file-main">
            <Presence kind="text" id={asking ? 'ask' : linked ? 'account' : src.state}>
              {asking ? (
                <span className="cp-row-title" style={{ fontWeight: 500 }}>
                  {src.id === 'ics' ? t('Remove this calendar link from Natively?') : t('Disconnect this account from Natively?')}
                </span>
              ) : linked ? (
                <>
                  <span className="cp-row-title" style={{ fontWeight: 500 }}>
                    {src.account || (src.id === 'google' ? t('Google account') : t(copy.title))}
                  </span>
                  {src.detail && <span className="cp-row-detail"> · {src.detail}</span>}
                </>
              ) : (
                <>
                  <span className="cp-row-title" style={{ fontWeight: 500 }}>{t(copy.title)}</span>
                  <span className="cp-row-detail"> · {note}</span>
                </>
              )}
            </Presence>
          </span>
          {refreshed && !asking && <span className="cp-time">{refreshed}</span>}
          <Presence kind="control" id={asking || (src.id === 'ics' && icsDraft !== null && !linked) ? 'cancel' : null}>
            <button
              type="button"
              className="cp-pill cp-pill--sm"
              onClick={() => { if (asking) setConfirming(null); else { setIcsDraft(null); setErrors((e) => ({ ...e, ics: undefined })); } }}
            >
              {t('Cancel')}
            </button>
          </Presence>
          {linked ? (
            <button
              type="button"
              className={`cp-pill cp-pill--sm cp-pill--danger${asking ? ' is-armed' : ''}`}
              onClick={() => disconnectSource(src.id)}
              disabled={busy !== null}
            >
              <SwapLabel id={disconnectLabel} sizers={[t('Disconnect'), t('Disconnecting…')]}>{disconnectLabel}</SwapLabel>
            </button>
          ) : src.state === 'notAllowed' ? (
            <button type="button" className="cp-pill cp-pill--sm" onClick={() => { if (APPLE_CALENDAR_PRIVACY_URL) window.electronAPI?.openExternal?.(APPLE_CALENDAR_PRIVACY_URL); }}>
              {t('Open System Settings')}
              <ArrowUpRight size={12} className="cp-arrow" />
            </button>
          ) : (
            // Connect: the row's small pill, flat (a fill, no outline) in the
            // primary ink, so it reads as the row's action without a colour.
            <button
              type="button"
              className="cp-pill cp-pill--sm cp-pill--flat"
              onClick={() => connectSource(src.id)}
              disabled={busy !== null || src.state === 'unconfigured' || (src.id === 'ics' && icsDraft !== null && !icsDraft.trim())}
            >
              <SwapLabel id={connectLabel} sizers={[t('Connect'), t('Connecting…'), t('Add')]}>{connectLabel}</SwapLabel>
            </button>
          )}
        </div>
        {/* The calendar link's field: paste, then Add. The address is a secret,
            so it is never shown again once added (the row names the calendar). */}
        <Collapse open={src.id === 'ics' && !linked && icsDraft !== null}>
          <div className="pt-2">
            <input
              type="url"
              className="cp-input"
              value={icsDraft ?? ''}
              onChange={(e) => setIcsDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && icsDraft?.trim()) void connectSource('ics'); }}
              placeholder={t('Paste a webcal:// or https:// calendar link')}
              aria-label={t('Calendar link')}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </Collapse>
        <Collapse open={!!errors[src.id] && !linked}>
          <div className="pt-2">
            {/* Transitions.dev "Error state shake", the one every Settings alert
                plays (.t-notice-shake): keyed by the message, so a new refusal
                shakes again and a re-render does not. */}
            <div key={errors[src.id] ?? ''} className="cp-notice t-notice-shake" role="alert">
              <AlertCircle size={14} />
              <span>{errors[src.id]}</span>
            </div>
          </div>
        </Collapse>
      </div>
    );
  };

  return (
    <SettingsMotionReady.Provider value={motionReady}>
      <div className="cal-pane space-y-6 animated fadeIn" data-theme={theme} data-entered={entered || undefined} data-settings-stagger>
        {/* ── The calendars ── */}
        <section>
          <h3 className="cp-label">{t('Calendars')}</h3>
          <p className="cp-desc">{t('Your next meetings, here and in the Launcher, ready to join. A meeting in two calendars shows once.')}</p>
          {status === null ? null : (
            <div className={`pt-4 cp-sources${reduceMotion ? ' cp-fade-in' : ''}`}>
              {sourceList.map(sourceRow)}
            </div>
          )}
        </section>

        {/* ── The next 7 days ── */}
        <Collapse open={connected} className="!mt-0" skipStagger>
          <section className="pt-6">
            {/* While loading, the row keeps the count's 40px, so the swap to it
                (almost always what arrives) does not push the days down. */}
            <div className={`flex items-end justify-between gap-4${events === null || sorted.length > 0 ? ' min-h-[40px]' : ''}`}>
              {/* Loading, the empty week and the count are one slot: each state
                  swaps in (Transitions.dev "Text states swap", the shared
                  Presence) instead of snapping. */}
              <Presence kind="text" block id={events === null ? 'loading' : sorted.length === 0 ? 'empty' : 'count'}>
                {events === null ? (
                  <p className="cp-desc" style={{ margin: 0 }}>{t('Loading your meetings…')}</p>
                ) : sorted.length === 0 ? (
                  <h3 className="cp-label">{t('Upcoming')}</h3>
                ) : (
                  <div className="cp-hero">
                    <span className="cp-hero-num"><DigitPop value={sorted.length} /></span>
                    <span className="cp-hero-text">
                      {sorted.length === 1 ? t('meeting in the next 7 days') : t('meetings in the next 7 days')}
                      {/* The countdown ticks by the minute; each new value swaps in. */}
                      {next && <span className="cp-quiet"> · <Presence kind="text" id={next}>{next}</Presence></span>}
                    </span>
                  </div>
                )}
              </Presence>
              <button type="button" className={`cp-pill cp-pill--sm${refreshed ? ' is-done' : ''}`} onClick={refresh} disabled={refreshing}>
                <Presence kind="icon" id={refreshingShown ? 'busy' : refreshed ? 'done' : 'idle'} slotClassName="w-3 h-3">
                  {refreshingShown ? <Loader2 size={12} className="animate-spin" /> : refreshed ? <Check size={12} strokeWidth={2.5} /> : (
                    // One turn per click, as Skills' Refresh.
                    <motion.span
                      className="inline-flex"
                      initial={false}
                      animate={{ rotate: reduceMotion ? 0 : refreshTurns * 360 }}
                      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <RefreshCw size={12} />
                    </motion.span>
                  )}
                </Presence>
                <SwapLabel id={refreshed ? 'done' : 'idle'} sizers={[t('Refresh'), t('Up to date')]}>
                  {refreshed ? t('Up to date') : t('Refresh')}
                </SwapLabel>
              </button>
            </div>

            {/* The empty week and the days swap by folding, one shrinking as the
                other grows, as the account area does on connect. */}
            <Collapse open={events !== null && sorted.length === 0}>
              <div className="cp-empty mt-4">
                <p>{t('Your next 7 days are clear. New meetings show up here within a minute.')}</p>
              </div>
            </Collapse>

            <Collapse open={days.length > 0}>
              <div className="pt-6">
                <div className="cp-slots cp-slots--cards">
                <AnimatePresence initial={false}>
                {days.map((day, dayIndex) => (
                  <CollapseItem key={day.key}>
                  <div className="cp-slot">
                  <div className="cp-card" style={{ '--cp-card-delay': `${Math.min(dayIndex, 2) * 80}ms` } as React.CSSProperties}>
                    <div className="cp-card-header">
                      {/* The square carries the date, like a calendar leaf, where a
                          repeated glyph on every card would say nothing. */}
                      <span className="cp-card-icon cp-card-daynum" aria-hidden="true">{day.day}</span>
                      <h4 className="cp-card-label">
                        {day.label}
                        <span className="sr-only">, {day.date}</span>
                      </h4>
                      <span className="cp-card-aside">
                        <Presence kind="text" id={String(day.items.length)}>
                          {day.items.length === 1 ? t('1 meeting') : `${day.items.length} ${t('meetings')}`}
                        </Presence>
                      </span>
                    </div>
                    <div className="cp-slots">
                      <AnimatePresence initial={false}>
                      {day.items.map((ev, rowIndex) => {
                        const start = new Date(ev.startTime);
                        const end = new Date(ev.endTime);
                        const mins = Math.round((start.getTime() - now) / 60_000);
                        const length = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
                        const detail = providerOf(ev.link) ?? (length > 0 ? durationLabel(length, lang) : null);
                        const soon = mins < RELATIVE_MINUTES;
                        // Its own session, one click away: from 15 min before until it ends.
                        const startable = !meetingActive && mins <= START_LEAD_MINUTES && end.getTime() > now;
                        const countdown = mins <= 0 ? t('Now') : new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' }).format(mins, 'minute').replace(/\.$/, '');
                        return (
                          <CollapseItem key={ev.id}>
                          <div className="cp-slot">
                          <div className="cp-row" style={{ '--cp-row-delay': `${Math.min(rowIndex + 1, 3) * 40}ms` } as React.CSSProperties}>
                            <span className="cp-row-main" title={ev.title}>
                              <span className="cp-row-title">{ev.title}</span>
                              {detail && <span className="cp-row-detail"> · {detail}</span>}
                            </span>
                            <span className="cp-row-side">
                              {/* At 15 min the countdown hands over to Start Natively: one
                                  slot, so the handover is a swap, not a snap. */}
                              <Presence kind="control" id={startable ? 'start' : soon ? 'soon' : null}>
                                {startable ? (
                                  <button
                                    type="button"
                                    className="cp-pill cp-pill--sm cp-pill--start"
                                    onClick={() => window.dispatchEvent(new CustomEvent('natively:start-meeting-for-event', { detail: { title: ev.title, calendarEventId: ev.id } }))}
                                    aria-label={`${t('Start Natively for')} ${ev.title}`}
                                  >
                                    {t('Start Natively')}
                                  </button>
                                ) : (
                                  <span className="cp-now">
                                    <Presence kind="text" id={countdown}>{countdown}</Presence>
                                  </span>
                                )}
                              </Presence>
                              {/* A meeting moved by the refresh swaps its time in place. */}
                              <span className="cp-time"><Presence kind="text" id={rangeOf(start, end)}>{rangeOf(start, end)}</Presence></span>
                              {ev.link ? (
                                <button
                                  type="button"
                                  className="cp-pill cp-pill--sm"
                                  onClick={() => window.electronAPI?.openExternal?.(ev.link!)}
                                  title={ev.link}
                                  aria-label={`${t('Join')} ${ev.title}`}
                                >
                                  {t('Join')}
                                  <ArrowUpRight size={12} className="cp-arrow" />
                                </button>
                              ) : hasLinks ? (
                                <span className="cp-pill cp-pill--sm invisible" aria-hidden="true">
                                  {t('Join')}
                                  <ArrowUpRight size={12} className="cp-arrow" />
                                </span>
                              ) : null}
                            </span>
                          </div>
                          </div>
                          </CollapseItem>
                        );
                      })}
                      </AnimatePresence>
                    </div>
                  </div>
                  </div>
                  </CollapseItem>
                ))}
                </AnimatePresence>
                </div>
              </div>
            </Collapse>
          </section>
        </Collapse>

        {/* ── Where the events come from ── */}
        <Collapse open={connected && calendars.length > 0} className="!mt-0" skipStagger>
          <section className="pt-6">
            <div className="cp-card">
              <div className="cp-card-header">
                <span className="cp-card-icon"><CalendarRange size={12} /></span>
                <h4 className="cp-card-label">{t('Synced calendars')}</h4>
                <button
                  type="button"
                  className="cp-pill cp-pill--sm ml-auto"
                  onClick={() => window.electronAPI?.openExternal?.(GOOGLE_CALENDAR_URL)}
                >
                  {t('Change in Google Calendar')}
                  <ArrowUpRight size={12} className="cp-arrow" />
                </button>
              </div>
              <div className="cp-slots">
                <AnimatePresence initial={false}>
                {calendars.map((cal, rowIndex) => (
                  <CollapseItem key={cal.id}>
                  <div className="cp-slot">
                  <div className="cp-row" style={{ '--cp-row-delay': `${Math.min(rowIndex + 1, 3) * 40}ms` } as React.CSSProperties}>
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className="cp-dot" style={{ background: cal.color || 'var(--cp-tertiary)' }} aria-hidden="true" />
                      <span className="cp-row-main"><span className="cp-row-title" style={{ fontWeight: 500 }}>{cal.name}</span></span>
                    </span>
                    {cal.primary && <span className="cp-time">{t('Primary')}</span>}
                  </div>
                  </div>
                  </CollapseItem>
                ))}
                </AnimatePresence>
              </div>
            </div>
          </section>
        </Collapse>

        {/* ── Meeting detection ── */}
        <section>
          <div className="cp-card">
            <div className="cp-card-header">
              <span className="cp-card-icon"><Video size={12} /></span>
              <h4 className="cp-card-label">{t('Detect meetings')}</h4>
              <span className="ml-auto flex items-center">
                <SettingsToggle
                  checked={!!detect}
                  onChange={toggleDetect}
                  label={t('Detect meetings')}
                  disabled={detect === null}
                />
              </span>
            </div>
            <p className="cp-desc" style={{ margin: 0 }}>
              {t('Offers to start Natively when a call begins in Zoom, Teams, Meet, Webex, Slack or another call app.')}
            </p>
            <div className="cp-card-header" style={{ marginTop: 12 }}>
              <h4 className="cp-card-label">{t('Start automatically')}</h4>
              <span className="ml-auto flex items-center">
                <SettingsToggle
                  checked={!!autoStart && !!detect}
                  onChange={toggleAutoStart}
                  label={t('Start automatically')}
                  disabled={autoStart === null || !detect}
                />
              </span>
            </div>
            <p className="cp-desc" style={{ margin: 0 }}>
              {t('Starts Natively 10 seconds after a call is detected, unless you press Not now.')}
            </p>
          </div>
        </section>

        {/* ── Calendar reminder lead time ── */}
        {connected && (
          <section>
            <div className="cp-card">
              <div className="cp-card-header">
                <span className="cp-card-icon"><Bell size={12} /></span>
                <h4 className="cp-card-label">{t('Remind me before meetings')}</h4>
                <span className="ml-auto flex items-center gap-1.5" role="radiogroup" aria-label={t('Remind me before meetings')}>
                  {[1, 2, 5].map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={reminderLead === m}
                      className={`cp-pill cp-pill--sm${reminderLead === m ? ' is-selected' : ''}`}
                      onClick={() => chooseReminderLead(m)}
                      disabled={reminderLead === null}
                    >
                      {m === 1 ? t('1 min') : m === 2 ? t('2 min') : t('5 min')}
                    </button>
                  ))}
                </span>
              </div>
              <p className="cp-desc" style={{ margin: 0 }}>
                {t('A notification before each calendar meeting offers to start Natively.')}
              </p>
            </div>
          </section>
        )}

        {/* ── End meetings automatically ── */}
        <section>
          <div className="cp-card">
            <div className="cp-card-header">
              <span className="cp-card-icon"><PhoneOff size={12} /></span>
              <h4 className="cp-card-label">{t('End meetings automatically when the call ends')}</h4>
              <span className="ml-auto flex items-center">
                <SettingsToggle
                  checked={!!autoStop}
                  onChange={toggleAutoStop}
                  label={t('End meetings automatically when the call ends')}
                  disabled={autoStop === null}
                />
              </span>
            </div>
            <p className="cp-desc" style={{ margin: 0 }}>
              {t('Stops Natively and writes your notes when you leave the call, or after 15 minutes with nothing said.')}
            </p>
          </div>
        </section>

        {/* ── Snapshot shared screens ── */}
        <section>
          <div className="cp-card">
            <div className="cp-card-header">
              <span className="cp-card-icon"><ScreenShare size={12} /></span>
              <h4 className="cp-card-label">{t('Snapshot shared screens')}</h4>
              <span className="ml-auto flex items-center">
                <SettingsToggle
                  checked={!!snapshots}
                  onChange={toggleSnapshots}
                  label={t('Snapshot shared screens')}
                  disabled={snapshots === null}
                />
              </span>
            </div>
            <p className="cp-desc" style={{ margin: 0 }}>
              {t('When someone else shares their screen in Zoom or Teams, Natively takes a picture every 10 seconds and adds what it shows to your notes, using your vision model. Never while you present, and paused while Undetectable is on. Get consent from the people in the meeting first.')}
            </p>
          </div>
        </section>

        {/* ── Catch-up after back-to-back meetings ── */}
        <section>
          <div className="cp-card">
            <div className="cp-card-header">
              <span className="cp-card-icon"><ListChecks size={12} /></span>
              <h4 className="cp-card-label">{t('Catch up after back-to-back meetings')}</h4>
              <span className="ml-auto flex items-center">
                <SettingsToggle
                  checked={!!catchUp}
                  onChange={toggleCatchUp}
                  label={t('Catch up after back-to-back meetings')}
                  disabled={catchUp === null}
                />
              </span>
            </div>
            <p className="cp-desc" style={{ margin: 0 }}>
              {t('After two or more meetings with less than 15 minutes between them, the launcher shows what was decided and what you took on, in one place.')}
            </p>
          </div>
        </section>

        <p className="cp-foot">
          <Info size={14} />
          <span><strong>{t('Read-only.')}</strong> {t('Natively can’t add, change or delete your events.')}</span>
        </p>
      </div>
    </SettingsMotionReady.Provider>
  );
};

export default CalendarSettings;
