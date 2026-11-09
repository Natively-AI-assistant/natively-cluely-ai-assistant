// src/components/onboarding/DemoVideoToaster.tsx
//
// "Watch the full setup & demo" card: the 9-minute film on YouTube.
//
// An onboarding card (src/lib/cards/cardPolicy.mjs): the orchestrator raises it
// after the Plans card (stageCatalog.ts) and the card ledger decides when it
// may come back. Opening the film from the Welcome screen or Setup & Help
// retires it too (src/lib/demoVideo.ts), so nobody is asked twice.
//
// The film opens in the browser (electronAPI.openExternal, https on macOS and
// Windows alike), never inside the app. The thumbnail ships with the app, so
// nothing loads from YouTube until the user asks.
//
// The review card's size and build (ReviewModal): it pours out of the bottom
// of the window (GenieModal), 600 × 420, the words on a flat ground on the
// left and the film's thumbnail in its own inset panel on the right, one
// outlined action and a quiet "Not now".
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { X, ArrowRight, Play } from 'lucide-react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { GenieModal } from '../ui/GenieModal';
// The YouTube thumbnail recomposed for this portrait panel (232 × 458, drawn at
// 3×). Source: natively-launch/films6/thumb/launcher-card.html, the same
// world as the video's own thumbnail (yt-final.html), so the link feels continuous.
import demoVideoCardArt from '../../assets/demo-video-card.jpg';
import { DEMO_VIDEO_URL } from '../../lib/demoVideo';

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';

// The browser-extension card's measured ink (see BrowserExtensionToaster).
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

const EASE_CSS = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_FM  = [0.23, 1, 0.32, 1] as const;

const SHADOW_LIGHT = '0 30px 70px -28px rgba(16,24,40,0.40)';
const SHADOW_DARK  = '0 40px 90px -30px rgba(0,0,0,0.85)';

// The picture pushes in slowly under the pointer; the play button answers fast.
const PLATE_ZOOM     = 0.04;
const PLATE_ZOOM_IN  = 1100;
const PLATE_ZOOM_OUT = 700;
const CTA_IN  = 420;
const CTA_OUT = 280;

const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.04, delayChildren: 0.3 } } };
const ITEM = {
  hidden: { opacity: 0, y: 12, filter: 'blur(3px)' },
  show:   { opacity: 1, y: 0,  filter: 'blur(0px)', transition: { duration: 0.5, ease: EASE_FM as any } },
};
const ITEM_REDUCED = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { duration: 0.3 } },
};

interface Props {
  isOpen:    boolean;
  /** Why it closed, for the host's card ledger: 'acted' once the film opened, else nothing. */
  onDismiss: (reason?: 'acted') => void;
}

