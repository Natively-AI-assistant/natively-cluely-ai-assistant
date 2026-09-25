import React from 'react';
import { ArrowRight, AudioLines, ChevronDown, ChevronUp, Mic, MonitorUp, PointerOff, SlidersHorizontal, FlaskConical, Volume2 } from 'lucide-react';
import nativelyIcon from '../../icon.png';
import { useResolvedTheme } from '../../../hooks/useResolvedTheme';
import type { HelpPlatform } from '../../../lib/helpContent.mjs';
import { HelpCallout } from './HelpParts';

// Illustrations for Setup & Help. Drawn from the app's own tokens rather than
// screenshots, so they follow the theme, stay sharp at any scale and cannot
// drift into showing a colour the app no longer uses. Colour appears only where
// the real thing carries state — a switch that is on — as everywhere else in
// Settings. Nothing here animates on a loop: a diagram that never stops moving
// competes with the text it illustrates.

export const NativelyGlyph: React.FC<{ size?: number }> = ({ size = 14 }) => {
  const isLight = useResolvedTheme() === 'light';
  return (
    <img
      src={nativelyIcon}
      alt=""
      aria-hidden
      style={{ width: size, height: size, filter: isLight ? 'brightness(0)' : 'brightness(0) invert(1)', opacity: 0.9 }}
      className="object-contain"
    />
  );
};

/** A switch drawn at mock scale, on. */
const MockSwitch: React.FC = () => (
  <span aria-hidden className="relative inline-flex h-4 w-7 shrink-0 rounded-full bg-accent-primary">
    <span className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm" />
  </span>
);

// `perApp`: macOS lists each app with its own switch; Windows' microphone page
// has plain switches with no app in them, so it draws none.
const MockPermissionRow: React.FC<{ icon: React.ReactNode; label: string; detail: string; perApp?: boolean }> = ({ icon, label, detail, perApp = true }) => (
  <div className="px-3 py-2.5">
    <div className="flex items-center gap-2 text-[11px] font-semibold text-text-primary">
      <span className="text-text-secondary">{icon}</span>
      {label}
    </div>
    <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-item-surface px-2.5 py-1.5">
      <span className="flex items-center gap-2 text-[11px] text-text-primary">
        {perApp && (
          <span className="flex h-5 w-5 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-elevated">
            <NativelyGlyph size={11} />
          </span>
        )}
        {detail}
      </span>
      <MockSwitch />
    </div>
  </div>
);

/**
 * The OS privacy page with Natively allowed, per platform. macOS: the two panes
 * the app checks at launch (main.ts — Microphone and Screen Recording, named
 * "Screen & System Audio Recording" from macOS 15). Windows: the microphone page,
 * where desktop apps are allowed as a group rather than one by one.
 */
