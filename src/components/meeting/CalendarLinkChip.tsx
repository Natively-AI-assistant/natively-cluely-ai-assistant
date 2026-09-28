import React, { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, CalendarPlus, Check, ChevronDown } from 'lucide-react';
import { useT } from '../../i18n';
import {
    durationParts, eventMs, firstName, initials, namesAndRest, otherAttendees,
    splitByRecording, timelineLayout, type RecordingSpan,
} from './calendarLinkView';

/*
  The meeting notes' "which calendar event was this": a quiet action in the
  header, beside Copy (it used to sit on the date line, where it read as a
  stray control). A session is linked to its event at start when one clearly fits
  (electron/services/calendar/calendarSessionMatch.ts); a tie, a start with no
  event, or a wrong guess lands here. Linking gives the meeting the event's title
  (unless the user named it) and its attendees: the follow-up's recipients.

  The menu says what the choice rests on, without choosing: the recording's own
  span, a strip plotting it (the toggle-blue band) against every event, one lane
  each, and the events split into those it overlapped and those around it. Each
  row gives the start and length, and who else was invited. Hovering a row lights
  its lane; the linked event's lane stays lit. Blocks with nobody else are dimmed.
  Nothing is labelled a best match: the matcher refuses ties, so the menu doesn't
  guess either. Arithmetic in ./calendarLinkView (tested).

  The menu is the tone picker's (MeetingDetails ToneMenu): the Transitions.dev
  .t-dropdown, the same surface, rows and keys.
*/

export interface CalendarEventSnapshot {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    link?: string;
    attendees: Array<{ email: string; name?: string; response?: string }>;
    linkedBy?: string;
}

const MENU_CLOSE_MS = 150;
const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
const range = (a: number, b: number) => (b > a ? clock.formatRange(new Date(a), new Date(b)) : clock.format(new Date(a))).toLowerCase();
// "10:00", "9:30": the menu's header carries the am/pm.
const shortClock = (ms: number) => clock.format(new Date(ms)).replace(/\s?[AP]M$/i, '');
const TOGGLE_INK_DARK = 'var(--toggle-on)';
// Toggle blue as text/strokes on white, darkened for contrast (Phone Mirror's toggle ink).
const TOGGLE_INK_LIGHT = 'color-mix(in srgb, var(--toggle-on) 80%, #000)';

