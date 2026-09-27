import React, { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, CalendarPlus, Check, ChevronDown } from 'lucide-react';
import { useT } from '../../i18n';

/*
  The meeting notes' "which calendar event was this": a quiet chip on the date
  line. A session is linked to its event at start when one clearly fits
  (electron/services/calendar/calendarSessionMatch.ts); a tie, a start with no
  event, or a wrong guess lands here. The menu offers the events around the
  meeting's time (nearest first) and, for a linked meeting, "Not a calendar
  meeting". Linking gives the meeting the event's title (unless the user named
  it) and its attendees: the follow-up's recipients.

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
const range = (e: CalendarEventSnapshot) => {
    const start = new Date(e.startTime);
    const end = new Date(e.endTime);
    return end > start ? clock.formatRange(start, end).toLowerCase() : clock.format(start).toLowerCase();
};

export const CalendarLinkChip: React.FC<{
    meetingId: string;
    event?: CalendarEventSnapshot;
    isLight: boolean;
    onChanged: () => void;
}> = ({ meetingId, event, isLight, onChanged }) => {
    const t = useT();
    const menuId = useId();
    const [connected, setConnected] = useState<boolean | null>(null);
    const [open, setOpen] = useState(false);
    const [closing, setClosing] = useState(false);
    const [candidates, setCandidates] = useState<CalendarEventSnapshot[] | null>(null);
    const [saving, setSaving] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Only offered with a calendar to look in; a linked meeting always shows its event.
    useEffect(() => {
        let live = true;
        window.electronAPI?.getCalendarStatus?.()
            .then((s) => { if (live) setConnected(!!s?.connected); })
            .catch(() => { if (live) setConnected(false); });
        return () => { live = false; };
    }, []);

    const openMenu = () => {
        clearTimeout(closeTimer.current);
        setClosing(false);
        setOpen(true);
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
    // Focus the current event (or the first row) once the list is in, so the arrow keys work at once.
    useEffect(() => {
        if (!open || candidates === null) return;
        const current = candidates.findIndex((c) => c.id === event?.id);
        itemRefs.current[Math.max(0, current)]?.focus({ preventScroll: true });
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

    const hover = isLight ? 'hover:bg-black/[0.05] focus-visible:bg-black/[0.05]' : 'hover:bg-white/[0.06] focus-visible:bg-white/[0.06]';
    const rows = candidates ?? [];
    itemRefs.current = [];

    return (
        <div ref={rootRef} className="relative inline-flex">
            <button
                ref={triggerRef}
                type="button"
                disabled={saving}
                onClick={() => (open ? close(false) : openMenu())}
                onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); openMenu(); } }}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={menuId}
                title={event ? t('Linked calendar event') : undefined}
                className={`-my-0.5 -mx-1.5 px-1.5 py-0.5 inline-flex items-center gap-1 max-w-[320px] rounded-md text-xs font-medium hover:text-text-primary disabled:opacity-50 transition-colors ${isLight ? 'hover:bg-black/[0.05]' : 'hover:bg-white/[0.06]'} ${open ? `text-text-primary ${isLight ? 'bg-black/[0.05]' : 'bg-white/[0.06]'}` : event ? 'text-text-secondary' : 'text-text-tertiary'}`}
            >
                {event ? <CalendarDays className="w-3 h-3 shrink-0" strokeWidth={2} /> : <CalendarPlus className="w-3 h-3 shrink-0" strokeWidth={2} />}
                <span className="truncate">{event ? event.title : t('Link to calendar event')}</span>
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
                data-origin="top-left"
                inert={!open}
                onKeyDown={onMenuKeyDown}
                className={`t-dropdown${open ? ' is-open' : closing ? ' is-closing' : ''} absolute left-[-6px] top-full mt-1.5 z-50 w-[300px] p-[3px] rounded-lg border ${isLight
                    ? 'bg-white border-black/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.06)]'
                    : 'bg-[#1C1C1F] border-white/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.5),0_1px_2px_rgba(0,0,0,0.3)]'}`}
            >
                <p className="px-1.5 pt-1.5 pb-1 text-[10.5px] font-medium text-text-tertiary">{t('Which calendar event was this?')}</p>
                {candidates === null ? (
                    <p className="px-1.5 py-1.5 text-[11px] text-text-secondary">{t('Looking at your calendar…')}</p>
                ) : rows.length === 0 ? (
                    <p className="px-1.5 py-1.5 text-[11px] text-text-secondary">{t('No calendar events around this time.')}</p>
                ) : rows.map((c, i) => {
                    const selected = c.id === event?.id;
                    return (
                        <button
                            key={c.id}
                            ref={(el) => { itemRefs.current[i] = el; }}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            tabIndex={-1}
                            onClick={() => choose(c.id)}
                            className={`w-full min-h-[34px] flex items-center gap-2 pl-1.5 pr-1.5 py-1 rounded-[5px] text-left focus-visible:outline-none transition-colors ${hover}`}
                        >
                            <span className="min-w-0 flex-1">
                                <span className={`block truncate text-[11.5px] font-medium ${selected ? 'text-text-primary' : 'text-text-secondary'}`}>{c.title}</span>
                                <span className="block text-[10.5px] text-text-tertiary tabular-nums">{range(c)}</span>
                            </span>
                            {selected && <Check className="w-3.5 h-3.5 shrink-0 text-text-primary" strokeWidth={2.5} />}
                        </button>
                    );
                })}
                {event && (
                    <>
                        <div className={`my-[3px] h-px ${isLight ? 'bg-black/[0.06]' : 'bg-white/[0.06]'}`} />
                        <button
                            ref={(el) => { itemRefs.current[rows.length] = el; }}
                            type="button"
                            role="menuitem"
                            tabIndex={-1}
                            onClick={() => choose(null)}
                            className={`w-full h-[26px] flex items-center pl-1.5 pr-1.5 rounded-[5px] text-left text-[11px] font-medium text-text-secondary hover:text-text-primary focus-visible:text-text-primary focus-visible:outline-none transition-colors ${hover}`}
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
