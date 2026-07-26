// DEV-ONLY visual repro for the "no thinking-dot under liquid-glass/modern"
// bug report. Not part of the shipped app (see harness.html precedent:
// streamingCodeHarness.tsx). Renders the REAL class strings used by both
// thinking-dot render sites in NativelyInterface.tsx (the embedded dot in
// renderMessageText's streaming branch, ~L5636-5651, and the standalone
// pre-placeholder pill, ~L7404-7427) under all 6 (theme x light/dark)
// combinations, each wrapped in the real `[data-theme]` / `[data-interface-theme]`
// ancestor attributes the real CSS selectors key off of — so the REAL
// index.css cascade decides what's visible, not a guess.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import GlassEffectLayer from '../components/ui/GlassEffectLayer';
import { getOverlayAppearance, getGlassOverlayAppearance } from '../lib/overlayAppearance';

const THEMES: Array<{ value: 'default' | 'liquid-glass' | 'modern'; label: string }> = [
  { value: 'default', label: 'default' },
  { value: 'liquid-glass', label: 'liquid-glass' },
  { value: 'modern', label: 'modern' },
];

function EmbeddedDot({ isLightTheme }: { isLightTheme: boolean }) {
  // Exact classes from NativelyInterface.tsx L5605-5651 (the `key="streaming"`
  // branch, isThinking = true).
  const cardBgBorderClass = isLightTheme
    ? 'bg-slate-100/70 backdrop-blur-md border border-slate-200/50 text-slate-900 shadow-sm'
    : 'bg-zinc-800/60 backdrop-blur-md border border-zinc-700/40 text-zinc-100 shadow-md';
  return (
    <div
      className={`w-fit px-[16.5px] py-[12.5px] rounded-[20px] rounded-tl-[4px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 markdown-content whitespace-pre-wrap text-[14.5px] leading-relaxed`}
    >
      <div className="flex gap-1.5 items-center py-0.5">
        <div
          className={`natively-thinking-dot w-2 h-2 ${isLightTheme ? 'bg-slate-400' : 'bg-white'} rounded-full`}
          style={{ animationDelay: '0ms' }}
        />
        <div
          className={`natively-thinking-dot w-2 h-2 ${isLightTheme ? 'bg-slate-400' : 'bg-white'} rounded-full`}
          style={{ animationDelay: '160ms' }}
        />
        <div
          className={`natively-thinking-dot w-2 h-2 ${isLightTheme ? 'bg-slate-400' : 'bg-white'} rounded-full`}
          style={{ animationDelay: '320ms' }}
        />
      </div>
    </div>
  );
}

function StandalonePill({ subtleStyle }: { subtleStyle: React.CSSProperties }) {
  // Exact classes from NativelyInterface.tsx L7404-7427, now with the REAL
  // appearance.subtleStyle inline style (advisor-flagged: the earlier repro
  // omitted this).
  return (
    <div className="flex justify-start">
      <div className="px-3 py-2 flex gap-1.5 overlay-subtle-surface rounded-full border" style={subtleStyle}>
        <div className="natively-thinking-dot w-2 h-2 bg-slate-400 rounded-full" style={{ animationDelay: '0ms' }} />
        <div className="natively-thinking-dot w-2 h-2 bg-slate-400 rounded-full" style={{ animationDelay: '160ms' }} />
        <div className="natively-thinking-dot w-2 h-2 bg-slate-400 rounded-full" style={{ animationDelay: '320ms' }} />
      </div>
    </div>
  );
}

