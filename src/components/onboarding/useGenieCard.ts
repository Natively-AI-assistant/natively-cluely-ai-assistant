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

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { animate, cubicBezier, useMotionValue, useReducedMotion } from 'framer-motion';
import {
  genieFrame, genieBands, genieBandRows, genieOpacity, genieShadowOpacity, genieEdges,
  genieTrack, SLOT_INSET, BAND_OVERLAP, type GenieGeometry,
} from './genieMotion.mjs';
import type { GenieSnapshot } from './genieSnapshots';
import { useGenieAnimationEnabled } from '../../lib/genieAnimationSetting';

const EASE_FM = [0.23, 1, 0.32, 1] as const;

/*
  The clock eases along a gentle, symmetric cubic Bezier, on top of the
  genie's own two phases (stretch, then drain), which already start and land
  softly. What matters at 60 Hz is how far the card moves in ONE frame: past
  about 60 px it stops reading as motion and starts to strobe. A strong
  ease-out here made the top edge jump 166 px in a frame; a linear clock, 45.
  This curve moves it at most ~55 px opening and ~60 closing, because the
  runs are a little longer than before (0.65 / 0.6 s, inside macOS's range:
  the GNOME port uses 560 / 480 ms, Harshil Shah's 700). The close is the
  quicker of the two: the user asked for it to go.
*/
const GENIE_EASE = [0.33, 0, 0.67, 1] as [number, number, number, number];
const GENIE_OPEN  = { duration: 0.65, ease: GENIE_EASE };
const GENIE_CLOSE = { duration: 0.6, ease: GENIE_EASE };

/** How long a card takes to pour back into the slot, for a host sequencing the next one after it. */
export const GENIE_CLOSE_MS = GENIE_CLOSE.duration * 1000;

// About this many bands. Each is a copy of the card mapped onto its own slice
// of the funnel, so the content pinches with the outline. 48 held 60fps with
// the CPU throttled 4x; 144 dropped frames.
const GENIE_BANDS = 48;

// A genie drawn from a picture (the macOS way) is cut much finer than one
// drawn from live copies: a strip is a slice of one image, not a whole card
// laid out again, so it costs next to nothing. One every 8 px keeps the
// funnel's edge on the curve (Harshil Shah's warp uses a row every 5-10 px;
// BCGenieEffect slices every 10).
const IMAGE_ROW_PX = 8;
const IMAGE_BANDS_MAX = 120;
// How long a close waits for a fresh picture before pouring the card away
// without one. A capture measures 3-15 ms.
const CAPTURE_WAIT_MS = 160;
// After an open lands, the picture stays over the live card until the card is
// done loading and has stopped changing, so a card still fetching or still
// bringing its rows in never shows that between the picture and itself. At
// most this long, then it fades anyway.
const LANDING_HOLD_MAX_MS = 900;
// ...and it must have stopped changing for this long: "not loading" alone let
// the Modes manager's rows arrive one by one after the picture had gone.
const LANDING_QUIET_MS = 150;
const LANDING_FADE_MS = 120;

const REDUCED_FADE  = { duration: 0.15, ease: 'linear' as const };
const SCRIM_OPEN_S  = 0.25;
const SCRIM_CLOSE_S = 0.3;

// Backstop: Chromium stops animation frames in a hidden window, and a close
// that never completes must still release the onboarding slot.
const CLOSE_FALLBACK_MS = 900;

// One run of the genie, from one progress to another, on the document
// timeline. The compositor plays it (genieTrack); framer's motion value runs
// the same run on the main thread as the bookkeeping clock: completion,
// interrupts, the outline fallback and the hidden-window backstop.
interface GenieRun {
  from: number;
  to: number;
  durationMs: number;
  ease: (t: number) => number;
  /** document.timeline time the run started at. */
  start: number;
  /**
   * The start is the first frame the run actually rendered on. Until then it
   * is only when the run was asked for, which a busy main thread (a card
   * mounting) can put well before any frame reaches the screen.
   */
  anchored?: boolean;
}

const easeOf = (transition: { ease: unknown }): ((t: number) => number) =>
  Array.isArray(transition.ease)
    ? cubicBezier(...(transition.ease as [number, number, number, number]))
    : (t: number) => t;

const timelineNow = () => Number(document.timeline?.currentTime ?? performance.now());

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

