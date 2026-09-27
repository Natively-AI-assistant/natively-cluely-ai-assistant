import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { animate, AnimatePresence, motion, useIsPresent, useReducedMotion, type AnimationPlaybackControls, type Variants } from 'framer-motion';

/** Asks the overlay to own the window height while a fold tweens (NativelyInterface.requestChromeHeightMotion). */
export type RequestHeightMotion = (growPx: number, durationMs: number, options?: { resize?: boolean }) => (() => void) | null;

const EASE_SMOOTH_OUT = [0.22, 1, 0.36, 1] as const;
const ENTER_S = 0.25;          // --duration-fast
const FADE_S = 0.15;           // --duration-quick: the close is quicker than the open
const COLLAPSE_DELAY_S = 0.06; // the contents are mostly gone before the room closes
const COLLAPSE_S = 0.25;       // --duration-fast
const ENTER_MS = ENTER_S * 1000;
const FADE_MS = FADE_S * 1000;
export const FOLD_EXIT_MS = Math.round((COLLAPSE_DELAY_S + COLLAPSE_S) * 1000);

const variants = (reduce: boolean): Variants => ({
  hidden: reduce
    ? { opacity: 0 }
    : { opacity: 0, height: 0, y: 4, filter: 'blur(2px)', overflow: 'hidden' },
  shown: reduce
    ? { opacity: 1, transition: { duration: FADE_S } }
    : {
        opacity: 1, height: 'auto', y: 0, filter: 'blur(0px)',
        transition: {
          height: { duration: ENTER_S, ease: EASE_SMOOTH_OUT },
          y: { duration: ENTER_S, ease: EASE_SMOOTH_OUT },
          filter: { duration: ENTER_S, ease: EASE_SMOOTH_OUT },
          opacity: { duration: 0.2, ease: 'easeOut' },
        },
        // No filter left at rest: a resting blur(0) is still a compositing
        // layer, and it would change what the glass surfaces inside sample.
        transitionEnd: { overflow: 'visible', filter: 'none' },
      },
  // `instant`: the overlay is hidden, so there is nothing to watch fold.
  exit: (instant: boolean | undefined) => instant
    ? { opacity: 0, transition: { duration: 0 } }
    : reduce
    ? { opacity: 0, transition: { duration: FADE_S } }
    : {
        opacity: 0, height: 0, y: -2, filter: 'blur(2px)', overflow: 'hidden',
        transition: {
          opacity: { duration: FADE_S, ease: EASE_SMOOTH_OUT },
          y: { duration: FADE_S, ease: EASE_SMOOTH_OUT },
          filter: { duration: FADE_S, ease: EASE_SMOOTH_OUT },
          height: { duration: COLLAPSE_S, delay: COLLAPSE_DELAY_S, ease: EASE_SMOOTH_OUT },
        },
      },
});

// Glass inside a fold (the tab picker's backdrop-blur, the status pills, the
// liquid-glass tray): while the box has opacity < 1 or any filter it is the
// backdrop ROOT, so that glass samples nothing behind it until the fold ends
// and then snaps in (measured: a mean 15-21/255 change across the tab picker
// in its last frame). Those folds clip open and shut by height and position
// only: no fade, no blur, glass correct on every frame.
// Named states beside the fade ones: glass is only found once the contents
// are in the DOM, after framer has started the fade, and only a change of the
// `animate` LABEL retargets a running animation.
const clipVariants: Variants = {
  shownClip: {
    opacity: 1, filter: 'none', height: 'auto', y: 0,
    transition: {
      height: { duration: ENTER_S, ease: EASE_SMOOTH_OUT },
      y: { duration: ENTER_S, ease: EASE_SMOOTH_OUT },
      opacity: { duration: 0 },
      filter: { duration: 0 },
    },
    transitionEnd: { overflow: 'visible' },
  },
  exitClip: (instant: boolean | undefined) => instant
    ? { opacity: 0, transition: { duration: 0 } }
    : {
        height: 0, y: -2, overflow: 'hidden',
        transition: {
          height: { duration: COLLAPSE_S, ease: EASE_SMOOTH_OUT },
          y: { duration: COLLAPSE_S, ease: EASE_SMOOTH_OUT },
        },
      },
};

const hasGlass = (root: Element) => {
  const glassy = (el: Element) => [null, '::before', '::after'].some((pseudo) => {
    // The liquid-glass surfaces draw their glass on a pseudo-element.
    const cs = getComputedStyle(el, pseudo) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
    const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
    return bf !== 'none' && bf !== '';
  });
  if (glassy(root)) return true;
  const all = root.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) if (glassy(all[i])) return true;
  return false;
};

