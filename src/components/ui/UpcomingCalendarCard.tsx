import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { useT, useLanguage } from '../../i18n';
import calendarBackdrop from '../../UI_comp/calendar.jpg';
import ConnectCalendarButton from './ConnectCalendarButton';
import { reconcileStack, settleEntering, dropLeft, arrivalSteps, padStack, isSlotKey, type StackEntry } from './bannerStack.mjs';
import './UpcomingCalendarCard.css';
import './textsReveal.css';
import { useTextsReveal } from './useTextsReveal';
import GlassSurface from '../../ui-components/GlassSurface';
import '../../ui-components/liquidglas2.0/LiquidGlassCta.css';

export interface CalendarAttendee {
    email: string;
    name?: string;
    /** Their Gravatar (CalendarManager). A 404 when they have none. */
    photoUrl?: string;
}

export interface CalendarMeeting {
    id: string;
    title: string;
    startTime: string;
    /** When it ends. Without it the time line shows the start alone. */
    endTime?: string;
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

/** Within this many minutes of its start, a meeting's countdown turns amber. */
const SOON_MINUTES = 15;

/** In its last hour, a meeting's tile counts down instead of showing the date. */
const COUNTDOWN_MINUTES = 60;

/**
 * A meeting stays in the deck until 5 minutes after it starts, the Launcher's
 * own rule. The card applies it too, on its own clock: the Launcher only
 * re-filters when its fetch answers, and a countdown left running past it
 * would read "6m ago", "7m ago"…
 */
const STARTED_GRACE_MS = 5 * 60_000;

const formatters = new Map<string, Intl.RelativeTimeFormat | Intl.NumberFormat>();
function cachedFormat<F extends Intl.RelativeTimeFormat | Intl.NumberFormat>(key: string, make: () => F): F {
    let f = formatters.get(key) as F | undefined;
    if (!f) {
        f = make();
        formatters.set(key, f);
    }
    return f;
}
const relativeFormat = (lang: string) =>
    cachedFormat(`rtf:${lang}`, () => new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'narrow' }));
const spokenFormat = (lang: string) =>
    cachedFormat(`rtf-long:${lang}`, () => new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'long' }));
const minutesFormat = (lang: string) =>
    cachedFormat(`min:${lang}`, () => new Intl.NumberFormat(lang, { style: 'unit', unit: 'minute', unitDisplay: 'short' }));
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const capitalize = (text: string, lang: string) => text.charAt(0).toLocaleUpperCase(lang) + text.slice(1);

// Clock times read like the Launcher's meeting list right below this card
// (Launcher.tsx formatTime): "2:25 pm". The same window should not show
// "14:25" here and "2:25 pm" there.
const clockFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
const clockOf = (d: Date) => clockFormat.format(d).toLowerCase();
const rangeOf = (start: Date, end: Date | null) =>
    end && end > start ? clockFormat.formatRange(start, end).toLowerCase() : clockOf(start);

/**
 * The linked heading, once there are meetings: what the deck can't say at a
 * glance. Line 1 counts what's ahead ("3 upcoming meetings"), line 2 says when
 * the next one is ("Next in 20 minutes", "Next tomorrow at 9:00 am", "Next on
 * Wed at 9:00 am"), in words, where the front tile is a ring or a date leaf.
 */
function linkedSummary(next: CalendarMeeting, count: number, now: number, lang: string, t: (s: string) => string) {
    const start = new Date(next.startTime);
    const mins = Math.round((start.getTime() - now) / 60_000);
    const days = Math.round((startOfDay(start) - startOfDay(new Date(now))) / 86_400_000);
    const rtf = spokenFormat(lang);
    const line2 = mins <= 0
        ? t('Next one is starting now')
        : mins < COUNTDOWN_MINUTES
            ? `${t('Next')} ${rtf.format(mins, 'minute')}`
            : days <= 1
                ? `${t('Next')} ${rtf.format(days, 'day')} ${t('at')} ${clockOf(start)}`
                : `${t('Next on')} ${start.toLocaleDateString(lang, { weekday: 'short' }).replace(/\.$/, '')} ${t('at')} ${clockOf(start)}`;
    return { line1: count === 1 ? t('1 upcoming meeting') : `${count} ${t('upcoming meetings')}`, line2 };
}

