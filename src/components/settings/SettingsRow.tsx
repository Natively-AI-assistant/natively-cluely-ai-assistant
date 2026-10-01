import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { DisclosureChevron } from '../ui/AccordionSection';
import { SettingsToggle } from './SettingsToggle';

// The parts General, Audio and Sync are built from, as one module, so a pane
// that adopts the Settings look takes the same measurements rather than a copy
// of them. Intelligence and Provider performance use it.
//
// PhoneMirrorSettings.tsx (Sync) still carries its own copies of these —
// SyncRow, Switch, BTN, SectionHeading, its tone strings and its motion
// vocabulary (Presence, Collapse, useSettledFlag) are the originals this file
// was lifted from, value for value. Moving Sync onto this module is a pure
// refactor that was left out of the Intelligence redesign on purpose.

// ── Motion ───────────────────────────────────────────────────────────────
// Sync's vocabulary, so the two panes move alike: the transitions.dev token
// scale, as values. framer-motion drives the pieces that have to sequence an
// exit before an entrance, which a React re-render cannot do with CSS alone.
// Every state change goes through one of these moves:
//   text swap   150ms ease-in-out, 4px, 2px blur    descriptions, button labels
//   icon swap   250ms ease-in-out, 0.25 scale, 2px   spinner/check/copy glyphs
//   badge pop   500ms bounce in, 180ms out           status tags
//   control     250ms in / 150ms out, 0.96 scale     a control that changes identity
//   collapse    250ms smooth-out, height + opacity    notices, rows, cards
// No `layout`/`layoutId` anywhere: layout projection caused a scroll
// regression in this same settings scroller (see AIProvidersSettings).
export const EASE_SMOOTH_OUT = [0.22, 1, 0.36, 1] as const;
const EASE_BOUNCE = [0.34, 1.36, 0.64, 1] as const;
const EASE_CLOSE = [0.4, 0, 0.2, 1] as const;
const DUR_QUICK = 0.15;
const DUR_FAST = 0.25;
const DUR_BADGE_FADE = 0.4;
const DUR_BADGE_POP = 0.5;
const DUR_BADGE_CLOSE = 0.18;

// Until a pane's first read has landed, it renders the settled state with no
// motion at all — otherwise every value that arrives from IPC would "swap in"
// on open. Default false: a Presence or Collapse outside a provider never moves.
export const SettingsMotionReady = React.createContext(false);

/**
 * Readiness for SettingsMotionReady. Flips one tick AFTER the commit that
 * carried the data: React batches the data and a same-tick flag into one
 * render, which would mount everything already "ready" and animate it.
 */
export function useMotionReadyAfter(loaded: boolean): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!loaded || ready) return;
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, [loaded, ready]);
  return ready;
}

/**
 * Height + opacity, the shared Disclosure's move, but silent before hydration.
 * In a `space-y-*` stack, pass `className="!mt-0"` and put the gap INSIDE as
 * top padding: the stack's margin sits outside the animated height, so it would
 * jump in whole before the fold. `skipStagger` for a direct child of a
 * `data-settings-stagger` container, whose entrance would otherwise replay.
 */
export const Collapse: React.FC<{ open: boolean; className?: string; skipStagger?: boolean; children: React.ReactNode }> = ({
  open,
  className,
  skipStagger,
  children,
}) => {
  const ready = React.useContext(SettingsMotionReady);
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="collapse"
          className={className}
          data-stagger-skip={skipStagger ? '' : undefined}
          initial={ready ? (reduce ? { opacity: 0 } : { height: 0, opacity: 0 }) : false}
          animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: reduce ? DUR_QUICK : DUR_FAST, ease: EASE_SMOOTH_OUT }}
          style={{ overflow: 'hidden' }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

/**
 * One item of a list that grows and folds rows as they come and go (measured
 * providers after a Refresh or a Forget). Must be a DIRECT child of an
 * <AnimatePresence initial={false}>, keyed by the item's identity.
 */
export const CollapseItem: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ready = React.useContext(SettingsMotionReady);
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={ready ? (reduce ? { opacity: 0 } : { height: 0, opacity: 0 }) : false}
      animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
      transition={{ duration: reduce ? DUR_QUICK : DUR_FAST, ease: EASE_SMOOTH_OUT }}
      style={{ overflow: 'hidden' }}
    >
      {children}
    </motion.div>
  );
};