function ThemeBlock({ theme, mode }: { theme: 'default' | 'liquid-glass' | 'modern'; mode: 'light' | 'dark' }) {
  const isLightTheme = mode === 'light';
  const isGlassTheme = theme === 'liquid-glass';
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  // Mirrors NativelyInterface.tsx L1462-1467 exactly: glass gets the empty
  // getGlassOverlayAppearance() object, everyone else (default AND modern —
  // isModernTheme is NOT in this branch) gets getOverlayAppearance().
  const appearance = isGlassTheme
    ? getGlassOverlayAppearance()
    : getOverlayAppearance(0.65, isLightTheme ? 'light' : 'dark');

  return (
    <div
      data-interface-theme={theme}
      data-mode={mode}
      style={{
        padding: 40,
        margin: 8,
        // A busy, high-contrast backdrop BEHIND the panel — stands in for
        // real desktop content the OS-level vibrancy/acrylic blur would show
        // through in production (GlassEffectLayer.tsx's own comment: blur of
        // background content is now done by the native BrowserWindow, not
        // CSS/JS). A flat backdrop can't surface an over-blur/wash-out effect;
        // this checkerboard-ish gradient can.
        background:
          mode === 'light'
            ? 'repeating-linear-gradient(45deg, #ffffff 0 20px, #cbd5e1 20px 40px)'
            : 'repeating-linear-gradient(45deg, #000000 0 20px, #1e293b 20px 40px)',
        borderRadius: 12,
        display: 'inline-block',
        verticalAlign: 'top',
        width: 340,
      }}
    >
      <div style={{ fontSize: 11, opacity: 0.9, marginBottom: 8, fontFamily: 'monospace', color: mode === 'light' ? '#000' : '#fff', background: mode === 'light' ? '#fff8' : '#0008', display: 'inline-block', padding: '2px 4px' }}>
        theme={theme} / data-theme={mode}
      </div>
      {/* Real shellRef structure: NativelyInterface.tsx L6984-7010 */}
      <div
        ref={shellRef}
        data-shell-card=""
        className="relative max-w-full backdrop-blur-2xl border rounded-[24px] overflow-hidden flex flex-col draggable-area overlay-shell-surface"
        style={{ ...appearance.shellStyle, contain: 'layout style', width: 300 }}
      >
        {isGlassTheme && <GlassEffectLayer parentRef={shellRef} cornerRadius={24} />}
        {/* Real scroll container: NativelyInterface.tsx L7326-7331 */}
        <div className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3 no-drag isolate">
          <div data-testid={`embedded-${theme}-${mode}`}>
            <EmbeddedDot isLightTheme={isLightTheme} />
          </div>
          <div data-testid={`standalone-${theme}-${mode}`} style={{ marginTop: 8 }}>
            <StandalonePill subtleStyle={appearance.subtleStyle} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Harness() {
  const [rootMode, setRootMode] = React.useState<'light' | 'dark'>('dark');

  // The real app sets data-theme on <html> (document.documentElement) in
  // main.tsx — NOT per-subtree. Selectors like
  // `[data-theme='light'] [data-interface-theme="modern"] .ai-response-card`
  // therefore require data-theme to be an ANCESTOR of data-interface-theme,
  // not a sibling attribute on the same node. Mirror that exactly here.
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', rootMode);
  }, [rootMode]);

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', background: '#0b0e14', minHeight: '100vh', color: '#e6edf3' }}>
      <h2>Thinking-dot repro — real classes, real index.css, real [data-theme]/[data-interface-theme] nesting</h2>
      <p style={{ opacity: 0.7, fontSize: 13, maxWidth: 700 }}>
        Each box below sets <code>data-interface-theme</code> on its own wrapper
        div. <code>document.documentElement[data-theme]</code> is toggled by the
        button (real app sets this on &lt;html&gt;, matching the actual
        ancestor-selector shape). Two rows per box: the embedded in-bubble dot
        (renderMessageText streaming branch) and the standalone pre-placeholder
        pill.
      </p>
      <button type="button" onClick={() => setRootMode((m) => (m === 'light' ? 'dark' : 'light'))} style={{ marginBottom: 16 }}>
        Toggle html[data-theme] (currently: {rootMode})
      </button>
      <div>
        {THEMES.map((t) => (
          <ThemeBlock key={t.value} theme={t.value} mode={rootMode} />
        ))}
      </div>
    </div>
  );
}

const container = document.getElementById('harness-root');
if (container) {
  createRoot(container).render(<Harness />);
}
