// src/components/onboarding/welcomeShared.tsx
//
// What the first-launch screens (WelcomeScreen, ShortcutTour) share: the ink
// per theme, the window frame, the lavender CTA and the meeting demo on the
// right. One copy, so the two screens cannot drift apart.

import React, { useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import cardLight from '../../assets/welcome/card-light.webp';
import cardDark from '../../assets/welcome/card-dark.webp';
import meetingVideo from '../../assets/welcome/meeting.webm';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { LiquidGlassCta } from '../../ui-components/LiquidGlassCta';
import WindowControls from '../WindowControls';
import { DemoOverlay } from './DemoOverlay';

export const WELCOME_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';

// Ink as the onboarding cards measure it on each ground.
const THEME = {
  light: {
    bg: '#F7F8FC', strong: '#0B1020', body: 'rgba(11,16,32,0.68)', quiet: 'rgba(11,16,32,0.66)', faint: 'rgba(11,16,32,0.58)',
    plate: '#EEF1F8', grid: 'rgba(11,16,32,0.035)', card: cardLight, markFilter: 'invert(1)',
    kcBg: '#FFFFFF', kcRim: 'rgba(11,16,32,0.14)', kcUnder: 'rgba(11,16,32,0.14)', dot: 'rgba(11,16,32,0.14)',
  },
  dark: {
    // A step under the #232327 plate, so the plate still reads as inset.
    bg: '#161618', strong: '#F2F2F4', body: 'rgba(255,255,255,0.66)', quiet: 'rgba(255,255,255,0.56)', faint: 'rgba(255,255,255,0.50)',
    plate: '#232327', grid: 'rgba(255,255,255,0.035)', card: cardDark, markFilter: 'none',
    kcBg: 'rgba(255,255,255,0.07)', kcRim: 'rgba(255,255,255,0.16)', kcUnder: 'rgba(0,0,0,0.45)', dot: 'rgba(255,255,255,0.14)',
  },
} as const;

export type WelcomeTheme = (typeof THEME)['light'] | (typeof THEME)['dark'];

export function useWelcomeTheme(): WelcomeTheme {
  return THEME[useResolvedTheme()];
}

/** Staggered entrance for the left column; a plain fade under reduced motion. */
export function useRise() {
  const reduced = useReducedMotion() ?? false;
  return (delay: number) => (reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2, delay } }
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay, ease: [0.23, 1, 0.32, 1] as const } });
}

/**
 * The full-window frame. The launcher is frameless on Windows and hidden-inset
 * on macOS, and these screens replace its header, so they carry a drag strip
 * and WindowControls (which renders nothing on macOS, where the native traffic
 * lights sit in that strip).
 */
export const WelcomeFrame: React.FC<React.HTMLAttributes<HTMLDivElement> & { t: WelcomeTheme }> = ({ t, children, style, className, ...rest }) => (
  <div
    {...rest}
    className={`relative h-full w-full flex select-none ${className ?? ''}`}
    style={{ background: t.bg, color: t.strong, fontFamily: WELCOME_FONT, WebkitFontSmoothing: 'antialiased', ...style }}
  >
    <div className="drag-region absolute inset-x-0 top-0 h-[40px] z-10 flex justify-end">
      <div className="no-drag"><WindowControls /></div>
    </div>
    {children}
  </div>
);

export const LavenderButton: React.FC<{ width: number; height?: number; labelSize?: number; onClick: () => void; children: React.ReactNode }> = (props) => (
  <LiquidGlassCta {...props} />
);

/** Keycaps for one shortcut: ['⌘', 'B'] → ⌘ + B. */
export const Keycaps: React.FC<{ t: WelcomeTheme; keys: string[]; size?: 'sm' | 'lg'; onDark?: boolean }> = ({ t, keys, size = 'sm', onDark }) => {
  const big = size === 'lg';
  const cap: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
    minWidth: big ? 64 : 30, height: big ? 60 : 28, padding: big ? '0 16px' : '0 8px', borderRadius: big ? 14 : 7,
    fontSize: big ? 22 : 12.5, fontWeight: 600, letterSpacing: '-0.01em',
    color: onDark ? '#F2F2F4' : t.strong,
    background: onDark ? 'rgba(255,255,255,0.10)' : t.kcBg,
    border: `1px solid ${onDark ? 'rgba(255,255,255,0.18)' : t.kcRim}`,
    boxShadow: `inset 0 ${big ? -3 : -2}px 0 ${onDark ? 'rgba(0,0,0,0.35)' : t.kcUnder}, 0 ${big ? 2 : 1}px ${big ? 6 : 2}px rgba(0,0,0,0.14)`,
  };
  const plus: React.CSSProperties = { fontSize: big ? 20 : 12, margin: big ? '0 10px' : '0 5px', color: onDark ? 'rgba(255,255,255,0.55)' : t.faint };
  return (
    <span className="inline-flex items-center" aria-label={keys.join(' + ')}>
      {keys.map((k, i) => (
        <React.Fragment key={`${k}-${i}`}>
          {i > 0 && <span aria-hidden style={plus}>+</span>}
          <kbd aria-hidden style={{ ...cap, fontFamily: 'inherit' }}>{k}</kbd>
        </React.Fragment>
      ))}
    </span>
  );
};