const FoldBody: React.FC<{
  reduce: boolean;
  instant: boolean;
  innerRef: React.RefObject<HTMLDivElement | null>;
  innerClassName?: string;
  testId?: string;
  onShown: () => void;
  /** The open fold's contents changed height; returns the settle for the tween, or null to step. */
  onResize: (fromPx: number, toPx: number) => { settle: (() => void) | null; tween: boolean };
  /** False when AnimatePresence skips the entrance (the fold was already shown at mount). */
  mountedAnimated: boolean;
  children: React.ReactNode;
}> = ({ reduce, instant, innerRef, innerClassName, testId, onShown, onResize, mountedAnimated, children }) => {
  // A leaving fold still looks clickable for its fade; it must not be.
  const present = useIsPresent();
  // null until the contents have been checked for glass (before the first
  // paint); only then does the box get a target, so framer starts ONE open,
  // in the right mode.
  const [mode, setMode] = useState<'fade' | 'clip' | null>(null);
  const useClip = mode === 'clip' && !reduce;
  const v = useMemo(() => ({ ...variants(reduce), ...clipVariants }), [reduce]);
  const boxRef = useRef<HTMLDivElement>(null);
  // Before the first paint, so the fade never starts on a glass block.
  useLayoutEffect(() => {
    setMode(innerRef.current && hasGlass(innerRef.current) ? 'clip' : 'fade');
  }, [innerRef]);
  // Open and at rest: the only state in which a content change may tween.
  // During the open or the fold, framer's variant owns the box's height.
  // Open at rest from the start when it mounts without an open animation
  // (instant, or already shown when the overlay mounted): no 'shown'
  // completion will ever arrive to say so.
  const settledRef = useRef(instant || !mountedAnimated);
  const resizeRef = useRef<{ controls: AnimationPlaybackControls; settle: (() => void) | null } | null>(null);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const startResizeRef = useRef<((from: number, to: number) => void) | null>(null);
  // The height framer's open is heading for. The open measures `auto` once,
  // when it starts, so contents that change during it (the tab list landing
  // as the picker opens) would snap in when the open ends at `auto`.
  const openTargetRef = useRef<number | null>(null);

  // transitions.dev #01 card resize, for a fold that is already open: the tab
  // picker's list arriving after "Finding open tabs…", a second status pill
  // wrapping the row onto another line. The ResizeObserver runs after layout
  // and before paint, so the box is pinned back to the old height before the
  // new one is ever drawn.
  useLayoutEffect(() => {
    const inner = innerRef.current;
    const box = boxRef.current;
    if (!inner || !box || typeof ResizeObserver === 'undefined') return;
    let last = inner.offsetHeight;
    const startResize = (from: number, next: number) => {
      const previous = resizeRef.current;
      resizeRef.current = null;
      previous?.controls.stop();
      const { settle, tween } = onResizeRef.current(from, next);
      previous?.settle?.();
      if (!tween) {
        box.style.height = 'auto';
        box.style.overflow = 'visible';
        settle?.();
        return;
      }
      box.style.overflow = 'hidden';
      box.style.height = `${from}px`;
      const controls = animate(box, { height: [from, next] }, { duration: ENTER_S, ease: EASE_SMOOTH_OUT });
      const entry = { controls, settle };
      resizeRef.current = entry;
      controls.then(() => {
        if (resizeRef.current !== entry) return;
        resizeRef.current = null;
        box.style.height = 'auto';
        box.style.overflow = 'visible';
        settle?.();
      });
    };
    startResizeRef.current = startResize;
    const ro = new ResizeObserver(() => {
      const next = inner.offsetHeight;
      const from = resizeRef.current ? box.offsetHeight : last;
      last = next;
      if (!settledRef.current || Math.abs(next - from) < 1) return;
      startResize(from, next);
    });
    ro.observe(inner);
    return () => {
      ro.disconnect();
      resizeRef.current?.controls.stop();
      resizeRef.current?.settle?.();
      resizeRef.current = null;
    };
  }, [innerRef]);

  // The fold starts leaving: hand the height back to the exit variant.
  if (!present && settledRef.current) {
    settledRef.current = false;
    const running = resizeRef.current;
    resizeRef.current = null;
    running?.controls.stop();
    running?.settle?.();
  }

  return (
    <motion.div
      ref={boxRef}
      variants={v}
      initial={instant ? false : 'hidden'}
      animate={mode === null ? undefined : useClip ? 'shownClip' : 'shown'}
      exit={useClip ? 'exitClip' : 'exit'}
      onAnimationStart={(definition) => {
        if (definition !== 'shown' && definition !== 'shownClip') return;
        settledRef.current = false;
        openTargetRef.current = innerRef.current?.offsetHeight ?? null;
      }}
      onAnimationComplete={(definition) => {
        if (definition !== 'shown' && definition !== 'shownClip') return;
        settledRef.current = true;
        const target = openTargetRef.current;
        openTargetRef.current = null;
        const now = innerRef.current?.offsetHeight;
        // Changed while opening: carry on from where the open landed, in the
        // same frame, before `auto` paints the new height.
        if (!reduce && target !== null && now !== undefined && Math.abs(now - target) >= 1) {
          startResizeRef.current?.(target, now);
        }
        onShown();
      }}
      style={{ pointerEvents: present ? undefined : 'none' }}
      data-testid={testId}
    >
      {/* Spacing lives INSIDE the animated box as padding: a margin would
          survive height 0 and leave a step at the end of the fold. */}
      <div ref={innerRef} className={innerClassName}>{children}</div>
    </motion.div>
  );
};

