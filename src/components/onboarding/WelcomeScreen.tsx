// src/components/onboarding/WelcomeScreen.tsx
//
// First-launch welcome. Fills the launcher window once, on a fresh install,
// between the logo splash and the launcher; App.tsx decides when (see
// src/lib/onboarding/welcomeGate.mjs). "Get started" hands over to the launcher,
// where the permissions card follows as usual.
//
// Left: the N mark (black on light, as-is white on dark), the pitch and one
// lavender liquid-glass action. Right: the Natively overlay answering over a
// live call (meeting.webm, the old welcome's hero video). The card is a still
// of the website's liquid-glass NativelyInterfaceCard with a grey body,
// captured per theme on a TRANSPARENT ground, so the app ships no second copy
// of the website's glass renderer. Its frost is real: a backdrop-filter layer
// sits exactly under the card's panel and blurs the playing video through it.
//
// Window chrome: the launcher is frameless on Windows and hidden-inset on
// macOS, and this screen replaces the launcher's own header. So it carries a
// drag strip across the top, and WindowControls, which renders nothing on
// macOS where the native traffic lights sit in that strip instead.

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import nativelyMark from '../../assets/logo.webp';
import cardLight from '../../assets/welcome/card-light.webp';
import cardDark from '../../assets/welcome/card-dark.webp';
import meetingVideo from '../../assets/welcome/meeting.webm';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import WindowControls from '../WindowControls';

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';

// Ink as the onboarding cards measure it on each ground.
const THEME = {
  light: {
    bg: '#F7F8FC', strong: '#0B1020', body: 'rgba(11,16,32,0.68)', quiet: 'rgba(11,16,32,0.66)', faint: 'rgba(11,16,32,0.58)',
    plate: '#EEF1F8', grid: 'rgba(11,16,32,0.035)', card: cardLight, markFilter: 'invert(1)',
    button: {},
  },
  dark: {
    // A step under the #232327 plate, so the plate still reads as inset.
    bg: '#161618', strong: '#F2F2F4', body: 'rgba(255,255,255,0.66)', quiet: 'rgba(255,255,255,0.56)', faint: 'rgba(255,255,255,0.50)',
    plate: '#232327', grid: 'rgba(255,255,255,0.035)', card: cardDark, markFilter: 'none',
    // The same glass on a dark page: a thicker tint, a light label, a softer rim.
    button: {
      '--lg-lav-bg': 'rgba(156,111,243,0.34)',
      '--lg-lav-hover': 'rgba(156,111,243,0.46)',
      '--lg-lav-fg': '#F4EEFF',
      '--lg-lav-rim': 'rgba(255,255,255,0.30)',
      '--lg-lav-glow': 'rgba(124,77,230,0.60)',
    },
  },
} as const;

// The captured card's geometry, in CSS px: 520 wide, 340 tall, and its glass
// panel (below the pill) starting 48px down, 292px tall with a 24px radius.
// The blur layer must match it exactly or the frost shows past the glass.
const CARD = { w: 520, h: 340, panelTop: 48, panelH: 292, radius: 24 };
// How far the call tucks up under the card, as in the approved design.
const CALL = { w: 520, tuck: 150 };

const TERMS_URL = 'https://natively.software/termsandconditions';
const PRIVACY_URL = 'https://natively.software/privacy';

interface Props {
  onGetStarted: () => void;
}

