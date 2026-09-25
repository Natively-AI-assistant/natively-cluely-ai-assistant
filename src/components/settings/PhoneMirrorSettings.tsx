import { AlertCircle, BookOpen, Braces, Briefcase, Check, ClipboardPaste, Copy, Eye, EyeOff, FileText, HelpCircle, KeyRound, Lock, Paperclip, QrCode, RefreshCw, Smartphone, Sparkles, Wifi } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { useT } from '../../i18n';
import { extensionPairingSatisfied, isPartialPhoneMirrorStatus, mergePhoneMirrorStatus } from '../../lib/phoneMirrorStatusMerge.mjs';
import type { BrowserContextSettings, PhoneMirrorInfo } from '../../types/electron';
import { LiquidGlassBadge } from '../../ui-components/LiquidGlassBadge';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import { isMac } from '../../utils/platformUtils';
import { NativelyLogoMark } from '../NativelyLogoMark';
import { Disclosure, DisclosureChevron } from '../ui/AccordionSection';
import { SettingsToggle } from './SettingsToggle';

// Sync is built from the parts General and Audio are built from, not from a
// system of its own: Audio's section heading, General's row (40px tile,
// 14px bold title, 12px description, SettingsToggle), General's secondary
// button and ADVANCED disclosure, Audio's card for anything that opens under a
// row, and the Liquid Glass badge/button General and Billing use. Colour comes
// from the same Tailwind tokens, so both themes follow them for free; the only
// theme-split values here are the red/green status text, which the
// palette's dark-tuned 300/400 shades cannot carry on the light canvas.

// ── Motion ───────────────────────────────────────────────────────────────
// The transitions.dev token scale, as values: framer-motion (already in this
// renderer — the shared Disclosure runs on it) drives the pieces that have to
// sequence an exit before an entrance, which a React re-render cannot do with
// CSS alone. Every state change on this pane goes through one of six moves:
//   text swap   150ms ease-in-out, 4px, 2px blur   descriptions, button labels
//   icon swap   250ms ease-in-out, 0.25 scale, 2px  eye/copy/check glyphs
//   badge pop   500ms bounce in, 180ms out          status tags
//   collapse    250ms smooth-out, height + opacity   notices, rows, cards
//   roll        150ms ease-in-out, 4px, 2px blur    countdown digits, per column
//   drain       linear, on the wall clock           countdown ring
// No `layout`/`layoutId` anywhere: layout projection caused a scroll
// regression in this same settings scroller (see AIProvidersSettings).
const EASE_SMOOTH_OUT = [0.22, 1, 0.36, 1] as const;
const EASE_BOUNCE = [0.34, 1.36, 0.64, 1] as const;
const EASE_CLOSE = [0.4, 0, 0.2, 1] as const;
const DUR_QUICK = 0.15;
const DUR_FAST = 0.25;
const DUR_BADGE_FADE = 0.4;
const DUR_BADGE_POP = 0.5;
const DUR_BADGE_CLOSE = 0.18;

// Until the first status/settings read lands, the pane renders the settled
// state with no motion at all — otherwise opening Sync with the mirror already
// on would "expand" every row, because `info` starts life as EMPTY_INFO.
const MotionReadyContext = React.createContext(false);

/** Height + opacity, the shared Disclosure's move, but silent before hydration. */
const Collapse: React.FC<{ open: boolean; children: React.ReactNode }> = ({ open, children }) => {
  const ready = React.useContext(MotionReadyContext);
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="collapse"
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

// Every "this thing changed" move on the pane, as presets of ONE component.
// `id` names the state on show: a new id plays the old one's exit and the new
// one's entrance; null shows nothing (and plays the exit). Before hydration
// nothing animates (see MotionReadyContext); under reduced motion the
// transforms drop out and the fades stay.
//   text     transitions.dev "text states swap": out up, in from below, 2px blur
//   icon     transitions.dev "icon swap": cross-fade in one fixed 14px slot
//   badge    transitions.dev "notification badge": bouncy pop in, quiet exit
//   control  a control that changes identity (Connect → Re-pair, Reset → confirm)
type PresenceKind = 'text' | 'icon' | 'badge' | 'control';

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

const Presence: React.FC<{
  kind: PresenceKind;
  id: string | null;
  /** Text only: a block-level swap (a whole description) rather than inline. */
  block?: boolean;
  className?: string;
  children?: React.ReactNode;
}> = ({ kind, id, block, className = '', children }) => {
  const ready = React.useContext(MotionReadyContext);
  const m = presenceMotion(kind, !!useReducedMotion());
  const cls = `${block ? 'block' : m.className} ${className}`;
  // Before hydration: plain markup, no AnimatePresence at all (the fix
  // SettingsRow.tsx's copy already carries). Gating only `initial` is not
  // enough: in mode="wait" the incoming child mounts after the outgoing one's
  // exit settles, a frame or more later, by which time `ready` has flipped, so
  // a running mirror's description swapped in on every open of Sync.
  if (!ready) {
    const Plain = kind === 'control' ? 'div' : 'span';
    const body = id !== null ? <Plain className={cls}>{children}</Plain> : null;
    return kind === 'icon' ? (
      <span className="relative inline-block w-3.5 h-3.5 shrink-0" aria-hidden="true">
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
    <span className="relative inline-block w-3.5 h-3.5 shrink-0" aria-hidden="true">
      {presence}
    </span>
  ) : (
    presence
  );
};

/** Copy to the clipboard and say so for a moment; the timer dies with the pane. */
function useCopyFlash(ms = 1200): [boolean, (text: string | null) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(
    async (text: string | null) => {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), ms);
      } catch (_) {
        /* noop */
      }
    },
    [ms],
  );
  return [copied, copy];
}

/**
 * A busy flag that only shows once the work has run long enough to be worth a
 * word, then stays long enough to be read. Starting/stopping/updating often
 * finish in 100–400ms; a 500ms badge pop that exits half way through is
 * a flicker, not feedback. transitions-polish's intent-delay rule.
 */
