import React, { useState } from 'react';
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

/** Animated height/opacity wrapper for disclosure content. Respects reduced motion. */
export const Disclosure: React.FC<{ open: boolean; children: React.ReactNode }> = ({ open, children }) => {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="disclosure"
          initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          style={{ overflow: 'hidden' }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

/** A chevron that rotates (rather than swaps glyphs) between collapsed/expanded. */
export const DisclosureChevron: React.FC<{ open: boolean }> = ({ open }) => (
  <ChevronDown size={14} className={`shrink-0 transition-transform duration-200 ease-apple-ease motion-reduce:transition-none ${open ? 'rotate-0' : '-rotate-90'}`} />
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
  // The children mount on first open and then stay: the grid track has to
  // have something to collapse around for the close to animate. Until that
  // first open they are not rendered at all, as when the body unmounted on close.
  const [hasOpened, setHasOpened] = useState(defaultOpen);

  return (
    // Header hover is --bg-row-hover, not bg-item-surface: Plans renders this card
    // ON bg-item-surface, so that hover painted the colour it already was. The
    // focus ring is drawn inside (-2px): outside, the card's overflow-hidden cut
    // it off on every side and keyboard focus was invisible.
    // Motion is transitions.dev's accordion on an Apple spring
    // (AccordionSection.css): data-open drives the panel's height, the body
    // settling in and out, and the chevron flip.
    <div className={`t-acc acc-section border mb-4 overflow-hidden shadow-sm ${className}`} data-open={String(isOpen)}>
      <button
        onClick={() => { setHasOpened(true); setIsOpen(!isOpen); }}
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
      {/* Collapsed, the body is still in the DOM at 0px, so inert keeps its
          links and buttons out of the tab order and the accessibility tree. */}
      <div className="t-acc-panel" aria-hidden={!isOpen} {...(isOpen ? null : { inert: true })}>
        <div className="t-acc-panel-inner">
          {/* The body is always mounted, only its children wait for the first
              open: the content's fade-in needs a closed style to start from. */}
          <div className={`acc-section-body p-5 text-sm leading-relaxed text-text-secondary ${divider ? 'border-t border-border-subtle' : ''}`}>
            {hasOpened && children}
          </div>
        </div>
      </div>
    </div>
  );
};
