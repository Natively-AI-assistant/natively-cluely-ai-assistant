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
        {/* The bubble. 20x18 rather than a letterbox 20x15: the neighbours
            (Shield, Cpu, Headphones) fill nearly the whole 24 grid vertically,
            so a short wide bubble read as a visibly smaller icon in the row. */}
        <rect x="2" y="3" width="20" height="18" rx="5" />
        {/* Reply hook resolving into a forward chevron. Sized from a 20px
            A/B: a tighter hook merges into a blob at the size it is actually
            rendered, and dropping the hook for a plain chevron reads as a
            media "skip" button rather than a reply. */}
        <path d="M7.5 8.5v3a2 2 0 0 0 2 2h4.5" />
        <path d="M12.8 11.3 15.2 13.5l-2.4 2.2" />
    </svg>
);
