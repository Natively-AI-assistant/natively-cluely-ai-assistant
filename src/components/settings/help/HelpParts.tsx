import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronRight, Copy, Pause, Play, Search, X } from 'lucide-react';
import { useResolvedTheme } from '../../../hooks/useResolvedTheme';
import { DisclosureChevron } from '../../ui/AccordionSection';
import {
  Collapse,
  Presence,
  SETTINGS_BTN_BASE,
  SETTINGS_BTN_NEUTRAL,
  SETTINGS_CARD,
  SettingsMotionReady,
  SettingsRow,
  useSettingsTones,
} from '../SettingsRow';
import { copyText } from '../../../lib/copyText';

// The pieces Setup & Help is written in. Every row is the shared SettingsRow —
// General, Audio, Sync, Intelligence and About are built from the same one —
// so a guide sits at exactly the measurements of the setting it explains:
// [40px tile][14px/700 title][12px description][control]. What a guide adds is
// its body, which opens under the row, indented to the title like any row child.
//
// Body type is the row description's: 12px text-secondary. Never text-tertiary
// for anything a person reads — it measures 3.25:1 on the light canvas.

/**
 * Whether the guide around a part is open. A recording reads it so it plays
 * only while its guide is open; outside any guide it is always true.
 */
const HelpGuideOpen = React.createContext(true);

/**
 * A row whose body opens beneath it. The whole row header toggles, not just the
 * chevron: the chevron button is the keyboard and screen-reader control, and a
 * pointer click anywhere on the header reaches it by bubbling. Clicks inside the
 * open body are ignored, so selecting text or copying a command never folds it.
 */
export const HelpGuideRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  /** Beside the title — Setup & Help uses it for a recording's running time. */
  badge?: React.ReactNode;
  description: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}> = ({ icon, title, badge, description, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  return (
    <div
      className="group"
      onClick={(e) => {
        if (bodyRef.current?.contains(e.target as Node)) return;
        setOpen((v) => !v);
      }}
    >
      <SettingsRow
        icon={icon}
        title={title}
        badge={badge}
        description={description}
        control={
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={open ? `Hide ${title}` : `Show ${title}`}
            className="w-7 h-7 rounded-full flex items-center justify-center text-text-secondary group-hover:text-text-primary group-hover:bg-bg-item-surface transition-colors"
          >
            <DisclosureChevron open={open} />
          </button>
        }
      >
        <div ref={bodyRef} id={bodyId}>
          <HelpGuideOpen.Provider value={open}>
            <Collapse open={open}>
              <div className="pb-4 pt-0.5 space-y-3 text-xs text-text-secondary leading-relaxed select-text">{children}</div>
            </Collapse>
          </HelpGuideOpen.Provider>
        </div>
      </SettingsRow>
    </div>
  );
};

/** A small sub-heading inside a guide body. */
export const HelpSubhead: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h5 className="text-xs font-semibold text-text-primary pt-1">{children}</h5>
);

/** Numbered steps: a 20px counter in the tile's surface, text beside it. */
export const HelpSteps: React.FC<{ steps: React.ReactNode[] }> = ({ steps }) => (
  <ol className="space-y-2">
    {steps.map((step, i) => (
      <li key={i} className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-px w-5 h-5 shrink-0 rounded-full bg-bg-item-surface border border-border-subtle text-[10.5px] font-semibold tabular-nums text-text-primary flex items-center justify-center"
        >
          {i + 1}
        </span>
        {/* flex-1 so a step holding a block (a command to copy) gets the full width. */}
        <span className="flex-1 min-w-0 pt-0.5">{step}</span>
      </li>
    ))}
  </ol>
);

/**
 * A numbered marker for a figure and its legend. Inverted (text colour on the
 * page colour) so it stands off an illustration drawn in surface tones, and the
 * same marker in both places so a number in the picture finds its line below.
 */
export const HelpCallout: React.FC<{ n: number }> = ({ n }) => (
  <span
    aria-hidden
    className="inline-flex w-4 h-4 shrink-0 rounded-full bg-text-primary text-bg-main text-[9.5px] font-bold tabular-nums leading-none items-center justify-center"
  >
    {n}
  </span>
);