/**
 * When a meeting is, split between its tile and its time line.
 *
 * - Its last hour: the tile counts down ("10" over "MIN", a ring running out),
 *   so the line gives the time range, "2:25 – 3:10 pm".
 * - Later today or tomorrow: the tile shows the date, the line "Today · 4:15 pm".
 * - Further out: the tile's date names the day, so the line is the range.
 *
 * A meeting leaves the deck 5 minutes after it starts (STARTED_GRACE_MS); until
 * then its tile says "Now".
 */
function meetingWhen(meeting: CalendarMeeting, now: number, lang: string) {
    const start = new Date(meeting.startTime);
    const end = meeting.endTime ? new Date(meeting.endTime) : null;
    const mins = Math.round((start.getTime() - now) / 60_000);
    // Math.round: a day across a DST change is 23 or 25 hours long.
    const days = Math.round((startOfDay(start) - startOfDay(new Date(now))) / 86_400_000);
    const countdown = mins < COUNTDOWN_MINUTES;
    const rtf = relativeFormat(lang);
    const unit = minutesFormat(lang).formatToParts(Math.max(0, mins)).find((p) => p.type === 'unit')?.value ?? 'min';
    return {
        countdown,
        soon: mins <= SOON_MINUTES,
        mins,
        // The tile.
        started: mins <= 0,
        nowLabel: capitalize(rtf.format(0, 'second'), lang),
        unit,
        weekday: start.toLocaleDateString(lang, { weekday: 'short' }).replace(/\.$/, ''),
        day: start.getDate(),
        // Read aloud in place of the tile.
        // Long form: a screen reader says "in 10m" as "in 10 metres".
        spoken: countdown
            ? spokenFormat(lang).format(Math.max(0, mins), 'minute')
            : start.toLocaleDateString(lang, { weekday: 'long', month: 'long', day: 'numeric' }),
        // The time line.
        lead: !countdown && days <= 1 ? capitalize(rtf.format(days, 'day'), lang) : null,
        time: !countdown && days <= 1 ? clockOf(start) : rangeOf(start, end),
    };
}

/**
 * The time now, every 30s while `enabled`, so "In 12m" counts down. The
 * stack is keyed on meeting ids, so a tick never moves a card.
 */
function useNow(enabled: boolean, everyMs = 30_000) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!enabled) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), everyMs);
        return () => window.clearInterval(timer);
    }, [enabled, everyMs]);
    return now;
}

/**
 * Faces without a photo get one of six deep tones, picked from their email so
 * a person keeps theirs, with white initials (UpcomingCalendarCard.css
 * .cal-face-N). Pastels with dark initials glared against the indigo.
 */
const FACE_TONES = 6;

const initialsFor = (a: CalendarAttendee) => {
    const src = (a.name || a.email || '').trim();
    if (!src) return '?';
    const parts = src.split(/[\s._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
};

const toneFor = (key: string) => {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return Math.abs(h) % FACE_TONES;
};

/** How far apart the banners land when the stack fills from empty. */
const ARRIVAL_STAGGER_MS = 80;

/**
 * Banners (meetings and placeholder slots) already shown this session. The
 * Launcher unmounts this card while meeting notes are open, so without this
 * every return would replay the arrival. A meeting that is genuinely new
 * still rises in.
 */
const arrivedKeys = new Set<string>();

/**
 * Meetings in the deck: the three soonest, and only those. Placeholder slots
 * stand in for any missing, so the deck is always three deep.
 */
const MEETING_SLOTS = 3;

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
 * soonest meetings, soonest in front, always three deep.
 * Placeholder slots (bannerStack.mjs padStack) fill in for missing meetings,
 * or stand in for them all while loading or when nothing is scheduled.
 * bannerStack.mjs keeps entries in a fixed order so no banner's DOM node ever
 * moves mid-transition.
 *
 * `active` is false while the linked card is not on screen (not connected,
 * or holding for the user to come back from the browser). The stack only
 * starts filling once it can be seen, so the arrival is not spent offscreen.
 */
function useMeetingStack(meetings: CalendarMeeting[], active: boolean, startDelayMs = 0) {
    const front = meetings.slice(0, MEETING_SLOTS);
    // Keyed on ids, not the array: the Launcher passes a fresh array every render.
    const signature = front.map((m) => m.id).join('\n');
    const latest = useRef(front);
    latest.current = front;

    const [entries, setEntries] = useState<StackEntry<CalendarMeeting | null>[]>([]);
    const entriesRef = useRef(entries);
    entriesRef.current = entries;
    const stackRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!active) return;
        const real = latest.current.map((m) => ({ key: m.id, item: m as CalendarMeeting | null }));
        const target = padStack(real, MEETING_SLOTS);
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
                steps = arrivalSteps(real).map((step) => padStack(step, MEETING_SLOTS));
            }
        }
        // A delay applies only to a stack filling from nothing (the reveal after
        // a sign-in); a later change to the meetings never waits.
        const delay = onScreen.length === 0 ? startDelayMs : 0;
        if (steps.length === 1 && delay === 0) {
            apply(steps[0]);
            return;
        }
        const timers = steps.map((step, i) => window.setTimeout(() => apply(step), delay + i * ARRIVAL_STAGGER_MS));
        return () => timers.forEach((timer) => window.clearTimeout(timer));
    }, [signature, active]);

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

    const meetingCount = entries.filter((e) => e.phase !== 'leaving' && !isSlotKey(e.key)).length;
    return { entries, stackRef, meetingCount };
}

