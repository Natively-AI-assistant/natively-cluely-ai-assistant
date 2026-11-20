// src/components/upgrade/PlansSwap.tsx
//
// The hand-off between a paywall and the plans page (Modes manager, Profile
// Intelligence), and between the startup Plans card and its "Start smaller"
// second chance. Each used to be a hard cut: one tree unmounted and the next
// painted on the same frame, so the panel jumped.
//
// It is a crossfade with depth, not a swap. The page you leave stays put,
// opaque, and recedes a little (a touch smaller, softly blurred, a few px
// back); the next page arrives over it from the other side, fading in and
// settling. Because the old page is still underneath until the new one is
// fully covering it, the panel is never empty and nothing flashes. An earlier
// version waited for the old page to finish leaving ("wait"), which left a
// blank beat between the two.
//
// Values are the shared motion scale: 250 ms (page slide) on the smooth-out
// curve cubic-bezier(0.22, 1, 0.36, 1), 8 px of travel, 3 px of blur, and a
// 0.99 scale for the receding page. No ease-in anywhere: the start is what the
// eye watches. Reduced motion keeps a plain 150 ms crossfade, with no travel,
// scale or blur.
//
// First paint is not animated (nothing to come from); the host's own entrance
// (the genie, the panel opening) already covers it.
import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

const EASE = [0.22, 1, 0.36, 1] as const;
/** How far a page travels as it leaves or arrives, in px (the page-slide distance). */
const TRAVEL = 8;
const BLUR = 3;
/** The page-slide duration, in seconds. */
const DURATION = 0.25;

interface Props {
  /** Changes when the page changes; the next page arrives over the old one. */
  swapKey: string;
  /** 1 goes forward (deeper), -1 goes back. Sets the side the new page arrives from. */
  direction?: 1 | -1;
  children: React.ReactNode;
}

export function PlansSwap({ swapKey, direction = 1, children }: Props) {
  const reduced = useReducedMotion() ?? false;
  // The page showing at first paint arrives with no animation; every page
  // after it does, including a return to the first one.
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; }, []);
  const dir = useRef(direction);
  dir.current = direction;

  const enter = reduced
    ? { opacity: 0 }
    : { opacity: 0, transform: `translate3d(${dir.current * TRAVEL}px, 0, 0) scale(1.005)`, filter: `blur(${BLUR}px)` };
  const rest = reduced
    ? { opacity: 1 }
    : { opacity: 1, transform: 'translate3d(0px, 0, 0) scale(1)', filter: 'blur(0px)' };
  // The old page stays fully opaque while it recedes: the new page's fade is
  // what covers it, so there is never a moment where both are half see-through
  // (which would let the backdrop show through).
  const leave = reduced
    ? { opacity: 1, transition: { duration: 0.15 } }
    : {
        opacity: 1,
        transform: `translate3d(${-dir.current * TRAVEL}px, 0, 0) scale(0.99)`,
        filter: `blur(${BLUR}px)`,
        transition: { duration: DURATION, ease: EASE as any },
      };

  return (
    // popLayout: the leaving page is lifted out of the flow (absolutely
    // positioned at its own size) so the arriving one can sit on top of it.
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={swapKey}
          initial={mounted.current ? enter : false}
          animate={{ ...rest, transition: { duration: reduced ? 0.15 : DURATION, ease: EASE as any } }}
          exit={leave}
          style={{ height: '100%', width: '100%' }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default PlansSwap;
