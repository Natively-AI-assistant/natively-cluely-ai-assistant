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
// Chrome Web Store URL canonical source: src/components/settings/HelpSettings.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, animate, useMotionValue, useReducedMotion, type MotionStyle } from 'framer-motion';
import { X, ArrowRight } from 'lucide-react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import beBlack from '../../../assets/BE-black.png';
import {
  genieFrame, genieBands, genieBandRows, genieOpacity, genieStretch, genieEdges,
  SLOT_INSET, BAND_OVERLAP, type GenieGeometry,
} from './genieMotion.mjs';

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

/*
  Open / close: the macOS genie. On close the card pours through a funnel
  into a slot at the bottom centre of the window, the way a minimised window
  pours into its Dock icon; on open it pours back out. The funnel is fixed on
  screen and the card passes through it. The geometry lives in
  genieMotion.mjs; this file only measures the card and runs the clock.

  The close eases in and out, since the card travels on screen. The open eases
  out, so it answers at once and settles gently. The close is the quicker of
  the two: the user asked for it to go.
*/
const GENIE_OPEN  = { duration: 0.55, ease: [0.23, 1, 0.32, 1] as any };
const GENIE_CLOSE = { duration: 0.45, ease: [0.65, 0, 0.35, 1] as any };
// About this many bands. Each is a copy of the card mapped onto its own slice
// of the funnel, so the content pinches with the outline. 48 held 60fps with
// the CPU throttled 4x; 144 dropped frames.
const GENIE_BANDS = 48;