/** Gravatars that 404'd this session: a missing photo is asked for once. */
const missingPhotos = new Set<string>();

/**
 * An attendee's initials, with their Gravatar over them once it loads. The
 * initials are there from the first paint, so a slow or missing photo never
 * leaves a gap, and a photo that arrives fades in (150ms) rather than
 * popping. No referrer goes to Gravatar.
 */
const AttendeeAvatar: React.FC<{ attendee: CalendarAttendee; identity: string; z: number }> = ({ attendee, identity, z }) => {
    const url = attendee.photoUrl && !missingPhotos.has(attendee.photoUrl) ? attendee.photoUrl : null;
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    return (
        <span
            title={attendee.name || attendee.email}
            style={{ zIndex: z }}
            className={`cal-face cal-face-${toneFor(identity)}`}
        >
            {initialsFor(attendee)}
            {url && !failed && (
                <img
                    src={url}
                    alt=""
                    draggable={false}
                    referrerPolicy="no-referrer"
                    onLoad={() => setLoaded(true)}
                    onError={() => { missingPhotos.add(url); setFailed(true); }}
                    className={`absolute inset-0 w-full h-full rounded-full object-cover transition-opacity duration-150 ease-out ${loaded ? 'opacity-100' : 'opacity-0'}`}
                />
            )}
        </span>
    );
};

/**
 * The deck's left column: a 28px round tile set in the pill's rounded end,
 * 8px in all round, so the two curves share a centre. A meeting's tile shows
 * its date, like a calendar leaf, or in its last hour a countdown: the minutes
 * left, inside a ring that runs out as the start comes (amber for the last 15).
 * Placeholders use the same column, so nothing shifts when meetings arrive.
 */
const MeetingTile: React.FC<{ when: ReturnType<typeof meetingWhen> }> = ({ when }) => (
    <span className={`cal-tile${when.countdown ? ' is-countdown' : ''}${when.soon ? ' is-soon' : ''}`}>
        <span className="sr-only">{when.spoken}</span>
        {when.countdown ? (
            <span className="contents" aria-hidden>
                <svg className="cal-tile-ring" viewBox="0 0 28 28">
                    <circle
                        className="cal-tile-arc"
                        cx="14"
                        cy="14"
                        r="12.5"
                        pathLength={100}
                        style={{ strokeDashoffset: 100 - (100 * Math.max(0, when.mins)) / COUNTDOWN_MINUTES }}
                    />
                </svg>
                {when.started ? (
                    <span className="cal-tile-now">{when.nowLabel}</span>
                ) : (
                    <>
                        <span className="cal-tile-num">{when.mins}</span>
                        <span className="cal-tile-unit">{when.unit}</span>
                    </>
                )}
            </span>
        ) : (
            <span className="contents" aria-hidden>
                <span className="cal-tile-weekday">{when.weekday}</span>
                <span className="cal-tile-day">{when.day}</span>
            </span>
        )}
    </span>
);

