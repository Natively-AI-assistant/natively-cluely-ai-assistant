import React from 'react';

/**
 * Natively logomark — "N" letterform inscribed in a circle.
 * Rendered as inline SVG so it inherits `color` (currentColor) and
 * can be styled freely with className.
 *
 * The exact master geometry (brand/natively-mark-*.svg): one filled
 * path, ring + uprights + diagonal all one width (75/1024), cropped to the ring.
 */
export const NativelyLogoMark: React.FC<{
    size?: number;
    className?: string;
}> = ({ size = 18, className = '' }) => (
    <svg
        width={size}
        height={size}
        viewBox="106 106 812 812"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
    >
        <path
            fill="currentColor"
            d="M512 106 A406 406 0 1 1 512 918 A406 406 0 1 1 512 106 Z M512 181 A331 331 0 1 0 512 843 A331 331 0 1 0 512 181 Z M288 194.91 H363 V829.09 H288 Z M661 194.91 H736 V829.09 H661 Z M269.75 211 L359.44 211 L754.25 813 L664.56 813 Z"
        />
    </svg>
);