const REDUCED_FADE = { duration: 0.15, ease: 'linear' as const };
const SCRIM_OPEN_S  = 0.25;
const SCRIM_CLOSE_S = 0.3;
// The host unmounts this component the moment it hears onDismiss, which
// would cut the genie off. So the card closes itself first and reports after
// the animation completes. This timer is the backstop: Chromium stops
// animation frames in a hidden window, and a close that never completes must
// still release the onboarding slot.
const CLOSE_FALLBACK_MS = 900;

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

  // closing: the genie is running. done: it has finished and the card is gone.
  const [closing, setClosing] = useState(false);
  const [done, setDone]       = useState(false);
  const afterCloseRef = useRef<(() => void) | null>(null);

  const shown = (isOpen || testForceShow) && !done;

  // ─── Genie clock ────────────────────────────────────────────
  // genie: 1 = in the slot, 0 = the card at rest.
  const genie = useMotionValue(1);
  const scrim = useMotionValue(0);
  // The wrapper is never transformed, so it reports where the card sits at
  // rest even while the card is mid-genie.
  const wrapRef   = useRef<HTMLDivElement>(null);
  const cardRef   = useRef<HTMLDivElement>(null);
  const bandsRef  = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const geomRef   = useRef<GenieGeometry | null>(null);
  const rowsRef   = useRef<[number, number][] | null>(null);

  const measure = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    geomRef.current = r && r.width > 0
      ? { top: r.top, bottom: r.bottom, width: r.width, slotY: window.innerHeight - SLOT_INSET }
      : null;
  };

  // Cut the card into bands: copies of it, each showing a strip of rows.
  // Built when the genie starts and removed when it ends, so at rest there
  // is one card and nothing promoted to its own layer.
  const buildBands = (): boolean => {
    const card = cardRef.current, layer = bandsRef.current, geom = geomRef.current;
    if (!card || !layer || !geom) return false;
    try {
      const height = Math.round(geom.bottom - geom.top);
      const rows = genieBandRows(height, GENIE_BANDS);
      const frag = document.createDocumentFragment();
      rows.forEach(([r0, r1], i) => {
        const band = document.createElement('div');
        band.style.cssText = `position:absolute;left:0;width:100%;top:${r0}px;`
          + `height:${r1 - r0 + (i < rows.length - 1 ? BAND_OVERLAP : 0)}px;`
          + 'overflow:hidden;transform-origin:0 0;will-change:transform;';
        const copy = card.cloneNode(true) as HTMLElement;
        // A copy is a picture, not a dialog: no ids to collide with the real
        // card's aria references, and nothing promoted or filtered inside it.
        copy.removeAttribute('role');
        copy.removeAttribute('aria-modal');
        copy.removeAttribute('aria-labelledby');
        copy.removeAttribute('aria-describedby');
        copy.querySelectorAll<HTMLElement>('[id]').forEach(el => el.removeAttribute('id'));
        copy.querySelectorAll<HTMLElement>('[style]').forEach(el => {
          el.style.willChange = 'auto';
          if (el.style.filter === 'blur(0px)') el.style.filter = '';
        });
        copy.style.cssText += `;position:absolute;left:0;top:${-r0}px;width:100%;`
          + 'visibility:visible;transform:none;clip-path:none;opacity:1;box-shadow:none;';
        band.appendChild(copy);
        frag.appendChild(band);
      });
      layer.replaceChildren(frag);
      rowsRef.current = rows;
      return true;
    } catch (e) {
      console.warn('[BrowserExtensionToaster] genie bands unavailable, using the outline genie:', e);
      layer.replaceChildren();
      rowsRef.current = null;
      return false;
    }
  };

  const clearBands = () => {
    bandsRef.current?.replaceChildren();
    rowsRef.current = null;
  };

  // One write per frame, straight to the DOM: no React render and no
  // per-property transforms recomputing the same geometry.
  const bandsFailedRef = useRef(false);
  const renderGenie = useCallback((p: number) => {
    const card = cardRef.current, layer = bandsRef.current, shadow = shadowRef.current;
    if (!card || !layer || !shadow) return;
    const geom = geomRef.current;

    if (reduced) {
      card.style.opacity = String(1 - p);
      return;
    }

    if (p <= 0.001 || !geom) {
      // At rest: the real card, whole, with its own shadow.
      clearBands();
      card.style.visibility = '';
      card.style.transform = card.style.clipPath = '';
      card.style.opacity = '1';
      shadow.style.display = 'none';
      return;
    }

    if (!rowsRef.current && !bandsFailedRef.current) bandsFailedRef.current = !buildBands();
    const rows = rowsRef.current;
    if (rows) {
      card.style.visibility = 'hidden';
      layer.style.opacity = String(genieOpacity(p));
      const transforms = genieBands(p, geom, rows);
      const els = layer.children;
      for (let i = 0; i < transforms.length; i++) (els[i] as HTMLElement).style.transform = transforms[i];
    } else {
      // Fallback: warp the outline only.
      const f = genieFrame(p, geom);
      card.style.transform = f.transform;
      card.style.clipPath = f.clipPath;
      card.style.opacity = String(f.opacity);
    }

    // The shadow is the card's own, drawn once and only ever moved: it
    // follows the card's top edge down and fades as the funnel forms, so it
    // is gone before the silhouette stops being a rectangle.
    const { top, bottom } = genieEdges(p, geom);
    const sy = Math.max(bottom - top, 0.5) / (geom.bottom - geom.top);
    shadow.style.display = 'block';
    shadow.style.transform = `translateY(${(top - geom.top).toFixed(2)}px) scaleY(${sy.toFixed(4)})`;
    shadow.style.opacity = String(1 - genieStretch(p));
  }, [reduced]);

  useEffect(() => genie.on('change', renderGenie), [genie, renderGenie]);

  // Pour out whenever the card appears.
  useEffect(() => {
    if (!shown) return;
    measure();
    bandsFailedRef.current = false;
    genie.set(1);
    renderGenie(1);
    scrim.set(0);
    const a = animate(genie, 0, reduced ? REDUCED_FADE : GENIE_OPEN);
    const b = animate(scrim, 1, { duration: SCRIM_OPEN_S, ease: EASE_FM as any });
    return () => { a.stop(); b.stop(); clearBands(); };
  }, [shown, reduced, genie, scrim, renderGenie]);

  // ─── Close sequencing ───────────────────────────────────────
  // Every way out goes through here: run the genie now, report once it has
  // played. The first request wins; a second click during it is ignored.
  const closeThen = useCallback((report: () => void) => {
    if (afterCloseRef.current) return;
    afterCloseRef.current = report;
    setClosing(true);
  }, []);

  const finishClose = useCallback(() => {
    const report = afterCloseRef.current;
    afterCloseRef.current = null;
    report?.();
  }, []);

  useEffect(() => {
    if (!closing) return;
    // Re-measure, and cut fresh bands from the card as it looks now (hover
    // states and all): the window may have been resized since it opened.
    if (genie.get() <= 0.001) { measure(); clearBands(); bandsFailedRef.current = false; }
    // Cut the bands before the clock starts, not on its first frame: the
    // copying is the one heavy step, and done inside a frame it would make
    // the genie skip ahead. At rest the bands match the card exactly, so
    // building them early shows nothing.
    if (!reduced && !rowsRef.current && !bandsFailedRef.current) bandsFailedRef.current = !buildBands();
    const a = animate(genie, 1, reduced ? REDUCED_FADE : GENIE_CLOSE);
    const b = animate(scrim, 0, reduced
      ? REDUCED_FADE
      : { duration: SCRIM_CLOSE_S, delay: GENIE_CLOSE.duration - SCRIM_CLOSE_S, ease: EASE_FM as any });
    Promise.all([a, b]).then(() => { setDone(true); finishClose(); });
    const t = setTimeout(finishClose, CLOSE_FALLBACK_MS);
    return () => { clearTimeout(t); a.stop(); b.stop(); };
  }, [closing, reduced, genie, scrim, finishClose]);

  // A host that keeps this mounted and opens it again gets a fresh card.
  useEffect(() => {
    if (!isOpen) { setClosing(false); setDone(false); afterCloseRef.current = null; }
  }, [isOpen]);

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
    if (!shown || closing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handlePermanentDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, closing, handlePermanentDismiss]);

  // Reset transient interaction state whenever the card closes.
  useEffect(() => {
    if (!shown || closing) { setPlateHover(false); setCtaActive(false); setCtaPressed(false); }
    if (!shown) setOpening(false);
  }, [shown, closing]);

  const item = reduced ? ITEM_REDUCED : ITEM;
  const ctaDur = ctaActive ? CTA_IN : CTA_OUT;

  return (
    <>
      {shown && (
        <motion.div
          key="ext-backdrop"
          style={{
            opacity: scrim,
            // While the card drains away the launcher is already live again.
            pointerEvents: closing ? 'none' : 'auto',
            position: 'fixed', inset: 0, zIndex: 9998,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
            // Dims, never blurs: frosting the whole launcher behind the card
            // left it unreadable (see 3a9901ae4, which set this for every
            // onboarding scrim).
            background: isLight ? 'rgba(10,10,18,0.30)' : 'rgba(0,0,0,0.80)',
          } as MotionStyle}
          onClick={e => { if (e.target === e.currentTarget) handlePermanentDismiss(); }}
        >
          <motion.div
            ref={wrapRef}
            style={{ position: 'relative', width: '600px', maxWidth: '100%' }}
          >
            {/* The card's shadow, standing in for it mid-genie. */}
            <div
              ref={shadowRef}
              aria-hidden
              style={{
                display: 'none', position: 'absolute', inset: 0,
                borderRadius: '20px', transformOrigin: '50% 0', pointerEvents: 'none',
                boxShadow: isLight ? SHADOW_LIGHT : SHADOW_DARK,
              }}
            />
            <motion.div
              key="ext-card"
              ref={cardRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="ext-toast-title"
              aria-describedby="ext-toast-desc"
              onPointerEnter={e => { if (!reduced && e.pointerType === 'mouse') setPlateHover(true); }}
              onPointerLeave={() => setPlateHover(false)}
              style={{
                transformOrigin: '50% 0%',
                position: 'relative',
                width: '100%',
                borderRadius: '20px',
                overflow: 'hidden',
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
              } as MotionStyle}
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
                        sphere breathes while the column holds still. */}
                    <div aria-hidden style={{
                      position: 'absolute', inset: 0,
                      backgroundImage: `url(${beBlack})`,
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
            </motion.div>
            {/* The genie's bands, present only while it runs. */}
            <div
              ref={bandsRef}
              aria-hidden
              inert
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            />
          </motion.div>
        </motion.div>
      )}
    </>
  );
};

export default BrowserExtensionToaster;