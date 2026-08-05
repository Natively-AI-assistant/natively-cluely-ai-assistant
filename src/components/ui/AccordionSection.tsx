import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';

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
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`border mb-4 overflow-hidden transition-all duration-200 shadow-sm ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-bg-item-surface group"
      >
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-bg-item-surface border border-border-subtle group-hover:border-border-muted transition-colors text-text-secondary shrink-0">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <span className="block font-semibold text-sm text-text-primary">{title}</span>
            {description && (
              <span className="block text-[11.5px] text-text-tertiary leading-relaxed mt-1">
                {description}
              </span>
            )}
          </div>
        </div>
        {isOpen
          ? <ChevronDown className="w-5 h-5 text-text-tertiary shrink-0" />
          : <ChevronRight className="w-5 h-5 text-text-tertiary shrink-0" />}
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="p-5 border-t border-border-subtle text-sm leading-relaxed text-text-secondary">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
