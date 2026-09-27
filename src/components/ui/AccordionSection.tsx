import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import './AccordionSection.css';

// ─── Shared disclosure primitives ───────────────────────────
// Promoted from HelpSettings.tsx / IntelligenceSettings.tsx, which had
// independently reimplemented the same "collapse this" behavior. Settings
// tabs that need a custom header (a toggle switch, a badge) alongside the
// disclosure should compose Disclosure + DisclosureChevron directly;
// AccordionSection below is the title+icon convenience wrapper for the
// common case.

/**
 * Animated height/opacity wrapper for disclosure content. Respects reduced motion.
 * The height tween needs overflow:hidden, so content is clipped while it moves.
 * `unclipWhenOpen` lifts the clip once the open tween settles and puts it back
 * the moment the close starts, so a dropdown inside the panel can hang past its
 * bottom edge. Off by default: other panels may rely on the clip.
 */
export const Disclosure: React.FC<{ open: boolean; unclipWhenOpen?: boolean; children: React.ReactNode }> = ({ open, unclipWhenOpen = false, children }) => {
  const reduce = useReducedMotion();
  // React state, not framer's transitionEnd: transitionEnd on the height:auto
  // tween missed on some re-opens and left the panel clipped for good.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!open) setSettled(false);
  }, [open]);
  const overflow = unclipWhenOpen && settled ? 'visible' : 'hidden';
  const variants = {
    shut: reduce ? { opacity: 0, overflow: 'hidden' } : { height: 0, opacity: 0, overflow: 'hidden' },
    shown: reduce ? { opacity: 1, overflow } : { height: 'auto', opacity: 1, overflow },
  };
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="disclosure"
          variants={variants}
          initial="shut"
          animate="shown"
          exit="shut"
          onAnimationComplete={(definition) => {
            if (unclipWhenOpen && definition === 'shown') setSettled(true);
          }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

/** A chevron that rotates (rather than swaps glyphs) between collapsed/expanded. */
export const DisclosureChevron: React.FC<{ open: boolean }> = ({ open }) => (
  <ChevronDown size={14} className={`shrink-0 transition-transform duration-[250ms] ease-sculpted motion-reduce:transition-none ${open ? 'rotate-0' : '-rotate-90'}`} />
);

interface AccordionSectionProps {
  title: string;
  /**
   * Optional supporting line under the title, rendered in the header so it is
   * readable while the section is still COLLAPSED. Use it when a user has to
   * understand what the section offers before deciding to open it; content
   * placed in `children` can only be read after they have already committed
   * to expanding.
   */
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Outer container classes (bg/border/radius) — override to match the surrounding card convention. */
  className?: string;
  /** The hairline between the header and the body. On by default; a body that
      opens with its own group label reads better without it. */
  divider?: boolean;
  /** The header's hover fill. On by default. Off for a card whose open body
      follows straight on: the fill stops square at the header's bottom edge
      and reads as a rectangle stuck to the top of the card. The chevron
      brightens on hover instead, so the header still answers the pointer. */
  hoverFill?: boolean;
}

// Apple's default UI spring, the same curve AccordionSection.css samples into
// --acc-spring: critically damped from rest, normalised so u = 1 is settled.
const SPRING_W = 9.2335;
const SPRING_END = 1 - (1 + SPRING_W) * Math.exp(-SPRING_W);
const spring = (u: number) => (1 - (1 + SPRING_W * u) * Math.exp(-SPRING_W * u)) / SPRING_END;

/** Space kept between a revealed card and the scroller's edges. */
const REVEAL_MARGIN = 16;

const scrollParentOf = (el: HTMLElement): HTMLElement | null => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return null;
};

/** A CSS time custom property ("720ms", "0.72s") in milliseconds. */
const cssMs = (el: HTMLElement, name: string, fallback: number) => {
  const m = /^\s*([\d.]+)(ms|s)\s*$/.exec(getComputedStyle(el).getPropertyValue(name));
  return m ? parseFloat(m[1]) * (m[2] === 's' ? 1000 : 1) : fallback;
};

/**
 * Moves `scroller` from where it is to `target(from)` on the accordion's
 * spring over `durationMs`, re-reading the target every frame (null = stay).
 * Any wheel, touch, pointer or key input hands the scroll back at once.
 * Returns a cancel.
 */
