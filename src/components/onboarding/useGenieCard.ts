// src/components/onboarding/useGenieCard.ts
//
// The macOS genie, as a hook: an onboarding card pours out of a slot at the
// bottom centre of the window on open and pours back into it on close, the way
// a minimised window pours into its Dock icon.
//
// The GEOMETRY lives in genieMotion.mjs. This hook measures the card, cuts it
// into bands, and runs the clock — the part BrowserExtensionToaster used to own
// inline. It was lifted out verbatim when the permissions card needed the same
// entrance, because two copies of a 48-band animation are two places for the
// timings to drift apart (CLAUDE.md: do not duplicate a feature when only a
// small integration differs).
//
// The host renders four nodes and hands back their refs:
//
//   wrap   — never transformed, so it reports where the card sits at rest even
//            while the card is mid-genie. Measured, not animated.
//   card   — the real card.
//   shadow — a stand-in that carries the card's drop shadow mid-genie.
//   bands  — an empty layer the band copies are built into.
//
// Close is sequenced: the host usually unmounts the moment it reports a
// dismiss, which would cut the animation off, so the card closes itself FIRST
// and reports through `closeThen` once the genie has played.

import { useState, useEffect, useCallback, useRef } from 'react';
import { animate, useMotionValue, useReducedMotion } from 'framer-motion';
import {
  genieFrame, genieBands, genieBandRows, genieOpacity, genieStretch, genieEdges,
  SLOT_INSET, BAND_OVERLAP, type GenieGeometry,
} from './genieMotion.mjs';

const EASE_FM = [0.23, 1, 0.32, 1] as const;

/*
  The close eases in and out, since the card travels on screen. The open eases
  out, so it answers at once and settles gently. The close is the quicker of the
  two: the user asked for it to go.
*/
const GENIE_OPEN  = { duration: 0.55, ease: [0.23, 1, 0.32, 1] as any };
const GENIE_CLOSE = { duration: 0.45, ease: [0.65, 0, 0.35, 1] as any };

// About this many bands. Each is a copy of the card mapped onto its own slice
// of the funnel, so the content pinches with the outline. 48 held 60fps with
// the CPU throttled 4x; 144 dropped frames.
const GENIE_BANDS = 48;

const REDUCED_FADE  = { duration: 0.15, ease: 'linear' as const };
const SCRIM_OPEN_S  = 0.25;
const SCRIM_CLOSE_S = 0.3;

// Backstop: Chromium stops animation frames in a hidden window, and a close
// that never completes must still release the onboarding slot.
const CLOSE_FALLBACK_MS = 900;

export interface GenieCard {
  /** Render the card while true. */
  shown: boolean;
  /** The genie is running; the card should stop accepting input. */
  closing: boolean;
  /** Run the close, then report. First request wins. */
  closeThen: (report: () => void) => void;
  /** Backdrop opacity. Bind to the scrim's `opacity`. */
  scrim: ReturnType<typeof useMotionValue<number>>;
  wrapRef:   React.RefObject<HTMLDivElement | null>;
  cardRef:   React.RefObject<HTMLDivElement | null>;
  bandsRef:  React.RefObject<HTMLDivElement | null>;
  shadowRef: React.RefObject<HTMLDivElement | null>;
  reduced: boolean;
}

export function useGenieCard(isOpen: boolean, label: string): GenieCard {
  const reduced = useReducedMotion() ?? false;

  // closing: the genie is running. done: it has finished and the card is gone.
  const [closing, setClosing] = useState(false);
  const [done, setDone]       = useState(false);
  const afterCloseRef = useRef<(() => void) | null>(null);

  const shown = isOpen && !done;

  // genie: 1 = in the slot, 0 = the card at rest.
  const genie = useMotionValue(1);
  const scrim = useMotionValue(0);

  const wrapRef   = useRef<HTMLDivElement>(null);
  const cardRef   = useRef<HTMLDivElement>(null);
  const bandsRef  = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const geomRef   = useRef<GenieGeometry | null>(null);
  const rowsRef   = useRef<[number, number][] | null>(null);
  const bandsFailedRef = useRef(false);

  const measure = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    geomRef.current = r && r.width > 0
      ? { top: r.top, bottom: r.bottom, width: r.width, slotY: window.innerHeight - SLOT_INSET }
      : null;
  };

  // Cut the card into bands: copies of it, each showing a strip of rows.
  // Built when the genie starts and removed when it ends, so at rest there is
  // one card and nothing promoted to its own layer.
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
      console.warn(`[${label}] genie bands unavailable, using the outline genie:`, e);
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

    // The shadow is the card's own, drawn once and only ever moved: it follows
    // the card's top edge down and fades as the funnel forms, so it is gone
    // before the silhouette stops being a rectangle.
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
    // copying is the one heavy step, and done inside a frame it would make the
    // genie skip ahead. At rest the bands match the card exactly, so building
    // them early shows nothing.
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

  return { shown, closing, closeThen, scrim, wrapRef, cardRef, bandsRef, shadowRef, reduced };
}
