// Shared bootstrapping for checks that mount the REAL overlay
// (src/components/NativelyInterface.tsx via index.html?window=overlay) in
// headless Chromium with `window.electronAPI` stubbed: a Vite dev server on a
// free loopback port, a Playwright Chromium, and a page whose main-process
// events the check can emit. Used by overlay-stream.check.mjs (canned streams)
// and live-replay.check.mjs (streams recorded from a real model).
//
// Platform note: Node + Playwright APIs only; nothing here is OS-specific.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

// Runs in the page before any app code. Every on* subscription is recorded so
// the test can emit to it; the unsubscribe really removes the callback (React
// StrictMode mounts effects twice — a no-op unsubscribe would deliver every
// token twice).
export function installStub(options) {
  window.__cbs = {};
  window.__calls = [];
  window.__diagramsEnabled = options.diagramsEnabled;
  const fixed = {
    getThemeMode: () => Promise.resolve({ mode: 'dark', resolved: 'dark' }),
    getDiagramsEnabled: () => Promise.resolve(window.__diagramsEnabled !== false),
    getIntelligenceFlags: () => Promise.resolve([]),
    // Callers iterate these without a guard; the catch-all below answers undefined.
    getKeybinds: () => Promise.resolve([]),
    getKeybindRegistrationFailures: () => Promise.resolve([]),
    // Optional: which model the overlay's own model picker should name.
    ...(options.model
      ? {
          getCurrentLlmConfig: () => Promise.resolve({ modelId: options.model, displayName: options.model }),
          getDefaultModel: () => Promise.resolve({ model: options.model }),
        }
      : {}),
    platform: 'darwin',
    // A test sets window.__repairWith to the source a "model" answers with.
    repairDiagram: (payload) => {
      window.__calls.push('repairDiagram');
      window.__repairRequests = [...(window.__repairRequests || []), payload];
      const fixed = window.__repairWith;
      if (!fixed) return Promise.resolve(undefined);
      return new Promise((resolve) => setTimeout(() => resolve({ ok: true, source: fixed }), window.__repairDelayMs || 40));
    },
  };
  window.electronAPI = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop in fixed) return fixed[prop];
        if (/^on[A-Z]/.test(prop)) {
          return (cb) => {
            if (typeof cb !== 'function') return () => {};
            (window.__cbs[prop] ||= []).push(cb);
            return () => {
              const list = window.__cbs[prop] || [];
              const i = list.indexOf(cb);
              if (i >= 0) list.splice(i, 1);
            };
          };
        }
        return (...args) => {
          window.__calls.push(prop);
          return Promise.resolve(undefined);
        };
      },
      has() {
        return true;
      },
    },
  );
  window.__emit = (name, ...args) => {
    for (const cb of [...(window.__cbs[name] || [])]) cb(...args);
    return (window.__cbs[name] || []).length;
  };
  try {
    localStorage.setItem('natively_resolved_theme', 'dark');
  } catch {
    /* storage unavailable */
  }
}

/** What the answer area looks like right now. */
export function snapshot() {
  const cards = [...document.querySelectorAll('figure.diagram-card')];
  const answerCards = [...document.querySelectorAll('.ai-response-card')];
  const text = answerCards.map((n) => n.innerText).join('\n');
  const img = cards[0] && cards[0].querySelector('img.diagram-card__img');
  return {
    answerRows: answerCards.length,
    text,
    diagramCards: cards.length,
    diagramState: cards[0] ? cards[0].getAttribute('data-diagram-state') : null,
    imgLoaded: Boolean(img && img.complete && img.naturalWidth > 0),
    spinnerInCard: cards[0] ? cards[0].querySelectorAll('.natively-thinking-label').length : 0,
    codeCards: document.querySelectorAll('.ai-response-card .overlay-code-block-surface:not(.diagram-card)').length,
    rawFence: /```/.test(text),
    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cardWidth: cards[0] ? cards[0].getBoundingClientRect().width : 0,
    viewportWidth: window.innerWidth,
  };
}

/**
 * Start the dev server and a browser. Returns `openOverlay()` for a fresh
 * overlay page and `close()` to tear everything down. Exits the process with
 * code 2 when the machine has no Chromium for Playwright.
 */
export async function startOverlayHarness({ root = process.cwd() } = {}) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'natively-overlay-check-'));
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.mts'),
    cacheDir,
    logLevel: 'error',
    clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, open: false },
  });
  await server.listen();
  const address = server.httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;
  // The full Chromium build first (new headless), then the headless shell, then
  // the system Chrome — whichever this machine has. Nothing is downloaded.
  let browser = null;
  let launchError = null;
  for (const options of [{ channel: 'chromium' }, {}, { channel: 'chrome' }]) {
    try {
      browser = await chromium.launch({ headless: true, ...options });
      break;
    } catch (err) {
      launchError = err;
    }
  }
  if (!browser) {
    await server.close().catch(() => {});
    rmSync(cacheDir, { recursive: true, force: true });
    console.error('No Chromium available for Playwright (run `npx playwright install chromium`).', String(launchError?.message || launchError).split('\n')[0]);
    process.exit(2);
  }

  /** A fresh overlay page. */
  async function openOverlay({ diagramsEnabled = true, width = 760, height = 900, recordVideoDir = '', deviceScaleFactor = 1, model = '' } = {}) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor,
      // A screen recording of the page (saved when the context closes).
      ...(recordVideoDir ? { recordVideo: { dir: recordVideoDir, size: { width, height } } } : {}),
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    await page.addInitScript(installStub, { diagramsEnabled, model });
    await page.goto(`${base}/?window=overlay`, { waitUntil: 'load' });
    // The overlay has subscribed once the answer-token listener exists.
    await page.waitForFunction(() => (window.__cbs?.onIntelligenceSuggestedAnswerToken || []).length > 0, null, { timeout: 60_000 });
    return { page, context, errors };
  }

  async function close() {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
    rmSync(cacheDir, { recursive: true, force: true });
  }

  return { openOverlay, close, base };
}
