// src/components/onboarding/BrowserExtensionIcon.tsx
//
// Shared SVG icon used by both BrowserExtensionToaster (hero) and
// PhoneMirrorSettings (browser-extension section). Replaces the generic
// lucide <Puzzle /> which read as "AI/missing piece" rather than
// "browser extension install".
//
// Reads instantly as the same affordance Chrome uses in its own
// extension install UI: a simplified browser frame with traffic lights,
// address bar, and a puzzle-piece extension snapping into the body.
import React from 'react';

interface Props {
  color: string;
  size?: number;
  className?: string;
}

export const BrowserExtensionIcon: React.FC<Props> = ({ color, size = 16, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={className}
    style={{ display: 'block', flexShrink: 0 }}
  >
    {/* Browser frame */}
    <rect x="4" y="10" width="56" height="44" rx="7" stroke={color} strokeWidth="2.4" />
    {/* Toolbar divider */}
    <line x1="4" y1="22" x2="60" y2="22" stroke={color} strokeWidth="2" opacity="0.7" />
    {/* Traffic lights */}
    <circle cx="11"  cy="16" r="2.4" fill={color} opacity="0.55" />
    <circle cx="18.5" cy="16" r="2.4" fill={color} opacity="0.35" />
    <circle cx="26"  cy="16" r="2.4" fill={color} opacity="0.2" />
    {/* Address bar */}
    <rect x="34" y="12.5" width="22" height="7" rx="3.5" stroke={color} strokeWidth="1.6" opacity="0.45" />
    {/* Extension puzzle piece — centered in body */}
    <path
      d="M32 35 C32 32.5 30 30.5 27.5 30.5 L27.5 27 L23 27 C23.6 25.5 22.5 23.5 20.5 23.5 C18.5 23.5 17.4 25.5 18 27 L13.5 27 L13.5 31 C15 30.4 17 31.5 17 33.5 C17 35.5 15 36.6 13.5 36 L13.5 40 L18 40 C17.4 41.5 18.5 43.5 20.5 43.5 C22.5 43.5 23.6 41.5 23 40 L27.5 40 L27.5 36.5 C30 36.5 32 34.5 32 32 L35 32 L35 35 Z"
      stroke={color}
      strokeWidth="2"
      strokeLinejoin="round"
      fill={color}
      fillOpacity="0.12"
    />
  </svg>
);

export default BrowserExtensionIcon;
