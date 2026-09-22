// DEV-ONLY visual repro for the overlay's "waiting for answer" indicator.
// Originally built for the "no thinking-dot under liquid-glass/modern" bug;
// the dot became a shimmering "Thinking..." label on 2026-09-21 and this
// harness moved with it (filename kept — revealHarness.html cites it as
// precedent). Not part of the shipped app (see harness.html precedent:
// streamingCodeHarness.tsx). Renders the REAL class strings used by the
// thinking-label render sites in NativelyInterface.tsx (the embedded label in
// renderMessageText's streaming branches, and the standalone pre-placeholder
// row) under all 6 (theme x light/dark) combinations, each wrapped in the real
// `[data-theme]` / `[data-interface-theme]` ancestor attributes the real CSS
// selectors key off of — so the REAL index.css cascade decides what's visible,
// not a guess. Contrast is the whole point: 13px glyphs are a far harder test
// of a theme than the solid 8px dot they replaced.
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

function VariantRow({ label, className }: { label: string; className: string }) {
  // Real wrapper classes from NativelyInterface.tsx's standalone pre-placeholder
  // row, so both candidates are measured in the real box, at the real size.
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.45, fontFamily: 'monospace' }}>
        {label}
      </div>
      <div className="flex justify-start my-2.5 min-h-[24px] items-center">
        <span className={`${className} text-[13px]`}>Thinking...</span>
      </div>
    </div>
  );
}

function EmbeddedLabel() {
  // Exact classes from NativelyInterface.tsx renderMessageText, the
  // `key="streaming"` branch with `!msg.text`. The card chrome the earlier
  // version of this harness carried (w-fit / rounded bubble / per-theme
  // bg+border) is gone from the real site — `.ai-response-card` is
  // neutralized in index.css — so reproducing it here would have tested a
  // bubble the user never sees.
  return (
    <div className="w-full ai-response-card my-2.5 min-h-[24px] transition-opacity duration-200 markdown-content whitespace-pre-wrap text-[14px] leading-relaxed natively-streaming-answer">
      <div className="flex items-center min-h-[24px] py-0.5">
        <span className="natively-thinking-label text-[13px]">Thinking...</span>
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
          <div data-testid={`standalone-${theme}-${mode}`}>
            <VariantRow label="standalone pre-placeholder row" className="natively-thinking-label" />
          </div>
          <div data-testid={`embedded-${theme}-${mode}`} style={{ marginTop: 10, borderTop: '1px solid rgba(128,128,128,0.25)', paddingTop: 6 }}>
            <div style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.45, fontFamily: 'monospace' }}>
              in the streaming bubble
            </div>
            <EmbeddedLabel />
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
      <h2>&quot;Thinking...&quot; — real classes, real index.css, real [data-theme]/[data-interface-theme] nesting</h2>
      <p style={{ opacity: 0.7, fontSize: 13, maxWidth: 760 }}>
        Each box sets <code>data-interface-theme</code> on its own wrapper div;
        <code>document.documentElement[data-theme]</code> is toggled by the button
        (the real app sets it on &lt;html&gt;, which is the ancestor-selector shape
        the real CSS depends on). Two rows per box: the standalone
        pre-placeholder row and the label inside the streaming bubble.
        <br />
        <br />
        The point of the light/dark toggle is liquid-glass and modern: both paint
        a DARK panel in <i>both</i> colour themes, which is the case that has
        broken this element twice. The label reads
        <code>--overlay-text-muted</code> / <code>--overlay-text-strong</code> so
        it follows the panel rather than the colour theme;
        <code>tests/css/thinking-label.check.mjs</code> pins that.
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
