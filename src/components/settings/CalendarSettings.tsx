import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, ArrowUpRight, CalendarRange, Info, Loader2, RefreshCw, Video } from 'lucide-react';
import { useLanguage, useT } from '../../i18n';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { Collapse, Presence, SettingsMotionReady, SwapLabel, useMotionReadyAfter, useSettledFlag } from './SettingsRow';
import { SettingsToggle } from './SettingsToggle';
import './CalendarSettings.css';

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

const GOOGLE_CALENDAR_URL = 'https://calendar.google.com/';

export const CalendarSettings: React.FC = () => {
  const t = useT();
  const { lang } = useLanguage();
  const theme = useResolvedTheme();
  const reduceMotion = useReducedMotion();

  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [calendars, setCalendars] = useState<SyncedCalendar[]>([]);
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);
  const [busy, setBusy] = useState<'connecting' | 'disconnecting' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTurns, setRefreshTurns] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Disconnecting throws away the Google sign-in, so the first click asks, in
  // the row itself (the pill turns red, the line asks, Cancel appears), and the
  // second disconnects. The question lapses after a few seconds on its own.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 6000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const connected = !!status?.connected;
  const motionReady = useMotionReadyAfter(status !== null);
  // The spinner only for a refresh that runs long enough to be worth one: the
  // click's own turn already answers a quick one, and a spinner that crossfades
  // in and straight back out on top of it read as two motions (Skills' rule).
  const refreshingShown = useSettledFlag(refreshing);
  const now = useNow(connected);

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

  useEffect(() => {
    let live = true;
    window.electronAPI?.getCalendarStatus?.()
      .then((s) => { if (live) setStatus(s ?? { connected: false }); })
      .catch(() => { if (live) setStatus({ connected: false }); });
    return () => { live = false; };
  }, []);

  // While connected: the next 7 days, every minute (the Launcher's cadence), and
  // the calendars they come from.
  const loadEvents = useCallback(() => window.electronAPI?.getUpcomingEvents?.()
    .then((list) => setEvents(list || []))
    .catch((err) => console.error('[CalendarSettings] Failed to fetch upcoming events:', err)), []);
  useEffect(() => {
    if (!connected) return;
    let live = true;
    void loadEvents();
    const interval = window.setInterval(() => { if (live) void loadEvents(); }, 60_000);
    window.electronAPI?.getSyncedCalendars?.()
      .then((list) => { if (live) setCalendars(list || []); })
      .catch((err) => console.error('[CalendarSettings] Failed to fetch synced calendars:', err));
    return () => { live = false; window.clearInterval(interval); };
  }, [connected, loadEvents]);

  const connect = async () => {
    setBusy('connecting');
    setError(null);
    try {
      const res = await window.electronAPI.calendarConnect();
      if (res.success) setStatus(await window.electronAPI.getCalendarStatus());
      else if (res.error) setError(res.error);
    } catch (err: any) {
      setError(err?.message || t('Could not connect to Google Calendar.'));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy('disconnecting');
    try {
      await window.electronAPI.calendarDisconnect();
      setStatus(await window.electronAPI.getCalendarStatus());
      setEvents(null);
      setCalendars([]);
    } catch (err) {
      console.error('[CalendarSettings] Disconnect failed:', err);
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    setRefreshTurns((n) => n + 1);
    if (!window.electronAPI?.calendarRefresh) return;
    setRefreshing(true);
    try {
      await window.electronAPI.calendarRefresh();
      await loadEvents();
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
  const connectLabel = busy === 'connecting' ? t('Connecting…') : t('Connect Google Calendar');
  const disconnectLabel = busy === 'disconnecting' ? t('Disconnecting…') : t('Disconnect');

  const accountRow = (
    <div className="cp-file">
      <GoogleMark />
      <span className="cp-file-main">
        <Presence kind="text" id={confirming ? 'ask' : 'account'}>
          {confirming ? (
            <span className="cp-row-title" style={{ fontWeight: 500 }}>{t('Disconnect this account from Natively?')}</span>
          ) : (
            <>
              <span className="cp-row-title" style={{ fontWeight: 500 }}>{status?.name || status?.email || t('Google account')}</span>
              {status?.name && status?.email && <span className="cp-row-detail"> · {status.email}</span>}
            </>
          )}
        </Presence>
      </span>
      <Presence kind="control" id={confirming ? 'cancel' : null}>
        <button type="button" className="cp-pill cp-pill--sm" onClick={() => setConfirming(false)}>{t('Cancel')}</button>
      </Presence>
      <button
        type="button"
        className={`cp-pill cp-pill--sm cp-pill--danger${confirming ? ' is-armed' : ''}`}
        onClick={disconnect}
        disabled={busy !== null}
      >
        <SwapLabel id={disconnectLabel} sizers={[t('Disconnect'), t('Disconnecting…')]}>{disconnectLabel}</SwapLabel>
      </button>
    </div>
  );
  const connectBox = (
    <div className="cp-empty">
      <p>{t('Connect Google Calendar to see your next meetings here and in the Launcher.')}</p>
      <button type="button" className="cp-pill cp-pill--lg" onClick={connect} disabled={busy !== null}>
        <Presence kind="icon" id={busy === 'connecting' ? 'busy' : 'idle'}>
          {busy === 'connecting' ? <Loader2 size={14} className="animate-spin" /> : <GoogleMark size={14} />}
        </Presence>
        <SwapLabel id={connectLabel} sizers={[t('Connect Google Calendar'), t('Connecting…')]}>{connectLabel}</SwapLabel>
      </button>
    </div>
  );

  return (
    <SettingsMotionReady.Provider value={motionReady}>
      <div className="cal-pane space-y-6 animated fadeIn" data-theme={theme} data-settings-stagger>
        {/* ── The account ── */}
        <section>
          <h3 className="cp-label">{t('Google Calendar')}</h3>
          <p className="cp-desc">{t('Your next meetings, here and in the Launcher, ready to join.')}</p>
          {/* Connecting and disconnecting swap these two in place: one folds as
              the other grows (the shared Collapse, 250ms smooth-out), so the
              section resizes instead of jumping between a 130px box and a row.
              Under reduced motion the two folds would overlap as fades (both
              shown, then one gone: two jumps), so it is one swap with a fade. */}
          {reduceMotion ? (
            status === null ? null : (
              <div key={connected ? 'account' : 'empty'} className="pt-4 cp-fade-in">{connected ? accountRow : connectBox}</div>
            )
          ) : (
            <>
              <Collapse open={connected} skipStagger>
                <div className="pt-4">{accountRow}</div>
              </Collapse>
              <Collapse open={status !== null && !connected} skipStagger>
                <div className="pt-4">{connectBox}</div>
              </Collapse>
            </>
          )}
          <Collapse open={!!error && !connected}>
            <div className="pt-3">
              {/* Transitions.dev "Error state shake", the one every Settings alert
                  plays (.t-notice-shake): keyed by the message, so a new refusal
                  shakes again and a re-render does not. */}
              <div key={error ?? ''} className="cp-notice t-notice-shake" role="alert">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            </div>
          </Collapse>
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
              <button type="button" className="cp-pill cp-pill--sm" onClick={refresh} disabled={refreshing}>
                <Presence kind="icon" id={refreshingShown ? 'busy' : 'idle'} slotClassName="w-3 h-3">
                  {refreshingShown ? <Loader2 size={12} className="animate-spin" /> : (
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
                {t('Refresh')}
              </button>
            </div>

            {events !== null && sorted.length === 0 && (
              <div className="cp-empty mt-4">
                <p>{t('Your next 7 days are clear. New meetings show up here within a minute.')}</p>
              </div>
            )}

            {days.length > 0 && (
              <div className="mt-6">
                {days.map((day) => (
                  <div key={day.key} className="cp-card">
                    <div className="cp-card-header">
                      {/* The square carries the date, like a calendar leaf, where a
                          repeated glyph on every card would say nothing. */}
                      <span className="cp-card-icon cp-card-daynum" aria-hidden="true">{day.day}</span>
                      <h4 className="cp-card-label">
                        {day.label}
                        <span className="sr-only">, {day.date}</span>
                      </h4>
                      <span className="cp-card-aside">
                        {day.items.length === 1 ? t('1 meeting') : `${day.items.length} ${t('meetings')}`}
                      </span>
                    </div>
                    <div className="cp-rows">
                      {day.items.map((ev) => {
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
                          <div key={ev.id} className="cp-row">
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
                              <span className="cp-time">{rangeOf(start, end)}</span>
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
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
              <div className="cp-rows">
                {calendars.map((cal) => (
                  <div key={cal.id} className="cp-row">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className="cp-dot" style={{ background: cal.color || 'var(--cp-tertiary)' }} aria-hidden="true" />
                      <span className="cp-row-main"><span className="cp-row-title" style={{ fontWeight: 500 }}>{cal.name}</span></span>
                    </span>
                    {cal.primary && <span className="cp-time">{t('Primary')}</span>}
                  </div>
                ))}
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
              {t('Offers to start Natively when a Zoom, Teams, Meet or Webex call begins.')}
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