export interface GenieCardOptions {
  /** About this many bands (default 48), for a genie drawn from live copies. */
  bands?: number;
  /** Called once the card has fully poured out: it is visible and can take focus. */
  onOpened?: () => void;
  /**
   * Pictures of the card, so the genie warps one image the way macOS does
   * instead of live copies (genieSnapshots.ts). Without one (a card's first
   * open, a new theme or size), the live copies stand in.
   */
  snapshots?: GenieSnapshotSource;
}

export interface GenieSnapshotSource {
  /** The kept picture of the view the card is opening into. Called with the card in the DOM. */
  forOpen: () => GenieSnapshot | null;
  /** A picture of the card exactly as it is, for the close. */
  forClose: () => Promise<GenieSnapshot | null>;
  /** The live card has finished loading: the landing picture can give way to it. */
  settled: () => boolean;
}

export function useGenieCard(isOpen: boolean, label: string, options: GenieCardOptions = {}): GenieCard {
  // The genie also stands down when the user turns it off in Settings →
  // Advanced: the same plain fade, and no pictures taken.
  const genieEnabled = useGenieAnimationEnabled();
  const reduced = (useReducedMotion() ?? false) || !genieEnabled;
  const bandCount = options.bands ?? GENIE_BANDS;
  const onOpenedRef = useRef(options.onOpened);
  onOpenedRef.current = options.onOpened;
  const snapshotsRef = useRef(options.snapshots);
  snapshotsRef.current = options.snapshots;

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
  const runRef = useRef<GenieRun | null>(null);
  // The picture this run warps, if it has one. Null: live copies.
  const imageRef = useRef<GenieSnapshot | null>(null);
  // The landing: the picture held over the live card until it is ready.
  const landingRef = useRef<{ el: HTMLElement; cancel: () => void } | null>(null);
  // The compositor's animations for the current run: one per band, the band
  // layer's fade and the shadow stand-in. Empty when the main thread draws.
  const trackRef = useRef<Animation[]>([]);
  const pinsRef = useRef(new WeakMap<HTMLElement, string>());

  const measure = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    geomRef.current = r && r.width > 0
      ? { top: r.top, bottom: r.bottom, width: r.width, slotY: window.innerHeight - SLOT_INSET }
      : null;
  };

  // Where the genie is, as the eye sees it: the compositor's run, read off the
  // same timeline it plays on. Framer's value can trail it by a frame, and a
  // close that starts from there would step backwards.
  const visibleProgress = (): number => {
    const run = runRef.current;
    if (!run) return genie.get();
    const t = Math.min(1, Math.max(0, (timelineNow() - run.start) / run.durationMs));
    return run.from + (run.to - run.from) * run.ease(t);
  };

  const stopTrack = () => {
    trackRef.current.forEach(a => a.cancel());
    trackRef.current = [];
  };

  // Hand the current run to the compositor: every band, the band layer and
  // the shadow get a Web Animation through a precomputed frame 120 times a
  // second, blended linearly between them, all started at the run's own
  // start time. (Holding each frame instead left a 60 Hz display landing on
  // one sample some frames and three the next: uneven steps. Between samples
  // 8 ms apart the blend stays within the bands' 2 px overlap.)
  const playTrack = () => {
    stopTrack();
    const run = runRef.current, geom = geomRef.current, rows = rowsRef.current;
    const layer = bandsRef.current, shadow = shadowRef.current;
    if (!run || !geom || !rows || !layer || !shadow || typeof layer.animate !== 'function') return;
    try {
      const track = genieTrack(run.from, run.to, run.ease, run.durationMs, geom, rows);
      const timing: KeyframeAnimationOptions = { duration: run.durationMs, fill: 'both' };
      const held = <T,>(values: T[], key: (v: T) => Keyframe) =>
        values.map((v, i) => ({ ...key(v), offset: track.offsets[i] }));
      const anims: Animation[] = [];
      track.bands.forEach((frames, b) => {
        const band = layer.children[b] as HTMLElement | undefined;
        if (band) anims.push(band.animate(held(frames, m => ({ transform: m })), timing));
      });
      anims.push(layer.animate(held(track.layerOpacity, o => ({ opacity: String(o) })), timing));
      shadow.style.display = 'block';
      anims.push(shadow.animate(
        held(track.shadowTransform.map((tf, i) => [tf, track.shadowOpacity[i]] as const),
          ([tf, o]) => ({ transform: tf, opacity: String(o) })),
        timing,
      ));
      if (run.anchored) {
        // A replay (a re-cut, or a close taking over mid-open): same clock.
        anims.forEach(a => { a.startTime = run.start; });
      } else {
        // Start on the next frame that renders, all together, with framer's
        // clock, which also starts on that frame. Stamped with the moment it
        // was asked for instead, a run whose first frames a busy main thread
        // delayed opened already part-way through: a jump at the start.
        // Until then the animations sit on their first frame.
        requestAnimationFrame(() => {
          if (runRef.current !== run || trackRef.current !== anims) return;
          run.start = timelineNow();
          run.anchored = true;
          anims.forEach(a => { a.startTime = run.start; });
        });
      }
      trackRef.current = anims;
    } catch (e) {
      // The main thread draws it instead, frame by frame, as it always did.
      console.warn(`[${label}] genie compositor track unavailable:`, e);
      stopTrack();
    }
  };

  // Cut ONE picture of the card into strips, each a slice of the same image
  // placed where its rows sit: BCGenieEffect's slices, macOS's single
  // texture. Nothing is laid out again, so the strips are fine and cheap, and
  // every strip shows the same pixels, so nothing can differ between them.
  const buildImageBands = (snap: GenieSnapshot): boolean => {
    const card = cardRef.current, layer = bandsRef.current, geom = geomRef.current;
    if (!card || !layer || !geom) return false;
    const height = Math.round(geom.bottom - geom.top);
    const count = Math.min(IMAGE_BANDS_MAX, Math.max(12, Math.ceil(height / IMAGE_ROW_PX)));
    const rows = genieBandRows(height, count);
    const radius = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
    const frag = document.createDocumentFragment();
    rows.forEach(([r0, r1], i) => {
      const band = document.createElement('div');
      band.className = 'genie-band';
      const h = r1 - r0 + (i < rows.length - 1 ? BAND_OVERLAP : 0);
      band.style.cssText = `position:absolute;left:0;width:100%;top:${r0}px;height:${h}px;`
        + 'overflow:hidden;transform-origin:0 0;will-change:transform;';
      band.appendChild(pictureSlice(snap, r0, h, height, radius));
      frag.appendChild(band);
    });
    layer.replaceChildren(frag);
    rowsRef.current = rows;
    playTrack();
    return true;
  };

  const releaseImage = () => {
    const snap = imageRef.current;
    imageRef.current = null;
    if (snap?.transient) snap.bitmap.close();
  };

  const endLanding = () => {
    landingRef.current?.cancel();
    landingRef.current = null;
  };

  // The open has landed on a picture. Hand over to the live card without a
  // pop: the picture stays on top until the card has finished loading (or
  // LANDING_HOLD_MAX_MS), then fades away over it.
  const holdLanding = (snap: GenieSnapshot) => {
    const layer = bandsRef.current, card = cardRef.current;
    if (!layer || !card) return;
    endLanding();
    const height = card.getBoundingClientRect().height;
    const pic = pictureSlice(snap, 0, height, height, parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0);
    pic.style.inset = '0';
    layer.style.opacity = '1';
    layer.replaceChildren(pic);
    const started = performance.now();
    let changedAt = started;
    const quiet = new MutationObserver(() => { changedAt = performance.now(); });
    quiet.observe(card, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    let frame = 0;
    let fade: Animation | null = null;
    const finish = () => { cancelAnimationFrame(frame); quiet.disconnect(); fade?.cancel(); if (pic.isConnected) pic.remove(); };
    const check = () => {
      const now = performance.now();
      const ready = (snapshotsRef.current?.settled() ?? true) && now - changedAt >= LANDING_QUIET_MS;
      if (!ready && now - started < LANDING_HOLD_MAX_MS) { frame = requestAnimationFrame(check); return; }
      quiet.disconnect();
      fade = pic.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LANDING_FADE_MS, easing: 'ease-out', fill: 'forwards' });
      fade.finished.then(() => { if (landingRef.current?.el === pic) landingRef.current = null; pic.remove(); }).catch(() => {});
    };
    landingRef.current = { el: pic, cancel: finish };
    check();
  };

  // Cut the card into bands: copies of it, each showing a strip of rows.
  // Built when the genie starts and removed when it ends, so at rest there is
  // one card and nothing promoted to its own layer.
  const buildBands = (): boolean => {
    if (imageRef.current) return buildImageBands(imageRef.current);
    const card = cardRef.current, layer = bandsRef.current, geom = geomRef.current;
    if (!card || !layer || !geom) return false;
    try {
      const count = bandCount;
      const height = Math.round(geom.bottom - geom.top);
      const rows = genieBandRows(height, count);
      // A clone starts scrolled to the top and with its canvases blank. Note
      // what the card is showing now, so every copy can be put back to it.
      const scrolled = scrolledElements(card);
      const canvases = Array.from(card.querySelectorAll('canvas'));
      const frag = document.createDocumentFragment();
      const copies: HTMLElement[] = [];
      rows.forEach(([r0, r1], i) => {
        const band = document.createElement('div');
        band.style.cssText = `position:absolute;left:0;width:100%;top:${r0}px;`
          + `height:${r1 - r0 + (i < rows.length - 1 ? BAND_OVERLAP : 0)}px;`
          + 'overflow:hidden;transform-origin:0 0;will-change:transform;';
        const copy = card.cloneNode(true) as HTMLElement;
        // A copy is a picture, not a dialog: no ids, test ids, form-control
        // names, promoted layers or live media (sanitizeCopy below).
        sanitizeCopy(copy);
        // The height is pinned: a card sized by percentage (h-full) would
        // otherwise resolve it against the band, a few pixels tall.
        const pin = `;position:absolute;left:0;top:${-r0}px;width:100%;height:${height}px;`
          + 'visibility:visible;transform:none;clip-path:none;opacity:1;box-shadow:none;';
        pinsRef.current.set(copy, pin);
        copy.style.cssText += pin;
        copy.querySelectorAll('canvas').forEach((c, k) => {
          try { c.getContext('2d')?.drawImage(canvases[k], 0, 0); } catch { /* tainted or webgl: leave blank */ }
        });
        band.appendChild(copy);
        frag.appendChild(band);
        copies.push(copy);
      });
      layer.replaceChildren(frag);
      // Scroll offsets only take once the copies are in the document.
      if (scrolled.length) {
        for (const copy of copies) {
          for (const { path, top, left } of scrolled) {
            const el = elementAt(copy, path);
            if (el) { el.scrollTop = top; el.scrollLeft = left; }
          }
        }
      }
      rowsRef.current = rows;
      playTrack();
      return true;
    } catch (e) {
      console.warn(`[${label}] genie bands unavailable, using the outline genie:`, e);
      layer.replaceChildren();
      rowsRef.current = null;
      return false;
    }
  };

  const clearBands = () => {
    stopTrack();
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

    // At rest only when the run is heading there (an open, or nothing
    // running). A close starts from rest too, and its eased progress stays
    // under 0.001 for its first frames: treated as rest, those frames threw
    // away the bands the close had just cut and cut them again a moment
    // later, a ~100 ms stall at the start of every close of a heavy card.
    const settling = !runRef.current || runRef.current.to === 0;
    if ((p <= 0.001 && settling) || !geom) {
      // At rest: the real card, whole, with its own shadow.
      const landedOn = rowsRef.current && imageRef.current;
      clearBands();
      if (landedOn && imageRef.current) holdLanding(imageRef.current);
      card.style.visibility = '';
      card.style.transform = card.style.clipPath = '';
      card.style.opacity = '1';
      shadow.style.display = 'none';
      return;
    }

    if (!rowsRef.current && !bandsFailedRef.current) bandsFailedRef.current = !buildBands();
    const rows = rowsRef.current;
    // The compositor is drawing this run: the main thread only keeps the
    // copies live and the real card out of sight.
    const composited = rows !== null && trackRef.current.length > 0;
    if (rows) {
      card.style.visibility = 'hidden';
      // Opacity too: a descendant that sets visibility: visible inline shows
      // through a hidden parent (Settings' panel did), and opacity cannot be
      // overridden from below.
      card.style.opacity = '0';
      if (!composited) {
        layer.style.opacity = String(genieOpacity(p));
        const transforms = genieBands(p, geom, rows);
        const els = layer.children;
        for (let i = 0; i < transforms.length; i++) (els[i] as HTMLElement).style.transform = transforms[i];
      }
    } else {
      // Fallback: warp the outline only.
      const f = genieFrame(p, geom);
      card.style.transform = f.transform;
      card.style.clipPath = f.clipPath;
      card.style.opacity = String(f.opacity);
    }

    // The shadow is the card's own, drawn once and only ever moved: it follows
    // the card's top edge down and is gone within a few px of the card
    // pinching in, since it is a rectangle's and would outline one round the
    // funnel (genieShadowOpacity).
    if (composited) return;
    const { top, bottom } = genieEdges(p, geom);
    const sy = Math.max(bottom - top, 0.5) / (geom.bottom - geom.top);
    shadow.style.display = 'block';
    shadow.style.transform = `translateY(${(top - geom.top).toFixed(2)}px) scaleY(${sy.toFixed(4)})`;
    shadow.style.opacity = String(genieShadowOpacity(p, geom));
  }, [reduced, bandCount]);

  useEffect(() => genie.on('change', renderGenie), [genie, renderGenie]);

  // Pour out whenever the card appears. A layout effect, so the card is hidden
  // and cut into bands before the browser paints it: from a plain effect the
  // first frame showed the whole card at rest, then the genie started. (The
  // dim used to hide that frame, back when the card sat inside it.)
  useLayoutEffect(() => {
    if (!shown) return;
    measure();
    bandsFailedRef.current = false;
    endLanding();
    releaseImage();
    // Pour out the last picture of the view this card opens into, if there is
    // one; otherwise the live copies stand in, this once.
    imageRef.current = reduced ? null : (snapshotsRef.current?.forOpen() ?? null);
    // No picture yet (a card's first open, a new theme or size): the outline
    // genie on the real card, one element, rather than dozens of live copies
    // replaying a loading card into each other (the stutter, and the GPU
    // running out of tile memory).
    if (snapshotsRef.current && !imageRef.current) bandsFailedRef.current = true;
    runRef.current = reduced ? null : {
      from: 1, to: 0, durationMs: GENIE_OPEN.duration * 1000, ease: easeOf(GENIE_OPEN), start: timelineNow(),
    };
    genie.set(1);
    renderGenie(1);
    scrim.set(0);
    const a = animate(genie, 0, reduced ? REDUCED_FADE : GENIE_OPEN);
    const b = animate(scrim, 1, { duration: SCRIM_OPEN_S, ease: EASE_FM as any });
    let live = true;
    a.then(() => { if (live) onOpenedRef.current?.(); });
    return () => { live = false; a.stop(); b.stop(); clearBands(); endLanding(); runRef.current = null; };
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
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    // outlineOnly: a card drawn from pictures that has none for this close
    // pours away as its own outline, never as live copies.
    const run = (outlineOnly: boolean) => {
      // Re-measure, and cut fresh bands from the card as it looks now (hover
      // states and all): the window may have been resized since it opened.
      if (genie.get() <= 0.001) { measure(); clearBands(); bandsFailedRef.current = outlineOnly; }
      // Closed mid-open: carry on from where the eye sees the card, not from
      // where framer's value has got to.
      const from = visibleProgress();
      if (Math.abs(from - genie.get()) > 0.001) genie.set(from);
      runRef.current = reduced ? null : {
        from, to: 1, durationMs: GENIE_CLOSE.duration * 1000, ease: easeOf(GENIE_CLOSE), start: timelineNow(),
      };
      // Cut the bands before the clock starts, not on its first frame: the
      // copying is the one heavy step, and done inside a frame it would make the
      // genie skip ahead. At rest the bands match the card exactly, so building
      // them early shows nothing. Bands already cut (closed mid-open) take the
      // new run.
      if (!reduced && !rowsRef.current && !bandsFailedRef.current) bandsFailedRef.current = !buildBands();
      else if (rowsRef.current) playTrack();
      // The bands and the shadow stand-in are showing now. Hand over from the
      // real card at once, not on the clock's first change: that comes a frame
      // later, and for that frame the card's own shadow and the stand-in's
      // were drawn together, twice as dark.
      if (!reduced && rowsRef.current) renderGenie(from);
      const a = animate(genie, 1, reduced ? REDUCED_FADE : GENIE_CLOSE);
      const b = animate(scrim, 0, reduced
        ? REDUCED_FADE
        : { duration: SCRIM_CLOSE_S, delay: GENIE_CLOSE.duration - SCRIM_CLOSE_S, ease: EASE_FM as any });
      // `live`: when the backstop has already released the card (frames were
      // stopped in a hidden window) and the host has moved on, the animation
      // can still resolve later. Setting done then would leave a host that
      // keeps this mounted (GenieModal) unable to ever show the card again.
      let live = true;
      Promise.all([a, b]).then(() => { if (!live) return; setDone(true); finishClose(); });
      const t = setTimeout(finishClose, CLOSE_FALLBACK_MS);
      cleanup = () => { live = false; clearTimeout(t); a.stop(); b.stop(); stopTrack(); runRef.current = null; };
    };

    // A card at rest pours away as a picture of itself taken now (a few ms),
    // exactly as it is on screen, the way macOS minimizes a window. Closed
    // mid-open, it keeps whatever the open was drawn from.
    endLanding();
    const source = snapshotsRef.current;
    const atRest = genie.get() <= 0.001 && !rowsRef.current;
    if (source && atRest && !reduced) {
      const shot = source.forClose().catch(() => null);
      const late = new Promise<null>(r => setTimeout(() => r(null), CAPTURE_WAIT_MS));
      Promise.race([shot, late]).then(snap => {
        if (cancelled) return;
        releaseImage();
        imageRef.current = snap;
        // No picture in time: the outline genie on the real card.
        run(!snap);
        // A picture that arrived after the close had to start without it.
        if (!snap) shot.then(s => { if (s?.transient) s.bitmap.close(); });
      });
    } else {
      if (atRest) releaseImage();
      run(false);
    }
    return () => { cancelled = true; cleanup?.(); };
  }, [closing, reduced, genie, scrim, finishClose, renderGenie]);

  // A host that keeps this mounted and opens it again gets a fresh card.
  useEffect(() => {
    if (!isOpen) { setClosing(false); setDone(false); afterCloseRef.current = null; endLanding(); releaseImage(); }
  }, [isOpen]);

  return { shown, closing, closeThen, scrim, wrapRef, cardRef, bandsRef, shadowRef, reduced };
}

