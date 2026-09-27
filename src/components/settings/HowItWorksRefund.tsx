import React, { useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { CalendarClock, CalendarX, CirclePlay, Clock3, FileText, Gauge, Heart, KeyRound, Mail, Power, Receipt, Ticket } from 'lucide-react';
import { AccordionSection } from '../ui/AccordionSection';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import './HowItWorksRefund.css';

// Extracted from NativelyApiSettings so PlansSettings can order this AFTER the
// app-only-license section. It used to be the last thing inside the API
// component, which forced it to render above the Pro section (a sibling one
// level up) with no way to reorder the two.
//
// No boxed icon left of the title: the accordion header is already a bordered
// rectangle, so a second one inside it was redundant. Title + chevron is enough.
//
// Three parts behind one switch — How it works / Refunds / Cancel & support —
// so only one part is on screen at a time; all three stacked ran to thirteen
// rows. Inside every part there is ONE row shape, SettingsRow (the row About,
// General and Intelligence are built from), so body text starts at the same x
// everywhere; mixing shapes per part is the look that was rejected for About.
//
// Motion, transitions.dev values:
//   tab switch      tabs sliding: a sky-blue Liquid Glass pill (.lg-bubble on
//                   .lg-sky's #3a9ff7), 250ms smooth-out, labels cross-fade on
//                   the same clock
//   part swap       one motion: the box eases to the new part's height (250ms
//                   smooth-out) while the new part fades in from a 2px blur
//                   (250ms) and the old fades out (150ms) — see PartPanels
//   Open / Email    learn-more hover (HowItWorksRefund.css)
// No framer `layout`/`layoutId`: layout projection caused a scroll regression in
// this settings scroller (see AIProvidersSettings). Nothing staggers in when the
// accordion opens: content that starts at opacity 0 stays invisible wherever
// Chromium has stopped rAF (a hidden or unfocused window).

// SettingsRow's neutral button, value for value (SETTINGS_BTN there), kept
// local so this file stands on committed code alone.
const SETTINGS_BTN =
  'px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out active:scale-[0.97] disabled:active:scale-100 motion-reduce:active:scale-100 bg-bg-component hover:bg-bg-elevated text-text-primary border-border-subtle';

const PORTAL_URL = 'https://customer.dodopayments.com/';
const POLICY_URL = 'https://natively.software/refundpolicy';
const DEMO_URL = 'https://natively.software/pro';
const CONTACT_EMAIL = 'natively.contact@gmail.com';

/** This section's sky blue — theme-aware, see HowItWorksRefund.css. */
const SKY = 'var(--hiw-sky)';
/** Feeds .lg-sky the same theme-aware blue, so the buttons match the pill. */
const SKY_BUTTON_STYLE = { '--lg-sky-bg': 'var(--hiw-sky)', '--lg-sky-hover': 'var(--hiw-sky-hover)' } as React.CSSProperties;

const EASE_SMOOTH_OUT = [0.22, 1, 0.36, 1] as const;
const SWAP_DUR = 0.15;
const SWAP_BLUR = 'blur(2px)';
const RESIZE_DUR = 0.25;

type PartId = 'how' | 'refunds' | 'cancel';
const PARTS: ReadonlyArray<{ id: PartId; name: string }> = [
  { id: 'how', name: 'How it works' },
  { id: 'refunds', name: 'Refunds' },
  { id: 'cancel', name: 'Cancel & support' },
];

// One set of steps for both products: the two paths are the same three steps,
// so a chooser between them (a second pill, then choice cards) added a
// decision and a box without adding information. Step 1 names both products
// and step 3 says what each key unlocks, so neither path is hidden.
const STEPS: ReadonlyArray<{ title: string; body: string }> = [
  { title: 'Choose a plan or a license', body: 'A Natively API plan above, or a Pro license below for your own AI keys.' },
  { title: 'Check your inbox', body: 'Your API key or license key is emailed to you instantly.' },
  { title: 'Paste it into the key box', body: 'An API key switches on usage and models; a license key unlocks Pro.' },
];

// The summary of the Refund Policy, one rule per row. Rows with a figure carry
// it in the control slot so the numbers line up in a column you can scan.
// Each line must stay TRUE against the full policy: "when you request" (our own
// mistakes are refunded in full), "usage cost" (§3.7 deducts ALL usage, not the
// part over 10%), "even if you miss our reminder" (§3.6).
const RULES: ReadonlyArray<{ icon: React.ElementType; title: string; body: string; figure?: string }> = [
  { icon: Clock3, title: 'Natively API refund window', body: 'Counts from your first purchase; renewals aren\'t covered.', figure: '24 hours' },
  { icon: KeyRound, title: 'Pro license refund window', body: 'Only before you activate it. Try the free trial first.', figure: '1 hour' },
  { icon: Receipt, title: 'Refund processing fee', body: 'Deducted when you request a refund.', figure: '$2.50' },
  { icon: Gauge, title: 'Heavy use is deducted', body: 'Used over 10% of AI, Voice, Knowledge or Research? Usage cost comes off.' },
  { icon: CalendarClock, title: 'Renewals aren\'t refunded', body: 'Cancel before your renewal date. Final even if you miss our reminder.' },
  { icon: Ticket, title: 'Promo purchases are final sale', body: 'Coupons, vouchers, referral credit and limited-time offers.' },
  { icon: Power, title: 'A refund ends access', body: 'Immediately. If the mistake was ours: full refund, and you keep access.' },
];

/** transitions.dev learn-more chevron: the arms spread into an arrow on hover. */
const LearnChevron: React.FC = () => (
  <span className="t-learn-chevron" aria-hidden="true">
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path className="t-learn-arm t-learn-arm-top" d="M6 4L10 8" />
      <path className="t-learn-arm t-learn-arm-bot" d="M10 8L6 12" />
    </svg>
  </span>
);

/**
 * A segmented switch: the theme's input surface as the track, one sky-blue
 * Liquid Glass pill under equal-width cells, moved by a transform. WAI-ARIA
 * tabs — arrows move AND select (a choice here costs nothing to undo), Home/End
 * jump to the ends.
 *
 * The glass sits on an inner span because .lg-bubble sets position: relative,
 * which would fight the pill's absolute positioning. `capRadius` pins the
 * rim's corner fade to the pill's real radius (half its rendered height).
 */
function SkySwitch<T extends string>({
  label,
  idPrefix,
  items,
  value,
  onChange,
  capRadius,
}: {
  label: string;
  idPrefix: string;
  items: ReadonlyArray<{ id: T; name: string; sub?: string }>;
  value: T;
  onChange: (id: T) => void;
  capRadius: number;
}) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const index = Math.max(0, items.findIndex((item) => item.id === value));
  const count = items.length;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const last = count - 1;
    const next =
      event.key === 'ArrowRight' ? Math.min(index + 1, last)
      : event.key === 'ArrowLeft' ? Math.max(index - 1, 0)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : -1;
    if (next < 0) return;
    event.preventDefault();
    const id = items[next].id;
    onChange(id);
    refs.current[id]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="relative grid rounded-full border border-border-subtle bg-bg-input p-1"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 transition-transform duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{ width: `calc((100% - 8px) / ${count})`, transform: `translateX(${index * 100}%)` }}
      >
        <span
          className="lg-bubble block h-full w-full rounded-full"
          style={{ '--bubble-user-bg': SKY, '--lg-cap-2': `${capRadius}px` } as React.CSSProperties}
        />
      </span>
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => { refs.current[item.id] = el; }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            // White on the sky pill, as on .lg-sky (2.80:1, the owner's choice
            // there; see LiquidGlassButton.css). Labels cross-fade on the pill's
            // own clock, so the colour lands as the pill arrives.
            className={`relative z-10 rounded-full px-3 py-1.5 text-center outline-none focus-visible:shadow-[0_0_0_4px_var(--toggle-focus-ring)] ${selected ? 'text-white' : 'text-text-secondary hover:text-text-primary'} transition-colors duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none`}
          >
            <span className="block text-xs font-semibold">{item.name}</span>
            {item.sub ? <span className="block text-[11px] font-medium">{item.sub}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The icon's slot: 40px wide, the same column SettingsRow's tile takes, so
 * text lines up with the rest of Settings — but no tile. The icons (and the
 * step numbers) stand on their own in both themes, by owner request.
 */
const TILE = 'w-10 h-10 flex items-center justify-center shrink-0';

/**
 * SettingsRow's exact geometry and type (px-4 py-3, 40px tile, gap-4, 14px
 * bold title, 12px description, trailing control) with the tile above, so
 * text sits on the same column as the rest of Settings.
 */
const IconRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  control?: React.ReactNode;
}> = ({ icon, title, description, control }) => (
  <div className="border-x border-transparent">
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <div className={`${TILE} text-text-primary`}>{icon}</div>
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-text-primary">{title}</h4>
          <div className="text-xs text-text-secondary mt-0.5">{description}</div>
        </div>
      </div>
      {control && <div className="shrink-0 flex items-center gap-2">{control}</div>}
    </div>
  </div>
);

