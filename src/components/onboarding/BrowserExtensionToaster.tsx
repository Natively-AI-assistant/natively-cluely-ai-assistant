// src/components/onboarding/BrowserExtensionToaster.tsx
//
// "Install the browser extension" invitation.
// Shown ONCE per install/update to v2.8.0+ when the Natively browser
// extension is not yet connected.
//
// Presentational: the onboarding orchestrator decides when it opens
// (OrchestratedToasterHost); this component owns the permanent dismiss flag
// and auto-dismisses silently the moment the extension connects.
//
// It pours out of, and back into, the bottom of the window like every other
// popup (GenieModal), warping one picture of itself the way macOS does.
//
// Chrome Web Store URL canonical source: src/components/settings/HelpSettings.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { X, ArrowRight } from 'lucide-react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import chromeArt from '../../assets/cards/chrome.jpg';
import { GenieModal } from '../ui/GenieModal';

const DISMISS_KEY = 'natively_ext_connect_dismissed_v1';
const MIN_VERSION = '2.8.0';

// Canonical Chrome Web Store URL (also in HelpSettings.tsx).
const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/lmhgnkbjnelmciecjkleaomjpejcgaln?utm_source=item-share-cb';

/*
  ── Composition ─────────────────────────────────────────────────────────────

  Two panes: the words on a flat ground on the left, the image in its own
  inset panel on the right. Nothing crosses between them, so the type never
  needs a scrim and the image is shown whole.

  The column has three tiers, separated by space rather than by rules:

    statement   eyebrow, headline, one sentence of support
    evidence    three stacked figures
    action      the CTA and its quiet alternative, pinned to the bottom
*/

// ─── Tokens ────────────────────────────────────────────────────
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';

/*
  Ink for the dark ground (#1C1C1E). The type sits on flat colour rather than
  a photograph, so it needs no scrim, but it does have to clear AA on its own.
  Measured, not estimated:

    strong  #F2F2F4   15.2:1
    body    0.66       8.0:1
    quiet   0.52       5.4:1    eyebrow, figure labels
    faint   0.48       4.9:1    the decline, which is a control
*/
const INK_DARK = {
  strong: '#F2F2F4',
  body:   'rgba(255,255,255,0.66)',
  quiet:  'rgba(255,255,255,0.52)',
  faint:  'rgba(255,255,255,0.48)',
};

/*
  Ink for the light ground. Not black: a faint blue cast keeps it in the same
  temperature as the image panel, so the two halves read as one card.

  Measured against #F7F8FC, not eyeballed (white only raises these):

    strong  #0B1020   17.8:1
    body    0.68      6.5:1
    quiet   0.66      6.0:1    eyebrow, and the words after each figure
    faint   0.58      4.6:1    the decline, which is a CONTROL and so has to
                               clear 4.5:1 even while staying the quietest
                               thing on the card

  The alphas are higher than the dark set's for the same roles. That is not a
  mistake: dark text loses contrast against a light ground far faster than
  light text loses it against a dark one, so the same visual weight costs more
  opacity here.
*/
const INK_LIGHT = {
  strong: '#0B1020',
  body:   'rgba(11,16,32,0.68)',
  quiet:  'rgba(11,16,32,0.66)',
  faint:  'rgba(11,16,32,0.58)',
};

// One curve for every eased property on the card, so all motion shares a
// temperament. Strong ease-out: movement lands early, then drifts.
const EASE_CSS = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_FM  = [0.23, 1, 0.32, 1] as const;

// Panel zoom. The image pushes in under the pointer while the type holds
// still; the difference between the two is the whole effect. It is allowed
// to be slow because it is an image breathing, not a control answering a
// click, and the card is only ever seen once.
const PLATE_ZOOM     = 0.05;
const PLATE_ZOOM_IN  = 1100;
const PLATE_ZOOM_OUT = 700;

// CTA. Inside the band where a hover still feels attached to the pointer.
// The exit is quicker than the entrance: the user deciding may take its
// time, the system letting go should not.
const CTA_IN  = 420;
const CTA_OUT = 280;