/**
 * The deck's geometry, as UpcomingCalendarCard.css draws it: the stack's
 * bottom edge, the card height, the peek and depth scale per step back, the
 * sink of the cards in front of a popped one, and each depth's pop lift, as
 * the hover hit-test uses it (in screen px).
 */
interface DeckGeometry {
    bottom: number;
    H: number;
    peek: number;
    depthScale: number;
    sink: number;
    lift: (depth: number) => number;
}
/** The top of the card at depth j with the card at depth `pd` popped. At rest
 *  it sits j peeks up, scaled from its bottom edge; popped it rises by its lift
 *  at full size; behind a popped card it rises by that same lift; in front of
 *  one it sinks by the sink. */
function deckTop(g: DeckGeometry, j: number, pd: number | null): number {
    const parted = pd && j < pd ? g.sink : 0;
    if (j === 0) return g.bottom - g.H + parted;
    const lift = pd ? g.lift(pd) : 0;
    if (pd && j === pd) return g.bottom - j * g.peek - lift - g.H;
    if (pd && j > pd) return g.bottom - j * g.peek - lift - g.H * (1 - j * g.depthScale);
    return g.bottom - j * g.peek - g.H * (1 - j * g.depthScale) + parted;
}
function readDeckGeometry(stack: HTMLElement, bottom: number, H: number, k = 1): DeckGeometry {
    return {
        bottom,
        H,
        peek: cssPx(stack, '--stack-peek', 14) * k,
        depthScale: cssPx(stack, '--stack-depth-scale', 0.06),
        sink: cssPx(stack, '--pop-sink', 4) * k,
        lift: (depth) => cssPx(stack, `--pop-lift-${depth}`, 20) * k,
    };
}

/**
 * A banner's body in Liquid Glass 2.0 (src/ui-components/liquidglas2.0): a
 * tinted, translucent lens that refracts the curtain behind the card, lit from
 * a corner. The lens is GlassSurface, frostier and bending harder than the 2.0
 * CTA, nearer Apple's Liquid Glass: a 4px blur on the bent backdrop
 * (`displace`, which also frosts the cards behind into a haze), a 45% band
 * with a 4px map blur, a -60 pull, achromatic, B for the vertical ramp. It
 * shows because the tint is thin (30%). The
 * bevel, sheen and directional edge are the CTA's own classes, fed the banner's
 * tokens (UpcomingCalendarCard.css). The curtain is the light it bends, so the
 * CTA's aura isn't needed here.
 */
const BannerGlass: React.FC = () => (
    <>
        <GlassSurface
            className="cal-glass"
            contentClassName="glass-surface__content--bare"
            width="100%"
            height={44}
            borderRadius={22}
            borderWidth={0.45}
            brightness={55}
            opacity={0.9}
            blur={4}
            displace={4}
            saturation={1.7}
            distortionScale={-60}
            redOffset={0}
            greenOffset={0}
            blueOffset={0}
            xChannel="R"
            yChannel="B"
            mixBlendMode="screen"
        />
        <span className="glass-cta__bevel" aria-hidden="true" />
        <span className="glass-cta__sheen" aria-hidden="true" />
        <span className="glass-cta__edge" aria-hidden="true" />
    </>
);

/**
 * Faces shown per meeting before the "+N". Two, overlapping 2px with the
 * first on top, leave every initial whole and give the title the room.
 */
const MAX_FACES = 2;

/**
 * A meeting as a pill, like a toast: the tile in the left end, title over
 * time in the middle, faces in the right end, each end's circles centred on
 * the pill's own curve.
 */
