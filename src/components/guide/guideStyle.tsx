// First-run guide: the accent and the status dot the floating card
// (GuideCard.tsx) uses. The overlay and notes window draw their steps with
// their own components (OverlayBanner; the notes window's raised pill).
import React from 'react';

export const GUIDE_ACCENT = '#7C5CFF';
export const guideAccentText = (dark: boolean) => (dark ? '#B9A6FF' : '#6A4FE0');

export const GuideStatusDot: React.FC<{ dark: boolean; label: string; done?: boolean }> = ({ dark, label, done }) => (
  <span
    role="status"
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 500,
      color: done ? (dark ? '#8EE3AE' : '#1E8A4C') : guideAccentText(dark),
    }}
  >
    <i style={{ width: 6, height: 6, borderRadius: 3, background: done ? '#2FB866' : GUIDE_ACCENT, boxShadow: done ? undefined : '0 0 0 4px rgba(124,92,255,.18)' }} />
    {label}
  </span>
);
