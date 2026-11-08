/**
 * The hidden offscreen page behind the toolbar icon (toolbar-icon.ts): tells
 * the service worker whether Chrome is light or dark, now and on every change.
 */
const dark = window.matchMedia('(prefers-color-scheme: dark)');

function report(): void {
  chrome.runtime.sendMessage({ type: 'toolbar-theme', dark: dark.matches }).catch(() => {});
}

dark.addEventListener('change', report);
report();
