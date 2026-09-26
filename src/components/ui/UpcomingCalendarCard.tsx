import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, CalendarCheck } from 'lucide-react';
import { useT } from '../../i18n';
import calendarBackdrop from '../../UI_comp/calendar.jpg';
import ConnectCalendarButton from './ConnectCalendarButton';
import { reconcileStack, settleEntering, dropLeft, arrivalSteps, padStack, isSlotKey, type StackEntry } from './bannerStack.mjs';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import './UpcomingCalendarCard.css';

export interface CalendarAttendee {
    email: string;
    name?: string;
}

export interface CalendarMeeting {
    id: string;
    title: string;
    startTime: string;
    attendees?: CalendarAttendee[];
}

interface UpcomingCalendarCardProps {
    /** Whether the user has already linked a calendar. */
    isConnected: boolean;
    /**
     * The calendar is connected. `fresh` is true when a sign-in just completed
     * here, false when the launch-time status check found an existing link.
     */
    onConnect?: (info: { fresh: boolean }) => void;
    /** Upcoming meetings, soonest-first. Only the first 3 are ever shown. */
    meetings?: CalendarMeeting[];
    /** Total upcoming meeting count, for the "+N more" pill. Defaults to meetings.length. */
    totalCount?: number;
    /**
     * The first fetch has not answered yet. The stack shows skeleton cards
     * rather than "No upcoming events", which would flash on every launch
     * before the real meetings arrive.
     */
    loading?: boolean;
    className?: string;
}

const formatTimeLabel = (startTime: string) => {
    const start = new Date(startTime);
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);
    const isToday = start.toDateString() === now.toDateString();
    const isTomorrow = start.toDateString() === tomorrow.toDateString();
    const time = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return isToday ? `Today at ${time}`
        : isTomorrow ? `Tomorrow at ${time}`
        : `${start.toLocaleDateString([], { weekday: 'short' })} at ${time}`;
};

// Deterministic avatar palette from email/name
const avatarPalette = [
    'bg-rose-300/90 text-rose-900',
    'bg-amber-200/90 text-amber-900',
    'bg-emerald-200/90 text-emerald-900',
    'bg-sky-200/90 text-sky-900',
    'bg-violet-200/90 text-violet-900',
    'bg-teal-200/90 text-teal-900',
];

