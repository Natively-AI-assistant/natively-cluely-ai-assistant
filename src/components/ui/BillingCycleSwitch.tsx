// src/components/ui/BillingCycleSwitch.tsx
//
// Monthly / Yearly for the Natively API plans. One control wherever the plans
// are sold (Settings › Plans & Billing, the end-of-trial card), so the choice
// looks and behaves the same in both.
//
// Settings › Plans & Billing passes a third option, Hourly, first: it swaps the
// row of plans for the two Pro packs, as the website's pricing page does
// (2026-11-10). The end-of-trial card keeps the two.
//
// It is Overlay's two-way switch (.surface-switch / .surface-switch-thumb in
// index.css, already themed for light and dark): a radiogroup with one thumb
// that slides under the picked label. Arrow keys move the choice.
import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { YEARLY_MONTHS_FREE, type BillingCycle } from '../../lib/apiPlans.mjs';

export type SwitchOption<T extends string> = { id: T; label: string };

const BILLING_CYCLES: ReadonlyArray<SwitchOption<BillingCycle>> = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];

/** What Plans & Billing shows: the packs (Hourly) or the plans, billed monthly or yearly. */
export type PlansView = 'hourly' | BillingCycle;
export const PLANS_VIEWS: ReadonlyArray<SwitchOption<PlansView>> = [
  { id: 'hourly', label: 'Hourly' },
  ...BILLING_CYCLES,
];

interface Props<T extends string> {
  value: T;
  onChange: (next: T) => void;
  /** The choices, in order. Monthly / Yearly when left out. */
  options?: ReadonlyArray<SwitchOption<T>>;
  /** Row alignment: centred in Settings, left-aligned in a card's text column. */
  align?: 'center' | 'start';
  /** "Yearly: 2 months free" beside the switch. Settings hides it (its price
   *  card already shows the months-free pill), so the switch sits centred. */
  showNote?: boolean;
}

export function BillingCycleSwitch<T extends string = BillingCycle>({
  value,
  onChange,
  options = BILLING_CYCLES as unknown as ReadonlyArray<SwitchOption<T>>,
  align = 'center',
  showNote = true,
}: Props<T>) {
  const reduceMotion = useReducedMotion();
  const count = options.length;
  const index = Math.max(0, options.findIndex((c) => c.id === value));
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = options[Math.min(count - 1, Math.max(0, index + (e.key === 'ArrowRight' ? 1 : -1)))].id;
    onChange(next);
    (e.currentTarget.querySelector(`[data-cycle="${next}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className={`flex items-center gap-2.5 ${align === 'center' ? 'justify-center' : 'justify-start'}`}>
      <div
        role="radiogroup"
        aria-label="Billing"
        onKeyDown={onKeyDown}
        className="surface-switch relative grid p-1 rounded-full"
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      >
        <motion.div
          aria-hidden="true"
          className="surface-switch-thumb absolute top-1 bottom-1 left-1 rounded-full"
          style={{ width: `calc((100% - 8px) / ${count})` }}
          initial={false}
          animate={{ x: `${index * 100}%` }}
          transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 30 }}
        />
        {options.map(({ id, label }) => (
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
