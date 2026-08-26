import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { LanguageProvider } from "./i18n"
import "./index.css"

// ── Renderer crash/hang diagnostics ─────────────────────────────────────────
// Surface uncaught errors and unhandled promise rejections through console.error
// so the main process's `console-message` listener (WindowHelper.attachRenderer-
// Diagnostics) forwards them to ~/Documents/natively_debug.log. Without this, an
// early renderer throw (before React mounts) leaves the user on a black/logo
// screen with NO trace anywhere. Registered FIRST so it also covers the theme/
// platform setup below.
window.addEventListener('error', (event) => {
  const e = event.error;
  const where = `${event.filename ?? '?'}:${event.lineno ?? 0}:${event.colno ?? 0}`;
  // eslint-disable-next-line no-console
  console.error(`[renderer] window.onerror ${event.message} @ ${where}`, e?.stack ?? '');
});
window.addEventListener('unhandledrejection', (event) => {
  const r = event.reason;
  // eslint-disable-next-line no-console
  console.error('[renderer] unhandledrejection', r?.stack ?? r?.message ?? String(r));
});
// Positive "the bundle reached main.tsx" marker — distinguishes "JS never ran"
// (missing asset / CSP block) from "JS ran but hung later".
// eslint-disable-next-line no-console
console.log('[renderer] main.tsx evaluating');

const THEME_CACHE_KEY = 'natively_resolved_theme';
const launcherIsolation = new URLSearchParams(window.location.search).get('isolate');

if (launcherIsolation === 'shell') {
  // eslint-disable-next-line no-console
  console.warn('[LeakTest] launcher shell isolation active — React root intentionally skipped');
} else {

// Set platform attribute synchronously — before React renders — so CSS selectors
// like html[data-platform="win32"] work immediately without a flash on first paint.
document.documentElement.setAttribute(
  'data-platform',
  window.electronAPI?.platform ?? (typeof process !== 'undefined' ? process.platform : '') ?? ''
);

// Step 1: Apply cached theme synchronously — before React renders.
// This ensures useResolvedTheme()'s initial useState read sees the correct value.
const cachedTheme = localStorage.getItem(THEME_CACHE_KEY) as 'light' | 'dark' | null;
document.documentElement.setAttribute('data-theme', cachedTheme ?? 'dark');

// Step 2: Confirm/correct from main process (authoritative) and keep cache in sync.
if (window.electronAPI?.getThemeMode) {
  window.electronAPI.getThemeMode().then(({ resolved }) => {
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem(THEME_CACHE_KEY, resolved);
  }).catch(() => {});

  window.electronAPI?.onThemeChanged?.(({ resolved }) => {
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem(THEME_CACHE_KEY, resolved);
  });
}

// Step 3: Track maximized state on the root element so the frameless-window
// corner radius (src/index.css, `html[data-platform="win32"] body`) can drop to
// 0 while maximized. A maximized window is flush with the work area on all four
// sides, so a radius there does not read as a rounded window — it punches four
// transparent notches through to the desktop at the screen corners. macOS is
// unaffected: its launcher is a native window and the OS handles this itself.
//
// This reuses the maximize signal WindowControls already consumes; no new IPC.
// The launcher has no fullscreen path (nothing in WindowHelper calls
// setFullScreen), so maximize is the only flush-to-edge state to handle.
//
// Scoped to the launcher on purpose. main.tsx runs in EVERY renderer, but both
// halves of that signal are launcher-only: `window-is-maximized` resolves to
// isMainWindowMaximized() and `window-maximized-changed` is emitted from the
// launcher's own maximize/unmaximize handlers. Without this guard, maximizing
// the launcher would stamp the attribute onto the settings/overlay/cropper
// renderers too — invisible today since their bodies are transparent, but a
// wrong-window coupling waiting to matter.
const isLauncherRenderer = (() => {
  const w = new URLSearchParams(window.location.search).get('window');
  return w === 'launcher' || w === null;
})();

// Published to CSS as well. The launcher is the ONLY window whose body is an
// opaque, full-bleed surface — every other renderer (settings, model selector,
// cropper, overlay, aux panels) is a transparent window painting its own
// rounded panel inside a see-through body. Chrome styling keyed to the window
// edge must therefore say "launcher", not "win32": a `border-radius` on a
// transparent body is inert, but anything that PAINTS (the hairline ring below)
// would draw a ghost outline around those windows' full rects.
if (isLauncherRenderer) {
  document.documentElement.setAttribute('data-window', 'launcher');
}

if (isLauncherRenderer && window.electronAPI?.platform !== 'darwin') {
  const setMaximized = (maximized: boolean) => {
    document.documentElement.setAttribute('data-window-maximized', maximized ? 'true' : 'false');
  };
  // Seed from the authoritative main-process value — covers the app being
  // reopened while already maximized, same as WindowControls' initial query.
  setMaximized(false);
  window.electronAPI?.windowIsMaximized?.().then(setMaximized).catch(() => {});
  window.electronAPI?.onWindowMaximizedChanged?.(setMaximized);
}

try {
  const rootEl = document.getElementById("root");
  if (!rootEl) {
    // eslint-disable-next-line no-console
    console.error('[renderer] FATAL: #root element not found — cannot mount React');
  } else {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <LanguageProvider>
          <App />
        </LanguageProvider>
      </React.StrictMode>
    );
    // eslint-disable-next-line no-console
    console.log('[renderer] React root render() dispatched');
  }
} catch (err: any) {
  // A throw here means the whole app failed to mount → black/logo screen.
  // Log it so the failure has a trace in natively_debug.log instead of nothing.
  // eslint-disable-next-line no-console
  console.error('[renderer] FATAL: React mount threw', err?.stack ?? err?.message ?? String(err));
}
}
