import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, Link2, Plus, Users, X } from 'lucide-react';
import { NpPop } from './NpPop';
import { eventTimeRange, groupAttendees, type Attendee } from './notepadView';

/**
 * The notepad's heading (2026-10-20), as Granola's notes window draws it
 * (values from its stylesheet, sizes measured on its live window at 500×923):
 *
 *  - The title: IBM Plex Serif (Granola's own fallback for its Quadrant face)
 *    at 24/28px, 32px in, wrapping. A click renames it (the meeting is saved
 *    under it); Enter keeps it, Esc goes back.
 *  - The chip row, 14px under it: a 28px pill with the day and the people
 *    (0.5px hairline, its hover painted 3px inside). No folder button: folders
 *    have no view of their own since the launcher dropped it (2026-11-01).
 *  - The chip's popover (280px, 12px corners): the event with its colour
 *    square and time, Join, the people by company (add or take someone off,
 *    for this meeting's notes only), and a way to link a different event.
 *
 * Its text fields are typed through NotesWindow's keyboard hook like the page:
 * the window owns their text and routes the keys.
 */

export interface MeetingEventInfo { id: string; title: string | null; startTime: string | null; endTime: string | null; link: string | null }
export interface HeadingInfo {
    title: string | null;
    people: number;
    event: MeetingEventInfo | null;
    attendees: Attendee[];
    selfEmail: string | null;
}
type Candidate = { id: string; title: string; startTime: string; endTime: string; people: number };

const ink = (v: string): React.CSSProperties => ({ color: `var(${v})` });