/**
 * Rows [top, top + height) of a picture of the card, as a canvas: the strip
 * of one image a band carries. The card's own rounded corners are clipped
 * back in (the capture is its rectangle, corners and all). Drawn once; after
 * that the compositor only moves it.
 */
function pictureSlice(snap: GenieSnapshot, top: number, height: number, cardHeight: number, radius: number): HTMLCanvasElement {
  const { bitmap } = snap;
  const scale = bitmap.height / cardHeight;
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.style.cssText = `position:absolute;left:0;top:0;width:100%;height:${height}px;`;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const dy = -Math.round(top * scale);
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(0, dy, bitmap.width, bitmap.height, radius * scale);
    else ctx.rect(0, dy, bitmap.width, bitmap.height);
    ctx.clip();
    ctx.drawImage(bitmap, 0, dy);
    ctx.restore();
  }
  return canvas;
}

// Every element inside `root` that is scrolled, by its child-index path.
function scrolledElements(root: Element): { path: number[]; top: number; left: number }[] {
  const out: { path: number[]; top: number; left: number }[] = [];
  const walk = (el: Element, path: number[]) => {
    if (el.scrollTop || el.scrollLeft) out.push({ path, top: el.scrollTop, left: el.scrollLeft });
    for (let i = 0; i < el.children.length; i++) walk(el.children[i], [...path, i]);
  };
  walk(root, []);
  return out;
}