/** The key to a figure's callouts: marker, then what that part is and does. */
export const HelpLegend: React.FC<{ items: Array<{ title: string; body: React.ReactNode }> }> = ({ items }) => (
  <ol className="space-y-2">
    {items.map(({ title, body }, i) => (
      <li key={title} className="flex items-start gap-2.5">
        <span className="mt-0.5"><HelpCallout n={i + 1} /></span>
        <span className="min-w-0">
          <span className="font-semibold text-text-primary">{title}.</span> {body}
        </span>
      </li>
    ))}
  </ol>
);

/** A place in the app — "Settings › Audio" — set as one chip so it scans as a path. */
export const HelpPath: React.FC<{ parts: string[] }> = ({ parts }) => (
  <span className="inline-flex items-center gap-0.5 align-baseline rounded-md border border-border-subtle bg-bg-item-surface px-1.5 py-px text-[11px] font-medium text-text-primary whitespace-nowrap">
    {parts.map((part, i) => (
      <React.Fragment key={i}>
        {i > 0 && <ChevronRight size={10} aria-hidden className="text-text-secondary" />}
        <span>{part}</span>
      </React.Fragment>
    ))}
  </span>
);

// KeyRecorder's own arrow mapping, so a stored "ArrowUp" reads as it does there.
const KEY_GLYPHS: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };

/**
 * Keycaps, drawn exactly as Settings → Keybinds draws a binding. Inline keys sit
 * in running text, so they drop to 20px to stay inside the 12px line.
 */
export const HelpKeys: React.FC<{ keys: string[]; inline?: boolean }> = ({ keys, inline }) => {
  if (keys.length === 0) return <span className="text-xs text-text-secondary">Not set</span>;
  return (
    <span className={`${inline ? 'inline-flex align-middle mx-0.5' : 'flex'} items-center gap-1`}>
      {keys.map((k, i) => (
        <kbd
          key={i}
          className={`bg-bg-input text-text-secondary ${inline ? 'h-5 min-w-[22px] px-1 text-[11px]' : 'h-6 min-w-[26px] px-1.5 text-xs'} rounded-md font-sans flex items-center justify-center shadow-sm border border-border-subtle`}
        >
          {KEY_GLYPHS[k] ?? k}
        </kbd>
      ))}
    </span>
  );
};

/** A two-column list: what you pick → what it needs. */
export const HelpDefinitions: React.FC<{ items: Array<{ term: string; detail: React.ReactNode }> }> = ({ items }) => (
  // divide-border-subtle with NO alpha suffix: the theme colours are bare var()s,
  // so `/20` would emit nothing at all (General's dead divider).
  <dl className={`${SETTINGS_CARD} divide-y divide-border-subtle`}>
    {items.map(({ term, detail }) => (
      <div key={term} className="grid grid-cols-[132px_1fr] gap-3 px-3 py-2">
        <dt className="font-semibold text-text-primary">{term}</dt>
        <dd className="min-w-0">{detail}</dd>
      </div>
    ))}
  </dl>
);

/** A command to paste somewhere else, with a Copy button. */
// Copied is Intelligence's CopyBlock state: the glyph cross-fades and the
// button takes the ok tone. The timer restarts on a second click rather than
// reverting at the first one's deadline, and a refused write (writeText
// REJECTS, it does not throw) says nothing instead of escaping unhandled.
export const HelpCommand: React.FC<{ command: string }> = ({ command }) => {
  const tones = useSettingsTones();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const handleCopy = useCallback(async () => {
    try {
      await copyText(command);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard unavailable: the command is selectable anyway */ }
  }, [command]);
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 min-w-0 rounded-lg border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[11px] text-text-primary whitespace-pre overflow-x-auto">
        {command}
      </code>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className={`${SETTINGS_BTN_BASE} ${copied ? tones.ok : SETTINGS_BTN_NEUTRAL}`}
        aria-label={copied ? 'Copied' : 'Copy command'}
      >
        <Presence kind="icon" id={copied ? 'check' : 'copy'}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </Presence>
      </button>
    </div>
  );
};

/** A picture inside a guide: the card Audio opens under its rows. */
export const HelpFigure: React.FC<{ caption?: string; children: React.ReactNode }> = ({ caption, children }) => (
  <figure className="space-y-2">
    <div className={`${SETTINGS_CARD} overflow-hidden`}>{children}</div>
    {caption && <figcaption className="text-[11px] text-text-secondary">{caption}</figcaption>}
  </figure>
);