/**
 * A dropdown menu: transitions.dev "menu dropdown". It grows from its trigger
 * (250ms smooth-out from 0.97) and gets out of the way faster than it came
 * (150ms to 0.99). Reduced motion keeps the fade and drops the scale. Not gated
 * on SettingsMotionReady: a menu only ever opens from a click. The transform
 * sits on the menu itself and settles to none, so it never becomes a
 * containing block for anything but its own options.
 */
export const SettingsMenu: React.FC<{
  open: boolean;
  /** The corner that touches the trigger, e.g. 'top right' for a right-0 menu. */
  origin?: string;
  className?: string;
  /** For a menu that is a listbox (AI Providers' model and language pickers). */
  role?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}> = ({ open, origin = 'top', className = '', role, ariaLabel, children }) => {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="menu"
          role={role}
          aria-label={ariaLabel}
          className={className}
          style={{ transformOrigin: origin }}
          initial={{ opacity: 0, scale: reduce ? 1 : 0.97 }}
          animate={{ opacity: 1, scale: 1, transition: { duration: DUR_FAST, ease: EASE_SMOOTH_OUT } }}
          exit={{ opacity: 0, scale: reduce ? 1 : 0.99, transition: { duration: DUR_QUICK, ease: EASE_SMOOTH_OUT } }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

// Every "this thing changed" move, as presets of ONE component. `id` names the
// state on show: a new id plays the old one's exit and the new one's entrance;
// null shows nothing (and plays the exit). Before hydration nothing animates;
// under reduced motion the transforms drop out and the fades stay.
//   text     transitions.dev "text states swap": out up, in from below, 2px blur
//   icon     transitions.dev "icon swap": cross-fade in one fixed 14px slot
//   badge    transitions.dev "notification badge": bouncy pop in, quiet exit
//   control  a control that changes identity (Set up → Edit setup, Clear → confirm)
export type PresenceKind = 'text' | 'icon' | 'badge' | 'control';

const presenceMotion = (kind: PresenceKind, reduce: boolean) => {
  const move = (n: number) => (reduce ? 0 : n);
  const size = (n: number) => (reduce ? 1 : n);
  const blurIn = { opacity: 1, filter: 'blur(0px)' };
  switch (kind) {
    case 'text': {
      const tr = { duration: DUR_QUICK, ease: 'easeInOut' } as const;
      return {
        className: 'inline-block',
        from: { opacity: 0, y: move(4), filter: 'blur(2px)' },
        to: { ...blurIn, y: 0, transition: tr },
        out: { opacity: 0, y: move(-4), filter: 'blur(2px)', transition: tr },
      };
    }
    case 'icon': {
      const tr = { duration: DUR_FAST, ease: 'easeInOut' } as const;
      return {
        className: 'absolute inset-0 grid place-items-center',
        from: { opacity: 0, scale: size(0.25), filter: 'blur(2px)' },
        to: { ...blurIn, scale: 1, transition: tr },
        out: { opacity: 0, scale: size(0.25), filter: 'blur(2px)', transition: tr },
      };
    }
    case 'badge':
      return {
        className: 'inline-flex',
        from: { opacity: 0, scale: size(0.8), filter: 'blur(2px)' },
        to: {
          ...blurIn,
          scale: 1,
          transition: {
            opacity: { duration: DUR_BADGE_FADE, ease: EASE_SMOOTH_OUT },
            filter: { duration: DUR_BADGE_FADE, ease: EASE_SMOOTH_OUT },
            scale: { duration: DUR_BADGE_POP, ease: EASE_BOUNCE },
          },
        },
        out: { opacity: 0, scale: size(0.9), filter: 'blur(2px)', transition: { duration: DUR_BADGE_CLOSE, ease: EASE_CLOSE } },
      };
    case 'control':
      return {
        className: 'flex items-center gap-2',
        from: { opacity: 0, scale: size(0.96), filter: 'blur(2px)' },
        to: { ...blurIn, scale: 1, transition: { duration: DUR_FAST, ease: EASE_SMOOTH_OUT } },
        out: { opacity: 0, scale: size(0.98), filter: 'blur(2px)', transition: { duration: DUR_QUICK, ease: EASE_SMOOTH_OUT } },
      };
  }
};

export const Presence: React.FC<{
  kind: PresenceKind;
  id: string | null;
  /** Text only: a block-level swap (a whole description) rather than inline. */
  block?: boolean;
  /** Icon only: the fixed slot the glyphs cross-fade in. 14px suits a button
      glyph; a row's 40px tile holds a 20px one (`w-5 h-5`). */
  slotClassName?: string;
  /** Readiness for a pane that tracks its own load, in place of a provider. */
  ready?: boolean;
  className?: string;
  children?: React.ReactNode;
}> = ({ kind, id, block, slotClassName = 'w-3.5 h-3.5', ready: readyProp, className = '', children }) => {
  const readyCtx = React.useContext(SettingsMotionReady);
  const ready = readyProp ?? readyCtx;
  const m = presenceMotion(kind, !!useReducedMotion());
  const cls = `${block ? 'block' : m.className} ${className}`;
  // Before hydration: plain markup, no AnimatePresence at all. Gating only the
  // `initial` prop is NOT enough — in mode="wait" the incoming child mounts after
  // the outgoing one's exit settles, a frame or more later, by which time the
  // ready flag has flipped and the value that arrived from IPC animates in anyway
  // (measured 2026-09-25 in the Intelligence harness). The switch to the animated
  // tree remounts once, invisibly, because AnimatePresence starts with initial={false}.
  if (!ready) {
    const Plain = kind === 'control' ? 'div' : 'span';
    const body = id !== null ? <Plain className={cls}>{children}</Plain> : null;
    return kind === 'icon' ? (
      <span className={`relative inline-block ${slotClassName} shrink-0`} aria-hidden="true">
        {body}
      </span>
    ) : (
      body
    );
  }
  // A control can hold a <div> (the confirm group), so it cannot be a span.
  const Tag = (kind === 'control' ? motion.div : motion.span) as typeof motion.span;
  const presence = (
    // Icons overlap as they cross-fade; everything else leaves before its
    // replacement arrives, so two labels never share a line.
    <AnimatePresence mode={kind === 'icon' ? 'sync' : 'wait'} initial={false}>
      {id !== null ? (
        <Tag key={id} className={cls} initial={m.from} animate={m.to} exit={m.out}>
          {children}
        </Tag>
      ) : null}
    </AnimatePresence>
  );
  return kind === 'icon' ? (
    <span className={`relative inline-block ${slotClassName} shrink-0`} aria-hidden="true">
      {presence}
    </span>
  ) : (
    presence
  );
};

/**
 * A control's label changing state without resizing the control. Every label
 * it can show sits invisibly in ONE grid cell, so the control keeps the widest
 * one's width in whatever font the platform renders (SF Pro and Segoe UI
 * measure differently, so a fixed min-width is a guess), and the visible label
 * swaps (Presence "text"). A label that grew on "Testing…" shoved every control
 * beside it sideways. `sizers` are the labels as they render, with any spinner
 * swapped for a same-size blank: a hidden `.animate-spin` would still read as
 * "loading" to GenieModal's snapshot check. Always ready — labels only change
 * in answer to a click or its result.
 */
export const SwapLabel: React.FC<{ id: string; sizers: React.ReactNode[]; children: React.ReactNode }> = ({
  id,
  sizers,
  children,
}) => (
  <span className="grid place-items-center">
    {sizers.map((node, i) => (
      <span key={i} aria-hidden="true" className="invisible col-start-1 row-start-1">
        {node}
      </span>
    ))}
    <span className="col-start-1 row-start-1">
      <SettingsMotionReady.Provider value={true}>
        <Presence kind="text" id={id}>
          {children}
        </Presence>
      </SettingsMotionReady.Provider>
    </span>
  </span>
);

/**
 * A busy flag that only shows once the work has run long enough to be worth a
 * word, then stays long enough to be read. A health check or a save often
 * finishes in 100–400ms; a 500ms badge pop that exits half way through is a
 * flicker, not feedback. transitions-polish's intent-delay rule.
 */
export function useSettledFlag(active: boolean, delayMs = 250, minVisibleMs = 450): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (active && !shown) {
      timer = setTimeout(() => {
        shownAt.current = Date.now();
        setShown(true);
      }, delayMs);
    } else if (!active && shown) {
      timer = setTimeout(() => setShown(false), Math.max(0, minVisibleMs - (Date.now() - shownAt.current)));
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [active, shown, delayMs, minVisibleMs]);
  return shown;
}

// ── Parts ────────────────────────────────────────────────────────────────

// General's "Check" button, minus its fixed 110px width, plus a press: a quick
// 0.97 give on :active, and opacity in the transition list so a disabled state
// fades instead of snapping. The base carries shape and motion only, for a
// button that takes a status tone instead (Copied, Clear logs).
export const SETTINGS_BTN_BASE =
  'px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out active:scale-[0.97] disabled:active:scale-100 motion-reduce:active:scale-100';
export const SETTINGS_BTN_NEUTRAL = 'bg-bg-component hover:bg-bg-elevated text-text-primary border-border-subtle';
export const SETTINGS_BTN = `${SETTINGS_BTN_BASE} ${SETTINGS_BTN_NEUTRAL}`;

// Audio's card: anything that opens underneath a row sits in one of these.
export const SETTINGS_CARD = 'bg-bg-card rounded-xl border border-border-subtle';

// The field look Sync uses for a pairing link, as an <input>.
export const SETTINGS_INPUT =
  'w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-xs text-text-primary transition-colors focus:outline-none focus:border-accent-primary disabled:opacity-50';

// Sync's field label ("PAIRING LINK").
export const SETTINGS_FIELD_LABEL = 'text-xs font-medium text-text-secondary uppercase tracking-wide block';

/* A dropdown on the right of a settings row grows with its label, up to
   PICKER_LABEL_MAX_CHARS characters ("Gemini 3.8 Flash"); capPickerLabel cuts
   anything longer. Its menu sizes to its options, so a short label like "Auto"
   still opens a menu wide enough to read the choices in it. */
export const PICKER_LABEL_MAX_CHARS = 16;
export const PICKER_MENU_WIDTH = 'min-w-full w-max max-w-[18rem]';

/* The Active Embedding Model and Active Reranker picker boxes carry this
   attribute and this min-width; the Retrieval page sets the variable to the
   wider of the two so they match (useMatchedHeroPickers). Anywhere else the
   variable is unset and each box fits its own label. */
export const RETRIEVAL_HERO_PICKER_ATTR = 'data-retrieval-hero-picker';
export const RETRIEVAL_HERO_PICKER_MIN_WIDTH = 'var(--retrieval-hero-picker-w, 0px)';

/** A label longer than `max` characters (spaces included) keeps its first
 *  max-1 and ends in an ellipsis, so what shows is never more than `max`. */
export const capPickerLabel = (label: string, max: number = PICKER_LABEL_MAX_CHARS): string => {
    const chars = Array.from(label);
    if (chars.length <= max) return label;
    return `${chars.slice(0, max - 1).join('').trimEnd()}…`;
};

// Audio's section heading.
export const SettingsSectionHeading: React.FC<{ title: string; subtitle?: React.ReactNode }> = ({ title, subtitle }) => (
  <>
    <h3 className="text-lg font-bold text-text-primary mb-1">{title}</h3>
    {subtitle ? <p className="text-xs text-text-secondary mb-2">{subtitle}</p> : null}
  </>
);

// General's row: [40px tile] [14px bold title (+badge) / 12px description] [control].
// The text block can shrink and the control cannot, so a long description
// wraps instead of squeezing the switch. `children` hang under the row,
// indented to the title (px-4 + 40px tile + gap-4 = 72px); each child owns its
// bottom gap so a closed <Collapse>, which renders nothing, leaves none.
// `descriptionKey` names the description's STATE, so a change of state swaps
// the text (Presence "text") rather than snapping it.
export const SettingsRow: React.FC<{
  icon: React.ReactNode;
  title: React.ReactNode;
  badge?: React.ReactNode;
  description?: React.ReactNode;
  descriptionKey?: string;
  control?: React.ReactNode;
  children?: React.ReactNode;
  /** Title wraps by default; model ids and other unbreakable strings truncate. */
  truncateTitle?: boolean;
}> = ({ icon, title, badge, description, descriptionKey, control, children, truncateTitle }) => (
  // border-x-transparent: General's rows sit in a container with a 1px
  // transparent border, which puts its tiles 1px in from the heading.
  <div className="border-x border-transparent">
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className={`text-sm font-bold text-text-primary ${truncateTitle ? 'truncate max-w-full' : ''}`}>{title}</h4>
            {badge}
          </div>
          {description && (
            <div className="text-xs text-text-secondary mt-0.5">
              {descriptionKey ? (
                <Presence kind="text" id={descriptionKey} block>
                  {description}
                </Presence>
              ) : (
                description
              )}
            </div>
          )}
        </div>
      </div>
      {control && <div className="shrink-0 flex items-center gap-2">{control}</div>}
    </div>
    {children && <div className="pl-[72px] pr-4">{children}</div>}
  </div>
);

// General's switch, with General's track colours passed exactly as it passes them.
export const SettingsSwitch: React.FC<{ checked: boolean; onChange: () => void; label: string; disabled?: boolean }> = ({
  checked,
  onChange,
  label,
  disabled,
}) => (
  <SettingsToggle
    checked={checked}
    onChange={onChange}
    label={label}
    disabled={disabled}
    className={checked ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}
  />
);

// General's ADVANCED disclosure heading. `count` is Sync's "· 2 on" suffix, so
// a switch turned on inside a closed disclosure is never invisible behind it.
export const SettingsDisclosureButton: React.FC<{
  open: boolean;
  onToggle: () => void;
  label: string;
  suffix?: React.ReactNode;
}> = ({ open, onToggle, label, suffix }) => (
  <button
    type="button"
    aria-expanded={open}
    onClick={onToggle}
    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-tertiary hover:text-text-secondary transition-colors"
  >
    <DisclosureChevron open={open} />
    {label}
    {suffix ? <span className="ml-1 normal-case tracking-normal font-medium text-text-secondary">{suffix}</span> : null}
  </button>
);

// A small group label inside a disclosure, set on the tile edge.
export const SettingsGroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  // text-secondary, not General's text-tertiary: tertiary measures 3.25:1 on the
  // light canvas, and a group label is text people read, not decoration.
  <div className="px-[17px] pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{children}</div>
);