export const WelcomeScreen: React.FC<Props> = ({ onGetStarted }) => {
  const t = THEME[useResolvedTheme()];
  const reduced = useReducedMotion() ?? false;
  const rise = (delay: number) => (reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2, delay } }
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay, ease: [0.23, 1, 0.32, 1] as const } });

  const openLink = (url: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    window.electronAPI?.openExternal?.(url);
  };

  return (
    <div
      role="main"
      aria-labelledby="welcome-title"
      className="relative h-full w-full flex select-none"
      style={{ background: t.bg, color: t.strong, fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}
    >
      {/* Drag strip; the controls opt back out of it. */}
      <div className="drag-region absolute inset-x-0 top-0 h-[40px] z-10 flex justify-end">
        <div className="no-drag"><WindowControls /></div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col items-center text-center" style={{ padding: '64px 72px 48px' }}>
        <div className="my-auto flex flex-col items-center" style={{ gap: 22 }}>
          <motion.img {...rise(0.05)} src={nativelyMark} alt="Natively" draggable={false}
            style={{ width: 60, height: 60, filter: t.markFilter }} />
          <motion.div {...rise(0.1)} style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-0.005em', color: t.quiet }}>
            Welcome to Natively
          </motion.div>
          <motion.h1 {...rise(0.14)} id="welcome-title"
            style={{ margin: 0, fontSize: 56, fontWeight: 300, letterSpacing: '-0.035em', lineHeight: 1.04, color: t.strong }}>
            Real-time help,<br />in every meeting.
          </motion.h1>
          <motion.p {...rise(0.18)}
            style={{ margin: 0, maxWidth: 400, fontSize: 16, lineHeight: 1.6, letterSpacing: '-0.008em', color: t.body }}>
            Natively listens along, answers the question in front of you, and can stay hidden from screen sharing.
          </motion.p>
          <motion.div {...rise(0.24)} style={{ marginTop: 16 }}>
            <LiquidGlassButton
              variant="lavender"
              className="lg-sm lg-wide"
              onClick={onGetStarted}
              style={{
                width: 320,
                // lg-sm's box is a 30px settings row; this CTA is 48px.
                ['--lg-pill-h' as string]: '48px',
                ['--lg-label-size' as string]: '15px',
                ...t.button,
              } as React.CSSProperties}
            >
              <span className="inline-flex items-center gap-2">Get started <ArrowRight size={15} strokeWidth={2} aria-hidden /></span>
            </LiquidGlassButton>
          </motion.div>
        </div>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: t.faint }}>
          By continuing, you agree to our{' '}
          <a href={TERMS_URL} onClick={openLink(TERMS_URL)} className="underline underline-offset-2" style={{ color: 'inherit' }}>Terms &amp; Conditions</a>
          {' '}and{' '}
          <a href={PRIVACY_URL} onClick={openLink(PRIVACY_URL)} className="underline underline-offset-2" style={{ color: 'inherit' }}>Privacy Policy</a>.
        </p>
      </div>

      <div className="h-full flex" style={{ flex: '0 0 50%', maxWidth: 600, padding: '12px 12px 12px 0', boxSizing: 'border-box' }}>
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, delay: 0.08, ease: [0.23, 1, 0.32, 1] }}
          className="relative flex-1 overflow-hidden flex flex-col items-center justify-center"
          style={{
            borderRadius: 22, background: t.plate,
            backgroundImage: `linear-gradient(${t.grid} 1px, transparent 1px), linear-gradient(90deg, ${t.grid} 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
          }}
        >
          {/* No filter/opacity on these wrappers once settled: either would make
              them a backdrop root and the blur below would stop seeing the call. */}
          <div className="relative" style={{ width: CARD.w, height: CARD.h, zIndex: 2 }}>
            <div
              aria-hidden
              className="absolute left-0"
              style={{
                top: CARD.panelTop, width: CARD.w, height: CARD.panelH, borderRadius: CARD.radius,
                WebkitBackdropFilter: 'blur(9px) saturate(1.6)', backdropFilter: 'blur(9px) saturate(1.6)',
                boxShadow: '0 24px 48px rgba(0,0,0,0.22)',
              }}
            />
            <img
              src={t.card}
              alt="The Natively overlay answering a question"
              draggable={false}
              className="absolute inset-0 block"
              style={{ width: CARD.w, height: CARD.h }}
            />
          </div>
          <div
            className="relative overflow-hidden"
            style={{
              zIndex: 1, width: CALL.w, aspectRatio: '16 / 9', marginTop: -CALL.tuck, borderRadius: 14,
              background: '#000', boxShadow: '0 16px 40px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.05)',
            }}
          >
            {/* Muted so it may autoplay; held on its first frame for reduced motion. */}
            <video
              src={meetingVideo}
              autoPlay={!reduced}
              muted
              loop
              playsInline
              preload="auto"
              aria-label="A video call with two participants"
              className="block h-full w-full"
              style={{ objectFit: 'cover' }}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
};
