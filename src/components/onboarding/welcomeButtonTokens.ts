// src/components/onboarding/welcomeButtonTokens.ts
//
// The onboarding CTA's Liquid Glass colours ("Get started" / "Start using
// Natively", variant="lavender"), per theme. Its own module so a surface that
// wants the same button (Settings › Process Disguise's selected tile) reads
// them without importing welcomeShared's video and card assets.

export const WELCOME_BUTTON_TOKENS = {
  // The PR's light button (a pale tint with a deep label — white on it would
  // run about 1.3:1) in the toggle's blue, so light and dark are one hue.
  // The label #3F2593 on the ~#CED8F7 composite is about 6:1.
  light: {
    '--lg-lav-bg': 'rgba(124,92,255,0.28)',
    '--lg-lav-hover': 'rgba(124,92,255,0.40)',
    '--lg-lav-fg': '#3F2593',
    '--lg-rim-2': 'rgba(124,92,255,0.32)',
    '--lg-rim-3': 'rgba(124,92,255,0.14)',
    '--lg-lens-rim-soft': 'rgba(124,92,255,0.28)',
    '--lg-lav-glow': 'rgba(124,92,255,0.42)',
    '--lg-lav-under': 'rgba(63,37,147,0.14)',
    '--lg-lav-drop': 'rgba(63,37,147,0.10)',
  },
  // The PR's glass on a dark page, in the Usage question card's blue: the
  // Settings toggle's ON colour, --toggle-on #7C5CFF (--bubble-user-bg). The
  // tint is full strength so the button IS that colour rather than a muddy
  // translucent version of it; the sheen, edge and glow are the PR's own.
  // White on it is 3.28:1 — the same owner-accepted trade-off as the card.
  dark: {
    '--lg-lav-bg': '#7C5CFF',
    '--lg-lav-hover': '#8B6EFF',
    '--lg-lav-fg': '#FFFFFF',
    '--lg-lav-rim': 'rgba(255,255,255,0.30)',
    '--lg-lav-glow': 'rgba(124,92,255,0.55)',
  },
} as const;