function useSettledFlag(active: boolean, delayMs = 250, minVisibleMs = 450): boolean {
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

// General's "Check" button, minus its fixed 110px width, plus a press: a quick
// 0.97 give on :active, and opacity in the transition list so a disabled state
// fades instead of snapping. Colour is split out so the Copy, Reset and
// confirm buttons can swap it for a status tone.
const BTN_BASE =
  'px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100';
const BTN_NEUTRAL = 'bg-bg-component hover:bg-bg-elevated text-text-primary border-border-subtle';
const BTN = `${BTN_BASE} ${BTN_NEUTRAL}`;

const EMPTY_BROWSER_CTX: BrowserContextSettings = {
  autoDetectCoding: true,
  autoAttachCoding: true,
  askBeforeUnknown: true,
  aiClassifierEnabled: false,
  autoDetectJobDescriptions: false,
  autoDetectDeveloperDocs: false,
  experimentalFullPageCapture: false,
};

const EMPTY_INFO: PhoneMirrorInfo = {
  running: false,
  enabled: false,
  exposeOnLan: false,
  port: 0,
  loopbackUrl: null,
  primaryUrl: null,
  lanUrls: [],
  token: null,
  extToken: null,
  qrDataUrl: null,
  clients: 0,
  extensionConnected: false,
  bindAddress: '127.0.0.1',
};

type CtxIpcKey =
  | 'browserAutoDetectCoding'
  | 'browserAutoAttachCoding'
  | 'browserAskBeforeUnknown'
  | 'browserAiClassifierEnabled'
  | 'browserAutoDetectJobDescriptions'
  | 'browserAutoDetectDeveloperDocs'
  | 'browserExperimentalFullPageCapture';

interface CtxOption {
  field: keyof BrowserContextSettings;
  ipcKey: CtxIpcKey;
  label: string;
  desc: string;
  Icon: React.ComponentType<{ size?: number }>;
  experimental?: boolean;
}

// Resolved BrowserContextSettings field → the IPC's browser* setting key.
const PRIMARY_CTX: CtxOption[] = [
  {
    field: 'autoDetectCoding',
    ipcKey: 'browserAutoDetectCoding',
    label: 'Auto-detect coding problems',
    Icon: Braces,
    desc: 'Recognize high-confidence coding and interview pages locally.',
  },
  {
    field: 'autoAttachCoding',
    ipcKey: 'browserAutoAttachCoding',
    label: 'Auto-attach coding context',
    Icon: Paperclip,
    desc: 'Capture the problem and attach it when you ask for an answer.',
  },
  {
    field: 'askBeforeUnknown',
    ipcKey: 'browserAskBeforeUnknown',
    label: 'Ask before attaching unknown pages',
    Icon: HelpCircle,
    desc: "If a page can't be classified confidently, ask before attaching it.",
  },
];

// Collapsed by default. The disclosure counts how many are on, so a switch
// turned on in here is never invisible behind it.
const MORE_CTX: CtxOption[] = [
  {
    field: 'aiClassifierEnabled',
    ipcKey: 'browserAiClassifierEnabled',
    label: 'AI page classifier',
    Icon: Sparkles,
    desc: 'Classify unknown pages from sanitized metadata.',
  },
  {
    field: 'autoDetectJobDescriptions',
    ipcKey: 'browserAutoDetectJobDescriptions',
    label: 'Auto-detect job descriptions',
    Icon: Briefcase,
    desc: 'Recognize job posts.',
  },
  {
    field: 'autoDetectDeveloperDocs',
    ipcKey: 'browserAutoDetectDeveloperDocs',
    label: 'Auto-detect developer docs',
    Icon: BookOpen,
    desc: 'Recognize developer documentation.',
  },
  {
    field: 'experimentalFullPageCapture',
    ipcKey: 'browserExperimentalFullPageCapture',
    label: 'Full page context',
    Icon: FileText,
    desc: 'Send the whole page when excerpts miss details. Uses more tokens.',
    experimental: true,
  },
];

// The countdown wears the Settings switch's ON blue (--toggle-on), not the
// periwinkle accent. The ring is a graphic (3:1 bar) and takes it flat in
// both themes; as 10-12px TEXT on the light card the flat #6688F5 is only
// 3.17:1, so light-theme text takes it 20% deeper (#526DC4, 4.69:1).
const TOGGLE_INK = 'var(--toggle-on)';
const TOGGLE_TEXT_INK_LIGHT = 'color-mix(in srgb, var(--toggle-on) 80%, #000)';

// A countdown's digits fall: the new digit drops in from above and the old one
// leaves downward (Apple's numericText(countsDown:)). A re-arm that jumps the
// count back UP rolls the other way. The move is the pane's text swap.
type DigitRollCustom = { dir: 1 | -1; dy: number };
const DIGIT_ROLL = {
  enter: ({ dir, dy }: DigitRollCustom) => ({ opacity: 0, y: -dir * dy, filter: 'blur(2px)' }),
  center: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: ({ dir, dy }: DigitRollCustom) => ({ opacity: 0, y: dir * dy, filter: 'blur(2px)' }),
};

/**
 * A ring that drains with the wall clock, and digits that roll a column at a
 * time. The ring is ONE linear Web Animation across the whole window, placed
 * on the document timeline by a negative delay — not a 1s transition restarted
 * every tick, which ran up to a second behind the digits and, like anything on
 * requestAnimationFrame, stalled while Chromium throttled a hidden window.
 */
const PairingCountdownRing: React.FC<{ seconds: number; deadline: number; total: number; textInk: string }> = ({
  seconds,
  deadline,
  total,
  textInk,
}) => {
  const reduce = !!useReducedMotion();
  const size = 32;
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const safeTotal = total > 0 ? total : 60;
  const remaining = Math.max(0, Math.min(safeTotal, seconds));
  const arc = useRef<SVGCircleElement>(null);

  // pathLength=1 keeps the dash maths in 0..1: offset 0 is a full ring, 1 empty.
  useEffect(() => {
    const el = arc.current;
    if (!el || reduce || typeof el.animate !== 'function') return;
    const windowMs = safeTotal * 1000;
    const anim = el.animate([{ strokeDashoffset: '0' }, { strokeDashoffset: '1' }], {
      duration: windowMs,
      delay: -(windowMs - (deadline - Date.now())),
      easing: 'linear',
      fill: 'both',
    });
    return () => anim.cancel();
  }, [deadline, safeTotal, reduce]);

  // Which way the digits roll: remembered from the previous count, derived
  // during render rather than in an effect so the first frame already knows.
  const [roll, setRoll] = useState<{ value: number; dir: 1 | -1 }>({ value: remaining, dir: 1 });
  if (roll.value !== remaining) setRoll({ value: remaining, dir: remaining < roll.value ? 1 : -1 });
  const custom: DigitRollCustom = { dir: roll.dir, dy: reduce ? 0 : 4 };
  const digits = String(remaining).split('');

  return (
    <div className="relative h-8 w-8 shrink-0" aria-hidden="true">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block" style={{ color: TOGGLE_INK }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="opacity-20" />
        <circle
          ref={arc}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          // Reduced motion (and the first paint) read the whole seconds; the
          // running animation overrides this while it plays.
          strokeDashoffset={1 - remaining / safeTotal}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center">
        <span className="inline-flex font-mono text-[10px] font-semibold leading-none" style={{ color: textInk }}>
          {digits.map((d, i) => (
            // Keyed by column from the right, so 42 → 41 rolls only the ones.
            <span key={digits.length - 1 - i} className="relative inline-block h-[1em] w-[1ch]">
              <AnimatePresence initial={false} custom={custom}>
                <motion.span
                  key={d}
                  custom={custom}
                  variants={DIGIT_ROLL}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: DUR_QUICK, ease: 'easeInOut' }}
                  className="absolute inset-0 grid place-items-center"
                >
                  {d}
                </motion.span>
              </AnimatePresence>
            </span>
          ))}
        </span>
      </span>
    </div>
  );
};