// Close ink on the light image panel (#E6E8EE). Rest clears the 3:1 that
// WCAG 1.4.11 asks of a control (3.97:1); at 0.34 it was 2.17:1.
// The card's drop shadow, shared with the stand-in that carries it mid-genie.
const SHADOW_LIGHT = '0 30px 70px -28px rgba(16,24,40,0.40)';
const SHADOW_DARK  = '0 40px 90px -30px rgba(0,0,0,0.85)';

const CLOSE_LIGHT = { rest: 'rgba(11,16,32,0.55)', hover: 'rgba(11,16,32,0.92)' };

// Entrance: once the card has poured out, the column arrives tier by tier.
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.04, delayChildren: 0.3 } } };
const ITEM = {
  hidden: { opacity: 0, y: 12, filter: 'blur(3px)' },
  show:   { opacity: 1, y: 0,  filter: 'blur(0px)', transition: { duration: 0.5, ease: EASE_FM as any } },
};
const ITEM_REDUCED = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { duration: 0.3 } },
};

/*
  Each figure is stacked: numeral above, one word or two below,
  three columns. Stacked, the numerals line up as a row of their own and read
  first, which is the point of leading with them.
*/
const FIGURES_STACKED: { value: string; label: string }[] = [
  { value: '3×',  label: 'Faster' },
  { value: '90%', label: 'Fewer Tokens' },
  { value: '0',   label: 'Screenshots' },
];

// Tiny inline semver compare (only major.minor.patch).
export function versionGte(a: string, b: string = MIN_VERSION): boolean {
  const pa = a.split('.').map(n => parseInt(n, 10));
  const pb = b.split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return true;
}

interface Props {
  isOpen:    boolean;
  onDismiss: () => void;
  onSkip?:   () => void;
}