const MeetingBanner: React.FC<{ meeting: CalendarMeeting; now: number }> = ({ meeting, now }) => {
    const { lang } = useLanguage();
    const when = meetingWhen(meeting, now, lang);
    const attendees = (meeting.attendees || []).slice(0, MAX_FACES);
    const remainingAttendees = Math.max(0, (meeting.attendees?.length || 0) - attendees.length);
    return (
        <div className="cal-banner h-full rounded-full pl-2 pr-3">
            <BannerGlass />
            <div className="cal-banner-body h-full flex items-center gap-2">
                <MeetingTile when={when} />
                <div className="min-w-0 flex-1 flex flex-col gap-[4px]">
                    <h4 title={meeting.title} className="text-[13px] font-semibold text-white leading-none tracking-[-0.01em] truncate">
                        {meeting.title}
                    </h4>
                    <span className="text-[11px] font-medium leading-none tabular-nums truncate">
                        {when.lead && (
                            <>
                                <span className="text-cyan-200/90">{when.lead}</span>
                                {/* Real spaces, not margins, so it reads "Today 4:15 pm", not "Today4:15 pm". */}
                                {' '}<span className="text-white/35 mx-[2px]" aria-hidden>·</span>{' '}
                            </>
                        )}
                        <span className={when.countdown && when.soon ? 'text-amber-200' : 'text-white/70'}>{when.time}</span>
                    </span>
                </div>
                {attendees.length > 0 && (
                    <div className="flex -space-x-[2px] shrink-0">
                        {attendees.map((a, ai) => {
                            const attendeeIdentity = (a.email || a.name || '').trim();
                            const attendeeKey = a.email ? `email:${a.email}` : `${attendeeIdentity || 'attendee'}:${ai}`;
                            return <AttendeeAvatar key={attendeeKey} attendee={a} identity={attendeeIdentity || String(ai)} z={attendees.length - ai + 1} />;
                        })}
                        {remainingAttendees > 0 && (
                            <span className="cal-face cal-face-more relative z-0">+{remainingAttendees}</span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * A placeholder slot, laid out like a meeting so nothing shifts when one
 * arrives. The front one stands in for the whole stack: a skeleton while the
 * first fetch is out, "No upcoming events" once it answers empty. A slot
 * behind it pops like a meeting and says "No other events", with an open
 * (dashed) tile for the free spot; its text, like a meeting's, shows only
 * when popped.
 */
const SlotBanner: React.FC<{ front: boolean; loading: boolean }> = ({ front, loading }) => {
    const t = useT();
    const [line1, line2] = front ? [t('No upcoming events'), t('Your next 7 days are clear')] : [t('No other events'), t('in the next 7 days')];
    return (
        <div className="cal-banner cal-slot h-full rounded-full pl-2 pr-3">
            <BannerGlass />
            <div className="cal-banner-body h-full flex items-center gap-2">
                {loading ? (
                    <>
                        <span className="cal-tile is-skeleton motion-safe:animate-pulse" />
                        <span className="flex-1 flex flex-col gap-[6px]">
                            <span className="block h-[8px] w-3/5 rounded-full bg-white/[0.14] motion-safe:animate-pulse" />
                            <span className="block h-[6px] w-2/5 rounded-full bg-white/[0.10] motion-safe:animate-pulse" />
                        </span>
                    </>
                ) : (
                    <>
                        <span className={`cal-tile${front ? '' : ' is-open'}`} aria-hidden>
                            {front && <CalendarCheck size={14} className="text-cyan-200/90" strokeWidth={2} />}
                        </span>
                        <span className="min-w-0 flex flex-col gap-[4px]">
                            <span className="text-[13px] font-semibold text-white leading-none tracking-[-0.01em] truncate">{line1}</span>
                            <span className="text-[11px] text-white/70 font-medium leading-none truncate">{line2}</span>
                        </span>
                    </>
                )}
            </div>
        </div>
    );
};

/** Matches the snippet's fixed 200ms `.is-hiding` fade (UpcomingCalendarCard.css). */
const HEADING_HIDE_MS = 200;

/** After the user comes back from the browser, a beat before the heading changes, so they see it happen. */
const RETURN_BEAT_MS = 450;

/**
 * After a sign-in, the stack starts filling this long after "Calendar
 * linked" begins to rise, so the eye reads the headline first and the cards
 * follow instead of everything moving in one frame.
 */
const STACK_AFTER_HEADING_MS = 200;

/** Extra hover reach above the deck's top edge, where the last card peeks. */
const PICK_OVERSHOOT_PX = 8;

/**
 * How long the deck keeps `.is-picking` after the pointer leaves, so a card
 * going back settles on the spring it rose on (--pop-settle-dur, 366ms)
 * rather than the stack's own curve.
 */
const PICK_SETTLE_MS = 380;

/**
 * The card's two-line heading, in both states: "Link your calendar to / see
 * upcoming events" before, "Calendar linked / see upcoming events" after.
 * Transitions.dev "Texts reveal": at rest it carries `.is-shown` from the
 * first paint, so nothing animates. With `reveal` it mounts without it,
 * commits that start state with one reflow, then adds it, which plays the
 * staggered entrance. `hiding` is the snippet's quiet 200ms fade.
 */
const CalendarHeading: React.FC<{ line1: string; line2: string; reveal?: boolean; hiding?: boolean }> = ({ line1, line2, reveal = false, hiding = false }) => {
    const { ref, shown } = useTextsReveal<HTMLHeadingElement>(reveal);
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
 * Before linking: a sample meeting where yours will be, the one the classic
 * backdrop (calender.png) had painted in (a Q2 roadmap review, two faces), now
 * drawn as ONE of the linked state's own banners, in the front banner's
 * place, so a sign-in swaps the sample for the real thing in place. One, not
 * a deck: the cards behind it crowded Connect calendar and competed with it.
 * The title is the
 * short form, which fits beside the tile whole. Its time is the next 4:30 pm,
 * so it never reads as a meeting that has passed. Decorative: hidden from screen readers, never under the pointer (no
 * pops), faces without photos (nothing is fetched for sample people), and it
 * leaves with the heading.
 */
const DEMO_ATTENDEES: CalendarAttendee[] = [{ email: '', name: 'Maya Reyes' }, { email: '', name: 'Ravi Lal' }];
const demoMeeting = (title: string, now: number): CalendarMeeting => {
    const start = new Date(now);
    start.setHours(16, 30, 0, 0);
    if (start.getTime() <= now + COUNTDOWN_MINUTES * 60_000) start.setDate(start.getDate() + 1);
    return { id: 'demo', title, startTime: start.toISOString(), endTime: new Date(start.getTime() + 45 * 60_000).toISOString(), attendees: DEMO_ATTENDEES };
};
const DemoMeetingStack: React.FC<{ hiding: boolean }> = ({ hiding }) => {
    const t = useT();
    const [now] = useState(() => Date.now());
    return (
        <div className={`cal-demo cal-link-exit${hiding ? ' is-hiding' : ''}`} aria-hidden="true">
            <div className="t-stack cal-stack h-[44px]">
                <div data-depth={0} className="t-stack-banner"><MeetingBanner meeting={demoMeeting(t('Q2 Roadmap Review'), now)} now={now} /></div>
            </div>
        </div>
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
    meetings: allMeetings = [],
    totalCount,
    loading = false,
    className = '',
}) => {
    const t = useT();
    const { lang } = useLanguage();

    // A sign-in that just completed. The consent screen is in the browser, so
    // when it finishes the user is still there: the card holds "Link your
    // calendar to" until the Natively window has focus again, gives the eye a
    // beat, fades the heading (200ms), and only then shows the linked card,
    // where "Calendar linked" reveals. The host is told at once, so it
    // connects and fetches the meetings while the user is away. The launch
    // status check connects silently: nothing to celebrate.
    //   none ── fresh sign-in ──▶ waiting ── window focused + beat ──▶ hiding ── 200ms ──▶ none
    const [linkHold, setLinkHold] = useState<'none' | 'waiting' | 'hiding'>('none');
    // A refused sign-in's message is showing under Connect calendar.
    const [connectError, setConnectError] = useState(false);
    const [revealLinkedHeading, setRevealLinkedHeading] = useState(false);
    const handleConnected = (info: { fresh: boolean }) => {
        if (info.fresh) {
            setRevealLinkedHeading(true);
            setLinkHold('waiting');
        }
        onConnect?.(info);
    };
    useEffect(() => {
        if (linkHold === 'none') return;
        let timer: number | undefined;
        if (linkHold === 'hiding') {
            timer = window.setTimeout(() => setLinkHold('none'), prefersReducedMotion() ? 0 : HEADING_HIDE_MS);
            return () => window.clearTimeout(timer);
        }
        const back = () => { timer = window.setTimeout(() => setLinkHold('hiding'), RETURN_BEAT_MS); };
        if (document.hasFocus()) back();
        else window.addEventListener('focus', back, { once: true });
        return () => {
            window.removeEventListener('focus', back);
            window.clearTimeout(timer);
        };
    }, [linkHold]);
    const showLinked = isConnected && linkHold === 'none';
    const now = useNow(showLinked && allMeetings.length > 0);
    const meetings = allMeetings.filter((m) => new Date(m.startTime).getTime() + STARTED_GRACE_MS > now);
    const { entries, stackRef } = useMeetingStack(meetings, showLinked, revealLinkedHeading && !prefersReducedMotion() ? STACK_AFTER_HEADING_MS : 0);

    const upcomingCount = Math.max(0, (totalCount ?? allMeetings.length) - (allMeetings.length - meetings.length));
    // The heading: "Calendar linked" for the moment of linking, while the first
    // fetch is out, and for an empty week (the deck's front says so); a summary
    // once there are meetings. Switching to the summary replays the heading's
    // reveal; a card that mounts on the summary (notes closed, say) just shows it.
    const summary = !loading && meetings.length > 0 ? linkedSummary(meetings[0], upcomingCount, now, lang, t) : null;
    const headingKind = summary ? 'summary' : 'status';
    const firstHeadingKind = useRef(headingKind);
    const latestById = new Map(meetings.map((m) => [m.id, m]));
    // Hover pops one card up out of the deck: the card whose edge is under
    // the pointer rises from its own place until it reads above the card in
    // front of it, keeping its place in the deck's layering. The cards behind
    // it rise with it, so their edges keep peeking above it and every card
    // stays reachable, and the cards in front of it sink a little to make
    // room. A popped card stays up while the pointer is on it.
    // Geometry, not :hover: a card that moves under the pointer would drop
    // and pop in a loop. The hit test walks the deck front to back using where
    // each card is drawn now, the same geometry the CSS (`.is-popped`,
    // `.is-raised`, `.is-parted`) draws: each card owns the band from its top
    // edge down to the top edge of the card in front of it.
    const [picked, setPicked] = useState<string | null>(null);
    const [settling, setSettling] = useState(false);
    useEffect(() => {
        if (!settling) return;
        const timer = window.setTimeout(() => setSettling(false), PICK_SETTLE_MS);
        return () => window.clearTimeout(timer);
    }, [settling]);
    // A four-deep deck, popped from the middle, rises into the heading: it
    // gives way (fades) while that is so.
    const [headingCovered, setHeadingCovered] = useState(false);
    const headerRef = useRef<HTMLDivElement>(null);
    // Every card at rest pops, placeholder slots included: a gap in the deck
    // says so when hovered rather than ignoring the pointer.
    const pickable = entries.filter((e) => e.phase === 'rest');
    const pickableKeys = pickable.map((e) => e.key).join('\n');
    useEffect(() => {
        if (picked && !pickableKeys.split('\n').includes(picked)) setPicked(null);
    }, [picked, pickableKeys]);
    const pickedDepth = pickable.find((p) => p.key === picked)?.depth ?? null;
    const trackPick = (e: React.PointerEvent) => {
        const stack = stackRef.current;
        if (!stack) return;
        const r = stack.getBoundingClientRect();
        const { clientX: x, clientY: y } = e;
        // Lengths from CSS are layout px; the rect is on-screen px. Scale them
        // by what separates the two (an ancestor's transform or zoom, like the
        // Launcher's recede when meeting notes open), or the zones drift away
        // from the cards.
        const k = r.height / (stack.offsetHeight || r.height);
        const geom = readDeckGeometry(stack, r.bottom, r.height, k);
        const deepest = Math.max(0, ...entries.filter((en) => en.phase !== 'leaving').map((en) => en.depth));
        const sinkOf = (pd: number | null) => (pd ? geom.sink : 0);
        const topOf = (j: number, pd: number | null) => deckTop(geom, j, pd);
        let key: string | null = null;
        if (x >= r.left && x <= r.right) {
            // Front to back; the deepest card also takes PICK_OVERSHOOT_PX
            // above its edge: a thin target shouldn't need precision.
            for (let j = 0; j <= deepest; j++) {
                const top = topOf(j, pickedDepth) - (j === deepest ? PICK_OVERSHOOT_PX * k : 0);
                const bottom = j === 0 ? r.bottom + sinkOf(pickedDepth) : topOf(j - 1, pickedDepth);
                if (y >= top && y < bottom) {
                    key = pickable.find((p) => p.depth === j)?.key ?? null;
                    break;
                }
            }
        }
        if (key !== picked) {
            setPicked(key);
            const pd = pickable.find((p) => p.key === key)?.depth ?? null;
            const highest = Math.min(...Array.from({ length: deepest + 1 }, (_, j) => topOf(j, pd)));
            const header = headerRef.current?.getBoundingClientRect();
            setHeadingCovered(!!header && highest < header.bottom);
        }
    };
    const releasePick = () => {
        if (picked) {
            setPicked(null);
            setSettling(true);
        }
        if (headingCovered) setHeadingCovered(false);
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
            {showLinked ? (
                // Distinct keys on the two states: both are a div whose first
                // child holds a CalendarHeading, so without them React reuses
                // the "Link your calendar to" heading, still mid-fade, as the
                // "Calendar linked" one, and the reveal can only fade in.
                <div
                    key="linked"
                    className="relative z-10 w-full flex flex-col h-full px-3.5 pt-3.5 pb-3"
                    onPointerMove={trackPick}
                    onPointerLeave={releasePick}
                >
                    {/* The heading 30.5px down (14px layer padding + 16.5px); the
                        deck pinned to the bottom, its front card 12px off the edge
                        (pb-3), as it always sat. A popped third card stops ~25px
                        under the heading. */}
                    <div
                        ref={headerRef}
                        className={`cal-stack-header relative flex justify-center text-center pt-[16.5px]${headingCovered ? ' is-covered' : ''}`}
                    >
                        <CalendarHeading
                            key={headingKind}
                            line1={summary ? summary.line1 : t('Calendar linked')}
                            line2={summary ? summary.line2 : t('see upcoming events')}
                            reveal={revealLinkedHeading || headingKind !== firstHeadingKind.current}
                        />
                    </div>

                    {/* The three soonest meetings as a banner stack, soonest in
                        front: always three deep. Entries stay in a fixed order;
                        depth is data-depth. */}
                    <div
                        ref={stackRef}
                        className={`t-stack cal-stack mt-auto h-[44px]${picked || settling ? ' is-picking' : ''}${pickedDepth ? ` pop-${pickedDepth}` : ''}`}
                    >
                        {entries.map((entry) => {
                            const slot = isSlotKey(entry.key);
                            const meeting = slot ? null : (latestById.get(entry.key) ?? entry.item);
                            return (
                                <div
                                    key={entry.key}
                                    data-depth={entry.depth}
                                    className={`t-stack-banner${slot ? ' cal-filler' : ''}${entry.phase === 'enter' ? ' is-enter' : ''}${entry.phase === 'leaving' ? ' is-leaving' : ''}${entry.key === picked ? ' is-popped' : ''}${pickedDepth && entry.phase === 'rest' && entry.depth > pickedDepth ? ' is-raised' : ''}${pickedDepth && entry.phase === 'rest' && entry.depth < pickedDepth ? ' is-parted' : ''}`}
                                >
                                    {meeting
                                        ? <MeetingBanner meeting={meeting} now={now} />
                                        : <SlotBanner front={entry.key === 'slot:0'} loading={loading} />}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <div key="linking" className="relative z-10 w-full flex flex-col items-center h-full pt-6 text-center">
                    {/* The sample steps aside for a refused sign-in's message, which
                        needs the room under the button; it comes back when the
                        message clears. */}
                    <DemoMeetingStack hiding={linkHold === 'hiding' || connectError} />
                    {/* Connect calendar sits centred between the heading (ends at
                        70.3px) and the sample banner (starts at 142px): 17.85px
                        either side of its 36px. */}
                    <div className="relative z-[1] mb-[17.85px]">
                        <CalendarHeading
                            line1={t('Link your calendar to')}
                            line2={t('see upcoming events')}
                            hiding={linkHold === 'hiding'}
                        />
                    </div>

                    {/* Leaves with the heading, on the same quiet 200ms fade. */}
                    <div className={`relative z-[1] cal-link-exit${linkHold === 'hiding' ? ' is-hiding' : ''}`}>
                        <ConnectCalendarButton
                            className="-translate-x-0.5"
                            onConnect={handleConnected}
                            onErrorChange={setConnectError}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default UpcomingCalendarCard;