/**
 * The extension's one-click pairing window, counting down. It owns its own
 * tick — the pane above only knows the deadline — so a minute of countdown
 * re-renders this card, not every row. Each tick reads the clock (so a
 * throttled window stays honest) and schedules the next one for the moment
 * the whole-second count changes, which is when the ring crosses that second.
 */
const PairingCountdown: React.FC<{ deadline: number; total: number; onExpired: () => void }> = ({
  deadline,
  total,
  onExpired,
}) => {
  const t = useT();
  const isLight = useResolvedTheme() === 'light';
  const textInk = isLight ? TOGGLE_TEXT_INK_LIGHT : TOGGLE_INK;
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const msLeft = deadline - Date.now();
      const left = Math.max(0, Math.ceil(msLeft / 1000));
      setRemaining(left);
      if (left <= 0) {
        onExpired();
        return;
      }
      // ceil(msLeft / 1000) next changes once msLeft falls past the whole
      // second below it; land a few ms after that so the read is unambiguous.
      timer = setTimeout(tick, (msLeft % 1000 || 1000) + 5);
    };
    tick();
    return () => clearTimeout(timer);
  }, [deadline, onExpired]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`Waiting for extension. Pairing window: ${remaining} seconds remaining.`}
      className="bg-bg-card rounded-xl border border-border-subtle p-3 flex items-center gap-3"
    >
      <PairingCountdownRing seconds={remaining} deadline={deadline} total={total} textInk={textInk} />
      <div className="min-w-0">
        <p className="text-sm font-bold text-text-primary">{t('Waiting for extension')}</p>
        <p className="text-xs text-text-secondary mt-0.5">
          {t('Click')}{' '}
          <span className="font-medium" style={{ color: textInk }}>
            {t('Connect to Natively')}
          </span>{' '}
          {t('in the extension popup.')}
        </p>
      </div>
    </div>
  );
};

// Audio's section heading.
const SectionHeading: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <>
    <h3 className="text-lg font-bold text-text-primary mb-1">{title}</h3>
    <p className="text-xs text-text-secondary mb-2">{subtitle}</p>
  </>
);

// General's row. Two additions for Sync's longer copy: the text block can
// shrink (min-w-0 flex-1) and the control cannot, so a two-line description
// wraps instead of squeezing the switch. `children` hang under the row,
// indented to the title (px-4 + 40px tile + gap-4 = 72px); each child is a
// <Collapse> that owns its own bottom gap, so a closed one leaves none.
// `descriptionKey` names the description's STATE, so a change of state swaps
// the text rather than snapping it.
// A row's status tag: `key` names the state, so a change of state re-pops it.
// `quiet` tags (Starting / Stopping / Updating) mark work in flight: they fade
// in calmly instead of bouncing — overshoot is for arrivals worth celebrating.
type RowBadge = { key: string; node: React.ReactNode; quiet?: boolean };

const SyncRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  badge?: RowBadge | null;
  description?: React.ReactNode;
  descriptionKey?: string;
  control?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ icon, title, badge = null, description, descriptionKey, control, children }) => (
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
            <h4 className="text-sm font-bold text-text-primary">{title}</h4>
            <Presence kind={badge?.quiet ? 'control' : 'badge'} id={badge?.key ?? null} className="inline-flex">
              {badge?.node}
            </Presence>
          </div>
          {description && (
            <p className="text-xs text-text-secondary mt-0.5">
              {descriptionKey ? (
                <Presence kind="text" id={descriptionKey} block>
                  {description}
                </Presence>
              ) : (
                description
              )}
            </p>
          )}
        </div>
      </div>
      {control && <div className="shrink-0 flex items-center gap-2">{control}</div>}
    </div>
    {children && <div className="pl-[72px] pr-4">{children}</div>}
  </div>
);

// General's switch, with General's track colours passed exactly as it passes them.
const Switch: React.FC<{ checked: boolean; onChange: () => void; label: string }> = ({ checked, onChange, label }) => (
  <SettingsToggle
    checked={checked}
    onChange={onChange}
    label={label}
    className={checked ? 'bg-accent-primary border border-transparent' : 'bg-bg-toggle-switch border border-border-muted'}
  />
);

