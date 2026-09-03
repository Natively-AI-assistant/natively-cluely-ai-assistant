import React from "react"
import ReactDOM from "react-dom/client"
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

try {
  const rootEl = document.getElementById("root");
  if (!rootEl) {
    // eslint-disable-next-line no-console
    console.error('[renderer] FATAL: #root element not found — cannot mount React');
  } else {
    // ── Route split ───────────────────────────────────────────────────────
    // Every window loads this same entry with a different `?window=`. Mounting
    // `App` in all of them meant the 36px resize toggle evaluated
    // react-markdown, react-syntax-highlighter and KaTeX to render 30 DOM nodes
    // (measured 2026-09-03: overlay-toggle 52MB heap / 219 JS files, against
    // the launcher's 66MB / 218 for 784 nodes). The light routes get their own
    // root, imported dynamically so `App` is never even fetched for them.
    //
    // `App` is dynamic on the other branch for the same reason — a static
    // import here would bundle it into the entry chunk and undo the split.
    const root = ReactDOM.createRoot(rootEl);
    const windowParam = new URLSearchParams(window.location.search).get('window') ?? '';
    const LIGHT_ROUTES = ['overlay-pill', 'overlay-toggle', 'cropper'];

    const mount = LIGHT_ROUTES.includes(windowParam)
      ? import('./AuxRoot').then(({ default: AuxRoot }) => (
          // No LanguageProvider: nothing on these routes uses i18n, and adding
          // a provider that does would pull it straight back in.
          <React.StrictMode>
            <AuxRoot route={windowParam as import('./AuxRoot').AuxRoute} />
          </React.StrictMode>
        ))
      : Promise.all([import('./App'), import('./i18n')]).then(
          ([{ default: App }, { LanguageProvider }]) => (
            <React.StrictMode>
              <LanguageProvider>
                <App />
              </LanguageProvider>
            </React.StrictMode>
          ),
        );

    mount
      .then((tree) => {
        root.render(tree);
        // eslint-disable-next-line no-console
        console.log(`[renderer] React root render() dispatched (route=${windowParam || 'launcher(default)'})`);
      })
      .catch((err: any) => {
        // A failed route import is the same class of failure as a mount throw:
        // black screen with no trace unless it is logged here.
        // eslint-disable-next-line no-console
        console.error('[renderer] FATAL: route import failed', err?.stack ?? err?.message ?? String(err));
      });
  }
} catch (err: any) {
  // A throw here means the whole app failed to mount → black/logo screen.
  // Log it so the failure has a trace in natively_debug.log instead of nothing.
  // eslint-disable-next-line no-console
  console.error('[renderer] FATAL: React mount threw', err?.stack ?? err?.message ?? String(err));
}
}
