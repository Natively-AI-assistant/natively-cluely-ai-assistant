// src/components/ProviderChangeNotice.tsx
//
// The notice in the launcher's bottom-right corner when meetings were indexed
// under a previous AI provider, and the re-index it offers. One card: Re-index
// turns the warning into the progress in place, so the card slides in once, not
// out and back in again. A notice, not a modal (no dim).
//
// It arrives and leaves like a macOS notification banner: sliding in from past
// the window's right edge and back out to it (#22 toast + an edge slide, in
// ProviderChangeNotice.css). Not the genie the other popups use — for a
// corner banner that read wrong. While it slides out it keeps showing what it
// showed when it was last open.
//
// Degraded semantic search (a fallback embedding provider, or a space that
// could not be saved) is a row of its own above the rest: the fallback kicks
// in while meetings are being embedded, which is when a re-index runs.
//
// The surface is the Liquid Glass kit's clear pane, .lg-notice
// (ui-components/LiquidGlassButton.css): a light backdrop blur with the
// saturation on the backdrop, and the kit's directional specular rim. Each row
// carries the "Refreshed" toast's glowing icon orb (Launcher.tsx,
// refresh-toast). Body copy is text-secondary rather than the toast's
// tertiary: it wraps to two or three lines here, and tertiary is too faint on
// dark glass for that.
//
// Motion inside an open card is transitions.dev's (ProviderChangeNotice.css):
// rows join and leave through an accordion, holding their last content while
// they close; titles and bodies swap in place; the main icon swaps alert ->
// refresh -> a check that draws itself; the re-index count pops in. The
// orb's tint and the progress bar tween on their own. Text swaps are keyed on
// the row's STATE, never on the live count, which would re-swap every tick.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, Check, RefreshCw } from 'lucide-react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import '../ui-components/LiquidGlassButton.css';
import './ProviderChangeNotice.css';

export interface ProviderChangeWarning { count: number; oldProvider: string; newProvider: string }
export interface ReindexProgress { done: number; total: number }
export interface EmbeddingDegradedNotice { kind: 'fallback' | 'persist-failed'; fallbackProvider?: string }

interface ProviderChangeNoticeProps {
  open: boolean;
  /** The warning; shown until Re-index or Dismiss. */
  warning: ProviderChangeWarning | null;
  /** The re-index under way. Takes the card's place once set. */
  progress: ReindexProgress | null;
  /** Semantic search degraded; shown for a few seconds beside the rest. */
  degraded?: EmbeddingDegradedNotice | null;
  onDismiss: () => void;
  onReindex: () => void;
}

type Tone = 'blue' | 'amber' | 'red' | 'green';
// The orb's tint is a background COLOUR (not a gradient class) so it can tween
// when the main row changes tone. Icon colours are full class strings, so
// Tailwind sees every one of them.
const ORB: Record<Tone, { fill: string; glow: string; dark: string; light: string }> = {
  blue: { fill: 'rgba(59, 130, 246, 0.2)', glow: 'rgba(59, 130, 246, 0.2)', dark: 'text-blue-300 drop-shadow-[0_0_5px_rgba(59,130,246,0.6)]', light: 'text-blue-500' },
  amber: { fill: 'rgba(245, 158, 11, 0.2)', glow: 'rgba(245, 158, 11, 0.2)', dark: 'text-amber-300 drop-shadow-[0_0_5px_rgba(245,158,11,0.6)]', light: 'text-amber-500' },
  red: { fill: 'rgba(239, 68, 68, 0.2)', glow: 'rgba(239, 68, 68, 0.2)', dark: 'text-red-300 drop-shadow-[0_0_5px_rgba(239,68,68,0.6)]', light: 'text-red-500' },
  green: { fill: 'rgba(16, 185, 129, 0.2)', glow: 'rgba(16, 185, 129, 0.2)', dark: 'text-emerald-300 drop-shadow-[0_0_5px_rgba(16,185,129,0.6)]', light: 'text-emerald-600' },
};
const TINT_TWEEN: React.CSSProperties = { transition: 'background-color var(--icon-swap-dur) var(--icon-swap-ease)' };