// The captured card's geometry, in CSS px: 520 wide, 340 tall, and its glass
// panel (below the pill) starting 48px down, 292px tall with a 24px radius.
// The blur layer must match it exactly or the frost shows past the glass.
const CARD = { w: 520, h: 340, panelTop: 48, panelH: 292, radius: 24 };
// How far the call tucks up under the overlay.
const CALL = { w: 520, tuck: 150 };
const EASE = [0.23, 1, 0.32, 1] as const;

/** The tour drives a working overlay (DemoOverlay) instead of the still card. */
export interface LiveOverlayProps {
  hidden: boolean;
  answerKey: number;
  shotKey: number;
  placeholderKeys: string[];
}

export interface MeetingDemoProps {
  t: WelcomeTheme;
  /** Omitted: the still liquid-glass card (the welcome). Set: the live overlay. */
  live?: LiveOverlayProps;
  /** Shown in the overlay's place while it is hidden. */
  hiddenHint?: React.ReactNode;
  /** A keystroke badge along the bottom edge. */
  badge?: React.ReactNode;
}

/**
 * The right-hand plate: the Natively overlay over a live call (meeting.webm).
 *
 * Still (the welcome): a still of the website's liquid-glass
 * NativelyInterfaceCard with a grey body, captured on a TRANSPARENT ground per
 * theme. Its frost is real: a backdrop-filter layer sits exactly under the
 * card's panel and blurs the playing call through it.
 *
 * Live (the shortcut tour): DemoOverlay, the in-meeting overlay's own parts,
 * reacting to the shortcuts as the real one does.
 */
export const MeetingDemo: React.FC<MeetingDemoProps> = ({ t, live, hiddenHint, badge }) => {
  const reduced = useReducedMotion() ?? false;
  const isLight = useResolvedTheme() === 'light';
  const videoRef = useRef<HTMLVideoElement>(null);

  // The demo "screenshot": the call's current frame. The video is a bundled,
  // same-origin asset, so the canvas is never tainted.
  const captureFrame = (): string | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = Math.round(480 * v.videoHeight / v.videoWidth);
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    try { return c.toDataURL('image/jpeg', 0.82); } catch { return null; }
  };

  return (
    <div className="h-full flex" style={{ flex: '0 0 50%', maxWidth: 600, padding: '12px 12px 12px 0', boxSizing: 'border-box' }}>
      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.7, delay: 0.08, ease: EASE }}
        className="relative flex-1 overflow-hidden flex flex-col items-center justify-center"
        style={{
          borderRadius: 22, background: t.plate,
          backgroundImage: `linear-gradient(${t.grid} 1px, transparent 1px), linear-gradient(90deg, ${t.grid} 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}
      >
        {live ? (
          // The overlay is laid out at its real 600px width and zoomed to fit
          // the plate (zoom, unlike transform, also shrinks its layout box).
          <div className="relative" style={{ zIndex: 2, zoom: 0.88 }}>
            <DemoOverlay
              isLight={isLight}
              hidden={live.hidden}
              answerKey={live.answerKey}
              shotKey={live.shotKey}
              captureFrame={captureFrame}
              placeholderKeys={live.placeholderKeys}
            />
          </div>
        ) : (
          // No filter or opacity on this wrapper: either would make it a
          // backdrop root and the blur below would stop seeing the call.
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
        )}
        <div
          className="relative overflow-hidden"
          style={{
            zIndex: 1, width: CALL.w, aspectRatio: '16 / 9', marginTop: -CALL.tuck, borderRadius: 14,
            background: '#000', boxShadow: '0 16px 40px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.05)',
          }}
        >
          {/* Muted so it may autoplay; held on its first frame for reduced motion. */}
          <video
            ref={videoRef}
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

        {live?.hidden && hiddenHint && (
          <div className="absolute inset-x-0 text-center" style={{ top: 108, fontSize: 13, fontWeight: 500, color: t.quiet }}>
            {hiddenHint}
          </div>
        )}
        {badge && (
          <div
            className="absolute flex items-center"
            style={{
              left: '50%', bottom: 22, transform: 'translateX(-50%)', padding: '8px 10px', borderRadius: 14,
              background: 'rgba(20,20,24,0.72)', WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)',
              boxShadow: '0 10px 30px rgba(0,0,0,0.35)', zIndex: 3,
            }}
          >
            {badge}
          </div>
        )}
      </motion.div>
    </div>
  );
};
