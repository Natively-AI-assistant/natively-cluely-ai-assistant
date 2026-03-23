import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"

// Initialize Platform
if (window.electronAPI?.platform) {
  document.documentElement.setAttribute('data-platform', window.electronAPI.platform);
}

const THEME_CACHE_KEY = 'natively_resolved_theme';

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

  window.electronAPI?.onThemeChanged?.(({ resolved }) => {
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem(THEME_CACHE_KEY, resolved);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