export type SettingsTone = 'warn' | 'danger' | 'ok';

// Status text. The palette's 300/400 shades are tuned for the dark canvas and
// fall well under 4.5:1 on the light one, so light takes the 700/800s. Green is
// the one step darker than Sync's copy: green-700 measured 4.49:1 as bare 12px
// text on the light canvas (a provider grade), so it goes to 800.
export function useSettingsTones(): Record<SettingsTone, string> & { text: Record<SettingsTone, string> } {
  const isLight = useResolvedTheme() === 'light';
  return {
    warn: `bg-amber-500/10 border-amber-500/20 ${isLight ? 'text-amber-800' : 'text-amber-200/90'}`,
    danger: `bg-red-500/10 border-red-500/20 ${isLight ? 'text-red-700' : 'text-red-300'}`,
    ok: `bg-green-500/10 border-green-500/20 ${isLight ? 'text-green-800' : 'text-green-400'}`,
    text: {
      warn: isLight ? 'text-amber-800' : 'text-amber-300',
      danger: isLight ? 'text-red-700' : 'text-red-400',
      ok: isLight ? 'text-green-800' : 'text-green-400',
    },
  };
}

// Sync's inline notice. Owns its bottom gap, like every row child.
// `className` replaces the bottom gap when a notice sits in a spaced stack.
// An `alert` shakes once as it lands (`.t-notice-shake`, src/index.css), and is
// re-keyed on `shakeKey` so a DIFFERENT message replays the shake while a
// re-render carrying the same one leaves it alone. Only alerts shake, and only
// once the pane is ready: an alert that is already true when the pane opens
// (a saved auth failure) is the state of things, not news, and must not shake
// on every open. The Collapse around it is silent then too.
export const SettingsNotice: React.FC<{
  tone: string;
  icon: React.ReactNode;
  alert?: boolean;
  shakeKey?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ tone, icon, alert, shakeKey, className = 'mb-3', children }) => {
  const ready = React.useContext(SettingsMotionReady);
  const key = shakeKey ?? '';
  const silentKey = useRef<string | null>(ready ? null : key);
  const shake = alert && ready && key !== silentKey.current;
  useEffect(() => {
    if (ready && key !== silentKey.current) silentKey.current = null;
  }, [ready, key]);
  return (
    <div
      key={alert ? shakeKey : undefined}
      role={alert ? 'alert' : undefined}
      className={`${className} flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${tone}${shake ? ' t-notice-shake' : ''}`}
    >
      <span className="mt-px shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
};

// Sync's footnote under a section.
export const SettingsFootnote: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <p className="flex items-start gap-2 px-1 mt-3 text-xs text-text-secondary">
    <span className="mt-px shrink-0">{icon}</span>
    <span>{children}</span>
  </p>
);