function elementAt(root: Element, path: number[]): Element | null {
  let el: Element | null = root;
  for (const i of path) { el = el?.children[i] ?? null; if (!el) return null; }
  return el;
}

/**
 * A copy is a picture, not a dialog: no ids to collide with the real card's
 * aria references, no test ids for a test to find twice, no form-control
 * names (a copied radio sharing a live radio's name would join its group),
 * nothing promoted to its own layer and no live media.
 */
function sanitizeCopy(copy: HTMLElement): void {
  copy.removeAttribute('role');
  copy.removeAttribute('aria-modal');
  copy.removeAttribute('aria-labelledby');
  copy.removeAttribute('aria-describedby');
  copy.removeAttribute('id');
  copy.removeAttribute('data-testid');
  copy.removeAttribute('inert');
  copy.querySelectorAll<HTMLElement>('[id]').forEach(el => el.removeAttribute('id'));
  copy.querySelectorAll<HTMLElement>('[data-testid]').forEach(el => el.removeAttribute('data-testid'));
  copy.querySelectorAll<HTMLElement>('[name]').forEach(el => el.removeAttribute('name'));
  // Live content would load or play once per band; a blank box of the same
  // size is all a band needs for half a second.
  copy.querySelectorAll<HTMLElement>('iframe, webview, video, audio').forEach(el => {
    const stub = document.createElement('div');
    stub.className = el.className;
    stub.style.cssText = el.style.cssText;
    el.replaceWith(stub);
  });
  copy.querySelectorAll<HTMLElement>('[style]').forEach(el => {
    el.style.willChange = 'auto';
    if (el.style.filter === 'blur(0px)') el.style.filter = '';
  });
}
