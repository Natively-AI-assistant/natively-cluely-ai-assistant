// src/components/onboarding/welcomeShared.tsx
//
// What the first-launch screens (WelcomeScreen, ShortcutTour) share: the ink
// per theme, the window frame, the lavender CTA and the meeting demo on the
// right. One copy, so the two screens cannot drift apart.

import React, { useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion';
import cardLight from '../../assets/welcome/card-light.webp';
import cardDark from '../../assets/welcome/card-dark.webp';
import meetingVideo from '../../assets/welcome/meeting.webm';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import WindowControls from '../WindowControls';
import { DemoOverlay } from './DemoOverlay';
import './onboardingMotion.css';

export const WELCOME_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';

// Ink as the onboarding cards measure it on each ground.
const THEME = {
  light: {
    bg: '#F7F8FC', strong: '#0B1020', body: 'rgba(11,16,32,0.68)', quiet: 'rgba(11,16,32,0.66)', faint: 'rgba(11,16,32,0.58)',
    plate: '#EEF1F8', grid: 'rgba(11,16,32,0.09)', card: cardLight, markFilter: 'invert(1)',
    kcBg: '#FFFFFF', kcRim: 'rgba(11,16,32,0.14)', kcUnder: 'rgba(11,16,32,0.14)', dot: 'rgba(11,16,32,0.14)',
    // The PR's light button (a pale tint with a deep label — white on it would
    // run about 1.3:1) in the toggle's blue, so light and dark are one hue.
    // The label #2A44A6 on the ~#CED8F7 composite is about 6:1.
    button: {
      '--lg-lav-bg': 'rgba(102,136,245,0.28)',
      '--lg-lav-hover': 'rgba(102,136,245,0.40)',
      '--lg-lav-fg': '#2A44A6',
      '--lg-rim-2': 'rgba(102,136,245,0.32)',
      '--lg-rim-3': 'rgba(102,136,245,0.14)',
      '--lg-lens-rim-soft': 'rgba(102,136,245,0.28)',
      '--lg-lav-glow': 'rgba(102,136,245,0.42)',
      '--lg-lav-under': 'rgba(40,70,180,0.14)',
      '--lg-lav-drop': 'rgba(40,60,150,0.10)',
    },
  },
  dark: {
    // A step under the #232327 plate, so the plate still reads as inset.
    bg: '#161618', strong: '#F2F2F4', body: 'rgba(255,255,255,0.66)', quiet: 'rgba(255,255,255,0.56)', faint: 'rgba(255,255,255,0.50)',
    plate: '#232327', grid: 'rgba(255,255,255,0.035)', card: cardDark, markFilter: 'none',
    kcBg: 'rgba(255,255,255,0.07)', kcRim: 'rgba(255,255,255,0.16)', kcUnder: 'rgba(0,0,0,0.45)', dot: 'rgba(255,255,255,0.14)',
    // The PR's glass on a dark page, in the Usage question card's blue: the
    // Settings toggle's ON colour, --toggle-on #6688F5 (--bubble-user-bg). The
    // tint is full strength so the button IS that colour rather than a muddy
    // translucent version of it; the sheen, edge and glow are the PR's own.
    // White on it is 3.28:1 — the same owner-accepted trade-off as the card.
    button: {
      '--lg-lav-bg': '#6688F5',
      '--lg-lav-hover': '#7594F7',
      '--lg-lav-fg': '#FFFFFF',
      '--lg-lav-rim': 'rgba(255,255,255,0.30)',
      '--lg-lav-glow': 'rgba(102,136,245,0.55)',
    },
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
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, delay, ease: [0.23, 1, 0.32, 1] as const } });
}

// transitions.dev #08 page side-by-side: 250ms in, 8px, 3px blur,
// --ease-smooth-out. The exit is quicker and quieter (150ms) — a close should
// get out of the way (transitions-polish: open/close asymmetry). `dir` is +1
// going forward and -1 going back, so Next and Back travel opposite ways.
const SMOOTH = [0.22, 1, 0.36, 1] as const;

