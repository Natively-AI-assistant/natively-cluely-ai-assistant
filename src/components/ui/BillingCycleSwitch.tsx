// src/components/ui/BillingCycleSwitch.tsx
//
// Monthly / Yearly for the Natively API plans. One control wherever the plans
// are sold (Settings › Plans & Billing, the end-of-trial card), so the choice
// looks and behaves the same in both.
//
// It is Overlay's two-way switch (.surface-switch / .surface-switch-thumb in
// index.css, already themed for light and dark): a radiogroup with one thumb
// that slides under the picked label. Arrow keys move the choice.
import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { YEARLY_MONTHS_FREE, type BillingCycle } from '../../lib/apiPlans.mjs';

const BILLING_CYCLES: ReadonlyArray<{ id: BillingCycle; label: string }> = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];

interface Props {
  value: BillingCycle;
  onChange: (next: BillingCycle) => void;
  /** Row alignment: centred in Settings, left-aligned in a card's text column. */
  align?: 'center' | 'start';
  /** "Yearly: 2 months free" beside the switch. Settings hides it (its price
   *  card already shows the months-free pill), so the switch sits centred. */
  showNote?: boolean;
}

export function BillingCycleSwitch({ value, onChange, align = 'center', showNote = true }: Props) {
  const reduceMotion = useReducedMotion();
  const index = Math.max(0, BILLING_CYCLES.findIndex((c) => c.id === value));
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = BILLING_CYCLES[e.key === 'ArrowRight' ? 1 : 0].id;
    onChange(next);
    (e.currentTarget.querySelector(`[data-cycle="${next}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className={`flex items-center gap-2.5 ${align === 'center' ? 'justify-center' : 'justify-start'}`}>
      <div
        role="radiogroup"
        aria-label="Billing"
        onKeyDown={onKeyDown}
        className="surface-switch relative grid grid-cols-2 p-1 rounded-full"
      >
        <motion.div
          aria-hidden="true"
          className="surface-switch-thumb absolute top-1 bottom-1 left-1 rounded-full"
          style={{ width: 'calc(50% - 4px)' }}
          initial={false}
          animate={{ x: `${index * 100}%` }}
          transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 30 }}
        />
        {BILLING_CYCLES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="radio"
            data-cycle={id}
            aria-checked={value === id}
            tabIndex={value === id ? 0 : -1}
            onClick={() => onChange(id)}
            className={`relative z-10 flex items-center justify-center px-4 py-1 rounded-full text-[12px] font-medium whitespace-nowrap transition-colors duration-200 motion-reduce:transition-none ${value === id ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {showNote && (
        <span className="text-[11px] text-text-tertiary whitespace-nowrap">
          Yearly: {YEARLY_MONTHS_FREE} months free
        </span>
      )}
    </div>
  );
}

export default BillingCycleSwitch;