export const DemoVideoToaster: React.FC<Props> = ({ isOpen, onDismiss }) => {
  const [opening, setOpening]       = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [plateHover, setPlateHover] = useState(false);
  const [ctaActive, setCtaActive]   = useState(false);
  const [ctaPressed, setCtaPressed] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const isLight = useResolvedTheme() === 'light';
  const INK = isLight ? INK_LIGHT : INK_DARK;

  // Starts closed, so the first thing the card does is pour out.
  const [visible, setVisible] = useState(false);
  useEffect(() => { setVisible(isOpen); }, [isOpen]);

  // The orchestrator unmounts this the moment it hears "dismissed", so every
  // way out closes the card first (the genie) and reports from onClosed.
  const afterCloseRef = useRef<(() => void) | null>(null);
  const closeThen = useCallback((after: () => void) => {
    if (afterCloseRef.current) return;
    afterCloseRef.current = after;
    setVisible(false);
  }, []);

  // ✕, Escape, backdrop and "Not now" are a "later": the ledger counts it.
  const handleDismiss = useCallback(() => closeThen(() => onDismiss()), [closeThen, onDismiss]);

  const handleWatch = async () => {
    if (opening) return;
    setOpening(true);
    setOpenFailed(false);
    let opened = false;
    try {
      opened = (await window.electronAPI?.openExternal?.(DEMO_VIDEO_URL))?.ok === true;
    } catch (e) {
      console.warn('[DemoVideoToaster] openExternal failed:', e);
    }
    // Opened: the film is playing in the browser. Not opened: stay, say where
    // else to find it, and record nothing.
    if (opened) closeThen(() => onDismiss('acted'));
    else { setOpenFailed(true); setOpening(false); }
  };

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, handleDismiss]);

  useEffect(() => {
    if (!visible) { setPlateHover(false); setCtaActive(false); setCtaPressed(false); }
  }, [visible]);

  const item = reduced ? ITEM_REDUCED : ITEM;
  const ctaDur = ctaActive ? CTA_IN : CTA_OUT;

  return (
    <GenieModal
      open={visible}
      label="DemoVideoToaster"
      keepPictures={!opening}
      zIndex={9998}
      onBackdropClick={handleDismiss}
      onClosed={() => { const after = afterCloseRef.current; afterCloseRef.current = null; after?.(); }}
      backdropStyle={{ background: isLight ? 'rgba(10,10,18,0.30)' : 'rgba(0,0,0,0.80)' }}
      padding={16}
      // The review card's size (ReviewModal.css: 600 wide, 420 tall, copy on
      // the left, the picture in a 40% panel on the right), so the launcher's
      // cards read as one family.
      wrapStyle={{ width: '600px', maxWidth: '100%' }}
      cardStyle={{
        background: isLight ? '#F7F8FC' : '#1C1C1E',
        boxShadow: isLight
          ? 'inset 0 0 0 1px rgba(11,16,32,0.10), inset 0 1px 0 rgba(255,255,255,0.80), ' + SHADOW_LIGHT
          : 'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06), ' + SHADOW_DARK,
        fontFamily: FONT,
        WebkitFontSmoothing: 'antialiased',
      } as React.CSSProperties}
      cardProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'demo-toast-title',
        'aria-describedby': 'demo-toast-desc',
      }}
      shadow={isLight ? SHADOW_LIGHT : SHADOW_DARK}
      radius={20}
    >
      {/* 474: the review card's height as it opens (its stars and note take
          it past ReviewModal.css's 420 minimum), measured 2026-11-03. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 40%', alignItems: 'stretch', minHeight: '474px' }}>
        <motion.div
          variants={STAGGER} initial={reduced ? 'hidden' : false} animate="show"
          style={{ display: 'flex', flexDirection: 'column', minWidth: 0, padding: '40px 28px 34px 40px' }}
        >
          <motion.div variants={item} style={{
            fontSize: '12px', fontWeight: 500, letterSpacing: '-0.005em', color: INK.quiet, margin: '0 0 22px',
          }}>
            Natively in 9 minutes
          </motion.div>

          <motion.h2 variants={item} id="demo-toast-title" style={{
            fontSize: '34px', fontWeight: 300, letterSpacing: '-0.032em', lineHeight: 1.08,
            margin: 0, color: INK.strong,
          }}>
            Watch the full
            <br />
            setup & demo
          </motion.h2>

          <motion.p variants={item} id="demo-toast-desc" style={{
            fontSize: '13.5px', lineHeight: 1.55, letterSpacing: '-0.008em',
            color: INK.body, margin: '16px 0 0', maxWidth: '300px', textWrap: 'pretty',
          } as React.CSSProperties}>
            Every step of the setup, then Natively at work in a meeting. It stays
            in Settings › Setup & Help whenever you want it again.
          </motion.p>

          {/* marginTop: auto pins the actions to the bottom of the column. */}
          <motion.div variants={item} style={{
            marginTop: 'auto', paddingTop: '30px',
            display: 'flex', alignItems: 'center', gap: '22px', flexWrap: 'wrap',
          }}>
            {openFailed && (
              <p role="alert" style={{
                flexBasis: '100%', margin: 0, fontSize: '12px', lineHeight: 1.45,
                color: isLight ? '#B42318' : '#FCA5A5',
              }}>
                Couldn't open your browser. The video is also in Settings › Setup & Help.
              </p>
            )}
            <button
              type="button"
              onClick={handleWatch}
              disabled={opening}
              onPointerEnter={e => { if (e.pointerType === 'mouse') setCtaActive(true); }}
              onPointerLeave={() => { setCtaActive(false); setCtaPressed(false); }}
              onPointerDown={() => setCtaPressed(true)}
              onPointerUp={() => setCtaPressed(false)}
              onFocus={e => { if (e.currentTarget.matches(':focus-visible')) setCtaActive(true); }}
              onBlur={() => setCtaActive(false)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                padding: '9px 14px', borderRadius: '9px',
                border: `1px solid ${isLight
                  ? (ctaActive ? 'rgba(11,16,32,0.46)' : 'rgba(11,16,32,0.22)')
                  : (ctaActive ? 'rgba(255,255,255,0.44)' : 'rgba(255,255,255,0.24)')}`,
                background: isLight
                  ? (ctaActive ? 'rgba(11,16,32,0.04)' : 'rgba(11,16,32,0)')
                  : (ctaActive ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0)'),
                outline: 'none',
                cursor: opening ? 'progress' : 'pointer',
                fontFamily: FONT, fontSize: '13px', fontWeight: 500, letterSpacing: '-0.01em',
                color: ctaActive ? INK.strong : (isLight ? 'rgba(11,16,32,0.84)' : 'rgba(255,255,255,0.88)'),
                opacity: opening ? 0.55 : 1,
                transform: ctaPressed && !reduced ? 'scale(0.97)' : 'none',
                transition:
                  `border-color ${ctaDur}ms ${EASE_CSS}, background-color ${ctaDur}ms ${EASE_CSS},`
                  + ` color ${ctaDur}ms ${EASE_CSS}, opacity 200ms ${EASE_CSS}, transform 120ms ${EASE_CSS}`,
              }}
            >
              <span>{opening ? 'Opening YouTube' : 'Watch on YouTube'}</span>
              <ArrowRight size={14} strokeWidth={1.9} aria-hidden style={{
                flex: 'none',
                transform: ctaActive && !reduced ? 'translateX(3px)' : 'translateX(0)',
                transition: `transform ${ctaDur}ms ${EASE_CSS}`,
              }} />
            </button>

            <button
              type="button"
              onClick={handleDismiss}
              style={{
                background: 'none', border: 0, padding: '9px 0', cursor: 'pointer', fontFamily: FONT,
                fontSize: '13px', fontWeight: 500, letterSpacing: '-0.008em', color: INK.faint,
                transition: `color 200ms ${EASE_CSS}`,
              }}
              onMouseEnter={e => (e.currentTarget.style.color = INK.body)}
              onMouseLeave={e => (e.currentTarget.style.color = INK.faint)}
              onFocus={e => (e.currentTarget.style.color = INK.body)}
              onBlur={e => (e.currentTarget.style.color = INK.faint)}
            >
              Not now
            </button>
          </motion.div>
        </motion.div>

        {/* The film's art in its own inset panel; pressing it plays the film. */}
        <div style={{ display: 'flex', padding: '8px 8px 8px 0' }}>
          <div style={{
            position: 'relative', flex: 1, borderRadius: '14px', overflow: 'hidden', background: '#8C8FE6',
            boxShadow: isLight ? 'inset 0 0 0 1px rgba(11,16,32,0.07)' : 'none',
          }}>
            <button
              type="button"
              onClick={handleWatch}
              disabled={opening}
              aria-label="Watch the full setup & demo on YouTube"
              onPointerEnter={e => { if (!reduced && e.pointerType === 'mouse') setPlateHover(true); }}
              onPointerLeave={() => setPlateHover(false)}
              style={{
                position: 'absolute', inset: 0, padding: 0, border: 0, background: 'none',
                cursor: opening ? 'progress' : 'pointer', outline: 'none',
              }}
            >
              <img src={demoVideoCardArt} alt="" draggable={false} style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', objectPosition: '50% 50%',
                transform: plateHover ? `scale(${1 + PLATE_ZOOM})` : 'scale(1)',
                transformOrigin: '50% 40%',
                transition: reduced ? undefined : `transform ${plateHover ? PLATE_ZOOM_IN : PLATE_ZOOM_OUT}ms ${EASE_CSS}`,
              }} />
              {/* Play, in the corner over the sweater: clear of the face and
                  the hand, which carry the picture. */}
              <span aria-hidden style={{
                position: 'absolute', right: '14px', bottom: '14px',
                width: '44px', height: '44px', borderRadius: '999px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: plateHover ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.86)',
                boxShadow: '0 10px 30px -8px rgba(11,16,32,0.55)',
                transform: `scale(${plateHover && !reduced ? 1.06 : 1})`,
                transition: `transform 240ms ${EASE_CSS}, background-color 240ms ${EASE_CSS}`,
              }}>
                <Play size={16} strokeWidth={0} fill="#0B1020" style={{ marginLeft: '2px' }} />
              </span>
            </button>

            {/* Close on the picture, like the review card's. No disc behind it:
                a soft dark drop shadow keeps the white X readable on the
                film's colours in both themes. */}
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Close"
              style={{
                position: 'absolute', top: '8px', right: '8px', zIndex: 2,
                width: '28px', height: '28px', padding: 0, border: 0, borderRadius: '999px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', color: '#FFFFFF', cursor: 'pointer', opacity: 0.86,
                filter: 'drop-shadow(0 1px 2px rgba(11,16,32,0.55)) drop-shadow(0 0 6px rgba(11,16,32,0.35))',
                transition: `opacity 180ms ${EASE_CSS}, transform 160ms ${EASE_CSS}`,
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '0.86'; e.currentTarget.style.transform = 'scale(1)'; }}
              onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.92)'; }}
              onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              <X size={14} strokeWidth={2} color="currentColor" />
            </button>
          </div>
        </div>
      </div>
    </GenieModal>
  );
};

export default DemoVideoToaster;
