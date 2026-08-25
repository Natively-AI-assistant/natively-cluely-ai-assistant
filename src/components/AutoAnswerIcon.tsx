import React from 'react';

/**
 * Auto Answer mark — a speech bubble whose tail turns into a play/forward
 * chevron: "the reply arrives on its own".
 *
 * The bubble is filled with `currentColor` and the glyph is knocked OUT of it,
 * so the knockout has to be the colour of whatever the bubble sits on. That is
 * `--bg-item-surface` (the settings row's own tile), which flips per theme
 * — #27272A dark, #EAECEF light — and keeps the glyph readable in both. A
 * fixed dark knockout would disappear into the bubble in light mode.
 *
 * Rendered inline so it inherits `color` exactly like the lucide icons it sits
 * beside, and takes the same `size` prop.
 */
export const AutoAnswerIcon: React.FC<{
    size?: number;
    className?: string;
}> = ({ size = 20, className = '' }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
    >
        {/* The bubble */}
        <rect x="12" y="22" width="76" height="54" rx="13" fill="currentColor" />
        {/* Reply hook, knocked out */}
        <path
            d="M36 36 V46 Q36 54 44 54 H60"
            stroke="var(--bg-item-surface, #14161C)"
            strokeWidth="7"
            strokeLinecap="round"
        />
        {/* …resolving into a forward chevron */}
        <path
            d="M53 47 L62 54 L53 61"
            stroke="var(--bg-item-surface, #14161C)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);