export const CalendarLinkChip: React.FC<{
    meetingId: string;
    /** The notes' title. Linking usually copies the event's title onto the meeting,
     *  so a linked event with nobody else in it shows its time instead of the same words again. */
    meetingTitle?: string;
    event?: CalendarEventSnapshot;
    isLight: boolean;
    onChanged: () => void;
}> = ({ meetingId, meetingTitle, event, isLight, onChanged }) => {
    const t = useT();
    const menuId = useId();
    const [connected, setConnected] = useState<boolean | null>(null);
    const [selfEmail, setSelfEmail] = useState<string | undefined>(undefined);
    const [open, setOpen] = useState(false);
    const [closing, setClosing] = useState(false);
    const [candidates, setCandidates] = useState<CalendarEventSnapshot[] | null>(null);
    const [span, setSpan] = useState<RecordingSpan | null>(null);
    const [saving, setSaving] = useState(false);
    const [hot, setHot] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Only offered with a calendar to look in; a linked meeting always shows its event.
    // CalendarManager already drops the user's own attendee entry (Google's `self`), in
    // every candidate and every saved link; the account address here is only a backstop.
    useEffect(() => {
        let live = true;
        window.electronAPI?.getCalendarStatus?.()
            .then((s) => { if (live) { setConnected(!!s?.connected); setSelfEmail(s?.email); } })
            .catch(() => { if (live) setConnected(false); });
        return () => { live = false; };
    }, []);

    useEffect(() => {
        let live = true;
        setSpan(null);
        window.electronAPI?.getMeetingRecordingSpan?.(meetingId)
            .then((s) => { if (live) setSpan(s && s.endMs >= s.startMs ? s : null); })
            .catch(() => {});
        return () => { live = false; };
    }, [meetingId]);

    const openMenu = () => {
        clearTimeout(closeTimer.current);
        setClosing(false);
        setOpen(true);
        setHot(null);
        setCandidates(null);
        window.electronAPI?.getMeetingCalendarCandidates?.(meetingId)
            .then((list) => setCandidates(list || []))
            .catch(() => setCandidates([]));
    };
    const close = (refocus: boolean) => {
        setOpen(false);
        setClosing(true);
        clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => setClosing(false), MENU_CLOSE_MS);
        if (refocus) triggerRef.current?.focus({ preventScroll: true });
    };
    useEffect(() => () => clearTimeout(closeTimer.current), []);
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const rows = candidates ?? [];
    const { during, around } = splitByRecording(rows, span);
    const ordered = [...during, ...around];

    // Focus the current event (or the first row) once the list is in, so the arrow keys work at once.
    useEffect(() => {
        if (!open || candidates === null) return;
        const current = ordered.findIndex((c) => c.id === event?.id);
        itemRefs.current[Math.max(0, current)]?.focus({ preventScroll: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, candidates, event?.id]);

    const choose = async (eventId: string | null) => {
        close(true);
        if (eventId === (event?.id ?? null) || !window.electronAPI?.setMeetingCalendarEvent) return;
        setSaving(true);
        try {
            const res = await window.electronAPI.setMeetingCalendarEvent(meetingId, eventId);
            if (res?.success) onChanged();
        } finally {
            setSaving(false);
        }
    };

    const onMenuKeyDown = (e: React.KeyboardEvent) => {
        const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length]?.focus(); };
        if (e.key === 'ArrowDown') go(at + 1);
        else if (e.key === 'ArrowUp') go(at - 1);
        else if (e.key === 'Home') go(0);
        else if (e.key === 'End') go(items.length - 1);
        else if (e.key === 'Escape') { e.preventDefault(); close(true); }
        else if (e.key === 'Tab') close(false);
    };

    if (!event && !connected) return null;

    const ink = isLight ? TOGGLE_INK_LIGHT : TOGGLE_INK_DARK;
    const hover = isLight ? 'hover:bg-black/[0.045] focus-visible:bg-black/[0.045]' : 'hover:bg-white/[0.06] focus-visible:bg-white/[0.06]';
    const hairline = isLight ? 'bg-black/[0.08]' : 'bg-white/[0.08]';
    const faceTone = isLight ? 'bg-[#E5E5EA] text-[#3C3C43] ring-white' : 'bg-[#3A3A3C] text-[#D1D1D6] ring-[#1C1C1F]';

    const lengthLabel = (ms: number) => {
        const { h, m } = durationParts(ms);
        return h ? `${h} ${t('hr')}${m ? ` ${m} ${t('min')}` : ''}` : `${m} ${t('min')}`;
    };

    // Linked, the trigger says who the meeting was with: that is what the link added.
    const label = (() => {
        if (!event) return t('Link to calendar event');
        const others = otherAttendees(event.attendees, selfEmail);
        if (others.length > 2) return `${t('With')} ${firstName(others[0])} +${others.length - 1}`;
        if (others.length) return `${t('With')} ${others.map(firstName).join(' & ')}`;
        const [a, b] = eventMs(event);
        return event.title.trim() && event.title.trim() !== (meetingTitle || '').trim() ? event.title : range(a, b);
    })();

    const layout = timelineLayout(rows, span);
    itemRefs.current = [];

    const renderRow = (c: CalendarEventSnapshot, i: number) => {
        const selected = c.id === event?.id;
        const [a, b] = eventMs(c);
        const others = otherAttendees(c.attendees, selfEmail);
        const solo = others.length === 0;
        const overlapped = i < during.length;
        const { names, rest } = namesAndRest(others, 2);
        return (
            <button
                key={c.id}
                ref={(el) => { itemRefs.current[i] = el; }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={-1}
                onClick={() => choose(c.id)}
                onMouseEnter={() => setHot(c.id)}
                onMouseLeave={() => setHot(null)}
                // Keyboard focus lights the lane; the focus placed on open (after a click) doesn't.
                onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setHot(c.id); }}
                onBlur={() => setHot(null)}
                className={`w-full flex items-center gap-2.5 px-2 py-[7px] rounded-[7px] text-left focus-visible:outline-none transition-colors duration-150 ${hover}`}
            >
                <span className="w-[42px] shrink-0 self-start pt-px text-right tabular-nums leading-tight">
                    <span className={`block text-[11.5px] font-medium ${solo ? 'text-text-tertiary' : 'text-text-secondary'}`}>{shortClock(a)}</span>
                    <span className="block text-[10.5px] text-text-tertiary">{lengthLabel(b - a)}</span>
                </span>
                <span
                    aria-hidden="true"
                    className={`w-px self-stretch shrink-0 rounded-full ${overlapped ? '' : hairline}`}
                    style={overlapped ? { background: 'var(--toggle-on)' } : undefined}
                />
                <span className="min-w-0 flex-1 leading-tight">
                    <span className={`block truncate text-[12px] font-medium ${solo && !selected ? 'text-text-tertiary' : 'text-text-primary'}`}>{c.title}</span>
                    <span className="mt-[3px] flex items-center gap-1.5 min-w-0">
                        {others.length > 0 && (
                            <span className="inline-flex shrink-0" aria-hidden="true">
                                {others.slice(0, 3).map((p, k) => (
                                    <span
                                        key={p.email}
                                        className={`inline-grid place-items-center w-4 h-4 rounded-full ring-2 text-[7px] leading-none font-semibold ${faceTone}`}
                                        style={k ? { marginLeft: -3 } : undefined}
                                    >
                                        {initials(p, 1)}
                                    </span>
                                ))}
                            </span>
                        )}
                        <span className="truncate text-[10.5px] text-text-tertiary">
                            {solo ? t('Just you') : `${names.join(', ')}${rest ? ` +${rest}` : ''}`}
                        </span>
                    </span>
                </span>
                {selected && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: ink }} strokeWidth={2.5} />}
            </button>
        );
    };

    const sectionLabel = (text: string) => (
        <p className="px-2 pt-2 pb-1 text-[10.5px] font-medium text-text-tertiary">{text}</p>
    );

    return (
        <div ref={rootRef} className="relative inline-flex min-w-0">
            <button
                ref={triggerRef}
                type="button"
                disabled={saving}
                onClick={() => (open ? close(false) : openMenu())}
                onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); openMenu(); } }}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={menuId}
                title={event ? `${t('Linked calendar event')}: ${event.title}` : undefined}
                className={`min-w-0 max-w-[240px] inline-flex items-center gap-2 text-xs font-medium hover:text-text-primary disabled:opacity-50 transition-colors ${open ? 'text-text-primary' : 'text-text-secondary'}`}
            >
                {event ? <CalendarDays className="w-3.5 h-3.5 shrink-0" strokeWidth={2} /> : <CalendarPlus className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />}
                <span className="truncate">{label}</span>
                <ChevronDown
                    className="w-3 h-3 shrink-0 text-text-tertiary"
                    strokeWidth={2.5}
                    style={{ transform: `scaleY(${open ? -1 : 1})`, transition: 'transform var(--dropdown-open-dur) var(--dropdown-ease)' }}
                />
            </button>
            <div
                id={menuId}
                role="menu"
                aria-label={t('Which calendar event was this?')}
                data-origin="top-right"
                inert={!open}
                onKeyDown={onMenuKeyDown}
                className={`t-dropdown${open ? ' is-open' : closing ? ' is-closing' : ''} absolute right-[-6px] top-full mt-2 z-50 w-[340px] p-1 rounded-[11px] border ${isLight
                    ? 'bg-white border-black/[0.08] shadow-[0_10px_30px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.06)]'
                    : 'bg-[#1C1C1F] border-white/[0.08] shadow-[0_10px_30px_rgba(0,0,0,0.5),0_1px_2px_rgba(0,0,0,0.3)]'}`}
            >
                <p className="px-2 pt-1.5 pb-0.5 text-[11px] font-medium text-text-secondary tabular-nums">
                    {span ? `${t('This recording')} · ${range(span.startMs, span.endMs)}` : t('Which calendar event was this?')}
                </p>
                {layout && (
                    // The recording against every event, one lane each in start order.
                    <div aria-hidden="true" className={`mx-1 mt-1 mb-1.5 px-2 pt-2 pb-1.5 rounded-[8px] border ${isLight ? 'border-black/[0.07] bg-black/[0.02]' : 'border-white/[0.07] bg-white/[0.025]'}`}>
                        <div className="relative" style={{ height: layout.lanes.length * 7 + 4 }}>
                            <div
                                className="absolute top-0 bottom-0 rounded-[3px]"
                                style={{
                                    left: `${layout.at(span!.startMs) * 100}%`,
                                    width: `${layout.width(span!.startMs, span!.endMs) * 100}%`,
                                    background: 'color-mix(in srgb, var(--toggle-on) 16%, transparent)',
                                    boxShadow: `inset 1px 0 0 ${ink}, inset -1px 0 0 ${ink}`,
                                }}
                            />
                            {layout.lanes.map((id, lane) => {
                                const c = rows.find((r) => r.id === id)!;
                                const [a, b] = eventMs(c);
                                const lit = hot === id || (hot === null && id === event?.id);
                                return (
                                    <div
                                        key={id}
                                        className="absolute h-[4px] rounded-full transition-colors duration-150"
                                        style={{
                                            top: 2 + lane * 7,
                                            left: `${layout.at(a) * 100}%`,
                                            width: `max(4px, ${layout.width(a, b) * 100}%)`,
                                            background: lit ? (isLight ? '#1C1C1E' : '#F2F2F7') : isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.22)',
                                        }}
                                    />
                                );
                            })}
                        </div>
                        <div className="relative h-3 mt-1">
                            {layout.ticks.map((tick) => {
                                const x = layout.at(tick);
                                return (
                                    <span
                                        key={tick}
                                        className={`absolute text-[9.5px] leading-none tabular-nums text-text-tertiary ${x < 0.06 ? '' : x > 0.94 ? '-translate-x-full' : '-translate-x-1/2'}`}
                                        style={{ left: `${x * 100}%` }}
                                    >
                                        {shortClock(tick)}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                )}
                {candidates === null ? (
                    <p className="px-2 py-2 text-[11px] text-text-tertiary">{t('Looking at your calendar…')}</p>
                ) : rows.length === 0 ? (
                    <p className="px-2 py-2 text-[11px] text-text-tertiary">{t('No calendar events around this time.')}</p>
                ) : (
                    <>
                        {during.length > 0 && sectionLabel(t('During this recording'))}
                        {during.map((c, i) => renderRow(c, i))}
                        {during.length > 0 && around.length > 0 && sectionLabel(t('Around it'))}
                        {around.map((c, i) => renderRow(c, during.length + i))}
                    </>
                )}
                {event && (
                    <>
                        <div className={`mx-1 my-1 h-px ${isLight ? 'bg-black/[0.06]' : 'bg-white/[0.06]'}`} />
                        <button
                            ref={(el) => { itemRefs.current[ordered.length] = el; }}
                            type="button"
                            role="menuitem"
                            tabIndex={-1}
                            onClick={() => choose(null)}
                            className={`w-full h-[28px] flex items-center px-2 rounded-[7px] text-left text-[11.5px] font-medium text-text-secondary hover:text-text-primary focus-visible:text-text-primary focus-visible:outline-none transition-colors ${hover}`}
                        >
                            {t('Not a calendar meeting')}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

export default CalendarLinkChip;