export const PhoneMirrorSettings: React.FC = () => {
  const t = useT();
  const isLight = useResolvedTheme() === 'light';
  const [info, setInfo] = useState<PhoneMirrorInfo>(EMPTY_INFO);
  const [busy, setBusy] = useState<null | 'enable' | 'disable' | 'lan' | 'rotate'>(null);
  // Phone Mirror server errors (status load, enable/disable, LAN, reset).
  const [error, setError] = useState<string | null>(null);
  // Smart Browser Context save errors — shown under their own section.
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [copied, copyLink] = useCopyFlash();
  // Companion browser-extension pairing: countdown (seconds left) while the 60s
  // one-click /pair window is open after "Connect browser extension".
  // The parent holds only the deadline; the countdown ticks itself, so the pane
  // is not re-rendered every second for the length of the window.
  const [armDeadline, setArmDeadline] = useState<number | null>(null);
  const [armTotal, setArmTotal] = useState(60);
  const [armError, setArmError] = useState<string | null>(null);
  const [pairCopied, copyPairString] = useCopyFlash();
  // Both pairing secrets stay behind an explicit reveal: Natively is used
  // while screen sharing, and the QR/link carry the phone token. The reveal
  // unmounts them while closed, so they are not in the DOM at all.
  const [showPairing, setShowPairing] = useState(false);
  const [showOtherAddrs, setShowOtherAddrs] = useState(false);
  const [showManualPair, setShowManualPair] = useState(false);
  const [showMoreCtx, setShowMoreCtx] = useState(false);
  // Reset is confirmed inline, not with <ConfirmDialog>: that portals to <body>
  // at z-50, and Settings sits inside GenieModal at z-index 300, so the dialog
  // opened invisibly BEHIND Settings while its overlay still took the input.
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const cancelResetRef = useRef<HTMLButtonElement | null>(null);

  // Optimistic switches. A switch used to sit still until the IPC answered —
  // and a LAN flip RESTARTS the server — while every control on the pane
  // dropped to 50% opacity (.t-toggle:disabled has no opacity transition, so
  // it snapped). Now the thumb travels on the click, the rest of the pane
  // stays put, and the value settles to whatever the service reports: a
  // declined LAN dialog or an error animates the switch back once.
  const [pendingRunning, setPendingRunning] = useState<boolean | null>(null);
  const [pendingLan, setPendingLan] = useState<boolean | null>(null);
  // A LAN flip tears the server down and starts it again, and every broadcast
  // from inside that restart is a half-state: running:false, no QR, no link,
  // every phone and the extension dropped. Rendering them blinked the Enable
  // switch, emptied the pairing card and bounced the "Connected" badges. So
  // for the length of the flip the pane renders the snapshot taken at the
  // click, and settles once, on the service's answer.
  const [flipView, setFlipView] = useState<PhoneMirrorInfo | null>(null);
  // The restart also drops live connections; phones and the extension
  // reconnect on their own a moment later. Keep showing what was connected
  // before the flip until they are back, or for a few seconds at most.
  const [connGrace, setConnGrace] = useState<{ clients: number; ext: boolean } | null>(null);
  // Synchronous re-entry guard: `busy` is state, so a second click inside the
  // same frame would still read null.
  const inFlightRef = useRef(false);

  // Nothing animates until both reads have landed AND rendered (see
  // MotionReadyContext). Readiness flips one tick after the commit that
  // carried the data: React batches the data and a same-tick ready flag into
  // one render, which would mount the rows already "ready" and expand them.
  const [infoReady, setInfoReady] = useState(false);
  const [ctxReady, setCtxReady] = useState(false);
  const [motionReady, setMotionReady] = useState(false);
  useEffect(() => {
    if (!infoReady || !ctxReady) return;
    const timer = setTimeout(() => setMotionReady(true), 0);
    return () => clearTimeout(timer);
  }, [infoReady, ctxReady]);

  // Smart Browser Context v2 — auto-capture settings.
  const [ctx, setCtx] = useState<BrowserContextSettings>(EMPTY_BROWSER_CTX);

  const refresh = useCallback(async () => {
    try {
      const next = await window.electronAPI.phoneMirrorGetInfo();
      if (next && typeof next === 'object') setInfo(next as PhoneMirrorInfo);
    } catch (e: any) {
      setError(e?.message || 'Failed to load phone mirror status');
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setInfoReady(true));
    const off = window.electronAPI.onPhoneMirrorStatus((next) => {
      if (!next || typeof next !== 'object') return;
      // This pane lives in the launcher window, which only receives the small
      // flag subset of a status broadcast (ipcHandlers.ts onStatusChange). Lay
      // the flags over the full snapshot we already hold — replacing it wiped
      // port/bindAddress/exposeOnLan/URLs ("port undefined · bound to
      // undefined", LAN toggle snapping back off ~150 ms after Allow).
      setInfo((prev) => mergePhoneMirrorStatus(prev, next));
      // The subset cannot describe a (re)start — new port, bind host, URLs, QR —
      // so reconcile with the full snapshot. Broadcasts are deduped upstream on
      // the flag tuple, so this is one get-info per real flag change.
      if (isPartialPhoneMirrorStatus(next)) void refresh();
    });
    return () => {
      off?.();
    };
  }, [refresh]);

  // Load Smart Browser Context settings once.
  useEffect(() => {
    (async () => {
      try {
        const res = await window.electronAPI.browserContextGetSettings?.();
        if (res && typeof res === 'object' && !('error' in res)) {
          setCtx(res as BrowserContextSettings);
        }
      } catch {
        /* keep documented defaults */
      } finally {
        setCtxReady(true);
      }
    })();
  }, []);

  // Toggle one auto-capture setting and persist it.
  const onToggleCtx = useCallback(
    async (field: keyof BrowserContextSettings, ipcKey: CtxIpcKey) => {
      const next = !ctx[field];
      setCtxError(null);
      // Optimistic update; reconcile with the persisted resolved settings.
      setCtx((prev) => ({ ...prev, [field]: next }));
      try {
        const res = await window.electronAPI.browserContextSetSettings?.({ [ipcKey]: next });
        if (res && typeof res === 'object' && !('error' in res)) {
          setCtx(res as BrowserContextSettings);
        }
      } catch (e: any) {
        setCtxError(e?.message || 'Failed to save browser context setting');
        setCtx((prev) => ({ ...prev, [field]: !next })); // revert
      }
    },
    [ctx],
  );

  const apply = useCallback(
    async (key: 'enable' | 'disable' | 'lan' | 'rotate', fn: () => Promise<any>): Promise<PhoneMirrorInfo | null> => {
      setBusy(key);
      setError(null);
      try {
        const result = await fn();
        if (result && typeof result === 'object' && 'error' in result && result.error) {
          setError(String(result.error));
        } else if (result && typeof result === 'object' && 'running' in result) {
          setInfo(result as PhoneMirrorInfo);
          return result as PhoneMirrorInfo;
        } else {
          await refresh();
        }
      } catch (e: any) {
        setError(e?.message || 'Action failed');
      } finally {
        setBusy(null);
      }
      return null;
    },
    [refresh],
  );

  const onToggleEnable = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPendingRunning(!info.running);
    try {
      if (info.running) {
        await apply('disable', () => window.electronAPI.phoneMirrorDisable());
      } else {
        await apply('enable', () => window.electronAPI.phoneMirrorEnable(info.exposeOnLan));
      }
    } finally {
      // `apply` has already written the service's answer into `info`, so the
      // switch settles on it without a second hop.
      inFlightRef.current = false;
      setPendingRunning(null);
    }
  }, [apply, info.running, info.exposeOnLan]);

  const onToggleLan = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPendingLan(!info.exposeOnLan);
    const before = info.running ? info : null;
    if (before) setFlipView(before);
    try {
      await apply('lan', () => window.electronAPI.phoneMirrorSetLan(!info.exposeOnLan));
    } finally {
      inFlightRef.current = false;
      setPendingLan(null);
      if (before) {
        setConnGrace({ clients: before.clients, ext: before.extensionConnected });
        setFlipView(null);
      }
    }
  }, [apply, info]);

  // Rotates BOTH the phone token and the extension token and disconnects every
  // client (PhoneMirrorService.rotateToken), hence the confirm and its copy.
  // A reset has succeeded when the reply carries a NEW extension token; only
  // then does the button say so. A failed reset shows its error instead.
  const onRotate = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const before = info.extToken;
    try {
      const reply = await apply('rotate', () => window.electronAPI.phoneMirrorRotateToken());
      if (reply && reply.extToken !== before) setResetDone(true);
    } finally {
      inFlightRef.current = false;
    }
  }, [apply, info.extToken]);
  useEffect(() => {
    if (!resetDone) return;
    const timer = setTimeout(() => setResetDone(false), 1600);
    return () => clearTimeout(timer);
  }, [resetDone]);

  // What the pane renders: the live state, or the pre-flip snapshot mid-flip.
  const view = flipView ?? info;
  const shownRunning = view.running;
  useEffect(() => {
    if (!connGrace) return;
    const timer = setTimeout(() => setConnGrace(null), 4000);
    return () => clearTimeout(timer);
  }, [connGrace]);
  useEffect(() => {
    if (connGrace && info.clients >= connGrace.clients && (info.extensionConnected || !connGrace.ext)) setConnGrace(null);
  }, [connGrace, info.clients, info.extensionConnected]);
  const shownClients = connGrace ? Math.max(view.clients, connGrace.clients) : view.clients;
  const shownExtConnected = connGrace ? view.extensionConnected || connGrace.ext : view.extensionConnected;

  // Asking to confirm moves focus to Cancel, the safe choice. A server stop
  // unmounts the row, so drop a pending confirm rather than resurrect it later.
  useEffect(() => {
    if (confirmReset) cancelResetRef.current?.focus();
  }, [confirmReset]);
  useEffect(() => {
    if (!shownRunning) setConfirmReset(false);
  }, [shownRunning]);

  // "Connect browser extension" — arm the 60s one-click pairing window on the
  // desktop, then run a local countdown so the user knows how long they have to
  // click "Connect to Natively" in the extension popup.
  const armedAtRef = useRef(0);
  const onArmExtension = useCallback(async () => {
    setArmError(null);
    armedAtRef.current = Date.now();
    try {
      const result = await window.electronAPI.phoneMirrorArmExtension();
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        setArmError(String(result.error));
        return;
      }
      const seconds =
        result && typeof result === 'object' && 'armedMs' in result
          ? Math.round((result.armedMs as number) / 1000)
          : 60;
      setArmTotal(seconds);
      setArmDeadline(Date.now() + seconds * 1000);
    } catch (e: any) {
      setArmError(e?.message || 'Failed to arm pairing');
    }
  }, []);

  // The moment the extension connects, the pairing window has done its job:
  // stop the countdown so the row goes straight to "Connected" instead of
  // saying "Waiting for extension" for up to another minute. Only the
  // false → true EDGE counts — a Re-pair starts while already connected.
  const prevExtConnectedRef = useRef(info.extensionConnected);
  useEffect(() => {
    const was = prevExtConnectedRef.current;
    prevExtConnectedRef.current = info.extensionConnected;
    if (!was && info.extensionConnected) setArmDeadline(null);
  }, [info.extensionConnected]);
  // A Re-pair never makes that edge: the extension stays connected on the same
  // token. The service stamps extPairedAt when /pair succeeds, so a stamp from
  // after this window opened, with the extension connected, ends it too. (Both
  // clocks are this machine's Date.now().)
  useEffect(() => {
    if (armDeadline !== null && extensionPairingSatisfied(info, armedAtRef.current)) setArmDeadline(null);
  }, [armDeadline, info]);

  // Manual fallback: the raw `port:token` string for the extension's "Pair
  // manually instead" field. It carries the EXTENSION token (loopback-scoped),
  // not the phone token — this string pairs the browser extension.
  const pairString = view.port && view.extToken ? `${view.port}:${view.extToken}` : null;

  const lanChecked = pendingLan ?? info.exposeOnLan;
  const runningChecked = pendingRunning ?? view.running;
  const onLan = view.bindAddress === '0.0.0.0';
  const arming = armDeadline !== null;
  const onArmExpired = useCallback(() => setArmDeadline(null), []);
  const moreOnCount = MORE_CTX.filter((o) => ctx[o.field]).length;

  const phoneBusyShown = useSettledFlag(busy === 'enable' || busy === 'disable');
  const lanBusyShown = useSettledFlag(busy === 'lan');
  // Hold the verb that was showing, so the badge does not read "Stopping" while
  // it lingers after a start.
  const phoneBusyVerbRef = useRef<'enable' | 'disable'>('enable');
  if (busy === 'enable' || busy === 'disable') phoneBusyVerbRef.current = busy;

  // Status text. The palette's 300/400 shades are tuned for the dark canvas and
  // fall well under 4.5:1 on the light one, so light takes the 700s.
  const dangerTone = `bg-red-500/10 border-red-500/20 ${isLight ? 'text-red-700' : 'text-red-300'}`;
  const okTone = `bg-green-500/10 border-green-500/20 ${isLight ? 'text-green-700' : 'text-green-400'}`;

  // Notices collapse open and shut under their row; the message is kept by
  // AnimatePresence through the exit, so it never blanks mid-collapse.
  const notice = (
    open: boolean,
    tone: string,
    icon: React.ReactNode,
    body: React.ReactNode,
    alert = false,
    gap: 'above' | 'below' = 'below',
  ) => (
    <Collapse open={open}>
      <div className={gap === 'above' ? 'pt-3' : 'pb-3'}>
        <div
          /* Re-keyed on the message so a DIFFERENT error remounts this node
             and replays the shake, while a re-render carrying the same message
             leaves it alone. This is the React equivalent of the recipe's
             remove-class / force-reflow / re-add dance, without the timers. */
          key={alert ? String(body) : undefined}
          role={alert ? 'alert' : undefined}
          /* Only alerts shake. A tip that jolts is noise. */
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${tone}${alert ? ' t-notice-shake' : ''}`}
        >
          <span className="mt-px shrink-0">{icon}</span>
          <span>{body}</span>
        </div>
      </div>
    </Collapse>
  );

  const copyButton = (value: string | null, isCopied: boolean, copy: (text: string | null) => Promise<void>, label: string) => (
    <button
      type="button"
      onClick={() => void copy(value)}
      disabled={!value}
      aria-label={label}
      className={`${BTN_BASE} min-w-[92px] ${isCopied ? okTone : BTN_NEUTRAL}`}
    >
      <Presence kind="icon" id={isCopied ? 'check' : 'copy'}>
        {isCopied ? <Check size={14} /> : <Copy size={14} />}
      </Presence>
      <Presence kind="text" id={isCopied ? 'copied' : 'copy'}>
        {isCopied ? t('Copied') : t('Copy')}
      </Presence>
    </button>
  );

  const secretField = (value: string | null) => (
    <code
      className="flex-1 min-w-0 truncate rounded-lg border border-border-subtle bg-bg-input px-3 py-2 font-mono text-xs text-text-primary"
      title={value || undefined}
    >
      {/* A token rotation (Reset, or a LAN flip) swaps the link in place. */}
      <Presence kind="text" id={value || 'none'} block className="truncate">
        {value || '—'}
      </Presence>
    </code>
  );

  const revealButton = (open: boolean, onClick: () => void, showLabel: string, hideLabel: string, minW: string) => (
    <button type="button" className={`${BTN} ${minW}`} aria-expanded={open} onClick={onClick}>
      <Presence kind="icon" id={open ? 'hide' : 'show'}>
        {open ? <EyeOff size={14} /> : <Eye size={14} />}
      </Presence>
      <Presence kind="text" id={open ? 'hide' : 'show'}>
        {open ? hideLabel : showLabel}
      </Presence>
    </button>
  );

  const tag = (key: string, label: string, variant: 'sky' | 'green' = 'sky', quiet = false): RowBadge => ({
    key,
    quiet,
    node: <LiquidGlassBadge variant={variant}>{label}</LiquidGlassBadge>,
  });
  const verb = phoneBusyVerbRef.current;
  const phoneBadge = phoneBusyShown
    ? tag(`busy-${verb}`, verb === 'enable' ? t('Starting') : t('Stopping'), 'sky', true)
    : view.running && shownClients > 0
      ? tag(`clients-${shownClients}`, `${shownClients} ${shownClients === 1 ? t('phone connected') : t('phones connected')}`, 'green')
      : null;
  // No "Not connected" badge: the Connect button already says it, and the
  // neutral glass badge has no light-theme treatment (a #555 slab on white).
  const extBadge = arming
    ? tag('waiting', t('Waiting'), 'sky', true)
    : shownRunning && shownExtConnected
      ? tag('connected', t('Connected'), 'green')
      : null;

  // No action while the server is off (the description says what to do first)
  // or while the pairing window is open (the countdown is the state).
  const extControlKey = arming || !shownRunning ? null : shownExtConnected ? 'repair' : 'connect';

  const renderCtxRow = (o: CtxOption) => (
    <SyncRow
      key={o.field}
      icon={<o.Icon size={20} />}
      title={t(o.label)}
      description={t(o.desc)}
      badge={o.experimental ? tag('experimental', t('Experimental')) : null}
      control={
        <Switch
          checked={ctx[o.field]}
          onChange={() => {
            void onToggleCtx(o.field, o.ipcKey);
          }}
          label={t(o.label)}
        />
      }
    />
  );

  return (
    <MotionReadyContext.Provider value={motionReady}>
      <div className="space-y-6 animated fadeIn" data-settings-stagger>
        {/* ── Phone Mirror: the local server, who can reach it, and pairing ── */}
        <section>
          <SectionHeading title={t('Phone Mirror')} subtitle={t('Follow live answers on your phone.')} />

          <SyncRow
            icon={<Smartphone size={20} />}
            title={t('Enable Phone Mirror')}
            badge={phoneBadge}
            descriptionKey={view.running ? `run-${view.port}-${view.bindAddress}` : 'off'}
            description={
              view.running ? (
                <>
                  {t('Running on port')} <span className="tabular-nums">{view.port}</span>
                  {' · '}
                  {onLan ? t('open to your network') : t('this computer only')}{' '}
                  <span className="tabular-nums">({view.bindAddress})</span>
                </>
              ) : (
                t("Shows live answers in your phone's browser.")
              )
            }
            control={
              <Switch
                checked={runningChecked}
                onChange={() => {
                  void onToggleEnable();
                }}
                label={t('Enable Phone Mirror')}
              />
            }
          />

          <SyncRow
            icon={<Wifi size={20} />}
            title={t('Allow LAN access')}
            badge={lanBusyShown ? tag('updating', t('Updating'), 'sky', true) : null}
            descriptionKey={lanChecked ? 'lan-on' : 'lan-off'}
            description={
              lanChecked
                ? t('Open the mirror on any device on this network.')
                : t('Keep the mirror on this computer only.')
            }
            control={
              <Switch
                checked={lanChecked}
                onChange={() => {
                  void onToggleLan();
                }}
                label={t('Allow LAN access')}
              />
            }
          />

          {/* Pairing and reset exist only while the server runs; they grow in
              and fold away with it rather than popping the list. */}
          <Collapse open={shownRunning}>
            <SyncRow
              icon={<QrCode size={20} />}
              title={t('Pair a phone')}
              descriptionKey={view.exposeOnLan ? 'pair-lan' : 'pair-local'}
              description={
                view.exposeOnLan
                  ? t('Scan the code with your phone camera, or open the link on it.')
                  : t('LAN is off. Turn it on, or open the link on this computer.')
              }
              control={revealButton(showPairing, () => setShowPairing((v) => !v), t('Show code'), t('Hide code'), 'min-w-[112px]')}
            >
              <Collapse open={showPairing}>
                <div className="pb-3">
                  {/* Audio's card. The QR plaque stays white in both themes —
                      scanners want dark modules on light. */}
                  <div className="bg-bg-card rounded-xl border border-border-subtle p-4 flex flex-wrap items-start gap-4">
                    <div className="relative shrink-0 w-[126px] h-[126px] rounded-lg bg-white p-1.5 border border-black/5 overflow-hidden">
                      {/* A new token draws a new code: cross-fade it in place. */}
                      <AnimatePresence initial={false}>
                        {view.qrDataUrl ? (
                          <motion.img
                            key={view.qrDataUrl}
                            src={view.qrDataUrl}
                            alt={t('Pairing QR code')}
                            className="absolute inset-1.5 block w-28 h-28"
                            draggable={false}
                            initial={{ opacity: 0, filter: 'blur(2px)' }}
                            animate={{ opacity: 1, filter: 'blur(0px)' }}
                            exit={{ opacity: 0, filter: 'blur(2px)' }}
                            transition={{ duration: DUR_FAST, ease: 'easeInOut' }}
                          />
                        ) : (
                          <motion.div
                            key="pending"
                            className="absolute inset-0 grid place-items-center bg-bg-input text-xs text-text-secondary"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: DUR_QUICK }}
                          >
                            {t('Generating…')}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="flex-1 min-w-[200px] space-y-2">
                      <label className="text-xs font-medium text-text-secondary uppercase tracking-wide block">
                        {t('Pairing link')}
                      </label>
                      <div className="flex items-center gap-2">
                        {secretField(view.primaryUrl)}
                        {copyButton(view.primaryUrl, copied, copyLink, t('Copy pairing link'))}
                      </div>
                      {view.exposeOnLan && view.lanUrls.length > 1 && (
                        <div>
                          <button
                            type="button"
                            aria-expanded={showOtherAddrs}
                            onClick={() => setShowOtherAddrs((v) => !v)}
                            className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                          >
                            <DisclosureChevron open={showOtherAddrs} />
                            {t('Other network addresses')} ({view.lanUrls.length - 1})
                          </button>
                          <Disclosure open={showOtherAddrs}>
                            <ul className="mt-1.5 space-y-0.5 pl-5 font-mono text-xs text-text-secondary">
                              {view.lanUrls.slice(1).map((u) => (
                                <li key={u} className="truncate">
                                  {u}
                                </li>
                              ))}
                            </ul>
                          </Disclosure>
                        </div>
                      )}
                      <p className="flex items-start gap-2 pt-1 text-xs text-text-secondary">
                        <Lock size={14} className="mt-px shrink-0" />
                        <span>{t('The link carries a private token. Anyone who has it can open the mirror.')}</span>
                      </p>
                    </div>
                  </div>
                </div>
              </Collapse>
            </SyncRow>

            <SyncRow
              icon={<KeyRound size={20} />}
              title={t('Reset pairing')}
              descriptionKey={confirmReset ? 'confirm' : 'idle'}
              description={
                confirmReset
                  ? t('Old links stop working. Re-pair the extension.')
                  : t('Disconnects all phones and the extension. Use if a link leaked.')
              }
              control={
                <Presence kind="control" id={confirmReset ? 'confirm' : 'idle'}>
                  {confirmReset ? (
                    <div
                      className="flex items-center gap-2"
                      role="group"
                      aria-label={t('Confirm reset pairing')}
                      onKeyDown={(e) => {
                        // Stop here so Settings' window-level Escape does not close the panel too.
                        if (e.key === 'Escape' && busy !== 'rotate') {
                          e.stopPropagation();
                          setConfirmReset(false);
                        }
                      }}
                    >
                      <button
                        ref={cancelResetRef}
                        type="button"
                        className={BTN}
                        onClick={() => setConfirmReset(false)}
                        disabled={busy === 'rotate'}
                      >
                        {t('Cancel')}
                      </button>
                      <button
                        type="button"
                        className={`${BTN_BASE} hover:bg-red-500/15 ${dangerTone}`}
                        onClick={async () => {
                          await onRotate();
                          setConfirmReset(false);
                        }}
                        disabled={busy === 'rotate'}
                      >
                        {busy === 'rotate' && <RefreshCw size={14} className="animate-spin" />}
                        {t('Reset pairing')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`${BTN_BASE} min-w-[92px] ${resetDone ? okTone : BTN_NEUTRAL}`}
                      onClick={() => {
                        if (inFlightRef.current) return;
                        setResetDone(false);
                        setConfirmReset(true);
                      }}
                    >
                      <Presence kind="icon" id={resetDone ? 'done' : 'reset'}>
                        {resetDone ? <Check size={14} /> : <RefreshCw size={14} />}
                      </Presence>
                      <Presence kind="text" id={resetDone ? 'done' : 'reset'}>
                        {resetDone ? t('Done') : t('Reset')}
                      </Presence>
                    </button>
                  )}
                </Presence>
              }
            />
          </Collapse>

          {notice(!!error, dangerTone, <AlertCircle size={14} />, error, true, 'above')}
        </section>

        {/* ── Browser Extension: talks to the same local server, so it needs
            Phone Mirror running before it can pair. ── */}
        <section>
          <SectionHeading title={t('Browser Extension')} subtitle={t("Send the page you're reading to Natively.")} />

          <SyncRow
            icon={<NativelyLogoMark size={20} />}
            title="Natively Companion"
            badge={extBadge}
            descriptionKey={shownRunning ? 'ext-on' : 'ext-off'}
            description={
              shownRunning ? (
                <>
                  {t('Sends your active tab to Natively.')}{' '}
                  <kbd className="px-1.5 py-0.5 rounded bg-bg-input border border-border-subtle font-mono text-[10px] text-text-primary">
                    {isMac ? '⌘' : 'Ctrl'}+Y
                  </kbd>{' '}
                  {t('captures it manually.')}
                </>
              ) : (
                t('Turn on Phone Mirror first. The extension connects through it.')
              )
            }
            control={
              // Always mounted, so the outgoing control can animate away.
              <Presence kind="control" id={extControlKey}>
                  {extControlKey === null ? null : extControlKey === 'repair' ? (
                    <button type="button" className={BTN} onClick={onArmExtension} aria-label={t('Re-pair browser extension')}>
                      <RefreshCw size={14} />
                      {t('Re-pair')}
                    </button>
                  ) : (
                    // Liquid Glass in the host's action colour (`action` reads
                    // --legacy-action-bg, the token the old button was painted
                    // with), at UI scale. The accessible name keeps the full
                    // phrase because the extension's popup tells people to click
                    // "Connect browser extension".
                    <LiquidGlassButton
                      variant="action"
                      className="lg-sm"
                      onClick={onArmExtension}
                      aria-label={t('Connect browser extension')}
                    >
                      {t('Connect')}
                    </LiquidGlassButton>
                  )}
              </Presence>
            }
          >
            <Collapse open={arming}>
              <div className="pb-3">
                {armDeadline !== null && (
                  <PairingCountdown deadline={armDeadline} total={armTotal} onExpired={onArmExpired} />
                )}
              </div>
            </Collapse>
            {notice(!!armError, dangerTone, <AlertCircle size={14} />, armError, true)}
          </SyncRow>

          <Collapse open={shownRunning}>
            <SyncRow
              icon={<ClipboardPaste size={20} />}
              title={t('Pair manually')}
              description={t('If one-click pairing fails, paste this into the extension manually.')}
              control={revealButton(showManualPair, () => setShowManualPair((v) => !v), t('Show'), t('Hide'), 'min-w-[84px]')}
            >
              <Collapse open={showManualPair}>
                <div className="pb-3">
                  <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-2">
                    <label className="text-xs font-medium text-text-secondary uppercase tracking-wide block">
                      {t('Pairing string')}
                    </label>
                    <div className="flex items-center gap-2">
                      {secretField(pairString)}
                      {copyButton(pairString, pairCopied, copyPairString, t('Copy pairing string'))}
                    </div>
                  </div>
                </div>
              </Collapse>
            </SyncRow>
          </Collapse>
        </section>

        {/* ── Smart Browser Context: the three switches that matter up front,
            the optional detectors behind General's ADVANCED-style disclosure. ── */}
        <section>
          <SectionHeading
            title={t('Smart Browser Context')}
            subtitle={t('Spots coding and interview pages and attaches the problem when you ask.')}
          />

          {PRIMARY_CTX.map(renderCtxRow)}

          <div className="pt-1">
            <button
              type="button"
              aria-expanded={showMoreCtx}
              onClick={() => setShowMoreCtx((s) => !s)}
              className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <DisclosureChevron open={showMoreCtx} />
              {t('More detectors')}
              <Presence kind="badge" id={moreOnCount > 0 ? `on-${moreOnCount}` : null}>
                <span className="ml-1 normal-case tracking-normal font-medium text-text-secondary">
                  · {moreOnCount} {t('on')}
                </span>
              </Presence>
            </button>
            {/* The shared Disclosure, so this opens exactly like General's ADVANCED. */}
            <Disclosure open={showMoreCtx}>
              <div className="mt-1">{MORE_CTX.map(renderCtxRow)}</div>
            </Disclosure>
          </div>

          <p className="flex items-center gap-2 px-1 mt-3 text-xs text-text-secondary">
            <Lock size={14} className="shrink-0" />
            <span>
              {t('Email, chat, banking, and sign-in pages are never captured, even if they look like a coding page.')}
            </span>
          </p>
          {notice(!!ctxError, dangerTone, <AlertCircle size={14} />, ctxError, true, 'above')}
        </section>
      </div>
    </MotionReadyContext.Provider>
  );
};