/** A CSS time custom property, in ms. The UNIT has to be read, not assumed:
 *  the production CSS minifier rewrites `150ms` as `.15s`, and a bare
 *  parseFloat then turns a 350ms slide-out into a 0.35ms one. */
const cssMs = (el: Element | null, name: string, fallback: number) => {
  const raw = el ? getComputedStyle(el).getPropertyValue(name).trim() : '';
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return raw.endsWith('ms') ? n : raw.endsWith('s') ? n * 1000 : fallback;
};
const readMs = (name: string, fallback: number) =>
  cssMs(document.querySelector('.lg-notice') ?? document.documentElement, name, fallback);

/** #21 accordion: a row that grows in and shrinks out. The grid item stays a
 *  bare div (its padding could not collapse), so the row's spacing is on a
 *  child. A closed row is inert and hidden from assistive tech. */
const Collapse: React.FC<{ open: boolean; children: React.ReactNode }> = ({ open, children }) => (
  <div className="t-acc" data-open={String(open)} aria-hidden={!open} {...(open ? null : { inert: true })}>
    <div className="t-acc-panel">
      <div className="t-acc-panel-inner">
        <div className="pb-3">{children}</div>
      </div>
    </div>
  </div>
);

/** #04 text swap, keyed: when `swapKey` changes the old text leaves up and the
 *  new one rises in. While the key holds, children update live (a count). */
const SwapText: React.FC<{ swapKey: string; children: React.ReactNode }> = ({ swapKey, children }) => {
  const [shownKey, setShownKey] = useState(swapKey);
  const [phase, setPhase] = useState<'idle' | 'exit' | 'enter'>('idle');
  const held = useRef<React.ReactNode>(children);
  if (shownKey === swapKey) held.current = children;
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (swapKey === shownKey) return;
    // Reduced motion: the snippet's guard drops the transitions, so the exit
    // would only be an empty gap. Swap at once instead.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShownKey(swapKey); return; }
    setPhase('exit');
    const t = setTimeout(() => { setShownKey(swapKey); setPhase('enter'); }, readMs('--text-swap-dur', 150));
    return () => clearTimeout(t);
  }, [swapKey, shownKey]);
  useLayoutEffect(() => {
    if (phase !== 'enter') return;
    void ref.current?.offsetHeight; // reflow: start from below, then transition back
    setPhase('idle');
  }, [phase]);
  const cls = phase === 'exit' ? ' is-exit' : phase === 'enter' ? ' is-enter-start' : '';
  return <span ref={ref} className={`t-text-swap${cls}`}>{shownKey === swapKey ? children : held.current}</span>;
};

/** #02 number pop-in. Keyed on the value, so each new count mounts fresh and
 *  its digits pop in; the last two ride in behind the rest. The LEADING digit
 *  never waits: the stagger is for trailing digits, and on a one-digit count
 *  (the usual case here) it left a gap before the "/10" for 140ms. */
const Digits: React.FC<{ value: number }> = ({ value }) => {
  const chars = String(value).split('');
  return (
    <span key={value} className="t-digit-group is-animating">
      {chars.map((ch, i) => (
        <span key={i} className="t-digit" data-stagger={i === 0 ? undefined : i === chars.length - 2 ? '1' : i === chars.length - 1 ? '2' : undefined}>{ch}</span>
      ))}
    </span>
  );
};

const Orb: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <div
    className="relative flex items-center justify-center w-9 h-9 shrink-0 rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] border border-white/5 motion-reduce:!transition-none"
    style={{ backgroundColor: ORB[tone].fill, backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.06))', ...TINT_TWEEN }}
  >
    <div className="absolute inset-0 rounded-full blur-md motion-reduce:!transition-none" style={{ backgroundColor: ORB[tone].glow, ...TINT_TWEEN }} />
    <span className="relative flex">{children}</span>
  </div>
);

