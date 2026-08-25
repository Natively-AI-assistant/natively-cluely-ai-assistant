import React from 'react';

/**
 * Auto Answer mark — a speech bubble whose reply hook resolves into a forward
 * chevron: "the reply arrives on its own".
 *
 * Drawn in the lucide idiom so it sits correctly beside its neighbours in
 * Settings › General (Shield, Headphones, Cpu, …): a 24-unit viewBox, no fill,
 * `currentColor` strokes at width 2, round caps and joins. The first cut was a
 * filled bubble with the glyph knocked out, which read as a heavy black slab
 * next to seven outline icons.
 *
 * Nothing here depends on a theme token: outline strokes inherit `color` from
 * the row exactly like every lucide icon does, so both palettes work for free.
 */
export const AutoAnswerIcon: React.FC<{
    size?: number;
    className?: string;
}> = ({ size = 20, className = '' }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
    >
        {/* The bubble */}
        <rect x="2" y="4" width="20" height="15" rx="4" />
        {/* Reply hook resolving into a forward chevron. Sized from a 20px
            A/B: a tighter hook merges into a blob at the size it is actually
            rendered, and dropping the hook for a plain chevron reads as a
            media "skip" button rather than a reply. */}
        <path d="M7 8.6v1.9a2 2 0 0 0 2 2h4.6" />
        <path d="M12.4 10.6 14.9 12.5l-2.5 1.9" />
    </svg>
);