export const BrowserExtensionToaster: React.FC<Props> = ({ isOpen, onDismiss, onSkip }) => {
  const [opening, setOpening]       = useState(false);
  const [plateHover, setPlateHover] = useState(false);
  const [ctaActive, setCtaActive]   = useState(false);
  const [ctaPressed, setCtaPressed] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const isLight = useResolvedTheme() === 'light';
  const INK = isLight ? INK_LIGHT : INK_DARK;

  // Test hook: ?extToaster=force bypasses the orchestrator and shows immediately.
  const testForceShow = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('extToaster') === 'force';

  // Starts closed, so the first thing the card does is pour out.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(isOpen || testForceShow);
  }, [isOpen, testForceShow]);

  // The orchestrator unmounts this the moment it hears "dismissed", so every
  // way out closes the card first (the genie) and reports from onClosed.
  const afterCloseRef = useRef<(() => void) | null>(null);
  const closeThen = useCallback((after: () => void) => {
    if (afterCloseRef.current) return;
    afterCloseRef.current = after;
    setVisible(false);
  }, []);

  // ─── Dismiss handlers ───────────────────────────────────────
  // The permanent flag is written at once, not after the exit, so quitting
  // mid-animation still counts as a dismiss.
  const persistDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
  };

  const handlePermanentDismiss = useCallback(() => {
    persistDismiss();
    closeThen(onDismiss);
  }, [closeThen, onDismiss]);

  const handleNotNow = () => {
    persistDismiss();
    closeThen(() => { onDismiss(); onSkip?.(); });
  };

  const handleInstall = async () => {
    if (opening) return;
    try {
      setOpening(true);
      await window.electronAPI?.openExternal?.(CHROME_STORE_URL);
    } catch (e) {
      console.warn('[BrowserExtensionToaster] openExternal failed:', e);
    } finally {
      // Close now; the user is in the Chrome store. Not a permanent
      // dismiss, so they can return next launch if they didn't install.
      closeThen(() => onDismiss());
    }
  };

  // ─── Auto-dismiss when the extension connects ──────────────
  useEffect(() => {
    if (!isOpen || testForceShow) return;
    const unsub = window.electronAPI?.onPhoneMirrorStatus?.(info => {
      if (info?.extensionConnected) {
        persistDismiss();
        closeThen(onDismiss);
      }
    });
    return () => { unsub?.(); };
  }, [isOpen, testForceShow, onDismiss, closeThen]);

  // ─── Escape key ─────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handlePermanentDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, handlePermanentDismiss]);

  // Reset transient interaction state whenever the card closes. `opening`
  // stays set through the close, so a picture of the card opening the store
  // is never kept for the next open.
  useEffect(() => {
    if (!visible) { setPlateHover(false); setCtaActive(false); setCtaPressed(false); }
  }, [visible]);

  const item = reduced ? ITEM_REDUCED : ITEM;
  const ctaDur = ctaActive ? CTA_IN : CTA_OUT;

  return (
    <GenieModal
      open={visible}
      label="BrowserExtensionToaster"
      // A picture of the card opening the store is never one the next open shows.
      keepPictures={!opening}
      zIndex={9998}
      onBackdropClick={handlePermanentDismiss}
      onClosed={() => { const after = afterCloseRef.current; afterCloseRef.current = null; after?.(); }}
      // Dims, never blurs: frosting the whole launcher behind the card left it
      // unreadable (see 3a9901ae4, which set this for every onboarding scrim).
      backdropStyle={{ background: isLight ? 'rgba(10,10,18,0.30)' : 'rgba(0,0,0,0.80)' }}
      padding={16}
      wrapStyle={{ width: '600px', maxWidth: '100%' }}
      cardStyle={{
        background: isLight ? '#F7F8FC' : '#1C1C1E',
        /*
          The edge inverts with the ground: a light hairline on the dark
          card, a shadow on the light one, so the card sits on the app in
          both themes rather than glowing against it in one.
        */
        boxShadow: isLight
          ? 'inset 0 0 0 1px rgba(11,16,32,0.10),'
            + ' inset 0 1px 0 rgba(255,255,255,0.80), ' + SHADOW_LIGHT
          : 'inset 0 0 0 1px rgba(255,255,255,0.08),'
          + ' inset 0 1px 0 rgba(255,255,255,0.06), ' + SHADOW_DARK,
        fontFamily: FONT,
        WebkitFontSmoothing: 'antialiased',
      } as React.CSSProperties}
      cardProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'ext-toast-title',
        'aria-describedby': 'ext-toast-desc',
        onPointerEnter: e => { if (!reduced && e.pointerType === 'mouse') setPlateHover(true); },
        onPointerLeave: () => setPlateHover(false),
      }}
      shadow={isLight ? SHADOW_LIGHT : SHADOW_DARK}
      radius={20}
    >
      {/*
        ── SPLIT ─────────────────────────────────────────────────────

        Two panes instead of a photograph with a caption. The type sits
        on flat colour, so it needs no scrim and reads at full contrast;
        the image sits in its own inset panel, so it is shown whole
        rather than fading out under the text.

        The panel is inset 8px from the card's top, right and bottom
        edges with its own radius. That gap is what makes it read as a
        separate object held inside the card rather than a second
        column bleeding to the edge.

        One layout for both themes. Only the ground and the ink
        change; the image panel is the same object in each, because it
        is a light photograph either way.
      */}
      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: '440px' }}>
        <motion.div
          // The genie pours the card out whole; a stagger on top of
          // it would bring the content in twice. Reduced motion has
          // no genie, so the column still arrives tier by tier.
          variants={STAGGER} initial={reduced ? 'hidden' : false} animate="show"
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
            Natively for Chrome
          </motion.div>

          {/*
            Light weight at display size. At 44px a 300 weight holds its
            shape and reads as confident rather than loud; the same line
            in semibold would compete with the image for attention.
            Tracking closes up as size rises.
          */}
          <motion.h2 variants={item} id="ext-toast-title" style={{
            fontSize: '44px', fontWeight: 300,
            letterSpacing: '-0.035em', lineHeight: 1.02,
            margin: '0 0 20px', color: INK.strong,
          }}>
            Skip the
            <br />
            Screenshot.
          </motion.h2>

          <motion.p variants={item} id="ext-toast-desc" style={{
            fontSize: '13.5px', lineHeight: 1.55, letterSpacing: '-0.008em',
            color: INK.body, margin: 0, maxWidth: '300px',
            textWrap: 'pretty',
          } as React.CSSProperties}>
            The page you are on goes straight to the assistant, so every
            answer starts with the full context and none of the copying.
          </motion.p>

          <motion.dl variants={item} style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, auto)',
            justifyContent: 'start', columnGap: '34px',
            margin: '30px 0 0', padding: 0,
          }}>
            {FIGURES_STACKED.map(({ value, label }) => (
              <div key={value}>
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
          <motion.div variants={item} style={{
            marginTop: 'auto', paddingTop: '34px',
            display: 'flex', alignItems: 'center', gap: '22px', flexWrap: 'wrap',
          }}>
            {/*
              Outlined, not filled. On a flat card a filled button is the
              strongest object on the page and pulls the eye off the
              image; a hairline outline says "button" at a fraction of the
              weight. Hover is three quiet channels on one curve: the
              outline and label brighten, a faint fill arrives, and the
              arrow travels 3px. Press compresses the whole thing.
            */}
            <button
              type="button"
              onClick={handleInstall}
              disabled={opening}
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
                cursor: opening ? 'progress' : 'pointer',
                fontFamily: FONT,
                fontSize: '13px', fontWeight: 500, letterSpacing: '-0.01em',
                color: ctaActive ? INK.strong : (isLight ? 'rgba(11,16,32,0.84)' : 'rgba(255,255,255,0.88)'),
                opacity: opening ? 0.55 : 1,
                transform: ctaPressed && !reduced ? 'scale(0.97)' : 'none',
                transition:
                  `border-color ${ctaDur}ms ${EASE_CSS}, background-color ${ctaDur}ms ${EASE_CSS},`
                  + ` color ${ctaDur}ms ${EASE_CSS}, opacity 200ms ${EASE_CSS}, transform 120ms ${EASE_CSS}`,
              }}
            >
              <span>{opening ? 'Opening Chrome Web Store' : 'Add to Chrome'}</span>
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
              onClick={handleNotNow}
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
              Not now
            </button>
          </motion.div>
        </motion.div>

        <div style={{ flex: '0 0 40%', padding: '8px 8px 8px 0', display: 'flex' }}>
          <div style={{
            position: 'relative', flex: 1,
            borderRadius: '14px', overflow: 'hidden',
            background: '#E6E8EE',
            boxShadow: isLight ? 'inset 0 0 0 1px rgba(11,16,32,0.07)' : 'none',
          }}>
            {/* The image. A slow push-in scoped to the panel, so the
                Chrome mark breathes while the column holds still. */}
            <div aria-hidden style={{
              position: 'absolute', inset: 0,
              backgroundImage: `url(${chromeArt})`,
              backgroundSize: 'cover',
              backgroundPosition: '92% 50%',
              transform: plateHover ? `scale(${1 + PLATE_ZOOM})` : 'scale(1)',
              transformOrigin: '70% 50%',
              transition: reduced
                ? undefined
                : `transform ${plateHover ? PLATE_ZOOM_IN : PLATE_ZOOM_OUT}ms ${EASE_CSS}`,
              willChange: reduced ? undefined : 'transform',
              pointerEvents: 'none',
            }} />

            {/* Close sits on the image panel, which is light in both
                themes, so its ink is dark in both. */}
            <button
              type="button"
              onClick={handlePermanentDismiss}
              aria-label="Close"
              style={{
                position: 'absolute', top: '8px', right: '8px', zIndex: 2,
                width: '30px', height: '30px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 0, cursor: 'pointer',
                background: 'none', border: 0, borderRadius: '8px',
                color: CLOSE_LIGHT.rest,
                transition: `color 180ms ${EASE_CSS}, transform 160ms ${EASE_CSS}`,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = CLOSE_LIGHT.hover; }}
              onMouseLeave={e => { e.currentTarget.style.color = CLOSE_LIGHT.rest; e.currentTarget.style.transform = 'scale(1)'; }}
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

export default BrowserExtensionToaster;