import { useCallback, useEffect, useRef } from 'react';
import { plansVisit } from './plansVisit.mjs';

/**
 * Callbacks fire as the visible share crosses each of these. Steps of 5% so a
 * section up to ten times the panel's height still crosses one at the moment
 * half the panel is filled with it (the "tall" rule below).
 */
const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);

/**
 * Reports to the Plans & Billing visit (plansVisit.mjs) when an element is
 * on screen: at least half of it, or, for something taller than the panel,
 * enough of it to fill half the panel. Returns a ref callback for the element.
 *
 * onScreenChange, when given, hears every change in that state, on screen or
 * not, for parts that need to know when they leave view as well.
 *
 * IntersectionObserver with no root measures against the window but clips by
 * every scrolling ancestor, so this works for the Settings panel's scroll and
 * for a section folded inside a closed accordion (0 px tall: never on screen).
 * When a new visit starts while the element stays mounted (Settings hidden and
 * shown again), it is observed afresh so it reports again.
 */
export function usePlansSeen(
  onSeen: () => void,
  onScreenChange?: (onScreen: boolean) => void,
): (el: Element | null) => void {
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;
  const onChangeRef = useRef(onScreenChange);
  onChangeRef.current = onScreenChange;
  const elRef = useRef<Element | null>(null);
  const ioRef = useRef<IntersectionObserver | null>(null);

  const observer = useCallback(() => {
    if (ioRef.current || typeof IntersectionObserver === 'undefined') return ioRef.current;
    ioRef.current = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const rootH = e.rootBounds?.height ?? window.innerHeight;
        const onScreen = e.isIntersecting && e.boundingClientRect.height > 0
          && (e.intersectionRatio >= 0.5 || e.intersectionRect.height >= rootH * 0.5);
        onChangeRef.current?.(onScreen);
        if (onScreen) onSeenRef.current();
      }
    }, { threshold: THRESHOLDS });
    return ioRef.current;
  }, []);

  useEffect(() => {
    // Re-created after a cleanup (React's development double mount runs the
    // cleanup below once without detaching the element).
    const el0 = elRef.current;
    if (el0 && !ioRef.current) observer()?.observe(el0);
    const off = plansVisit.onStart(() => {
      const el = elRef.current;
      const io = ioRef.current;
      if (el && io) { io.unobserve(el); io.observe(el); }
    });
    return () => { off(); ioRef.current?.disconnect(); ioRef.current = null; };
  }, [observer]);

  return useCallback((el: Element | null) => {
    const io = observer();
    if (elRef.current && io) io.unobserve(elRef.current);
    elRef.current = el;
    if (el && io) io.observe(el);
  }, [observer]);
}