/** Direction-aware slide for whatever swaps in the left column. */
export function useSlideVariants(): Variants {
  const reduced = useReducedMotion() ?? false;
  if (reduced) {
    return {
      enter: { opacity: 0 },
      center: { opacity: 1, transition: { duration: 0.15 } },
      exit: { opacity: 0, transition: { duration: 0.1 } },
    };
  }
  return {
    enter: (dir: number) => ({ opacity: 0, x: 8 * dir, filter: 'blur(3px)' }),
    center: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.25, ease: SMOOTH } },
    exit: (dir: number) => ({ opacity: 0, x: -8 * dir, filter: 'blur(3px)', transition: { duration: 0.15, ease: SMOOTH } }),
  };
}

/** transitions.dev #04 text swap (150ms, 4px, 2px blur) for a label that changes in place. */
export function useTextSwap() {
  const reduced = useReducedMotion() ?? false;
  return reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.15 } }, exit: { opacity: 0, transition: { duration: 0.1 } } }
    : {
        initial: { opacity: 0, y: 4, filter: 'blur(2px)' },
        animate: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.15, ease: SMOOTH } },
        exit: { opacity: 0, y: -4, filter: 'blur(2px)', transition: { duration: 0.1, ease: SMOOTH } },
      };
}

/** transitions.dev #22 toast: 350ms up with a cross-blur, 250ms back down. */
function useToastMotion() {
  const reduced = useReducedMotion() ?? false;
  return reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.15 } }, exit: { opacity: 0, transition: { duration: 0.1 } } }
    : {
        initial: { opacity: 0, y: 16, scale: 0.97, filter: 'blur(2px)' },
        animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { duration: 0.35, ease: SMOOTH } },
        exit: { opacity: 0, y: 16, scale: 0.97, filter: 'blur(2px)', transition: { duration: 0.25, ease: SMOOTH } },
      };
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

/**
 * The CTA. Kept as ONE button across Next → Start using Natively: the width
 * tweens (transitions.dev #01 card resize, 250ms --ease-smooth-out) and the
 * label swaps in place (#04 text swap) instead of one button popping out for
 * another. Pass `labelKey` so a changed label animates.
 */
export const LavenderButton: React.FC<{ t: WelcomeTheme; width: number; height?: number; labelSize?: number; labelKey?: string; onClick: () => void; children: React.ReactNode }> = ({ t, width, height = 48, labelSize = 15, labelKey, onClick, children }) => {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.span
      className="inline-block"
      initial={false}
      animate={{ width }}
      transition={reduced ? { duration: 0 } : { duration: 0.25, ease: SMOOTH }}
      style={{ width }}
    >
      <LiquidGlassButton
        variant="lavender"
        className="lg-sm lg-wide"
        onClick={onClick}
        style={{
          width: '100%',
          // lg-sm's box is a 30px settings row; a CTA sets its own height.
          ['--lg-pill-h' as string]: `${height}px`,
          ['--lg-label-size' as string]: `${labelSize}px`,
          ...t.button,
        } as React.CSSProperties}
      >
        <span className="relative inline-flex items-center justify-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={labelKey ?? 'label'}
              className="inline-flex items-center gap-2"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4, filter: 'blur(2px)' }}
              // A beat behind the width (transitions-polish: delay to sequence, not to pad).
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.15, delay: reduced ? 0 : 0.08, ease: SMOOTH } }}
              exit={reduced ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, y: -4, filter: 'blur(2px)', transition: { duration: 0.1, ease: SMOOTH } }}
            >
              {children}
            </motion.span>
          </AnimatePresence>
        </span>
      </LiquidGlassButton>
    </motion.span>
  );
};

