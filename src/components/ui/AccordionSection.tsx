import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

// ─── Shared disclosure primitives ───────────────────────────
// Promoted from HelpSettings.tsx / IntelligenceSettings.tsx, which had
// independently reimplemented the same "collapse this" behavior. Settings
// tabs that need a custom header (a toggle switch, a badge) alongside the
// disclosure should compose Disclosure + DisclosureChevron directly;
// AccordionSection below is the title+icon convenience wrapper for the
// common case.

/**
 * Animated height/opacity wrapper for disclosure content. Respects reduced motion.
 *
 * `duration` and `blur` are opt-in, so every existing disclosure keeps its
 * 220ms plain fade. AccordionSection passes transitions.dev's accordion
 * values: 250ms, the same both ways (an accordion is one reversible motion,
 * not an open/close pair), with the content softened by a 2px blur that
 * settles to 0, which hides the height crop slicing through a row mid-open.
 */
export const Disclosure: React.FC<{ open: boolean; children: React.ReactNode; duration?: number; blur?: boolean }> = ({
  open,
  children,
  duration = 0.22,
  blur = false,
}) => {
  const reduce = useReducedMotion();
  const hidden = blur ? { height: 0, opacity: 0, filter: 'blur(2px)' } : { height: 0, opacity: 0 };
  const shown = blur ? { height: 'auto', opacity: 1, filter: 'blur(0px)' } : { height: 'auto', opacity: 1 };
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="disclosure"
          initial={reduce ? { opacity: 0 } : hidden}
          animate={reduce ? { opacity: 1 } : shown}
          exit={reduce ? { opacity: 0 } : hidden}
          transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
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

  return (
    // Header hover is --bg-row-hover, not bg-item-surface: Plans renders this card
    // ON bg-item-surface, so that hover painted the colour it already was. The
    // focus ring is drawn inside (-2px): outside, the card's overflow-hidden cut
    // it off on every side and keyboard focus was invisible.
    <div className={`border mb-4 overflow-hidden shadow-sm ${className}`}>
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
        <ChevronDown
          className={`w-5 h-5 text-text-tertiary shrink-0 transition-[transform,color] duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${hoverFill ? '' : 'group-hover:text-text-primary'} ${isOpen ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>
      {/* Disclosure: smooth-out, a fade-only path under reduced motion, and no
          open animation when the section mounts already open. */}
      {/* The chevron above runs on this same 250ms smooth-out clock, so the
          flip and the panel land together. */}
      <Disclosure open={isOpen} duration={0.25} blur>
        <div className={`p-5 text-sm leading-relaxed text-text-secondary ${divider ? 'border-t border-border-subtle' : ''}`}>
          {children}
        </div>
      </Disclosure>
    </div>
  );
};