/** One theme's file of a recording, as the clip manifest (helpClips.ts) describes it. */
export interface HelpClipVariant {
  src: string;
  /** Pixel size, read by ffprobe when the clip was encoded. */
  size: readonly [number, number];
  /** Seconds, also from ffprobe. */
  duration: number;
  /** Step times come from the take's log, so each theme's file carries its own. */
  chapters: HelpClipChapter[];
}

/** A recording: its dark file, and a light one when it is of Settings UI. */
export interface HelpClipSource {
  dark: HelpClipVariant;
  light?: HelpClipVariant;
}

/** One step of a clip: where it starts, in seconds, and what happens in it. */
export interface HelpClipChapter {
  at: number;
  label: React.ReactNode;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * The OS reduced-motion setting, right from the first render. framer-motion's
 * useReducedMotion answers false until an effect has run, which was long
 * enough for a recording to start playing and then stop (0.3 s, measured).
 */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(REDUCED_MOTION_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!query) return;
    const onChange = () => setReduce(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduce;
}

/**
 * A screen recording of the real app, with its steps underneath. The steps are
 * the guide's text: each is a short label with its own progress track, the one
 * playing is lit, and pressing one jumps the clip there.
 *
 * A clip plays only while it can be seen — its guide open, the clip on screen
 * and the window visible — so a long page of recordings costs nothing until
 * one is looked at. Under reduced motion nothing plays by itself: the first
 * frame shows, the steps still jump to theirs, and Play is one press away.
 *
 * Recordings are bundled assets, so they play offline and under the app's CSP
 * (media falls to default-src 'self').
 */
// `size` is set as the aspect ratio: a <video> has no intrinsic size until its
// metadata loads, so without it the element lays out at the 300x150 default
// inside a guide that is mid-open, and the body jumps when the real height
// arrives. `duration` sizes the last step's track before metadata too.
export const HelpClip: React.FC<{
  clip: HelpClipSource;
  /** What the recording shows, for screen readers. */
  label: string;
  caption?: string;
}> = ({ clip, label, caption }) => {
  const reduce = usePrefersReducedMotion();
  const isLight = useResolvedTheme() === 'light';
  const guideOpen = React.useContext(HelpGuideOpen);
  const variant = isLight && clip.light ? clip.light : clip.dark;
  const { src, chapters } = variant;

  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fillRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  // null = follow the default (play unless reduced motion); otherwise the viewer's choice.
  const [choice, setChoice] = useState<'play' | 'pause' | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(0);

  const wantsPlay = choice ? choice === 'play' : !reduce;
  const shouldPlay = guideOpen && inView && pageVisible && wantsPlay;

  // A guide's step boundaries: [start, end) per chapter, the last ending at the clip's end.
  const bounds = chapters.map((c, i) => [c.at, i + 1 < chapters.length ? chapters[i + 1].at : variant.duration] as const);

  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onVisibility = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (shouldPlay) {
      // play() rejects when a pause interrupts it (the guide closed mid-load);
      // that is expected, not an error.
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [shouldPlay, src]);

  // Paints the step tracks from the clip's current time. Written straight to
  // the DOM: a React state per frame would re-render the guide 60 times a second.
  const paint = useCallback(() => {
    const video = videoRef.current;
    if (!video || bounds.length === 0) return;
    const t = video.currentTime;
    let current = 0;
    bounds.forEach(([start, end], i) => {
      if (t >= start) current = i;
      const fill = fillRefs.current[i];
      if (fill) fill.style.transform = `scaleX(${clamp01((t - start) / Math.max(0.001, end - start))})`;
    });
    setActive((prev) => (prev === current ? prev : current));
    // bounds is rebuilt each render from chapters + duration; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(bounds)]);

  useEffect(() => {
    if (!playing) {
      paint();
      return;
    }
    let frame = requestAnimationFrame(function tick() {
      paint();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, paint]);

  const seek = (i: number) => {
    const video = videoRef.current;
    if (!video) return;
    // A hair past the boundary, so the frame shown belongs to this step and
    // not the last frame of the one before.
    video.currentTime = Math.min(bounds[i][0] + 0.05, variant.duration);
    setActive(i);
    paint();
  };

  const toggle = () => setChoice(shouldPlay || (wantsPlay && !pageVisible) ? 'pause' : 'play');

  return (
    <figure className="space-y-2.5">
      <div
        ref={frameRef}
        className={`${SETTINGS_CARD} group/clip relative overflow-hidden`}
        style={{ aspectRatio: `${variant.size[0]} / ${variant.size[1]}` }}
      >
        <video
          ref={videoRef}
          key={src}
          src={src}
          aria-label={label}
          className="block w-full h-full object-cover bg-bg-main"
          // Fades in on its first frame rather than flashing the empty frame black.
          style={{ opacity: ready ? 1 : 0, transition: reduce ? 'none' : 'opacity 250ms ease-out' }}
          muted
          loop
          playsInline
          preload={guideOpen ? 'auto' : 'metadata'}
          onLoadedData={() => setReady(true)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onSeeked={paint}
          onClick={toggle}
        />
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause recording' : 'Play recording'}
          className={`absolute right-2.5 bottom-2.5 w-8 h-8 rounded-full flex items-center justify-center text-white bg-black/55 backdrop-blur-md ring-1 ring-white/15 shadow-sm transition-opacity duration-200 focus-visible:opacity-100 focus-visible:outline-none ${
            playing ? 'opacity-0 group-hover/clip:opacity-100' : 'opacity-100'
          }`}
        >
          <Presence kind="icon" id={playing ? 'pause' : 'play'}>
            {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="translate-x-px" />}
          </Presence>
        </button>
      </div>
      {chapters.length > 0 && (
        <ol
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${chapters.length}, minmax(0, 1fr))` }}
          aria-label="Steps in this recording"
        >
          {chapters.map((chapter, i) => {
            const isActive = i === active;
            return (
              <li key={i} className="min-w-0">
                <button
                  type="button"
                  onClick={() => seek(i)}
                  aria-current={isActive ? 'step' : undefined}
                  title={typeof chapter.label === 'string' ? chapter.label : undefined}
                  // Not ring-accent-primary/60: a bare var() colour takes no alpha
                  // suffix (tailwind.config.js), so that emitted nothing and the ring
                  // fell back to Tailwind's default blue.
                  className="group/step w-full text-left rounded-md focus-visible:outline-none"
                >
                  {/* The track is drawn in the text colour at low strength: --border-subtle
                      is transparent in dark, and a bare var() takes no alpha suffix. */}
                  <span
                    aria-hidden
                    className="block h-[3px] rounded-full overflow-hidden"
                    style={{ background: 'color-mix(in srgb, var(--text-primary) 14%, transparent)' }}
                  >
                    <span
                      ref={(el) => { fillRefs.current[i] = el; }}
                      className="block h-full w-full rounded-full bg-text-primary origin-left"
                      style={{ transform: 'scaleX(0)' }}
                    />
                  </span>
                  {/* One line, always: a step that wraps under its neighbours reads as
                      two steps. Labels are written to fit (gen-manifest checks
                      their length); the ellipsis only guards a translation. */}
                  <span className="mt-2 flex items-baseline gap-1.5 text-[11.5px] leading-snug whitespace-nowrap">
                    <span className={`shrink-0 tabular-nums font-semibold transition-colors duration-200 ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}>{i + 1}</span>
                    <span
                      className={`min-w-0 overflow-hidden text-ellipsis transition-colors duration-200 ${
                        isActive ? 'text-text-primary font-medium' : 'text-text-secondary group-hover/step:text-text-primary'
                      }`}
                    >
                      {chapter.label}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {caption && <figcaption className="text-[11px] text-text-secondary">{caption}</figcaption>}
    </figure>
  );
};

/** An outbound link, as Settings writes one ("Supported apps here"). */
export const HelpLink: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <button
    type="button"
    onClick={() => window.electronAPI?.openExternal?.(href)}
    // The underline fades in with the hover, as General's "Supported apps here" does.
    className="text-accent-primary underline decoration-transparent hover:decoration-current transition-colors duration-150 ease-out"
  >
    {children}
  </button>
);


// ── Setup meter ──────────────────────────────────────────────────────────
// Get started's summary: the steps a meeting cannot run without, as the same
// 3px tracks a recording's steps use, so the pane has one picture for
// "how far along". A done step fills in the text colour; colour is kept for
// state the app reports, never decoration. The fill slides only once the pane
// is ready (SettingsMotionReady): a step done long ago is drawn done, not
// animated to done every time the pane opens.

export interface HelpMeterStep {
  label: string;
  /** null while the step is still being read. */
  done: boolean | null;
}

export const HelpSetupMeter: React.FC<{
  steps: HelpMeterStep[];
  /** Headline once every step is done, and while some are left. */
  readyText: string;
  leftText: (left: number) => string;
  checkingText: string;
}> = ({ steps, readyText, leftText, checkingText }) => {
  const ready = React.useContext(SettingsMotionReady);
  const reduce = usePrefersReducedMotion();
  const tones = useSettingsTones();
  const checking = steps.some((s) => s.done === null);
  const doneCount = steps.filter((s) => s.done).length;
  const left = steps.length - doneCount;
  const headline = checking ? checkingText : left === 0 ? readyText : leftText(left);
  return (
    <div className={`${SETTINGS_CARD} px-4 py-3.5 mb-1`} role="group" aria-label={headline}>
      <div className="flex items-baseline justify-between gap-3">
        <Presence kind="text" id={checking ? 'checking' : `left-${left}`}>
          <span className={`text-[13px] font-semibold ${!checking && left === 0 ? tones.text.ok : 'text-text-primary'}`}>
            {headline}
          </span>
        </Presence>
        <span className="text-[11.5px] tabular-nums text-text-secondary shrink-0">
          {checking ? '' : `${doneCount} of ${steps.length}`}
        </span>
      </div>
      <ol className="mt-3 grid gap-3" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, i) => (
          <li key={step.label} className="min-w-0">
            <span
              aria-hidden
              className="block h-[3px] rounded-full overflow-hidden"
              style={{ background: 'color-mix(in srgb, var(--text-primary) 14%, transparent)' }}
            >
              <span
                className="block h-full w-full rounded-full bg-text-primary origin-left"
                style={{
                  transform: `scaleX(${step.done ? 1 : 0})`,
                  transition: ready && !reduce ? `transform 520ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 60}ms` : 'none',
                }}
              />
            </span>
            <span className="mt-2 flex items-center gap-1.5 text-[11.5px] leading-snug whitespace-nowrap">
              <span className={`shrink-0 tabular-nums font-semibold ${step.done ? 'text-text-primary' : 'text-text-secondary'}`}>{i + 1}</span>
              <span className={`min-w-0 overflow-hidden text-ellipsis ${step.done ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                {step.label}
              </span>
              <span className="sr-only">{step.done === null ? '' : step.done ? ', done' : ', to do'}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};

// ── Guide search ─────────────────────────────────────────────────────────
// Twenty-odd guides are past what a person scans; the field narrows them by
// title, description and the words people actually type ("pdf", "slack",
// "mute"). Escape clears it; the count says what is left.

/** Every word of the query appears somewhere in the haystack (case-insensitive). */
export function matchesHelpQuery(query: string, haystack: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = haystack.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export const HelpGuideSearch: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Shown at the right while a query is typed, e.g. "3 guides". */
  resultLabel?: string;
  clearLabel: string;
}> = ({ value, onChange, placeholder, resultLabel, clearLabel }) => (
  <div className="relative mt-3 mb-2">
    <Search size={14} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && value) {
          e.stopPropagation();
          onChange('');
        }
      }}
      placeholder={placeholder}
      aria-label={placeholder}
      spellCheck={false}
      className="w-full h-9 rounded-lg border border-border-subtle bg-bg-input pl-9 pr-24 text-xs text-text-primary placeholder:text-text-secondary transition-colors focus:outline-none focus:border-accent-primary [&::-webkit-search-cancel-button]:hidden"
    />
    <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
      {value && resultLabel && <span className="text-[11px] tabular-nums text-text-secondary" aria-live="polite">{resultLabel}</span>}
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={clearLabel}
          className="w-6 h-6 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-item-surface transition-colors"
        >
          <X size={12} />
        </button>
      )}
    </span>
  </div>
);

/** A guide group's label: Settings' group label, with how many guides it holds. */
export const HelpGroupLabel: React.FC<{ title: string; count: number }> = ({ title, count }) => (
  <div className="flex items-baseline gap-2 px-[17px] pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
    <span>{title}</span>
    <span className="font-medium tabular-nums normal-case tracking-normal opacity-80">{count}</span>
  </div>
);