const glide = (scroller: HTMLElement, durationMs: number, target: (from: number) => number | null): (() => void) => {
  const from = scroller.scrollTop;
  const start = performance.now();
  let frames = 0;
  let raf = 0;
  const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  const cancel = () => {
    cancelAnimationFrame(raf);
    inputs.forEach((type) => scroller.removeEventListener(type, cancel));
  };
  const step = (now: number) => {
    frames += 1;
    const u = durationMs > 0 ? Math.min(1, (now - start) / durationMs) : 1;
    const to = target(from);
    if (to !== null) scroller.scrollTop = from + (to - from) * spring(u);
    // Reduced motion jumps, but still over two frames, for late sizing.
    if (u < 1 || frames < 2) raf = requestAnimationFrame(step);
    else cancel();
  };
  inputs.forEach((type) => scroller.addEventListener(type, cancel, { passive: true }));
  raf = requestAnimationFrame(step);
  return cancel;
};

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A panel opening near the bottom of a scroller grows below the fold, where
 * none of its motion is seen. This glides the scroller, on the height's own
 * spring and clock (--acc-expand), just far enough to bring the opened panel
 * into view, and never so far that `anchor` (its header or trigger) leaves
 * the top.
 *
 * The target is re-read every frame: content that sizes itself in its own
 * effects (How it works' part box) is not at full height on the first one.
 */
const revealOpening = (anchor: HTMLElement, panel: HTMLElement, body: HTMLElement): (() => void) => {
  const scroller = scrollParentOf(panel);
  if (!scroller) return () => {};
  const view = scroller.getBoundingClientRect();
  // Scroll-content coordinates. Nothing above the panel moves while it opens,
  // so these hold for the whole glide. The panel's TOP, not the header's
  // height plus the panel's current one: under reduced motion (or reopened
  // mid-close) that height is not 0 here, and it would count the body twice.
  const anchorTop = anchor.getBoundingClientRect().top - view.top + scroller.scrollTop;
  const panelTop = panel.getBoundingClientRect().top - view.top + scroller.scrollTop;
  return glide(scroller, reducedMotion() ? 0 : cssMs(panel, '--acc-expand', 720), (from) => {
    const to = Math.min(
      panelTop + body.offsetHeight + REVEAL_MARGIN - scroller.clientHeight,
      anchorTop - REVEAL_MARGIN,
    );
    return to > from ? to : null;
  });
};

/**
 * Closing a panel near the bottom of a scroller shrinks the page under the
 * scroll position. Left alone, the browser clamps it back only once the page
 * is too short, so everything sat still, then slid down through the second
 * half of the close. This eases the scroller to where the clamp would leave
 * it, on the collapse's own spring from the first frame, so the panel and the
 * page settle as one motion. It never outruns the page: from and to differ by
 * at most the panel's height, and both follow the same curve.
 */
const settleClosing = (panel: HTMLElement): (() => void) => {
  const scroller = scrollParentOf(panel);
  if (!scroller) return () => {};
  const to = Math.max(0, scroller.scrollHeight - panel.getBoundingClientRect().height - scroller.clientHeight);
  if (to >= scroller.scrollTop) return () => {};
  return glide(scroller, reducedMotion() ? 0 : cssMs(panel, '--acc-collapse', 720), () => to);
};

/**
 * The accordion's motion on its own (AccordionSection.css): a panel that grows
 * and shrinks on the Apple spring, its content settling in and out, and the
 * scroller following it into view and back. AccordionSection wraps it in a
 * header; a disclosure with its own trigger (the Pro teaser's "See pricing")
 * uses it directly.
 *
 * `anchorRef` is that header or trigger: the glide never scrolls it past the
 * top. `className` lands on the outer wrapper (margins), `bodyClassName` on
 * the moving body (padding, a divider): padding on the panel itself would
 * leave a strip the 0fr track cannot close.
 */
export const AccordionPanel: React.FC<{
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  id?: string;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}> = ({ open, anchorRef, id, className = '', bodyClassName = '', children }) => {
  // The children mount on first open and then stay: the grid track has to
  // have something to collapse around for the close to animate. Until that
  // first open they are not rendered at all, as when the body unmounted on
  // close. Set during render so they mount in the same commit as the open.
  const [hasOpened, setHasOpened] = useState(open);
  if (open && !hasOpened) setHasOpened(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Glide only on a CHANGE of `open`: a panel that mounts open never scrolls
  // the page, including StrictMode's second mount pass.
  const shownOpen = useRef(open);

  // After the commit, so the body's content is mounted and the panel's height
  // is still the pre-toggle one. The cleanup cancels a glide when the panel
  // toggles again or unmounts mid-way.
  useLayoutEffect(() => {
    if (shownOpen.current === open) return;
    shownOpen.current = open;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    const body = bodyRef.current;
    if (!anchor || !panel || !body) return;
    return open ? revealOpening(anchor, panel, body) : settleClosing(panel);
  }, [open, anchorRef]);

  return (
    <div className={`t-acc acc-section ${className}`} data-open={String(open)}>
      {/* Collapsed, the body is still in the DOM at 0px, so inert keeps its
          links and buttons out of the tab order and the accessibility tree. */}
      <div ref={panelRef} id={id} className="t-acc-panel" aria-hidden={!open} {...(open ? null : { inert: true })}>
        <div className="t-acc-panel-inner">
          {/* The body is always mounted, only its children wait for the first
              open: the content's fade-in needs a closed style to start from. */}
          <div ref={bodyRef} className={`acc-section-body ${bodyClassName}`}>
            {hasOpened && children}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Title + icon + card-chrome disclosure, self-managing its own open state.
 * Default className matches the original HelpSettings look; pass a
 * different one to match another file's card tokens (e.g. the
 * `bg-bg-item-surface rounded-2xl` convention used in Plans & Billing).
 */
export const AccordionSection: React.FC<AccordionSectionProps> = ({
  title,
  description,
  icon,
  children,
  defaultOpen = false,
  className = 'bg-bg-card rounded-xl border-border-subtle',
  divider = true,
  hoverFill = true,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const cardRef = useRef<HTMLDivElement>(null);

  return (
    // Header hover is --bg-row-hover, not bg-item-surface: Plans renders this card
    // ON bg-item-surface, so that hover painted the colour it already was. The
    // focus ring is drawn inside (-2px): outside, the card's overflow-hidden cut
    // it off on every side and keyboard focus was invisible.
    // Motion is transitions.dev's accordion on an Apple spring
    // (AccordionSection.css): data-open here drives the chevron flip, and
    // AccordionPanel the height, the body settling in and out, and the scroll.
    <div ref={cardRef} className={`t-acc acc-section border mb-4 overflow-hidden shadow-sm ${className}`} data-open={String(isOpen)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className={`w-full flex items-center justify-between gap-3 p-4 text-left transition-colors ${hoverFill ? 'hover:bg-[color:var(--bg-row-hover)]' : ''} focus-visible:[outline-offset:-2px] group`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-bg-item-surface border border-border-subtle group-hover:border-border-muted transition-colors text-text-secondary shrink-0">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <span className="block font-semibold text-sm text-text-primary">{title}</span>
            {/* text-secondary, not tertiary: tertiary measured 2.89:1 on the light
                Plans card (bg-item-surface). A description is read, not decoration. */}
            {description && (
              <span className="block text-[11.5px] text-text-secondary leading-relaxed mt-1">
                {description}
              </span>
            )}
          </div>
        </div>
        {/* "v" closed, "^" open: the span flips, the glyph only recolours.
            strokeWidth 5/3: the snippet's non-scaling-stroke draws the width in
            screen pixels, so lucide's 2 would render 2px instead of the 1.67px
            it gets scaled to at 20px (measured: 23% more ink). */}
        <span className="t-acc-chevron shrink-0">
          <ChevronDown
            strokeWidth={5 / 3}
            className={`w-5 h-5 text-text-tertiary transition-colors duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${hoverFill ? '' : 'group-hover:text-text-primary'}`}
          />
        </span>
      </button>
      <AccordionPanel
        open={isOpen}
        anchorRef={cardRef}
        bodyClassName={`p-5 text-sm leading-relaxed text-text-secondary ${divider ? 'border-t border-border-subtle' : ''}`}
      >
        {children}
      </AccordionPanel>
    </div>
  );
};
