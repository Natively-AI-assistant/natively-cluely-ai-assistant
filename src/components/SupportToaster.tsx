// src/components/SupportToaster.tsx
//
// "Support the developer" invitation.
//
// Presentational: the onboarding orchestrator decides when it opens
// (OrchestratedToasterHost), and on dismiss the host records the showing with
// DonationManager so the cooldown starts.
//
// Same two-pane composition as the browser-extension card, so the onboarding
// set reads as one family: the words on a flat ground on the left, the image
// in its own inset panel on the right. The heart in the image carries all of
// the card's colour; the type and the button stay neutral.
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, ArrowRight } from 'lucide-react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import supportArt from '../../assets/support.png';

const SUPPORT_URL = 'https://buymeacoffee.com/evinjohnn';

// Returning to the app after this long from the support page is taken as a
// donation, and the card retires itself.
const PRESUMED_DONATION_MS = 20_000;

// ─── Tokens ────────────────────────────────────────────────────
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';

/*
  Ink per ground, measured rather than estimated (see the contrast test):

    dark  #1C1C1E   strong 15.2  body 8.0  quiet 5.4  faint 4.9
    light #F7F8FC   strong 17.8  body 6.5  quiet 6.0  faint 4.6

  "faint" is the decline, which is a control, so it has to clear 4.5:1 even
  while staying the quietest thing on the card. Identical to the extension
  card's sets on purpose: the two sit next to each other in the same flow.
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

interface SupportToasterProps {
  isOpen: boolean;
  onDismiss: () => void;
  className?: string;
}

export const SupportToaster: React.FC<SupportToasterProps> = ({ isOpen, onDismiss, className }) => {
  const [plateHover, setPlateHover] = useState(false);
  const [ctaActive, setCtaActive]   = useState(false);
  const [ctaPressed, setCtaPressed] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const isLight = useResolvedTheme() === 'light';
  const INK = isLight ? INK_LIGHT : INK_DARK;

  // When the user left for the support page. Set on click, read on refocus.
  const clickTimeRef = useRef<number | null>(null);

  // Coming back after a while from the support page is treated as a donation.
  useEffect(() => {
    const handleFocus = async () => {
      if (clickTimeRef.current === null) return;
      const elapsed = Date.now() - clickTimeRef.current;
      clickTimeRef.current = null;
      if (elapsed > PRESUMED_DONATION_MS) {
        await window.electronAPI?.setDonationComplete?.();
        onDismiss();
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [onDismiss]);

  // Escape closes it, like every other card in the onboarding set.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onDismiss]);

  // Reset transient interaction state whenever the card closes.
  useEffect(() => {
    if (!isOpen) { setPlateHover(false); setCtaActive(false); setCtaPressed(false); }
  }, [isOpen]);

  const handleSupport = () => {
    clickTimeRef.current = Date.now();
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(SUPPORT_URL);
    } else {
      window.open(SUPPORT_URL, '_blank');
    }
  };

  const item = reduced ? ITEM_REDUCED : ITEM;
  const ctaDur = ctaActive ? CTA_IN : CTA_OUT;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="support-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: EASE_FM as any }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
            // Dims, never blurs (3a9901ae4): frosting the whole launcher
            // behind the card left it unreadable.
            background: isLight ? 'rgba(10,10,18,0.30)' : 'rgba(0,0,0,0.80)',
          }}
          onClick={e => { if (e.target === e.currentTarget) onDismiss(); }}
        >
          <motion.div
            key="support-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-toast-title"
            aria-describedby="support-toast-desc"
            className={className}
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
              // one, so it sits on the app in both themes. No coloured
              // border: a red outline is how an error is drawn, not a thank-you.
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
            <div style={{ display: 'flex', alignItems: 'stretch', minHeight: '400px' }}>
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
                  Support Natively
                </motion.div>

                {/*
                  Light weight at display size, as on the extension card. The
                  size steps down from 44px because "Used by thousands." is
                  the longer line and has to hold on one line in the column.
                */}
                <motion.h2 variants={item} id="support-toast-title" style={{
                  fontSize: '34px', fontWeight: 300,
                  letterSpacing: '-0.032em', lineHeight: 1.08,
                  margin: '0 0 20px', color: INK.strong,
                }}>
                  Built by one.
                  <br />
                  Used by thousands.
                </motion.h2>

                <motion.p variants={item} id="support-toast-desc" style={{
                  fontSize: '13.5px', lineHeight: 1.55, letterSpacing: '-0.008em',
                  color: INK.body, margin: 0, maxWidth: '300px',
                  textWrap: 'pretty',
                } as React.CSSProperties}>
                  Natively is built and maintained by one developer. If it's part
                  of your daily workflow, your support keeps it moving forward.
                </motion.p>

                {/* marginTop: auto pins the action row to the bottom of the
                    column however short the copy above it runs. */}
                <motion.div variants={item} style={{
                  marginTop: 'auto', paddingTop: '34px',
                  display: 'flex', alignItems: 'center', gap: '22px', flexWrap: 'wrap',
                }}>
                  {/*
                    Outlined, matching the extension card. Hover strengthens the
                    outline and label, adds a faint fill and moves the arrow
                    3px; press compresses the whole button.
                  */}
                  <button
                    type="button"
                    onClick={handleSupport}
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
                      cursor: 'pointer',
                      fontFamily: FONT,
                      fontSize: '13px', fontWeight: 500, letterSpacing: '-0.01em',
                      color: ctaActive ? INK.strong : (isLight ? 'rgba(11,16,32,0.84)' : 'rgba(255,255,255,0.88)'),
                      transform: ctaPressed && !reduced ? 'scale(0.97)' : 'none',
                      transition:
                        `border-color ${ctaDur}ms ${EASE_CSS}, background-color ${ctaDur}ms ${EASE_CSS},`
                        + ` color ${ctaDur}ms ${EASE_CSS}, transform 120ms ${EASE_CSS}`,
                    }}
                  >
                    <span>Support the Builder</span>
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
                    onClick={onDismiss}
                    style={{
                      background: 'none', border: 0, padding: '9px 0',
                      cursor: 'pointer', fontFamily: FONT,
                      fontSize: '13px', fontWeight: 500, letterSpacing: '-0.008em',
                      color: INK.faint,
                      transition: `color 200ms ${EASE_CSS}`,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = INK.body)}
                    onMouseLeave={e => (e.currentTarget.style.color = INK.faint)}
                    onFocus={e => (e.currentTarget.style.color = INK.body)}
                    onBlur={e => (e.currentTarget.style.color = INK.faint)}
                  >
                    Maybe later
                  </button>
                </motion.div>
              </motion.div>

              <div style={{ flex: '0 0 40%', padding: '8px 8px 8px 0', display: 'flex' }}>
                <div style={{
                  position: 'relative', flex: 1,
                  borderRadius: '14px', overflow: 'hidden',
                  background: '#EDF0F5',
                  boxShadow: isLight ? 'inset 0 0 0 1px rgba(11,16,32,0.07)' : 'none',
                }}>
                  {/* The image. A slow push-in scoped to the panel, so the
                      heart breathes while the column holds still. */}
                  <div aria-hidden style={{
                    position: 'absolute', inset: 0,
                    backgroundImage: `url(${supportArt})`,
                    backgroundSize: 'cover',
                    backgroundPosition: '88% 50%',
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
                    onClick={onDismiss}
                    aria-label="Close"
                    style={{
                      position: 'absolute', top: '8px', right: '8px', zIndex: 2,
                      width: '30px', height: '30px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: 0, cursor: 'pointer',
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
