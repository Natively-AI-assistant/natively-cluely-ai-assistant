// DEV-ONLY visual check for the overlay's dynamic action cards
// (DynamicActionBar). Not part of the shipped app (see thinkingDotHarness.tsx
// for the precedent). Renders the REAL DynamicActionCard inside the REAL
// overlay shell structure, beside its real neighbours (rolling transcript,
// quick actions), under the interface themes x the ?mode= colour theme plus a
// low-opacity case, each nested under the real [data-theme] /
// [data-interface-theme] ancestors so the real index.css cascade decides the
// colours. 2026-09-27: the cue-row direction ("A") was picked here over a
// suggestion-chip direction and the old bolt card.
//
// ?motion=1 instead mounts the REAL DynamicActionBar in one shell, over a
// stubbed electronAPI, and exposes window.__cards (push / retract) and
// window.__heightCalls (every requestHeightMotion the bar made), so a script
// can drive enter, hover, Tab, dismiss and expiry and record the frames.
//
// Production has NO backdrop blur of the desktop: the overlay window is
// transparent, and CSS backdrop-filter only sees pixels inside the page. So the
// harness puts real text BEHIND the shell and turns backdrop-filter off, or
// every variant would look legible over a blur users never get.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { MessageSquare, Pencil } from 'lucide-react';
import '../index.css';
import GlassEffectLayer from '../components/ui/GlassEffectLayer';
import { getOverlayAppearance, getGlassOverlayAppearance } from '../lib/overlayAppearance';
import { DynamicActionCard as RealCard } from '../components/dynamic-actions/DynamicActionCard';
import { DynamicActionBar } from '../components/dynamic-actions/DynamicActionBar';
import type { DynamicActionPayload } from '@/types/electron';

type Theme = 'default' | 'liquid-glass' | 'modern';
type Mode = 'light' | 'dark';

const mk = (id: string, type: string, label: string, quote: string, priority: number): DynamicActionPayload => ({
  id, sessionId: 's', modeId: 'm', modeTemplateType: 'sales', type, label, confidence: 0.9, priority,
  evidenceRefs: [{ source: 'transcript', text: quote }], status: 'shown', createdAt: Date.now(), promptInstruction: '',
});
const ACTIONS: DynamicActionPayload[] = [
  mk('a1', 'pricing_objection', 'Handle pricing objection', 'Honestly that seems expensive compared to what we pay now.', 3),
  mk('a2', 'roi_question', 'Build ROI case', 'What kind of return have other teams our size seen?', 2),
];

// ── the real shell, with the bar's real neighbours ───────────────────────────
function QuickActions({ chipStyle }: { chipStyle: React.CSSProperties }) {
  const cls = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 overlay-chip-surface overlay-text-interactive';
  return (
    <div className="flex flex-wrap justify-center items-center gap-1.5 px-4 pb-3 pt-1 max-w-full">
      <button className={cls} style={chipStyle}><Pencil className="w-3 h-3 opacity-70" /> What to answer?</button>
      <button className={cls} style={chipStyle}><MessageSquare className="w-3 h-3 opacity-70" /> Clarify</button>
    </div>
  );
}

function Transcript() {
  return (
    <div className="w-[90%] mx-auto pt-1 overflow-hidden whitespace-nowrap text-right">
      <span className="text-[13px] italic leading-7 text-[var(--overlay-text-muted)]">
        …we&apos;re a team of about forty agents. Honestly that seems expensive compared to what we pay now.
      </span>
    </div>
  );
}

const BACKDROP_TEXT = `export const salesCall = [
  { who: 'interviewer', id: 'S01', expect: 'silent', parts: ["Okay, thanks for jumping on."] },
  { who: 'interviewer', id: 'S02', expect: 'silent', parts: ["So a bit of background on us."] },
  { who: 'user', text: 'Happy to walk you through it.' },
  { who: 'interviewer', id: 'S05', expect: 'answer', q: 'what does pricing look like' },
  // Get Started with Pro   ·   SETTINGS   ·   Upcoming: Payout sync 10:00
  const turns = r.turns.filter((t) => t.who === 'interviewer');
  for (const g of gens.values()) { const candidates = turns.filter(…) }
  answer turns: 6/6 fired; silent turns: 5/5 quiet; content checks 6/6`;

function Block({ theme, mode, opacity, variant }: { theme: Theme; mode: Mode; opacity: number; variant: 'a' }) {
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const isGlass = theme === 'liquid-glass';
  const appearance = isGlass ? getGlassOverlayAppearance() : getOverlayAppearance(opacity, mode);
  const [primary, second] = ACTIONS;
  return (
    <div
      data-interface-theme={theme}
      data-block={`${variant}-${theme}-${mode}-${Math.round(opacity * 100)}`}
      className="harness-block"
      style={{ position: 'relative', width: 680, padding: '34px 40px', margin: 10, borderRadius: 12, overflow: 'hidden', display: 'inline-block', verticalAlign: 'top',
        background: mode === 'light' ? '#f5f5f7' : '#1e1f22' }}
    >
      <pre style={{ position: 'absolute', inset: 0, margin: 0, padding: '18px 22px', fontSize: 13, lineHeight: '19px', whiteSpace: 'pre-wrap',
        fontFamily: 'SF Mono, Menlo, monospace', color: mode === 'light' ? '#1d1d1f' : '#d4d4d4', pointerEvents: 'none' }}>
        {BACKDROP_TEXT}{'\n'}{BACKDROP_TEXT}
      </pre>
      <div style={{ position: 'relative', fontSize: 10, fontFamily: 'monospace', marginBottom: 8, color: mode === 'light' ? '#000' : '#fff', background: mode === 'light' ? '#fffc' : '#000c', display: 'inline-block', padding: '2px 5px', borderRadius: 4 }}>
        {variant.toUpperCase()} · {theme} / {mode} · opacity {opacity}
      </div>
      <div
        ref={shellRef}
        data-shell-card=""
        className="relative max-w-full border rounded-[24px] overflow-hidden flex flex-col overlay-shell-surface overlay-shell-container overlay-text-primary"
        style={{ ...appearance.shellStyle, width: 600 }}
      >
        {isGlass && <GlassEffectLayer parentRef={shellRef} cornerRadius={24} />}
        <div className="relative z-10 pt-3">
          {(
            <div className="flex flex-col gap-1.5 px-3 pt-1 pb-1 w-full">
              <AnimatePresence initial={false}>
                <RealCard key={primary.id} action={primary} isPrimary onAccept={() => {}} onDismiss={() => {}} surfaceStyle={appearance.chipStyle} />
                <RealCard key={second.id} action={second} isPrimary={false} onAccept={() => {}} onDismiss={() => {}} surfaceStyle={appearance.chipStyle} />
              </AnimatePresence>
            </div>
          )}
          <Transcript />
          <QuickActions chipStyle={appearance.chipStyle} />
        </div>
      </div>
    </div>
  );
}

