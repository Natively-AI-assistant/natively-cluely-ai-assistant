import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { DisclosureChevron } from '../../ui/AccordionSection';
import {
  Collapse,
  Presence,
  SETTINGS_BTN_BASE,
  SETTINGS_BTN_NEUTRAL,
  SETTINGS_CARD,
  SettingsRow,
  useSettingsTones,
} from '../SettingsRow';

// The pieces Setup & Help is written in. Every row is the shared SettingsRow —
// General, Audio, Sync, Intelligence and About are built from the same one —
// so a guide sits at exactly the measurements of the setting it explains:
// [40px tile][14px/700 title][12px description][control]. What a guide adds is
// its body, which opens under the row, indented to the title like any row child.
//
// Body type is the row description's: 12px text-secondary. Never text-tertiary
// for anything a person reads — it measures 3.25:1 on the light canvas.

/**
 * A row whose body opens beneath it. The whole row header toggles, not just the
 * chevron: the chevron button is the keyboard and screen-reader control, and a
 * pointer click anywhere on the header reaches it by bubbling. Clicks inside the
 * open body are ignored, so selecting text or copying a command never folds it.
 */
export const HelpGuideRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}> = ({ icon, title, description, children, defaultOpen = false }) => {
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
          <Collapse open={open}>
            <div className="pb-4 pt-0.5 space-y-3 text-xs text-text-secondary leading-relaxed select-text">{children}</div>
          </Collapse>
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
      await navigator.clipboard.writeText(command);
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

/**
 * A screen recording of the real app, looping without sound. Recordings are
 * bundled assets, so they play offline and under the app's CSP (media falls to
 * default-src 'self'). Under reduced motion nothing plays by itself: the first
 * frame shows with controls, and the viewer starts it if they want it.
 */
// `size` is the recording's pixel size. A <video> has no intrinsic size until
// its metadata loads, so without it the element lays out at the 300x150
// default inside a guide that is mid-open: the Collapse measures that, then the
// body jumps ~170px when the real height arrives.
export const HelpVideo: React.FC<{ src: string; label: string; caption?: string; size: readonly [number, number] }> = ({
  src,
  label,
  caption,
  size,
}) => {
  const reduce = useReducedMotion();
  return (
    <HelpFigure caption={caption}>
      <video
        src={src}
        aria-label={label}
        className="block w-full h-auto bg-bg-main"
        style={{ aspectRatio: `${size[0]} / ${size[1]}` }}
        muted
        loop
        playsInline
        preload="auto"
        autoPlay={!reduce}
        controls={!!reduce}
      />
    </HelpFigure>
  );
};

/** An outbound link, as Settings writes one ("Supported apps here"). */
export const HelpLink: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <button
    type="button"
    onClick={() => window.electronAPI?.openExternal?.(href)}
    className="text-accent-primary hover:underline"
  >
    {children}
  </button>
);
