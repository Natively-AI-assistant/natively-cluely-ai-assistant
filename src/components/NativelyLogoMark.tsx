import React from 'react';

/**
 * Natively logomark — "N" letterform inscribed in a circle.
 * Rendered as inline SVG so it inherits `color` (currentColor) and
 * can be styled freely with className.
 *
 * The exact master geometry (brand/natively-mark-*.svg): one filled
 * path, ring + uprights + diagonal all one width (68/1024), cropped to the ring.
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
            d="M512 106 A406 406 0 1 1 512 918 A406 406 0 1 1 512 106 Z M512 174 A338 338 0 1 0 512 850 A338 338 0 1 0 512 174 Z M288 192.77 H356 V831.23 H288 Z M668 192.77 H736 V831.23 H668 Z M271.30 207 L352.62 207 L752.70 817 L671.38 817 Z"
        />
    </svg>
);