/** Keycaps for one shortcut: ['⌘', 'B'] → ⌘ + B. */
export const Keycaps: React.FC<{ t: WelcomeTheme; keys: string[]; size?: 'sm' | 'lg'; onDark?: boolean; pressed?: boolean }> = ({ t, keys, size = 'sm', onDark, pressed }) => {
  const big = size === 'lg';
  const cap: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
    minWidth: big ? 64 : 30, height: big ? 60 : 28, padding: big ? '0 16px' : '0 8px', borderRadius: big ? 14 : 7,
    fontSize: big ? 22 : 12.5, fontWeight: 600, letterSpacing: '-0.01em',
    color: onDark ? '#F2F2F4' : t.strong,
    background: onDark ? 'rgba(255,255,255,0.10)' : t.kcBg,
    border: `1px solid ${onDark ? 'rgba(255,255,255,0.18)' : t.kcRim}`,
    // The depth of the key is CSS (onboardingMotion.css) so a press can move it.
    ['--kc-under' as string]: onDark ? 'rgba(0,0,0,0.35)' : t.kcUnder,
    ['--kc-depth' as string]: big ? '3px' : '2px',
    ['--kc-press' as string]: big ? '2px' : '1px',
    ['--kc-drop-y' as string]: big ? '2px' : '1px',
    ['--kc-drop-blur' as string]: big ? '6px' : '2px',
  };
  const plus: React.CSSProperties = { fontSize: big ? 20 : 12, margin: big ? '0 10px' : '0 5px', color: onDark ? 'rgba(255,255,255,0.55)' : t.faint };
  return (
    <span className="inline-flex items-center" aria-label={keys.join(' + ')}>
      {keys.map((k, i) => (
        <React.Fragment key={`${k}-${i}`}>
          {i > 0 && <span aria-hidden style={plus}>+</span>}
          <kbd aria-hidden className="onb-keycap" data-pressed={pressed ? 'true' : undefined} style={{ ...cap, fontFamily: 'inherit' }}>{k}</kbd>
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
  const toast = useToastMotion();
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
        transition={{ duration: 0.5, delay: 0.08, ease: EASE }}
        className="relative flex-1 overflow-hidden flex flex-col items-center justify-center"
        style={{
          // backgroundColor, not the `background` shorthand: the shorthand resets
          // background-size, and the 40px grid below collapsed to one 1px edge line.
          borderRadius: 22, backgroundColor: t.plate,
          backgroundImage: `linear-gradient(${t.grid} 1px, transparent 1px), linear-gradient(90deg, ${t.grid} 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}
      >
        {/* One stage for both layers, so the call under them never moves when the
            still card gives way to the live overlay (they used to be two
            components, each mounting its own plate and restarting the video). The
            layers are absolute inside it and cross-fade: the card out in 150ms,
            the overlay in over 250ms (open/close asymmetry). Opacity here is
            transient — the frost re-reads the call the moment it settles. */}
        <div className="relative" style={{ width: CARD.w, height: CARD.h, zIndex: 2 }}>
          <AnimatePresence initial={false}>
            {live ? (
              // The overlay is laid out at its real 600px width and zoomed to fit
              // the plate (zoom, unlike transform, also shrinks its layout box).
              <motion.div
                key="live"
                className="absolute inset-x-0 top-0 flex justify-center"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: SMOOTH } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
              >
                <div style={{ zoom: 0.88 }}>
                  <DemoOverlay
                    isLight={isLight}
                    hidden={live.hidden}
                    answerKey={live.answerKey}
                    shotKey={live.shotKey}
                    captureFrame={captureFrame}
                    placeholderKeys={live.placeholderKeys}
                  />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="still"
                className="absolute left-0 top-0"
                style={{ width: CARD.w, height: CARD.h }}
                initial={false}
                exit={{ opacity: 0, transition: { duration: 0.15, ease: SMOOTH } }}
              >
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
              </motion.div>
            )}
          </AnimatePresence>
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

        <AnimatePresence>
          {live?.hidden && hiddenHint && (
            <motion.div
              key="hint"
              className="absolute inset-x-0 text-center"
              style={{ top: 108, fontSize: 13, fontWeight: 500, color: t.quiet }}
              {...toast}
            >
              {hiddenHint}
            </motion.div>
          )}
        </AnimatePresence>
        {/* The badge is centred by an OUTER static box, so the inner element's
            own transform is free for the toast motion. */}
        <div className="absolute inset-x-0 flex justify-center pointer-events-none" style={{ bottom: 22, zIndex: 3 }}>
          <AnimatePresence>
            {badge && (
              <motion.div
                key="badge"
                className="flex items-center"
                style={{
                  padding: '8px 10px', borderRadius: 14,
                  background: 'rgba(20,20,24,0.72)', WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
                }}
                {...toast}
              >
                {badge}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};