const NoticeRow: React.FC<{ orb: React.ReactNode; title: React.ReactNode; children: React.ReactNode }> = ({ orb, title, children }) => (
  <div className="relative flex items-start gap-3">
    {orb}
    <div className="flex-1 min-w-0 pt-0.5">
      <h3 className="text-[14px] font-semibold text-text-primary leading-tight tracking-tight">{title}</h3>
      {children}
    </div>
  </div>
);

const BODY = 'text-[11px] text-text-secondary font-medium tracking-wide leading-snug mt-1';
const BUTTON = 'px-3 py-1.5 rounded-lg text-xs transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100';

type Main =
  | { kind: 'warning'; warning: ProviderChangeWarning }
  | { kind: 'running' | 'done'; progress: ReindexProgress };

export const ProviderChangeNotice: React.FC<ProviderChangeNoticeProps> = (props) => {
  const { open } = props;
  // The host clears everything as it closes the card; the slide out keeps the
  // last open content instead of emptying as it goes.
  const lastOpen = useRef(props);
  if (open) lastOpen.current = props;
  const { warning, progress, degraded = null, onDismiss, onReindex } = open ? props : lastOpen.current;

  // Mounted while open or sliding out; `entered` is the slide's end state. A
  // fresh mount paints in the closed pose (off the edge) first, then slides.
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  const slideRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    setEntered(false);
    const closeMs = cssMs(slideRef.current, '--toast-close', 350);
    const t = setTimeout(() => setMounted(false), closeMs + 40);
    return () => clearTimeout(t);
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !mounted || entered) return;
    void slideRef.current?.offsetWidth; // reflow: start from the closed pose
    setEntered(true);
  }, [open, mounted, entered]);

  const isLight = useResolvedTheme() === 'light';
  const isAlert = !!warning && !progress;
  const iconClass = (tone: Tone) => (isLight ? ORB[tone].light : ORB[tone].dark);

  // Rows hold their last content while their accordion closes. Each time a row
  // opens AGAIN it takes a new key, so it mounts on its new state rather than
  // swapping in from the text it held while closed (a Dismissed warning must
  // not flash back as a re-index row grows in).
  const episodes = useRef({ degraded: 0, main: 0, wasDegraded: false, wasMain: false });
  const lastDegraded = useRef<EmbeddingDegradedNotice | null>(null);
  if (degraded) lastDegraded.current = degraded;
  const shownDegraded = degraded ?? lastDegraded.current;
  if (degraded && !episodes.current.wasDegraded) episodes.current.degraded += 1;
  episodes.current.wasDegraded = !!degraded;

  const lastMain = useRef<Main | null>(null);
  const liveMain: Main | null = progress
    ? { kind: progress.done >= progress.total && progress.total > 0 ? 'done' : 'running', progress }
    : warning ? { kind: 'warning', warning } : null;
  if (liveMain) lastMain.current = liveMain;
  const main = liveMain ?? lastMain.current;
  if (liveMain && !episodes.current.wasMain) episodes.current.main += 1;
  episodes.current.wasMain = !!liveMain;

  const mainTone: Tone = main?.kind === 'warning' ? 'red' : main?.kind === 'done' ? 'green' : 'blue';
  const mainIconState = main?.kind === 'warning' ? 'c' : main?.kind === 'done' ? 'b' : 'a';

  if (!mounted) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 24, pointerEvents: 'none' }}
    >
      {/* The slide rides on this wrapper; the fade and blur on the pane itself,
          so its frosted backdrop is never cut off mid-slide (see the CSS). */}
      <div ref={slideRef} className={`lg-notice-slide max-w-[340px]${entered ? ' is-open' : ''}`} style={{ pointerEvents: entered ? 'auto' : 'none' }}>
        <div
          role="status"
          aria-live="polite"
          {...(entered ? null : { inert: true })}
          // No flex gap: a collapsed row would still own one. Each row carries its
          // spacing inside its accordion, so the bottom padding is short by that.
          className={`t-toast${entered ? ' is-open' : ''} lg-notice${isAlert ? ' lg-notice-alert' : ''} rounded-[18px] overflow-hidden pl-4 pr-5 pt-3.5 pb-0.5 flex flex-col`}
        >
          <Collapse open={!!degraded}>
            {shownDegraded && (
              <NoticeRow
                key={episodes.current.degraded}
                orb={<Orb tone="amber"><AlertCircle size={15} className={iconClass('amber')} /></Orb>}
                title={<SwapText swapKey={shownDegraded.kind}>{shownDegraded.kind === 'fallback' ? 'Semantic search degraded' : 'Search may need a re-index'}</SwapText>}
              >
                <p className={BODY}>
                  <SwapText swapKey={shownDegraded.kind}>
                    {shownDegraded.kind === 'fallback'
                      ? `Switched to fallback embeddings (${shownDegraded.fallbackProvider ?? 'local'}).`
                      : 'The embedding space could not be saved.'}
                  </SwapText>
                </p>
              </NoticeRow>
            )}
          </Collapse>

          <Collapse open={!!liveMain}>
            {main && (
              <NoticeRow
                key={episodes.current.main}
                orb={
                  <Orb tone={mainTone}>
                    {/* Each slot is a flex box, not a bare span: an inline svg sits on the
                        text baseline of its line box, which lifted every icon here 1.5-4.5px
                        above the orb's centre. */}
                    <span className="t-icon-swap" data-state={mainIconState}>
                      <span className="t-icon flex" data-icon="a">
                        <RefreshCw size={15} className={`${iconClass('blue')} ${main.kind === 'running' ? 'animate-[spin_2s_linear_infinite] motion-reduce:animate-none' : ''}`} />
                      </span>
                      <span className="t-icon flex" data-icon="b">
                        <span className="t-success-check" data-state={main.kind === 'done' ? 'in' : 'out'}>
                          <Check size={15} strokeWidth={2.5} className={iconClass('green')} />
                        </span>
                      </span>
                      <span className="t-icon flex" data-icon="c">
                        <AlertCircle size={15} className={iconClass('red')} />
                      </span>
                    </span>
                  </Orb>
                }
                title={
                  <SwapText swapKey={main.kind}>
                    {main.kind === 'warning' ? 'Provider Changed' : main.kind === 'done' ? 'Search index updated' : 'Updating search index'}
                  </SwapText>
                }
              >
                <p className={BODY}>
                  <SwapText swapKey={main.kind}>
                    {main.kind === 'warning' ? (
                      <>⚠ {main.warning.count} meetings used your previous AI provider ({main.warning.oldProvider}) and won't appear in search results under {main.warning.newProvider}.</>
                    ) : main.kind === 'done' ? (
                      'Your past conversations are searchable again.'
                    ) : (
                      <>Re-indexing your past conversations for the upgraded AI model… <Digits value={main.progress.done} />/{main.progress.total}</>
                    )}
                  </SwapText>
                </p>
                {main.kind !== 'warning' && main.progress.total > 0 && (
                  <div className={`mt-2 h-1 w-full rounded-full overflow-hidden ${isLight ? 'bg-black/10' : 'bg-white/10'}`}>
                    <div
                      className={`h-full transition-[width,background-color] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${main.kind === 'done' ? 'bg-emerald-400' : 'bg-blue-400'}`}
                      style={{ width: `${Math.min(100, Math.round((main.progress.done / main.progress.total) * 100))}%` }}
                    />
                  </div>
                )}
              </NoticeRow>
            )}
          </Collapse>

          <Collapse open={isAlert}>
            <div className="relative flex gap-2 justify-end">
              <button
                onClick={onDismiss}
                className={`${BUTTON} font-medium text-text-secondary hover:text-text-primary ${isLight ? 'hover:bg-black/5' : 'hover:bg-white/5'}`}
              >
                Dismiss
              </button>
              <button
                onClick={onReindex}
                className={`${BUTTON} font-semibold bg-[#ff3333]/10 text-[#ff3333] hover:bg-[#ff3333]/20`}
              >
                Re-index automatically
              </button>
            </div>
          </Collapse>
        </div>
      </div>
    </div>
  );
};

export default ProviderChangeNotice;