/**
 * A step: SettingsRow's exact geometry (px-4 py-3, 40px leading slot, gap-4,
 * 14px bold title, 12px description) so the text sits on the same column as
 * every other tab — but the number stands on its own, with no tile. A boxed
 * "1" read as a button in light mode, where the tile is visible.
 */
const StepRow: React.FC<{ n: number; title: string; body: string }> = ({ n, title, body }) => (
  <div className="border-x border-transparent">
    <div className="flex items-center gap-4 px-4 py-3">
      <span className="w-10 h-10 shrink-0 flex items-center justify-center text-sm font-semibold tabular-nums text-text-primary">
        {n}
      </span>
      <div className="min-w-0">
        <h4 className="text-sm font-bold text-text-primary">{title}</h4>
        <div className="text-xs text-text-secondary mt-0.5">{body}</div>
      </div>
    </div>
  </div>
);

/**
 * The three parts, switched as ONE motion (transitions.dev card resize with a
 * cross-blur, on the polish scale):
 *   - every part stays mounted, stacked at the top of a clipped box, so its
 *     height is always measured and never has to be discovered mid-switch;
 *   - on a switch the box eases straight to the new part's height (250ms
 *     smooth-out) WHILE the new part fades in with a 2px blur settling to 0
 *     (250ms) and the old one fades out faster (150ms: exits are quieter).
 * It used to be three beats — fade out, swap, THEN resize — which read as the
 * card lurching after the content had already changed.
 * No framer `layout`: layout projection caused a scroll regression in this
 * scroller. Heights come from a ResizeObserver; the first measure happens in a
 * layout effect, before paint, so the box never renders at 0.
 */
