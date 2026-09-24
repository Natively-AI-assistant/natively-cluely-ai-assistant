// src/components/trial/TrialPromoToaster.tsx
//
// Free-trial invitation.
//
// Presentational: the onboarding orchestrator decides when it opens (no key,
// no trial token, permissions already seen) and supplies the start and manual
// setup actions (OrchestratedToasterHost).
//
// Same two-pane family as the browser-extension, support and review cards:
// the words on a flat ground on the left, the image in its own inset panel on
// the right. The flower carries the card's colour; the type and the button
// stay neutral.

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, ArrowRight } from 'lucide-react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { TRIAL_FALLBACK_LIMITS, formatCompact } from '../../types/nativelyUsage';
import flowerArt from '../../../assets/flower.png';

// ─── Tokens ────────────────────────────────────────────────────
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';

/*
  Ink per ground, measured rather than estimated (see the contrast test):

    dark  #1C1C1E   strong 15.2  body 8.0  quiet 5.4  faint 4.9
    light #F7F8FC   strong 17.8  body 6.5  quiet 6.0  faint 4.6

  "faint" is the decline, which is a control, so it clears 4.5:1 too. The
  same sets as the other onboarding cards, which appear in the same flow.
*/
const INK_DARK = {
  strong: '#F2F2F4',
  body:   'rgba(255,255,255,0.66)',
  quiet:  'rgba(255,255,255,0.52)',
  faint:  'rgba(255,255,255,0.48)',
};
const INK_LIGHT = {
  strong: '#0B1020',
  body:   'rgba(11,16,32,0.68)',
  quiet:  'rgba(11,16,32,0.66)',
  faint:  'rgba(11,16,32,0.58)',
};

// One curve for every eased property, so all motion shares a temperament.
const EASE_CSS = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_FM  = [0.23, 1, 0.32, 1] as const;

// Panel zoom: the image pushes in under the pointer while the words hold
// still. Slow on purpose; it is an image breathing, not a control answering.
const PLATE_ZOOM     = 0.05;
const PLATE_ZOOM_IN  = 1100;
const PLATE_ZOOM_OUT = 700;

// CTA hover. The exit is quicker than the entrance.
const CTA_IN  = 420;
const CTA_OUT = 280;

// The close sits on the image panel, which is light in both themes.
const CLOSE_INK = { rest: 'rgba(11,16,32,0.34)', hover: 'rgba(11,16,32,0.92)' };

const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.14 } } };
const ITEM = {
  hidden: { opacity: 0, y: 10, filter: 'blur(4px)' },
  show:   { opacity: 1, y: 0,  filter: 'blur(0px)', transition: { duration: 0.6, ease: EASE_FM as any } },
};
const ITEM_REDUCED = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { duration: 0.3 } },
};

/*
  What the trial includes, stacked: amount above, feature below. Read from
  TRIAL_FALLBACK_LIMITS so the card can never promise more than the trial
  grants.
*/
const INCLUDED: { value: string; label: string }[] = [
  { value: formatCompact(TRIAL_FALLBACK_LIMITS.ai_tokens),       label: 'AI tokens' },
  { value: `${TRIAL_FALLBACK_LIMITS.stt_minutes} min`,           label: 'Transcription' },
  { value: String(TRIAL_FALLBACK_LIMITS.search_requests),        label: 'Research searches' },
];

interface Props {
  isOpen:         boolean;
  hasNativelyKey: boolean;
  hasTrialToken:  boolean;
  onDismiss:      () => void;
  onStartTrial:   () => Promise<void>;
  onManualSetup:  () => void;   // dismiss + open settings
}

