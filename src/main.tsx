import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"

const THEME_CACHE_KEY = 'natively_resolved_theme';

// Set platform attribute synchronously — before React renders — so CSS selectors
// like html[data-platform="win32"] work immediately without a flash on first paint.
document.documentElement.setAttribute(
  'data-platform',
  window.electronAPI?.platform ?? process?.platform ?? ''
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
  });

  const cleanup = window.electronAPI.onThemeChanged(({ resolved }) => {
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem(THEME_CACHE_KEY, resolved);
  });

  if (import.meta.hot) {
    import.meta.hot.dispose(() => cleanup());
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