function Harness() {
  const params = new URLSearchParams(location.search);
  const mode = (params.get('mode') as Mode) ?? 'dark';
  React.useEffect(() => { document.documentElement.setAttribute('data-theme', mode); }, [mode]);
  const combos: Array<{ theme: Theme; opacity: number }> = [
    { theme: 'default', opacity: 0.65 }, { theme: 'default', opacity: 0.25 },
    { theme: 'liquid-glass', opacity: 0.65 }, { theme: 'modern', opacity: 0.65 },
  ];
  return (
    <MotionConfig reducedMotion="always">
      <style>{`.harness-block *, .harness-block *::before, .harness-block *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`}</style>
      <div style={{ padding: 12, background: mode === 'light' ? '#dcdce0' : '#0b0e14' }}>
        {(['a'] as const).map((v) => (
          <div key={v} style={{ whiteSpace: 'nowrap' }}>
            {combos.map((c) => <Block key={`${v}-${c.theme}-${c.opacity}`} theme={c.theme} mode={mode} opacity={c.opacity} variant={v} />)}
          </div>
        ))}
      </div>
    </MotionConfig>
  );
}

// ── ?motion=1: the real bar, driven by a script ─────────────────────────────
type Listener = ((data: any) => void) | null;
const motionMode = new URLSearchParams(location.search).get('motion') === '1';
if (motionMode) {
  const listeners: { action: Listener; retract: Listener } = { action: null, retract: null };
  (window as any).electronAPI = {
    onIntelligenceDynamicAction: (cb: Listener) => { listeners.action = cb; return () => { listeners.action = null; }; },
    onIntelligenceDynamicActionRetract: (cb: Listener) => { listeners.retract = cb; return () => { listeners.retract = null; }; },
    acceptDynamicAction: async () => {},
    dismissDynamicAction: async () => {},
  };
  (window as any).__heightCalls = [];
  (window as any).__accepted = [];
  (window as any).__cards = {
    push: (id: string, type: string, label: string, quote: string, priority: number) =>
      listeners.action?.({ action: { ...mk(id, type, label, quote, priority), createdAt: Date.now() } }),
    retract: (id: string) => listeners.retract?.({ id }),
  };
}

function MotionScene() {
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const params = new URLSearchParams(location.search);
  const theme = (params.get('theme') as Theme) ?? 'default';
  const mode = (params.get('mode') as Mode) ?? 'dark';
  const grant = params.get('grant') !== '0';
  React.useEffect(() => { document.documentElement.setAttribute('data-theme', mode); }, [mode]);
  const isGlass = theme === 'liquid-glass';
  const appearance = isGlass ? getGlassOverlayAppearance() : getOverlayAppearance(0.65, mode);
  return (
    <div data-interface-theme={theme} className="harness-block" style={{ padding: '28px 40px', width: 680, minHeight: 240, boxSizing: 'border-box', background: mode === 'light' ? '#f5f5f7' : '#1e1f22', position: 'relative', overflow: 'hidden' }}>
      <style>{`.harness-block *, .harness-block *::before, .harness-block *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }`}</style>
      <pre style={{ position: 'absolute', inset: 0, margin: 0, padding: '14px 22px', fontSize: 13, lineHeight: '19px', whiteSpace: 'pre-wrap', fontFamily: 'SF Mono, Menlo, monospace', color: mode === 'light' ? '#1d1d1f' : '#d4d4d4', opacity: 0.55, pointerEvents: 'none' }}>
        {BACKDROP_TEXT}
      </pre>
      <div ref={shellRef} data-shell-card="" className="relative max-w-full border rounded-[24px] overflow-hidden flex flex-col overlay-shell-surface overlay-shell-container overlay-text-primary" style={{ ...appearance.shellStyle, width: 600 }}>
        {isGlass && <GlassEffectLayer parentRef={shellRef} cornerRadius={24} />}
        <div className="relative z-10 pt-3">
          <DynamicActionBar
            onAcceptAction={(a) => { (window as any).__accepted.push({ id: a.id, t: performance.now() }); }}
            surfaceStyle={appearance.chipStyle}
            requestHeightMotion={(growPx, durationMs) => { (window as any).__heightCalls.push({ growPx, durationMs, t: performance.now() }); return grant; }}
          />
          <Transcript />
          <QuickActions chipStyle={appearance.chipStyle} />
        </div>
      </div>
    </div>
  );
}

const container = document.getElementById('harness-root');
if (container) createRoot(container).render(motionMode ? <MotionScene /> : <Harness />);