export const TrialPromoToaster: React.FC<Props> = ({
  isOpen, hasNativelyKey: _hasNativelyKey, hasTrialToken: _hasTrialToken, onDismiss, onStartTrial, onManualSetup,
}) => {
  const [visible,    setVisible]    = useState(false);
  const [starting,   setStarting]   = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [plateHover, setPlateHover] = useState(false);
  const [ctaActive,  setCtaActive]  = useState(false);
  const [ctaPressed, setCtaPressed] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const isLight = useResolvedTheme() === 'light';
  const INK = isLight ? INK_LIGHT : INK_DARK;

  // The orchestrator has already gated on key, token and permissions; the
  // card just follows isOpen.
  useEffect(() => {
    setVisible(isOpen);
    if (!isOpen) { setPlateHover(false); setCtaActive(false); setCtaPressed(false); }
  }, [isOpen]);

  const handleDismiss = () => {
    setVisible(false);
    onDismiss();
  };

  // Escape closes it, like every other card in the onboarding set.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !starting) handleDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, starting]);

  const handleStartTrial = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      await onStartTrial();
      setVisible(false);
    } catch (e: any) {
      setError(e?.message || 'Could not start trial. Check your connection.');
      setStarting(false);
    }
  };

  const handleManual = () => {
    setVisible(false);
    onManualSetup();
  };

  const item = reduced ? ITEM_REDUCED : ITEM;
  const ctaDur = ctaActive ? CTA_IN : CTA_OUT;

  // AnimatePresence stays mounted and only its CHILDREN come and go. An
  // early `return null` above it would unmount the presence boundary with
  // the card, so the exit animation could never run.
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="trial-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: EASE_FM as any }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9998,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
            // Dims, never blurs (3a9901ae4): frosting the whole launcher
            // behind the card left it unreadable.
            background: isLight ? 'rgba(10,10,18,0.30)' : 'rgba(0,0,0,0.80)',
          }}
          onClick={e => { if (e.target === e.currentTarget && !starting) handleDismiss(); }}
        >
          <motion.div
            key="trial-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trial-toast-title"
            aria-describedby="trial-toast-desc"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 18, filter: 'blur(10px)' }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1,    y: 0,  filter: 'blur(0px)' }}
            exit={   reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 10, filter: 'blur(4px)', transition: { duration: 0.16 } }}
            transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.9 }}
            onPointerEnter={e => { if (!reduced && e.pointerType === 'mouse') setPlateHover(true); }}
            onPointerLeave={() => setPlateHover(false)}
            style={{
              position: 'relative',
              width: '600px', maxWidth: '100%',
              borderRadius: '20px',
              overflow: 'hidden',
              background: isLight ? '#F7F8FC' : '#1C1C1E',
              // A shadow on the light card and a light hairline on the dark
              // one, so it sits on the app in both themes.
              boxShadow: isLight
                ? 'inset 0 0 0 1px rgba(11,16,32,0.10),'
                  + ' inset 0 1px 0 rgba(255,255,255,0.80),'
                  + ' 0 30px 70px -28px rgba(16,24,40,0.40)'
                : 'inset 0 0 0 1px rgba(255,255,255,0.08),'
                  + ' inset 0 1px 0 rgba(255,255,255,0.06),'
                  + ' 0 40px 90px -30px rgba(0,0,0,0.85)',
              fontFamily: FONT,
              WebkitFontSmoothing: 'antialiased',
            } as React.CSSProperties}
          >
            <div style={{ display: 'flex', alignItems: 'stretch', minHeight: '440px' }}>
              <motion.div
                variants={STAGGER} initial="hidden" animate="show"
                style={{
                  position: 'relative', zIndex: 2,
                  flex: '1 1 58%', minWidth: 0,
                  padding: '40px 28px 34px 40px',
                  display: 'flex', flexDirection: 'column',
                }}
              >
                <motion.div variants={item} style={{
                  fontSize: '12px', fontWeight: 500, letterSpacing: '-0.005em',
                  color: INK.quiet, margin: '0 0 22px',
                }}>
                  Natively trial · 30 minutes free
                </motion.div>

                {/* Light weight at display size, as on the other cards. */}
                <motion.h2 variants={item} id="trial-toast-title" style={{
                  fontSize: '34px', fontWeight: 300,
                  letterSpacing: '-0.032em', lineHeight: 1.08,
                  margin: '0 0 20px', color: INK.strong,
                }}>
                  Try everything.
                  <br />
                  No card needed.
                </motion.h2>

                <motion.p variants={item} id="trial-toast-desc" style={{
                  fontSize: '13.5px', lineHeight: 1.55, letterSpacing: '-0.008em',
                  color: INK.body, margin: 0, maxWidth: '300px',
                  textWrap: 'pretty',
                } as React.CSSProperties}>
                  Full Natively API access for 30 minutes: AI chat, meeting
                  transcription and company research. Bound to this device.
                  No sign-in.
                </motion.p>

                <motion.dl variants={item} style={{
                  display: 'grid', gridTemplateColumns: 'repeat(3, auto)',
                  justifyContent: 'start', columnGap: '30px',
                  margin: '28px 0 0', padding: 0,
                }}>
                  {INCLUDED.map(({ value, label }) => (
                    <div key={label}>
                      <dt style={{
                        fontSize: '24px', fontWeight: 600, letterSpacing: '-0.03em',
                        color: INK.strong, lineHeight: 1,
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {value}
                      </dt>
                      <dd style={{
                        margin: '7px 0 0', fontSize: '12px', fontWeight: 500,
                        letterSpacing: '-0.004em', color: INK.quiet, lineHeight: 1.2,
                      }}>
                        {label}
                      </dd>
                    </div>
                  ))}
                </motion.dl>

                {/* marginTop: auto pins the action row to the bottom of the
                    column however short the copy above it runs. */}
                <motion.div variants={item} style={{ marginTop: 'auto', paddingTop: '32px' }}>
                  {error && (
                    <p role="alert" style={{
                      margin: '0 0 12px', fontSize: '12px', lineHeight: 1.45,
                      color: isLight ? '#B42318' : '#FCA5A5',
                    }}>
                      {error}
                    </p>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '22px', flexWrap: 'wrap' }}>
                    {/*
                      Outlined, matching the other cards. Hover strengthens the
                      outline and label, adds a faint fill and moves the arrow
                      3px; press compresses the whole button.
                    */}
                    <button
                      type="button"
                      onClick={handleStartTrial}
                      disabled={starting}
                      onPointerEnter={e => { if (e.pointerType === 'mouse') setCtaActive(true); }}
                      onPointerLeave={() => { setCtaActive(false); setCtaPressed(false); }}
                      onPointerDown={() => setCtaPressed(true)}
                      onPointerUp={() => setCtaPressed(false)}
                      onFocus={e => { if (e.currentTarget.matches(':focus-visible')) setCtaActive(true); }}
                      onBlur={() => setCtaActive(false)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '8px',
                        padding: '9px 14px',
                        borderRadius: '9px',
                        border: `1px solid ${isLight
                          ? (ctaActive ? 'rgba(11,16,32,0.46)' : 'rgba(11,16,32,0.22)')
                          : (ctaActive ? 'rgba(255,255,255,0.44)' : 'rgba(255,255,255,0.24)')}`,
                        background: isLight
                          ? (ctaActive ? 'rgba(11,16,32,0.04)' : 'rgba(11,16,32,0)')
                          : (ctaActive ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0)'),
                        outline: 'none',
                        cursor: starting ? 'progress' : 'pointer',
                        fontFamily: FONT,
                        fontSize: '13px', fontWeight: 500, letterSpacing: '-0.01em',
                        color: ctaActive ? INK.strong : (isLight ? 'rgba(11,16,32,0.84)' : 'rgba(255,255,255,0.88)'),
                        opacity: starting ? 0.55 : 1,
                        transform: ctaPressed && !reduced ? 'scale(0.97)' : 'none',
                        transition:
                          `border-color ${ctaDur}ms ${EASE_CSS}, background-color ${ctaDur}ms ${EASE_CSS},`
                          + ` color ${ctaDur}ms ${EASE_CSS}, opacity 200ms ${EASE_CSS}, transform 120ms ${EASE_CSS}`,
                      }}
                    >
                      <span>{starting ? 'Starting trial…' : 'Start free trial'}</span>
                      <ArrowRight
                        size={14} strokeWidth={1.9} aria-hidden
                        style={{
                          flex: 'none',
                          transform: ctaActive && !reduced ? 'translateX(3px)' : 'translateX(0)',
                          transition: `transform ${ctaDur}ms ${EASE_CSS}`,
                        }}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={handleManual}
                      disabled={starting}
                      style={{
                        background: 'none', border: 0, padding: '9px 0',
                        cursor: starting ? 'default' : 'pointer', fontFamily: FONT,
                        fontSize: '13px', fontWeight: 500, letterSpacing: '-0.008em',
                        color: INK.faint,
                        opacity: starting ? 0.5 : 1,
                        transition: `color 200ms ${EASE_CSS}`,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = INK.body)}
                      onMouseLeave={e => (e.currentTarget.style.color = INK.faint)}
                      onFocus={e => (e.currentTarget.style.color = INK.body)}
                      onBlur={e => (e.currentTarget.style.color = INK.faint)}
                    >
                      I'll set up manually
                    </button>
                  </div>
                </motion.div>
              </motion.div>

              <div style={{ flex: '0 0 40%', padding: '8px 8px 8px 0', display: 'flex' }}>
                <div style={{
                  position: 'relative', flex: 1,
                  borderRadius: '14px', overflow: 'hidden',
                  background: '#EEF1F8',
                  boxShadow: isLight ? 'inset 0 0 0 1px rgba(11,16,32,0.07)' : 'none',
                }}>
                  {/* The image. A slow push-in scoped to the panel, so the
                      flower breathes while the column holds still. */}
                  <div aria-hidden style={{
                    position: 'absolute', inset: 0,
                    backgroundImage: `url(${flowerArt})`,
                    backgroundSize: 'cover',
                    backgroundPosition: '90% 50%',
                    transform: plateHover ? `scale(${1 + PLATE_ZOOM})` : 'scale(1)',
                    transformOrigin: '70% 50%',
                    transition: reduced
                      ? undefined
                      : `transform ${plateHover ? PLATE_ZOOM_IN : PLATE_ZOOM_OUT}ms ${EASE_CSS}`,
                    willChange: reduced ? undefined : 'transform',
                    pointerEvents: 'none',
                  }} />

                  <button
                    type="button"
                    onClick={handleDismiss}
                    disabled={starting}
                    aria-label="Close"
                    style={{
                      position: 'absolute', top: '8px', right: '8px', zIndex: 2,
                      width: '30px', height: '30px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: 0, cursor: starting ? 'default' : 'pointer',
                      background: 'none', border: 0, borderRadius: '8px',
                      color: CLOSE_INK.rest,
                      transition: `color 180ms ${EASE_CSS}, transform 160ms ${EASE_CSS}`,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = CLOSE_INK.hover; }}
                    onMouseLeave={e => { e.currentTarget.style.color = CLOSE_INK.rest; e.currentTarget.style.transform = 'scale(1)'; }}
                    onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.92)'; }}
                    onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                  >
                    <X size={14} strokeWidth={2} color="currentColor" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
