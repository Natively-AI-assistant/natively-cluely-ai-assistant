import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Maximize2, Minimize2 } from 'lucide-react';
import { forwardRef, useState } from 'react';
import type { MotionValue } from 'framer-motion';
import type { OverlayAppearance } from '../../lib/overlayAppearance';

interface ResizeToggleProps {
  /** True when the shell is at its wide width — the button then offers "collapse". */
  expanded: boolean;
  onToggle: () => void;
  appearance: OverlayAppearance;
  /** Mirrors the panel's data-interface-theme so CSS variable overrides apply. */
  interfaceTheme?: string;
  /**
   * Live right-offset motion value so the button tracks the panel's top-right
   * corner as the width spring animates. Computed in NativelyInterface from the
   * live shellWidth so the button sits in the side gutter just OUTSIDE the
   * panel's right edge. When provided, overrides the className's right positioning.
   */
  rightOffset?: MotionValue<number>;
  /**
   * Live top-offset motion value (px from the viewport top) so the button aligns
   * with the panel CARD's top edge — which sits below the TopPill + gap, not at
   * the window top. Measured from the panel rect in NativelyInterface. When
   * provided, overrides the className's top positioning.
   */
  topOffset?: MotionValue<number>;
}

/**
 * Standalone resize toggle that lives OUTSIDE the main panel body as a fixed
 * floating pill anchored to the top-right corner of the Electron window.
 *
 * Why outside the panel:
 *  - The main panel has overflow-hidden + rounded corners; an absolute button
 *    inside it could be clipped. More importantly, the user wants a clearly
 *    detached, independent control — the same pattern as macOS window controls
 *    sitting outside the content area.
 *  - Electron content-protection (`setContentProtection`) applies to the whole
 *    BrowserWindow, so this element inherits screen-capture protection for free.
 *  - Stealth pass-through: the hover hit-test in NativelyInterface includes this
 *    button's rect (via forwarded ref) so hovering it keeps the window interactive
 *    and the stealth passthrough path still wins when undetectable is on.
 *
 * The button is `position: fixed`; its `top`/`right` are driven by the
 * topOffset/rightOffset motion values so it hugs the PANEL card's top-right
 * corner (which sits below the TopPill), not the bare window corner. It falls
 * back to a static `top-3 right-3` when those offsets are not supplied.
 */
const ResizeToggle = forwardRef<HTMLButtonElement, ResizeToggleProps>(
  function ResizeToggle({ expanded, onToggle, appearance, interfaceTheme, rightOffset, topOffset }, ref) {
    const reduce = useReducedMotion();
    const [hovered, setHovered] = useState(false);

    return (
      <motion.button
        ref={ref}
        type="button"
        // preventDefault on mousedown so clicking the button does NOT move DOM
        // focus to it (or blur the chat input / the user's foreground app). The
        // overlay is a nonactivating NSPanel; a plain <button> would still steal
        // focus on press, dropping the caret out of the chat input mid-meeting.
        // This is the standard "toolbar button keeps focus where it was" idiom —
        // onClick still fires normally because only the default focus side-effect
        // of mousedown is suppressed.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        aria-label={expanded ? 'Collapse panel width' : 'Expand panel width'}
        aria-pressed={expanded}
        title={expanded ? 'Collapse' : 'Expand'}
        data-interface-theme={interfaceTheme}
        className="no-drag fixed z-[9999] flex h-[28px] w-[28px] items-center justify-center overflow-hidden rounded-full overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
        style={{
          ...appearance.iconStyle,
          top: topOffset ?? 12,
          right: rightOffset ?? 12,
          border: '1px solid rgba(128,128,128,0.22)',
          backdropFilter: 'blur(12px) saturate(140%)',
          WebkitBackdropFilter: 'blur(12px) saturate(140%)',
        }}
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
        animate={reduce ? { opacity: hovered ? 1 : 0.72 } : { opacity: hovered ? 1 : 0.72, scale: hovered ? 1.06 : 1 }}
        whileTap={reduce ? undefined : { scale: 0.92 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      >
        {/* Jelly-gloss sheen */}
        <span className="pointer-events-none absolute inset-x-1 top-0.5 h-[45%] rounded-full bg-gradient-to-b from-white/20 to-white/0 blur-[0.5px]" />
        <span
          className="relative grid place-items-center"
          style={{ transform: 'translate(-0.5px, -0.5px)' }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={expanded ? 'collapse' : 'expand'}
              className="col-start-1 row-start-1 flex items-center justify-center"
              style={{ gridArea: '1 / 1' }}
              initial={reduce ? false : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
              transition={reduce ? { duration: 0 } : { duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
            >
              {expanded ? (
                <Minimize2 className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
              )}
            </motion.span>
          </AnimatePresence>
        </span>
      </motion.button>
    );
  },
);

export default ResizeToggle;