export const PermissionsFigure: React.FC<{ platform: HelpPlatform }> = ({ platform }) => {
  const mac = platform === 'darwin';
  return (
    <div className="p-4 flex justify-center bg-bg-main">
      <div className="w-full max-w-[340px] overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated shadow-sm">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          {mac ? (
            <span aria-hidden className="flex gap-1">
              {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 rounded-full bg-border-muted" />)}
            </span>
          ) : null}
          <span className="text-[11px] font-semibold text-text-primary">
            {mac ? 'Privacy & Security' : 'Privacy & security › Microphone'}
          </span>
        </div>
        <div className="divide-y divide-border-subtle">
          {mac ? (
            <>
              <MockPermissionRow icon={<MonitorUp size={12} />} label="Screen & System Audio Recording" detail="Natively" />
              <MockPermissionRow icon={<Mic size={12} />} label="Microphone" detail="Natively" />
            </>
          ) : (
            <>
              <MockPermissionRow icon={<Mic size={12} />} label="Microphone access" detail="On" perApp={false} />
              <MockPermissionRow icon={<Mic size={12} />} label="Let desktop apps access your microphone" detail="On" perApp={false} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ── How an answer is made ────────────────────────────────────────────────
// The one thing the setup steps never said out loud: Natively needs TWO
// providers, because hearing and answering are separate jobs. Each stage is the
// Settings row tile at the same 40px, so the diagram reads as part of the pane.
// The AI stage wears the flask the Settings sidebar gives AI Providers, not the
// stock sparkles, so the picture points at the tab where the model is chosen.

const FlowStage: React.FC<{ icon: React.ReactNode; title: string; detail: string }> = ({ icon, title, detail }) => (
  <div className="flex flex-col items-center text-center min-w-0">
    <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle text-text-primary flex items-center justify-center shrink-0">
      {icon}
    </div>
    <div className="mt-2 text-xs font-semibold text-text-primary leading-tight">{title}</div>
    <div className="mt-0.5 text-[11px] text-text-secondary leading-snug">{detail}</div>
  </div>
);

const FlowArrow: React.FC = () => (
  <div aria-hidden className="flex h-10 items-center text-text-secondary">
    <span className="h-px w-3 bg-border-muted" />
    <ArrowRight size={12} className="-ml-0.5" />
  </div>
);

export const AnswerFlowFigure: React.FC = () => (
  <div
    role="img"
    aria-label="Meeting audio goes to your speech provider, which turns it into text. Your AI model reads that text and your screen, and the answer appears in the overlay."
    className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-start gap-x-1.5 px-3 py-4 bg-bg-main"
  >
    <FlowStage
      icon={<span className="flex items-center gap-0.5"><Mic size={14} /><Volume2 size={14} /></span>}
      title="Meeting audio"
      detail="You and the other side"
    />
    <FlowArrow />
    <FlowStage icon={<AudioLines size={20} />} title="Speech provider" detail="Turns it into text" />
    <FlowArrow />
    <FlowStage icon={<FlaskConical size={20} />} title="AI model" detail="Reads text and screen" />
    <FlowArrow />
    <FlowStage icon={<NativelyGlyph size={18} />} title="Answer" detail="In the overlay" />
  </div>
);

// ── The overlay, labelled ────────────────────────────────────────────────
// A schematic of NativelyInterface, not a replica: the parts a person touches,
// in their real order and with their real labels, and numbered callouts that
// the guide's legend repeats. Kept schematic on purpose — a pixel copy of the
// overlay goes stale with every restyle, a diagram of its parts does not.

const QUICK_ACTIONS = ['What to answer?', 'Clarify', 'Recap', 'Follow Up Question', 'Answer'];

const Chip: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-item-surface px-2 py-0.5 text-[9.5px] font-medium text-text-primary whitespace-nowrap ${className}`}>
    {children}
  </span>
);

/** A callout pinned beside the part it names. */
const Pin: React.FC<{ n: number; className: string }> = ({ n, className }) => (
  <span className={`absolute ${className}`}>
    <HelpCallout n={n} />
  </span>
);

export const OverlayAnatomyFigure: React.FC = () => (
  <div role="img" aria-label="The Natively overlay: a pill above a panel with the live transcript, quick actions, the ask box and a bottom row of controls." className="bg-bg-main px-8 py-5">
    <div aria-hidden className="relative mx-auto max-w-[400px] select-none">
      {/* 1 — the pill */}
      <div className="relative mx-auto mb-2 flex w-fit items-center gap-1.5 rounded-full border border-border-subtle bg-bg-item-surface p-1">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border-muted bg-bg-item-active">
          <NativelyGlyph size={13} />
        </span>
        <span className="flex items-center gap-1 rounded-full border border-border-muted bg-bg-item-surface px-2.5 py-0.5 text-[10px] font-medium text-text-primary">
          <ChevronUp size={10} /> Hide
        </span>
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border-muted bg-bg-item-active">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-text-primary opacity-80" />
        </span>
        <Pin n={1} className="-right-7 top-1/2 -translate-y-1/2" />
      </div>

      <div className="relative rounded-2xl border border-border-subtle bg-bg-elevated px-3 pb-2.5 pt-2 shadow-sm">
        {/* 2 — rolling transcript */}
        <div className="relative">
          <div className="truncate text-right text-[10px] italic text-text-secondary" style={{ maskImage: 'linear-gradient(to right, transparent, black 25%)' }}>
            …and we'd want the cache in front of the payments service
          </div>
          <Pin n={2} className="-left-10 top-1/2 -translate-y-1/2" />
        </div>

        {/* an answer, as the overlay draws one */}
        <div className="my-2.5 ml-auto w-[78%] rounded-[14px] rounded-tr-[4px] border border-border-subtle bg-bg-item-surface px-2.5 py-1.5 text-[10px] leading-snug text-text-primary">
          Put Redis in front of it and expire keys on write, so a retry never reads a stale total.
        </div>

        {/* 3 — quick actions */}
        <div className="relative flex flex-wrap justify-center gap-1">
          {QUICK_ACTIONS.map((label) => <Chip key={label}>{label}</Chip>)}
          <Pin n={3} className="-left-10 top-1/2 -translate-y-1/2" />
        </div>

        {/* 4 — the ask box */}
        <div className="relative mt-2">
          <div className="rounded-lg border border-border-subtle bg-bg-input px-2.5 py-1.5 text-[10px] text-text-secondary">
            Ask anything on screen or conversation…
          </div>
          <Pin n={4} className="-left-10 top-1/2 -translate-y-1/2" />
        </div>

        {/* 5–7 — the bottom row: each control carries its own callout */}
        <div className="mt-2 flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-md border border-border-subtle bg-bg-item-surface px-2 py-0.5 text-[9.5px] font-medium text-text-primary">
            Model <ChevronDown size={10} />
          </span>
          <HelpCallout n={5} />
          <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-md border border-border-subtle bg-bg-item-surface text-text-primary">
            <SlidersHorizontal size={10} />
          </span>
          <HelpCallout n={6} />
          <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-md border border-border-subtle bg-bg-item-surface text-text-primary">
            <PointerOff size={10} />
          </span>
          <HelpCallout n={7} />
        </div>
      </div>
    </div>
  </div>
);
