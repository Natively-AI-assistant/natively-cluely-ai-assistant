import React from 'react';
import { useT } from '../../i18n';
import calender from '../../UI_comp/calender.png';
import ConnectCalendarButton from './ConnectCalendarButton';

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
    /** Called once the connect flow succeeds (or to optimistically flip state). */
    onConnect?: () => void;
    /** Upcoming meetings, soonest-first. Only the first 3 are ever shown. */
    meetings?: CalendarMeeting[];
    /** Total upcoming meeting count, for the "+N more" pill. Defaults to meetings.length. */
    totalCount?: number;
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

// Front-most (soonest) meeting sits highest at rest; hover bumps past all of these (see hover:z-40).
const STACK_Z_CLASSES = ['z-30', 'z-20', 'z-10'];

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

/**
 * "Link your calendar to see upcoming events" hero card — soft-orchid-tinted
 * calendar backdrop, connect CTA when disconnected, stacked peek of the
 * next few meetings once connected. Pixel-matched to the Launcher card,
 * but self-contained so it can be dropped anywhere real meeting data needs
 * to be shown (props-driven, no Launcher-specific state/hooks).
 */
const UpcomingCalendarCard: React.FC<UpcomingCalendarCardProps> = ({
    isConnected,
    onConnect,
    meetings = [],
    totalCount,
    className = '',
}) => {
    const t = useT();

    const visibleMeetings = meetings.slice(0, 3);
    const moreMeetingsCount = Math.max(0, (totalCount ?? meetings.length) - visibleMeetings.length);

    const CARD_HEIGHT = 56;
    const CARD_OFFSET = 16;
    const stackHeight = visibleMeetings.length > 0
        ? (visibleMeetings.length - 1) * CARD_OFFSET + CARD_HEIGHT
        : 0;

    return (
        <div className={`rounded-xl overflow-hidden bg-bg-elevated relative flex flex-col shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)] ${className}`}>
            {/* Backdrop image with soft-orchid tint mask */}
            <div className="absolute inset-0">
                <img
                    src={calender}
                    alt=""
                    className="w-full h-full object-cover scale-105 translate-y-[1px]"
                />
                {/* Soft orchid tint mask — only when connected, washes the calendar image into the brand orchid */}
                {isConnected && (
                    <>
                        <div className="absolute inset-0 bg-[#6b4574]/55 mix-blend-multiply" />
                        <div className="absolute inset-0 bg-gradient-to-b from-[#9a5fa8]/25 via-[#7a4f8a]/20 to-[#3d2245]/35" />
                        {/* Soft top-glow */}
                        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-[260px] h-[200px] bg-[#e0b3e6]/20 blur-[80px] pointer-events-none" />
                    </>
                )}
                {/* Subtle grain */}
                <div
                    className="absolute inset-0 opacity-[0.05] mix-blend-overlay pointer-events-none"
                    style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>\")" }}
                />
            </div>

            {/* Content Layer */}
            {isConnected ? (
                <div className="relative z-10 w-full flex flex-col h-full px-3.5 pt-3.5 pb-3">
                    {/* Header — simple label replacing the old title + "Calendar Connected" pill */}
                    <div className="flex items-center justify-between px-0.5">
                        <h3 className="text-[12.5px] font-semibold text-white/75 uppercase tracking-wider">
                            {t('Upcoming events')}
                        </h3>
                        {moreMeetingsCount > 0 && (
                            <span className="text-[10.5px] font-semibold text-white/45 tabular-nums">
                                +{moreMeetingsCount} {t('more')}
                            </span>
                        )}
                    </div>

                    {/* Stacked meeting cards — hover an individual card to lift it and reveal its name */}
                    {visibleMeetings.length > 0 ? (
                        <div className="relative mt-auto" style={{ height: stackHeight }}>
                            {visibleMeetings.map((m, i) => {
                                const attendees = (m.attendees || []).slice(0, 3);
                                const remainingAttendees = Math.max(0, (m.attendees?.length || 0) - attendees.length);
                                // Static stacking order via Tailwind classes (NOT inline style — an inline
                                // `zIndex` would win the cascade over `hover:z-40` and the hover lift would
                                // never actually rise above its neighbors).
                                const zIndexClass = STACK_Z_CLASSES[i] || 'z-0';
                                return (
                                    <div
                                        key={m.id}
                                        className={`group absolute inset-x-0 rounded-[14px] bg-white/[0.07] ring-1 ring-white/[0.1] backdrop-blur-md px-3.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_8px_20px_-10px_rgba(0,0,0,0.55)] transition-all duration-300 ease-out hover:z-40 hover:-translate-y-2 hover:bg-white/[0.13] hover:ring-white/[0.18] ${zIndexClass}`}
                                        style={{ top: i * CARD_OFFSET, height: CARD_HEIGHT }}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-[11px] text-cyan-200/80 font-medium tabular-nums">
                                                {formatTimeLabel(m.startTime)}
                                            </span>
                                            {attendees.length > 0 && (
                                                <div className="flex -space-x-1.5 opacity-70 transition-opacity duration-300 group-hover:opacity-100">
                                                    {attendees.map((a, ai) => {
                                                        const attendeeIdentity = (a.email || a.name || '').trim();
                                                        const attendeeKey = a.email ? `email:${a.email}` : `${attendeeIdentity || 'attendee'}:${ai}`;
                                                        return (
                                                            <span
                                                                key={attendeeKey}
                                                                title={a.name || a.email}
                                                                className={`inline-flex items-center justify-center w-[16px] h-[16px] rounded-full ring-[1.5px] ring-[#2b1a33] text-[7.5px] font-bold ${colorFor(attendeeIdentity || String(ai))}`}
                                                            >
                                                                {initialsFor(a)}
                                                            </span>
                                                        );
                                                    })}
                                                    {remainingAttendees > 0 && (
                                                        <span className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full ring-[1.5px] ring-[#2b1a33] bg-white/15 text-[7.5px] font-bold text-white/85 tabular-nums">
                                                            +{remainingAttendees}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        {/* Name is hidden until this specific card is hovered — it then lifts and reveals its title */}
                                        <h4 className="text-[13px] font-semibold text-white leading-tight tracking-[-0.01em] line-clamp-1 mt-1 opacity-0 -translate-y-0.5 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-y-0">
                                            {m.title}
                                        </h4>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center">
                            <span className="text-[13px] text-white/50 font-medium">{t('No upcoming events')}</span>
                        </div>
                    )}
                </div>
            ) : (
                <div className="relative z-10 w-full flex flex-col items-center h-full pt-6 text-center">
                    <h3 className="text-[19px] leading-tight mb-4 tracking-[-0.01em]">
                        <span className="block font-semibold text-white">{t('Link your calendar to')}</span>
                        <span className="block font-medium text-white/60 text-[0.95em]">{t('see upcoming events')}</span>
                    </h3>

                    <ConnectCalendarButton
                        className="-translate-x-0.5"
                        onConnect={onConnect}
                    />
                </div>
            )}
        </div>
    );
};

export default UpcomingCalendarCard;