const initialsFor = (a: CalendarAttendee) => {
    const src = (a.name || a.email || '').trim();
    if (!src) return '?';
    const parts = src.split(/[\s._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
};

const colorFor = (key: string) => {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return avatarPalette[Math.abs(h) % avatarPalette.length];
};

/** How far apart the banners land when the stack fills from empty. */
const ARRIVAL_STAGGER_MS = 110;

/**
 * Banners (meetings and placeholder slots) already shown this session. The
 * Launcher unmounts this card while meeting notes are open, so without this
 * every return would replay the arrival. A meeting that is genuinely new
 * still rises in.
 */
const arrivedKeys = new Set<string>();

/** The stack is always this deep; placeholder slots fill in behind real meetings. */
const STACK_SIZE = 3;

/** A CSS time custom property in ms. The minifier may rewrite 250ms as .25s. */
function cssMs(name: string, fallback: number): number {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return fallback;
    return raw.endsWith('ms') ? value : raw.endsWith('s') ? value * 1000 : value;
}

/** A CSS length custom property as resolved on `el` (the stack overrides some). */
function cssPx(el: Element, name: string, fallback: number): number {
    const value = parseFloat(getComputedStyle(el).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * The Transitions.dev banner stack (UpcomingCalendarCard.css): the three
 * soonest meetings, soonest in front, always three deep. Placeholder slots
 * (bannerStack.mjs padStack) fill in behind, or stand in for the whole stack
 * while loading or when nothing is scheduled. bannerStack.mjs keeps entries
 * in a fixed order so no banner's DOM node ever moves mid-transition.
 */
function useMeetingStack(meetings: CalendarMeeting[]) {
    const front = meetings.slice(0, STACK_SIZE);
    // Keyed on ids, not the array: the Launcher passes a fresh array every render.
    const signature = front.map((m) => m.id).join('\n');
    const latest = useRef(front);
    latest.current = front;

    const [entries, setEntries] = useState<StackEntry<CalendarMeeting | null>[]>([]);
    const entriesRef = useRef(entries);
    entriesRef.current = entries;
    const stackRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const real = latest.current.map((m) => ({ key: m.id, item: m as CalendarMeeting | null }));
        const target = padStack(real, STACK_SIZE);
        const apply = (step: typeof target) =>
            setEntries((prev) => reconcileStack(prev, step, (key) => arrivedKeys.has(key)));

        // One-by-one arrival, furthest first, in two cases: the stack fills
        // from nothing (first paint), or real meetings replace placeholders
        // (the fetch answered), where each arrival pushes a slot out the back.
        // A refresh returning the same meetings changes nothing.
        const onScreen = entriesRef.current.filter((e) => e.phase !== 'leaving');
        let steps: (typeof target)[] = [target];
        if (!prefersReducedMotion() && target.some((t) => !arrivedKeys.has(t.key))) {
            if (onScreen.length === 0) steps = arrivalSteps(target);
            else if (real.length > 0 && onScreen.every((e) => isSlotKey(e.key))) {
                steps = arrivalSteps(real).map((step) => padStack(step, STACK_SIZE));
            }
        }
        if (steps.length === 1) {
            apply(steps[0]);
            return;
        }
        const timers = steps.map((step, i) => window.setTimeout(() => apply(step), i * ARRIVAL_STAGGER_MS));
        return () => timers.forEach((timer) => window.clearTimeout(timer));
    }, [signature]);

    // The snippet's recipe: render with .is-enter, force one reflow so that
    // start state is committed, then take it off in the same task.
    useLayoutEffect(() => {
        if (!entries.some((e) => e.phase === 'enter')) return;
        void stackRef.current?.offsetHeight;
        entries.forEach((e) => { if (e.phase !== 'leaving') arrivedKeys.add(e.key); });
        setEntries(settleEntering);
    }, [entries]);

    // A leaving banner is dropped once --stack-close has played.
    const leavingKeys = entries.filter((e) => e.phase === 'leaving').map((e) => e.key).join('\n');
    useEffect(() => {
        if (!leavingKeys) return;
        const keys = leavingKeys.split('\n');
        const timer = window.setTimeout(() => setEntries((prev) => dropLeft(prev, keys)), cssMs('--stack-close', 250));
        return () => window.clearTimeout(timer);
    }, [leavingKeys]);

    // Only real meetings spread; placeholder slots stay tucked behind.
    const meetingCount = entries.filter((e) => e.phase !== 'leaving' && !isSlotKey(e.key)).length;
    return { entries, stackRef, meetingCount };
}

const MeetingBanner: React.FC<{ meeting: CalendarMeeting }> = ({ meeting }) => {
    const attendees = (meeting.attendees || []).slice(0, 3);
    const remainingAttendees = Math.max(0, (meeting.attendees?.length || 0) - attendees.length);
    return (
        <div className="cal-banner h-full rounded-[14px] px-3.5">
            <div className="cal-banner-body h-full flex flex-col justify-center gap-1">
                <div className="flex items-center justify-between gap-2">
                    <h4 className="text-[13px] font-semibold text-white leading-tight tracking-[-0.01em] truncate">
                        {meeting.title}
                    </h4>
                    {attendees.length > 0 && (
                        <div className="flex -space-x-1.5 shrink-0">
                            {attendees.map((a, ai) => {
                                const attendeeIdentity = (a.email || a.name || '').trim();
                                const attendeeKey = a.email ? `email:${a.email}` : `${attendeeIdentity || 'attendee'}:${ai}`;
                                return (
                                    <span
                                        key={attendeeKey}
                                        title={a.name || a.email}
                                        className={`inline-flex items-center justify-center w-[16px] h-[16px] rounded-full ring-[1.5px] ring-[#211c6c] text-[7.5px] font-bold ${colorFor(attendeeIdentity || String(ai))}`}
                                    >
                                        {initialsFor(a)}
                                    </span>
                                );
                            })}
                            {remainingAttendees > 0 && (
                                <span className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full ring-[1.5px] ring-[#211c6c] bg-white/15 text-[7.5px] font-bold text-white/85 tabular-nums">
                                    +{remainingAttendees}
                                </span>
                            )}
                        </div>
                    )}
                </div>
                <span className="text-[11px] text-cyan-200/85 font-medium tabular-nums">
                    {formatTimeLabel(meeting.startTime)}
                </span>
            </div>
        </div>
    );
};

/**
 * A placeholder slot. The front one stands in for the whole stack: skeleton
 * lines while the first fetch is out, "No upcoming events" once it answers
 * empty. Slots behind the front are blank; they are there for the depth of
 * the stack, and hide when real meetings spread.
 */
const SlotBanner: React.FC<{ front: boolean; loading: boolean }> = ({ front, loading }) => {
    const t = useT();
    return (
        <div className="cal-banner cal-slot h-full rounded-[14px] px-3.5">
            <div className="cal-banner-body h-full flex flex-col justify-center gap-1.5">
                {front && loading && (
                    <>
                        <span className="block h-[9px] w-3/5 rounded-full bg-white/[0.14] motion-safe:animate-pulse" />
                        <span className="block h-[7px] w-2/5 rounded-full bg-cyan-200/[0.16] motion-safe:animate-pulse" />
                    </>
                )}
                {front && !loading && (
                    <div className="flex items-center gap-2.5">
                        <CalendarCheck size={16} className="shrink-0 text-cyan-200/85" strokeWidth={2} />
                        <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-white leading-tight truncate">{t('No upcoming events')}</div>
                            <div className="text-[11px] text-cyan-200/85 font-medium mt-0.5 truncate">{t('Your next 7 days are clear')}</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

/* The header button: Liquid Glass (src/ui-components/design.md) in the Connect
   button's translucent sky material, at chip size. */
const HEADER_BUTTON_STYLE = {
    '--lg-sky-bg': 'rgba(255, 255, 255, .14)',
    '--lg-sky-hover': 'rgba(255, 255, 255, .22)',
    '--lg-pill-h': '24px',
    '--lg-label-size': '11px',
    '--lg-icon-gap': '3px',
    padding: '0 8px',
} as React.CSSProperties;

/** Matches the snippet's fixed 200ms `.is-hiding` fade (UpcomingCalendarCard.css). */
const HEADING_HIDE_MS = 200;

/**
 * The card's two-line heading, in both states: "Link your calendar to / see
 * upcoming events" before, "Calendar linked / see upcoming events" after.
 * Transitions.dev "Texts reveal": at rest it carries `.is-shown` from the
 * first paint, so nothing animates. With `reveal` it mounts without it,
 * commits that start state with one reflow, then adds it, which plays the
 * staggered entrance. `hiding` is the snippet's quiet 200ms fade.
 */
const CalendarHeading: React.FC<{ line1: string; line2: string; reveal?: boolean; hiding?: boolean }> = ({ line1, line2, reveal = false, hiding = false }) => {
    const ref = useRef<HTMLHeadingElement>(null);
    const [shown, setShown] = useState(!reveal);
    useLayoutEffect(() => {
        if (shown) return;
        void ref.current?.offsetHeight;
        setShown(true);
    }, [shown]);
    return (
        <h3
            ref={ref}
            className={`t-stagger text-[19px] leading-tight tracking-[-0.01em]${hiding ? ' is-hiding' : shown ? ' is-shown' : ''}`}
        >
            <span className="t-stagger-line t-stagger-line--1 font-semibold text-white">{line1}</span>
            <span className="t-stagger-line t-stagger-line--2 font-medium text-white/60 text-[0.95em]">{line2}</span>
        </h3>
    );
};

/**
 * "Link your calendar to see upcoming events" hero card — indigo curtain
 * backdrop, connect CTA when disconnected, stacked peek of the
 * next few meetings once connected. Pixel-matched to the Launcher card,
 * but self-contained so it can be dropped anywhere real meeting data needs
 * to be shown (props-driven, no Launcher-specific state/hooks).
 */
const UpcomingCalendarCard: React.FC<UpcomingCalendarCardProps> = ({
    isConnected,
    onConnect,
    meetings = [],
    totalCount,
    loading = false,
    className = '',
}) => {
    const t = useT();

    // A sign-in that just completed: the "Link your calendar to" heading fades
    // (200ms), then the connected card mounts and "Calendar linked" reveals.
    // The launch-time status check connects silently: nothing to celebrate.
    const [linkHeadingHiding, setLinkHeadingHiding] = useState(false);
    const [revealLinkedHeading, setRevealLinkedHeading] = useState(false);
    const connectTimer = useRef<number | undefined>(undefined);
    useEffect(() => () => window.clearTimeout(connectTimer.current), []);
    const handleConnected = (info: { fresh: boolean }) => {
        if (!info.fresh) {
            onConnect?.(info);
            return;
        }
        setRevealLinkedHeading(true);
        if (prefersReducedMotion()) {
            onConnect?.(info);
            return;
        }
        setLinkHeadingHiding(true);
        connectTimer.current = window.setTimeout(() => onConnect?.(info), HEADING_HIDE_MS);
    };

    const moreMeetingsCount = Math.max(0, (totalCount ?? meetings.length) - Math.min(meetings.length, 3));
    const latestById = new Map(meetings.map((m) => [m.id, m]));
    const { entries, stackRef, meetingCount } = useMeetingStack(meetings);
    const headerRef = useRef<HTMLDivElement>(null);

    // Hover spread is geometry, per the snippet: the gaps between spread
    // banners belong to no element, so :hover would flicker across them.
    const [spread, setSpread] = useState({ on: false, coversHeader: false });
    // Only real meetings spread: two or more of them. The stack is always
    // three deep, so the collapsed box always includes both peeks.
    useEffect(() => {
        if (meetingCount < 2 && spread.on) setSpread({ on: false, coversHeader: false });
    }, [meetingCount, spread.on]);
    const trackSpread = (e: React.PointerEvent) => {
        const stack = stackRef.current;
        if (!stack || meetingCount < 2) return;
        const r = stack.getBoundingClientRect();
        const withinX = e.clientX >= r.left && e.clientX <= r.right;
        const spreadTop = r.top - (r.height + cssPx(stack, '--stack-spread-gap', 8)) * (meetingCount - 1);
        if (!spread.on) {
            const collapsedTop = r.top - cssPx(stack, '--stack-peek', 12) * (STACK_SIZE - 1);
            if (withinX && e.clientY >= collapsedTop && e.clientY <= r.bottom) {
                const header = headerRef.current?.getBoundingClientRect();
                setSpread({ on: true, coversHeader: !!header && spreadTop < header.bottom });
            }
        } else if (!(withinX && e.clientY >= spreadTop && e.clientY <= r.bottom)) {
            setSpread({ on: false, coversHeader: false });
        }
    };

    return (
        <div className={`rounded-xl overflow-hidden bg-bg-elevated relative flex flex-col shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)] ${className}`}>
            {/* Backdrop image. The curtain is plain, so it needs no tint once meetings stack over it. */}
            <div className="absolute inset-0">
                <img
                    src={calendarBackdrop}
                    alt=""
                    className="w-full h-full object-cover scale-105 translate-y-[1px]"
                />
                {/* Subtle grain */}
                <div
                    className="absolute inset-0 opacity-[0.05] mix-blend-overlay pointer-events-none"
                    style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>\")" }}
                />
            </div>

            {/* Content Layer */}
            {isConnected ? (
                // Distinct keys on the two states: both are a div whose first
                // child holds a CalendarHeading, so without them React reuses
                // the "Link your calendar to" heading, still mid-fade, as the
                // "Calendar linked" one, and the reveal can only fade in.
                <div
                    key="linked"
                    className="relative z-10 w-full flex flex-col h-full px-3.5 pt-3.5 pb-3"
                    onPointerMove={trackSpread}
                    onPointerLeave={() => spread.on && setSpread({ on: false, coversHeader: false })}
                >
                    {/* The same heading as before linking, now "Calendar linked",
                        at the same height: 14px layer padding + 34px here puts it
                        48px down, where the unlinked state's pt-12 puts its own.
                        The button stays in the top-right corner (top-0 is the
                        header's padding edge), without pulling the heading off
                        centre. No translate on it: the glass press scale replaces
                        `transform` and would jump it. */}
                    <div
                        ref={headerRef}
                        className={`cal-stack-header relative flex justify-center text-center pt-[34px] ${spread.on && spread.coversHeader ? 'is-covered' : ''}`}
                    >
                        <CalendarHeading
                            line1={t('Calendar linked')}
                            line2={t('see upcoming events')}
                            reveal={revealLinkedHeading}
                        />
                        <LiquidGlassButton
                            variant="sky"
                            className="lg-sm !absolute right-0 top-0"
                            style={HEADER_BUTTON_STYLE}
                            onClick={() => window.electronAPI?.openSettingsTab?.('calendar')}
                            aria-label={moreMeetingsCount > 0 ? `${t('Calendar settings')}: +${moreMeetingsCount} ${t('more')}` : t('Calendar settings')}
                            title={t('Calendar settings')}
                        >
                            <span className="inline-flex items-center gap-0.5 tabular-nums">
                                {moreMeetingsCount > 0 && <span>+{moreMeetingsCount}</span>}
                                <ArrowUpRight size={13} strokeWidth={2.25} />
                            </span>
                        </LiquidGlassButton>
                    </div>

                    {/* The three soonest meetings as a banner stack, soonest in
                        front, always three deep. Entries stay in a fixed order;
                        depth is data-depth. */}
                    <div ref={stackRef} className={`t-stack cal-stack mt-auto h-[54px] ${spread.on ? 'is-spread' : ''}`}>
                        {entries.map((entry) => {
                            const slot = isSlotKey(entry.key);
                            const meeting = slot ? null : (latestById.get(entry.key) ?? entry.item);
                            return (
                                <div
                                    key={entry.key}
                                    data-depth={entry.depth}
                                    className={`t-stack-banner${slot ? ' cal-filler' : ''}${entry.phase === 'enter' ? ' is-enter' : ''}${entry.phase === 'leaving' ? ' is-leaving' : ''}`}
                                >
                                    {meeting
                                        ? <MeetingBanner meeting={meeting} />
                                        : <SlotBanner front={entry.key === 'slot:0'} loading={loading} />}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <div key="linking" className="relative z-10 w-full flex flex-col items-center h-full pt-12 text-center">
                    <div className="mb-4">
                        <CalendarHeading
                            line1={t('Link your calendar to')}
                            line2={t('see upcoming events')}
                            hiding={linkHeadingHiding}
                        />
                    </div>

                    <ConnectCalendarButton
                        className="-translate-x-0.5"
                        onConnect={handleConnected}
                    />
                </div>
            )}
        </div>
    );
};

export default UpcomingCalendarCard;
