import React from 'react';

/**
 * Profile Intelligence mark — a person built from two circles: a solid head
 * over middle-tone shoulders, the shoulders cut back round the head and
 * scooped out underneath.
 *
 * Drawn in the Modes glyph's idiom (Launcher header): a 14-unit viewBox,
 * filled `currentColor` shapes, one part faded. The shoulders sit at 0.55
 * rather than the Modes tile's 0.35: at 0.35 a whole torso faded into the
 * background and the mark read as a lone dot.
 */
export const ProfileIntelligenceIcon: React.FC<{
    size?: number;
    className?: string;
}> = ({ size = 18, className = '' }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 14 14"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
    >
        <circle cx="7" cy="3.5" r="2.8" fill="currentColor" opacity="0.9" />
        <path
            d="M1.486 13.5A5.9 5.9 0 0 1 4.381 6.113A3.7 3.7 0 0 0 9.619 6.113A5.9 5.9 0 0 1 12.514 13.5A8.288 8.288 0 0 0 1.486 13.5Z"
            fill="currentColor"
            opacity="0.55"
        />
    </svg>
);