const PartPanels: React.FC<{ part: PartId; content: Record<PartId, React.ReactNode> }> = ({ part, content }) => {
  const reduceMotion = useReducedMotion();
  const refs = useRef<Partial<Record<PartId, HTMLDivElement | null>>>({});
  const [heights, setHeights] = useState<Partial<Record<PartId, number>>>({});

  useLayoutEffect(() => {
    const measure = () => {
      setHeights((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const { id } of PARTS) {
          const h = refs.current[id]?.offsetHeight;
          if (h != null && next[id] !== h) { next[id] = h; changed = true; }
        }
        return changed ? next : prev;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const { id } of PARTS) {
      const el = refs.current[id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const target = heights[part];

  // One motion value drives the height, set outright on the first measure and
  // animated on every change after. Declaring the height as BOTH a style and
  // an `animate` target let the style win when growing, so How it works ->
  // Refunds snapped to full height in one frame while shrinking eased.
  const height = useMotionValue(0);
  const measuredOnce = useRef(false);
  useLayoutEffect(() => {
    if (target == null) return;
    if (!measuredOnce.current || reduceMotion) {
      measuredOnce.current = true;
      height.set(target);
      return;
    }
    const controls = animate(height, target, { duration: RESIZE_DUR, ease: EASE_SMOOTH_OUT });
    return () => controls.stop();
  }, [target, reduceMotion, height]);

  const variants = reduceMotion
    ? { in: { opacity: 1, transition: { duration: 0 } }, out: { opacity: 0, transition: { duration: 0 } } }
    : {
        in: { opacity: 1, filter: 'blur(0px)', transition: { duration: RESIZE_DUR, ease: EASE_SMOOTH_OUT } },
        out: { opacity: 0, filter: SWAP_BLUR, transition: { duration: SWAP_DUR, ease: EASE_SMOOTH_OUT } },
      };

  return (
    <motion.div style={{ position: 'relative', overflow: 'hidden', height }}>
      {PARTS.map(({ id }) => {
        const active = id === part;
        return (
          <motion.div
            key={id}
            ref={(el) => { refs.current[id] = el; }}
            id={`hiw-part-panel-${id}`}
            role="tabpanel"
            aria-labelledby={`hiw-part-tab-${id}`}
            aria-hidden={!active}
            inert={!active}
            initial={false}
            animate={active ? 'in' : 'out'}
            variants={variants}
            style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
            // pt-1 keeps a focus ring on the first control inside clear of
            // the box's overflow clip.
            className={`pt-1 pb-1${active ? '' : ' pointer-events-none'}`}
          >
            {content[id]}
          </motion.div>
        );
      })}
    </motion.div>
  );
};

export const HowItWorksRefund: React.FC = () => {
  const reduceMotion = useReducedMotion();
  const [part, setPart] = useState<PartId>('how');

  const openExternal = (url: string) => {
    (window.electronAPI as any)?.openExternal?.(url);
  };

  const actionButton = `${SETTINGS_BTN} t-learn`;

  const howItWorks = (
    <>
      {STEPS.map((step, i) => (
        <StepRow key={step.title} n={i + 1} title={step.title} body={step.body} />
      ))}
      {/* The demo is the next thing to do after reading the steps, so it
          follows them, centred, as the same sky Liquid Glass button as Manage
          (.lg-sky at its defaults). */}
      <div className="flex justify-center px-4 pt-1 pb-3">
        <LiquidGlassButton
          variant="sky"
          className="lg-sm"
          style={SKY_BUTTON_STYLE}
          icon={<CirclePlay size={14} />}
          onClick={() => openExternal(DEMO_URL)}
        >
          Watch the demo
        </LiquidGlassButton>
      </div>
    </>
  );

  const refunds = RULES.map(({ icon: Icon, title, body, figure }) => (
    <IconRow
      key={title}
      icon={<Icon size={20} />}
      title={title}
      description={body}
      control={figure ? (
        <span className="text-sm font-semibold tabular-nums text-text-primary whitespace-nowrap">{figure}</span>
      ) : undefined}
    />
  ));

  const cancelAndSupport = (
    <>
      <IconRow
        icon={<CalendarX size={20} />}
        title="Cancel or change your plan"
        description="Do it in the customer portal any time before your renewal date."
        control={(
          // Sky blue: .lg-sky, the light Liquid Glass material, fed this
          // section's theme-aware blue (HowItWorksRefund.css).
          <LiquidGlassButton variant="sky" className="lg-sm" style={SKY_BUTTON_STYLE} onClick={() => openExternal(PORTAL_URL)}>
            Manage
          </LiquidGlassButton>
        )}
      />
      <IconRow
        icon={<FileText size={20} />}
        title="Full refund policy"
        description="Subscriptions, taxes, fees and your local consumer rights."
        control={(
          <button type="button" onClick={() => openExternal(POLICY_URL)} className={actionButton}>
            Open <LearnChevron />
          </button>
        )}
      />
      <IconRow
        icon={<Mail size={20} />}
        title="Questions or problems?"
        description={`Email ${CONTACT_EMAIL} rather than disputing a charge.`}
        control={(
          <button type="button" onClick={() => openExternal(`mailto:${CONTACT_EMAIL}`)} className={actionButton}>
            Email <LearnChevron />
          </button>
        )}
      />
      {/* The personal note, in the rows' own shape: the heart takes the same
          40px tile and 20px glyph as every icon above, so the note's text
          starts in the same column as theirs. Soft pink, filled, deep enough
          to hold on the light card (#EE82B0: 1.98:1 there, 6.09:1 on dark).
          No title, because the note has none. */}
      <div className="border-x border-transparent">
        <div className="flex items-center gap-4 px-4 py-3">
          <div className={`${TILE} text-text-primary`}>
            <Heart size={20} className="text-[#EE82B0]" fill="currentColor" />
          </div>
          <p className="min-w-0 text-xs text-text-secondary">
            Natively is built and supported by one person, in their free time. Replies can take a
            few days, and weekends are offline. Thank you for your patience.
          </p>
        </div>
      </div>
    </>
  );

  const content: Record<PartId, React.ReactNode> = { how: howItWorks, refunds, cancel: cancelAndSupport };

  return (
    <AccordionSection
      title="How it works & refund policy"
      description="Setup steps, refund rules and how to cancel."
      className="bg-bg-item-surface rounded-2xl border-border-subtle !mb-0"
      divider={false}
      hoverFill={false}
    >
      {/* -mx-5 cancels the accordion body's p-5, so rows take SettingsRow's own
          px-4 and their tiles sit on the header's text edge. */}
      <div className="-mx-5 -mt-3 -mb-2">
        <div className="px-[17px] pb-2">
          <SkySwitch
            label="How it works and refund policy"
            idPrefix="hiw-part"
            items={PARTS}
            value={part}
            onChange={setPart}
            capRadius={14}
          />
        </div>

        <PartPanels part={part} content={content} />
      </div>
    </AccordionSection>
  );
};
