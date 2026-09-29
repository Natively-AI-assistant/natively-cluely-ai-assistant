// src/components/onboarding/welcomeShared.tsx
//
// What the first-launch screens (WelcomeScreen, ShortcutTour) share: the ink
// per theme, the window frame, the lavender CTA and the meeting demo on the
// right. One copy, so the two screens cannot drift apart.

import React, { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion';
import meetingVideo from '../../assets/welcome/meeting.webm';
import { useT } from '../../i18n';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import WindowControls from '../WindowControls';
import { DemoOverlay, DEMO_OVERLAY_WIDTH } from './DemoOverlay';
import { WELCOME_BUTTON_TOKENS } from './welcomeButtonTokens';
import './onboardingMotion.css';

export const WELCOME_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';

// Ink as the onboarding cards measure it on each ground.
const THEME = {
  light: {
    bg: '#F7F8FC', strong: '#0B1020', body: 'rgba(11,16,32,0.68)', quiet: 'rgba(11,16,32,0.66)', faint: 'rgba(11,16,32,0.58)',
    plate: '#EEF1F8', grid: 'rgba(11,16,32,0.09)', markFilter: 'invert(1)',
    kcBg: '#FFFFFF', kcRim: 'rgba(11,16,32,0.14)', kcUnder: 'rgba(11,16,32,0.14)', dot: 'rgba(11,16,32,0.14)',
    button: WELCOME_BUTTON_TOKENS.light,
  },
  dark: {
    // A step under the #232327 plate, so the plate still reads as inset.
    bg: '#161618', strong: '#F2F2F4', body: 'rgba(255,255,255,0.66)', quiet: 'rgba(255,255,255,0.56)', faint: 'rgba(255,255,255,0.50)',
    plate: '#232327', grid: 'rgba(255,255,255,0.035)', markFilter: 'none',
    kcBg: 'rgba(255,255,255,0.07)', kcRim: 'rgba(255,255,255,0.16)', kcUnder: 'rgba(0,0,0,0.45)', dot: 'rgba(255,255,255,0.14)',
    button: WELCOME_BUTTON_TOKENS.dark,
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

/**
 * Direction-aware slide for whatever swaps in the left column. `overlap` is for a
 * swap where the old page and the new one are on screen together (AnimatePresence
 * popLayout): the new page starts 90ms in, once the old is mostly gone, so the two
 * layouts never read as one muddy picture. Where the old page has finished leaving
 * first (mode="wait") there is nothing to sequence, so no delay.
 */
export function useSlideVariants(overlap = false): Variants {
  const reduced = useReducedMotion() ?? false;
  const delay = overlap ? 0.09 : 0;
  if (reduced) {
    return {
      enter: { opacity: 0 },
      center: { opacity: 1, transition: { duration: 0.15, delay } },
      exit: { opacity: 0, transition: { duration: 0.1 } },
    };
  }
  return {
    enter: (dir: number) => ({ opacity: 0, x: 8 * dir, filter: 'blur(3px)' }),
    center: { opacity: 1, x: 0, filter: 'blur(0px)', transition: { duration: 0.25, delay, ease: SMOOTH } },
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
 * The CTA. Kept as ONE button across Next → Start using Natively, and it fits its
 * label: with no `width` it measures the label (a hidden copy, same font) and
 * tweens to that width plus padding, so it grows and shrinks with the text
 * (transitions.dev #01 card resize: 250ms --duration-fast, --ease-smooth-out, the
 * same both ways because it is one reversible motion) while the label swaps in
 * place (#04 text swap). Pass `width` only for a fixed hero (the welcome's
 * Get started). Pass `labelKey` so a changed label animates.
 */
export const LavenderButton: React.FC<{ t: WelcomeTheme; width?: number; height?: number; labelSize?: number; labelKey?: string; onClick: () => void; children: React.ReactNode }> = ({ t, width, height = 48, labelSize = 15, labelKey, onClick, children }) => {
  const reduced = useReducedMotion() ?? false;
  const measureRef = useRef<HTMLSpanElement>(null);
  // Side padding scales with the button: 22px at 40 tall, 26px at 48.
  const padX = Math.round(height * 0.55);
  const [fit, setFit] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (width != null) return;
    const measure = () => {
      const el = measureRef.current;
      if (el) setFit(Math.ceil(el.getBoundingClientRect().width) + padX * 2);
    };
    measure();
    // The label's font may arrive after first paint; measure again when it does.
    let live = true;
    document.fonts?.ready.then(() => { if (live) measure(); });
    return () => { live = false; };
  }, [width, labelKey, labelSize, padX]);

  // Until the first measurement lands (a single layout pass, before paint) use a
  // width that cannot clip: the button's own 16px padding plus a roomy label.
  const w = width ?? fit ?? 132;
  return (
    <motion.span
      className="inline-block"
      initial={false}
      animate={{ width: w }}
      transition={reduced ? { duration: 0 } : { duration: 0.25, ease: SMOOTH }}
      style={{ width: w }}
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
          {/* The label at its natural width, invisible: what the button fits. */}
          <span ref={measureRef} aria-hidden className="inline-flex items-center gap-2 absolute pointer-events-none whitespace-nowrap" style={{ visibility: 'hidden' }}>
            {children}
          </span>
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

// The stage (the overlay over the call) is drawn at full size and zoomed as one
// piece, so the overlay, the call and the gap between them keep their proportions
// at every window size. STAGE_LOOK is how large it reads at the launcher's default
// window: 0.88 leaves ~51px of plate either side of the overlay (18px at 1.0).
// Past the default the stage grows with the plate, so a larger window is not a
// small demo lost in a big grid.
const STAGE_LOOK = 0.88;
// The plate at the launcher's default window (1200 wide, locked aspect): what
// STAGE_LOOK was tuned against.
const PLATE_AT_DEFAULT = { w: 588, h: 776 };
const SCALE_RANGE = { min: 0.5, max: 1.6 } as const;
// The call is 528px wide at full size. The overlay is a little WIDER than it
// (OVERHANG each side): the overlay is the subject, the call is what it sits over.
const VIDEO_W = 528;
const OVERHANG = 12;
const OVERLAY_ZOOM = (VIDEO_W + OVERHANG * 2) / DEMO_OVERLAY_WIDTH;
// The stage the overlay sits in (fixed, so the call under it never moves), and how
// far the call tucks up under it.
const STAGE = { w: 520, h: 340, tuck: 136 };
// The stage sits this much above the plate's centre, closer to the top than to the
// keystroke badge along the bottom.
const LIFT = 40;
const EASE = [0.23, 1, 0.32, 1] as const;

/** The stage's zoom for a plate of this size. */
function stageScale(w: number, h: number): number {
  const fit = Math.min(w / PLATE_AT_DEFAULT.w, h / PLATE_AT_DEFAULT.h);
  return STAGE_LOOK * Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, fit));
}

/** What drives the demo overlay: the tour's presses. */
export interface LiveOverlayProps {
  hidden: boolean;
  answerKey: number;
  shotKey: number;
  placeholderKeys: string[];
}

export interface MeetingDemoProps {
  t: WelcomeTheme;
  /** What the overlay is doing. On the welcome it rests: nothing pressed, nothing hidden. */
  live: LiveOverlayProps;
  /** Shown in the overlay's place while it is hidden. */
  hiddenHint?: React.ReactNode;
  /** A keystroke badge along the bottom edge. */
  badge?: React.ReactNode;
}

/**
 * The right-hand plate: the app's own meeting overlay over a live call
 * (meeting.webm). The overlay is DemoOverlay — the real overlay's classes and
 * appearance, and the real RollingTranscript strip — frosting the call behind it.
 * On the welcome it rests; the tour drives it with the shortcuts it teaches.
 */
export const MeetingDemo: React.FC<MeetingDemoProps> = ({ t, live, hiddenHint, badge }) => {
  const reduced = useReducedMotion() ?? false;
  const toast = useToastMotion();
  const isLight = useResolvedTheme() === 'light';
  const videoRef = useRef<HTMLVideoElement>(null);
  const tr = useT();

  // Follow the plate: the launcher window resizes, and the stage with it.
  const plateRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(STAGE_LOOK);
  useLayoutEffect(() => {
    const el = plateRef.current;
    if (!el) return;
    const fit = () => {
      if (el.clientWidth && el.clientHeight) setScale(stageScale(el.clientWidth, el.clientHeight));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
    <div className="h-full flex" style={{ flex: '0 0 50%', padding: '12px 12px 12px 0', boxSizing: 'border-box' }}>
      <motion.div
        ref={plateRef}
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
          // Centred, so the partial boxes at the left and right edges are the same
          // width (from 0 the plate ended on a sliver: 588px is 14.7 cells).
          backgroundPosition: '50% 0',
        }}
      >
        {/* One stage, one overlay for the whole flow: the app's own overlay
            (DemoOverlay, built from the same classes and the real RollingTranscript),
            frosting the call behind it. On the welcome it simply rests on its
            opening conversation; the tour drives it. It never remounts, so the
            call video under it keeps playing. `zoom`, unlike transform, also
            shrinks the layout box, so the plate centres what it will show. */}
        <div className="relative flex flex-col items-center" style={{ zoom: scale, paddingBottom: LIFT * 2 }}>
          <div className="relative" style={{ width: STAGE.w, height: STAGE.h, zIndex: 2 }}>
            <div className="absolute inset-x-0 top-0 flex justify-center">
              {/* The overlay is laid out at its real width and zoomed to sit a little wider than the call. */}
              <div style={{ zoom: OVERLAY_ZOOM }}>
                <DemoOverlay
                  isLight={isLight}
                  hidden={live.hidden}
                  answerKey={live.answerKey}
                  shotKey={live.shotKey}
                  captureFrame={captureFrame}
                  placeholderKeys={live.placeholderKeys}
                />
              </div>
            </div>
          </div>
          <div className="relative" style={{ zIndex: 1, width: VIDEO_W, marginTop: -STAGE.tuck }}>
            <div
              className="relative overflow-hidden"
              style={{
                aspectRatio: '16 / 9', borderRadius: 14,
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
                aria-label={tr('A video call with two participants')}
                className="block h-full w-full"
                style={{ objectFit: 'cover' }}
              />
            </div>
            {/* Where the overlay was: a beat above the call it hides over. The
                outer box centres it, so the inner one's transform is free for the
                toast motion; it may run wider than the call (other languages). */}
            <div className="absolute flex justify-center pointer-events-none" style={{ left: -60, right: -60, bottom: '100%', marginBottom: 20 }}>
              <AnimatePresence>
                {live.hidden && hiddenHint && (
                  <motion.div key="hint" className="text-center" style={{ fontSize: 13, fontWeight: 500, color: t.quiet }} {...toast}>
                    {hiddenHint}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

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