export const NotesHeading: React.FC<{
    info: HeadingInfo;
    fallbackTitle: string;
    /** Live: the event and people can be changed. Ended: the title. */
    live: boolean;
    showChip: boolean;
    editingTitle: boolean;
    titleDraft: string;
    setTitleDraft: (v: string) => void;
    onStartTitle: (e: React.MouseEvent<HTMLElement>) => void;
    /** The hook types the title: never focus it. */
    titleFocusBlocked: boolean;
    onCommitTitle: () => void;
    onCancelTitle: () => void;
    attendeeDraft: string;
    setAttendeeDraft: (v: string) => void;
    onEngageAttendee: (e: React.MouseEvent<HTMLElement>) => void;
    onAddAttendee: () => void;
    onRemoveAttendee: (email: string) => void;
    onLinkEvent: (eventId: string | null) => void;
    hookField: string | null;
    preview?: boolean;
}> = ({
    info, fallbackTitle, live, showChip, editingTitle, titleDraft, setTitleDraft, onStartTitle, titleFocusBlocked, onCommitTitle, onCancelTitle,
    attendeeDraft, setAttendeeDraft, onEngageAttendee, onAddAttendee, onRemoveAttendee, onLinkEvent,
    hookField, preview,
}) => {
    const [open, setOpen] = useState<'event' | null>(null);
    const [candidates, setCandidates] = useState<Candidate[] | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const title = info.title ?? fallbackTitle;

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) {
                setOpen(null);
                setCandidates(null);
            }
        };
        document.addEventListener('mousedown', close, true);
        return () => document.removeEventListener('mousedown', close, true);
    }, [open]);

    const loadCandidates = () => {
        setCandidates([]);
        window.electronAPI?.liveNotesCalendarCandidates?.().then((list) => setCandidates(Array.isArray(list) ? list : [])).catch(() => setCandidates([]));
    };

    const groups = groupAttendees(info.attendees, info.selfEmail);
    const range = eventTimeRange(info.event?.startTime, info.event?.endTime);
    const typing = (f: string) => hookField === f;
    const row = 'w-full flex items-center gap-2 h-8 px-2 rounded-lg text-[13px] text-left transition-colors np-wash';

    return (
        <div className="shrink-0" ref={rootRef}>
            <div className="px-8 pt-[11px]">
                {editingTitle ? (
                    <textarea
                        aria-label="Meeting title"
                        rows={1}
                        value={titleDraft}
                        autoFocus={!titleFocusBlocked}
                        spellCheck={false}
                        onChange={(e) => setTitleDraft(e.target.value.replace(/\n/g, ''))}
                        onMouseDown={onStartTitle}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); onCommitTitle(); }
                            if (e.key === 'Escape') { e.preventDefault(); onCancelTitle(); }
                        }}
                        onBlur={() => { if (hookField !== 'title') onCommitTitle(); }}
                        data-hook-typing={typing('title') ? 'true' : undefined}
                        placeholder="New note"
                        maxLength={120}
                        className="block w-full resize-none overflow-hidden bg-transparent font-plex-serif text-[24px] leading-[28px] outline-none [field-sizing:content] placeholder:text-[color:var(--np-title-placeholder)]"
                        style={ink('--np-ink-strong')}
                    />
                ) : (
                    <h1
                        className={`font-plex-serif text-[24px] leading-[28px] font-normal break-words ${preview ? '' : 'cursor-text'}`}
                        style={ink('--np-ink-strong')}
                        title={preview ? undefined : 'Rename'}
                        onMouseDown={preview ? undefined : onStartTitle}
                    >
                        {title}
                    </h1>
                )}
            </div>

            {showChip && (
                <div className="relative mt-3.5 px-7 flex items-center gap-2">
                    <button
                        type="button"
                        aria-haspopup="dialog"
                        aria-expanded={open === 'event'}
                        title="Event details"
                        onClick={() => { setOpen((o) => (o === 'event' ? null : 'event')); setCandidates(null); }}
                        className="np-chip np-outline h-7 rounded-full pl-[13px] pr-[11px] inline-flex items-center text-[13px] font-[430] tracking-[0.01em]"
                        style={ink('--np-ink-secondary')}
                    >
                        <CalendarDays className="w-[14px] h-[14px] mr-1.5" strokeWidth={1.5} />
                        Today
                        {info.people > 0 && (
                            <span className="ml-2 inline-flex items-center gap-1">
                                <Users className="w-[15px] h-[15px] -translate-y-[0.5px]" strokeWidth={1.5} />
                                {info.people}
                            </span>
                        )}
                    </button>

                        <NpPop open={open === 'event'} origin="top left" role="dialog" aria-label="Event details" className="absolute left-7 top-8 z-30 w-[280px] max-h-[70vh] overflow-y-auto text-[13px]">
                            {info.event ? (
                                <>
                                    <div className="p-2">
                                        <div className="flex items-start gap-2.5 px-1 pt-1">
                                            <span className="mt-[3px] w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: 'var(--np-event)' }} />
                                            <div className="min-w-0">
                                                <p className="text-[14px] leading-4 truncate" style={ink('--np-ink-strong')}>{info.event.title || 'Calendar event'}</p>
                                                {range && <p className="mt-1 text-[12px] leading-4" style={ink('--np-ink-secondary')}>Today · {range}</p>}
                                            </div>
                                        </div>
                                        {info.event.link && (
                                            <button
                                                type="button"
                                                onClick={() => { void window.electronAPI?.openExternal?.(info.event!.link!, { surface: 'notes' }); }}
                                                className={`${row} mt-2`}
                                                style={ink('--np-ink')}
                                            >
                                                <Link2 className="w-4 h-4" strokeWidth={1.75} style={ink('--np-ink-secondary')} /> Join
                                            </button>
                                        )}
                                    </div>

                                    <div className="p-2" style={{ borderTop: '0.5px solid var(--np-ring)' }}>
                                        {live && (
                                            <form
                                                className="h-10 flex items-center gap-2 px-2"
                                                onSubmit={(e) => { e.preventDefault(); onAddAttendee(); }}
                                            >
                                                <Plus className="w-4 h-4 shrink-0" strokeWidth={1.75} style={ink('--np-ink-tertiary')} />
                                                <input
                                                    aria-label="Add attendees"
                                                    value={attendeeDraft}
                                                    onChange={(e) => setAttendeeDraft(e.target.value)}
                                                    onMouseDown={onEngageAttendee}
                                                    data-hook-typing={typing('attendee') ? 'true' : undefined}
                                                    placeholder="Add attendees..."
                                                    className="flex-1 min-w-0 bg-transparent text-[13px] outline-none placeholder:text-[color:var(--np-ink-tertiary)]"
                                                    style={ink('--np-ink')}
                                                />
                                            </form>
                                        )}
                                        <div className="max-h-[280px] overflow-y-auto">
                                            {groups.map((g) => (
                                                <div key={g.company} className="mt-1.5 first:mt-0">
                                                    <p className="px-2 py-1 text-[12px] font-medium" style={ink('--np-ink-secondary')}>{g.company}</p>
                                                    {g.people.map((p) => (
                                                        <div key={p.email} className="group flex items-center justify-between gap-2 min-w-0 p-1 pl-2 rounded-lg np-wash">
                                                            <span className="min-w-0 truncate text-[13px]" style={ink('--np-ink')}>
                                                                {p.name ?? p.email}
                                                                {p.self && <span style={ink('--np-ink-tertiary')}> (you)</span>}
                                                                {p.name && <span style={ink('--np-ink-tertiary')}> {p.email}</span>}
                                                            </span>
                                                            {live && !p.self && (
                                                                <button
                                                                    type="button"
                                                                    aria-label={`Remove ${p.name ?? p.email}`}
                                                                    onClick={() => onRemoveAttendee(p.email)}
                                                                    className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                                    style={ink('--np-ink-secondary')}
                                                                >
                                                                    <X className="w-3.5 h-3.5" strokeWidth={2} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <p className="p-3 text-[13px] leading-snug" style={ink('--np-ink-secondary')}>This meeting isn&rsquo;t linked to a calendar event.</p>
                            )}

                            {live && (
                                <div className="p-1" style={{ borderTop: '0.5px solid var(--np-ring)' }}>
                                    {candidates === null ? (
                                        <>
                                            <button type="button" onClick={loadCandidates} className={row} style={ink('--np-ink')}>
                                                <CalendarDays className="w-4 h-4" strokeWidth={1.75} style={ink('--np-ink-secondary')} />
                                                {info.event ? 'Link a different event' : 'Link an event'}
                                            </button>
                                            {info.event && (
                                                <button type="button" onClick={() => { onLinkEvent(null); setOpen(null); }} className={row} style={ink('--np-ink')}>
                                                    <X className="w-4 h-4" strokeWidth={1.75} style={ink('--np-ink-secondary')} /> Unlink
                                                </button>
                                            )}
                                        </>
                                    ) : candidates.length === 0 ? (
                                        <p className="px-2 py-2 text-[12px]" style={ink('--np-ink-tertiary')}>No events around now in your calendar.</p>
                                    ) : (
                                        candidates.map((c) => (
                                            <button
                                                key={c.id}
                                                type="button"
                                                onClick={() => { onLinkEvent(c.id); setOpen(null); setCandidates(null); }}
                                                className="w-full text-left flex items-start gap-2.5 px-2 py-1.5 rounded-lg transition-colors np-wash"
                                                style={c.id === info.event?.id ? { background: 'var(--np-wash)' } : undefined}
                                            >
                                                <span className="mt-[3px] w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: 'var(--np-event)' }} />
                                                <span className="min-w-0">
                                                    <span className="block text-[13px] truncate" style={ink('--np-ink')}>{c.title || 'Untitled event'}</span>
                                                    <span className="block text-[12px]" style={ink('--np-ink-secondary')}>{eventTimeRange(c.startTime, c.endTime)}{c.people > 0 ? ` · ${c.people} ${c.people === 1 ? 'person' : 'people'}` : ''}</span>
                                                </span>
                                            </button>
                                        ))
                                    )}
                                </div>
                            )}
                        </NpPop>
                </div>
            )}
        </div>
    );
};
