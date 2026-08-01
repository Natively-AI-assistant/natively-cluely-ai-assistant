import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

// Smooth height+opacity expand/collapse for settings disclosures (Set up / Customize /
// Developer options), matching the HelpSettings AccordionSection idiom. Height-auto is
// measured by framer-motion; under prefers-reduced-motion we drop the height/opacity tween
// so nothing slides or reflows — the content just appears.
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

// A chevron that rotates between collapsed (▸) and expanded (▾) instead of swapping glyphs,
// so the disclosure indicator turns smoothly with the panel.
export const DisclosureChevron: React.FC<{ open: boolean }> = ({ open }) => (
  <ChevronDown size={14} className={`shrink-0 transition-transform duration-200 ease-apple-ease motion-reduce:transition-none ${open ? 'rotate-0' : '-rotate-90'}`} />
);