/**
 * A block of the overlay's chrome (anything outside the chat viewport) that
 * opens and folds instead of popping in and out. The card's height is chrome +
 * viewport, so a plain `cond && <div>` moves the card, and the window with it,
 * in one frame.
 *
 * The window height is asked for up front: one resize that LEADS an opening
 * (a window shorter than the card cuts the footer off), none per frame, and one
 * settle when the tween really ends. When the overlay can't hold the channel
 * (an answer is streaming, another transition holds it) the fold tweens anyway
 * and the overlay's usual height reporting follows it.
 *
 * Nothing folds while the overlay is off screen or only now appearing (a
 * screenshot taken while it was hidden shows it): the block is simply there
 * when the overlay fades in, and the overlay's show path sizes the window once.
 * Tweening then would resize the window every frame under the fade-in.
 *
 * While folding, the contents are the last ones shown: AnimatePresence keeps
 * the element from the last render with `show` true, so an emptied list does
 * not flash "0 items" on its way out.
 */
export const ChromeFold: React.FC<{
  show: boolean;
  /** Whether the overlay itself is on screen (NativelyInterface's isExpanded). */
  overlayVisible: boolean;
  requestHeightMotion?: RequestHeightMotion;
  innerClassName?: string;
  testId?: string;
  children: React.ReactNode;
}> = ({ show, overlayVisible, requestHeightMotion, innerClassName, testId, children }) => {
  const reduce = useReducedMotion() ?? false;
  const requestRef = useRef(requestHeightMotion);
  requestRef.current = requestHeightMotion;
  const innerRef = useRef<HTMLDivElement>(null);
  const enterSettleRef = useRef<(() => void) | null>(null);
  const exitSettleRef = useRef<(() => void) | null>(null);
  const wasShownRef = useRef(show);
  // AnimatePresence initial={false}: a fold shown on the first render never
  // plays its entrance.
  const firstRenderRef = useRef(true);
  useEffect(() => { firstRenderRef.current = false; }, []);
  // The overlay's visibility as of the last commit. A change that arrives in
  // the same update that shows the overlay reads false here, so it's instant.
  const visibleBeforeRef = useRef(overlayVisible);
  const instant = !overlayVisible || !visibleBeforeRef.current;

  // Runs after the fold is in the DOM (at height 0 when opening), before it
  // paints. Ask for the new hold BEFORE releasing an older one: releasing
  // first would let the overlay report a mid-tween height in between.
  useLayoutEffect(() => {
    const was = wasShownRef.current;
    wasShownRef.current = show;
    visibleBeforeRef.current = overlayVisible;
    if (was === show) return;
    if (instant) {
      [enterSettleRef.current, exitSettleRef.current].forEach((settle) => settle?.());
      enterSettleRef.current = null;
      exitSettleRef.current = null;
      return;
    }
    // Reduced motion still asks: the height then steps instead of tweening,
    // and the window must lead that step too, or the footer is cut for a frame.
    const request = requestRef.current;
    if (show) {
      const grow = innerRef.current?.offsetHeight ?? 0;
      const previous = [enterSettleRef.current, exitSettleRef.current];
      enterSettleRef.current = request?.(grow, reduce ? FADE_MS : ENTER_MS) ?? null;
      exitSettleRef.current = null;
      previous.forEach((settle) => settle?.());
    } else {
      const previous = [enterSettleRef.current, exitSettleRef.current];
      exitSettleRef.current = request?.(0, reduce ? FADE_MS : FOLD_EXIT_MS) ?? null;
      enterSettleRef.current = null;
      previous.forEach((settle) => settle?.());
    }
  }, [show, reduce, overlayVisible, instant]);

  useEffect(() => () => {
    enterSettleRef.current?.();
    exitSettleRef.current?.();
  }, []);

  const instantRef = useRef(instant);
  instantRef.current = instant;
  const resized = (from: number, to: number) => {
    if (reduce || instantRef.current || !requestRef.current) return { settle: null, tween: false };
    // Refused = the width is moving: step with it rather than lag behind it.
    const settle = requestRef.current(Math.max(0, to - from), ENTER_MS, { resize: true });
    return { settle, tween: settle !== null };
  };

  const shown = () => {
    const settle = enterSettleRef.current;
    enterSettleRef.current = null;
    settle?.();
  };
  const folded = () => {
    const settle = exitSettleRef.current;
    exitSettleRef.current = null;
    settle?.();
  };

  return (
    <AnimatePresence initial={false} custom={instant} onExitComplete={folded}>
      {show && (
        <FoldBody
          key="fold"
          reduce={reduce}
          instant={instant}
          innerRef={innerRef}
          innerClassName={innerClassName}
          testId={testId}
          onShown={shown}
          onResize={resized}
          mountedAnimated={!firstRenderRef.current}
        >
          {children}
        </FoldBody>
      )}
    </AnimatePresence>
  );
};

export default ChromeFold;
