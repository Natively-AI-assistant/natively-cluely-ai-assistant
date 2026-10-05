// F-119 repro: the 'ollama-error' broadcast has no listener anywhere.
//
// LLMHelper.notifyRendererOllamaError() deliberately broadcasts a user-facing
// notification to every window when Ollama is unreachable / has no models AND
// the fallback also failed — but no preload method ever subscribed to
// 'ollama-error', so the user saw a silent hang instead. (repo-wide grep:
// exactly one file referenced the channel.)
//
// Live check: (1) the bridge must expose onOllamaError; (2) a main-side
// broadcast on 'ollama-error' must reach a renderer subscriber.
//
// Expected (correct): both hold → exit 0. Bug (F-119): bridge method
// undefined → exit 1.
//
// Run: node scripts/audit/F-119-repro.mjs
import { _electron as electron } from '@playwright/test';

const app = await electron.launch({
  args: ['dist-electron/electron/main.js'],
  env: { ...process.env, NODE_ENV: 'production', NATIVELY_DEV_BYPASS_SCREEN_TCC: '1' },
  timeout: 60_000,
});
await app.firstWindow({ timeout: 30_000 }).catch(() => null);
await new Promise((r) => setTimeout(r, 3_000));

let win = null;
for (const w of app.windows()) {
  try {
    if (await w.evaluate(() => !!window.electronAPI)) { win = w; break; }
  } catch { /* navigating */ }
}
if (!win) {
  console.error('[F-119] Inconclusive: no bridge window.');
  app.process().kill('SIGKILL');
  process.exit(2);
}

const hasBridge = await win.evaluate(() => typeof window.electronAPI.onOllamaError);
console.log('[F-119] typeof onOllamaError:', hasBridge);
if (hasBridge !== 'function') {
  console.error("[F-119] FAIL: bridge does not expose onOllamaError — main's deliberate user-facing Ollama failure notification goes nowhere (F-119 reproduced).");
  app.process().kill('SIGKILL');
  process.exit(1);
}

// Subscribe in the renderer, then fire the real broadcast from main.
await win.evaluate(() => {
  window.__f119 = null;
  window.electronAPI.onOllamaError((data) => { window.__f119 = data; });
});
await app.evaluate(({ BrowserWindow }) => {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('ollama-error', { message: 'AUDIT-F119-TEST' }); } catch { /* noop */ }
  }
});
await new Promise((r) => setTimeout(r, 500));
const received = await win.evaluate(() => window.__f119);
console.log('[F-119] renderer received:', JSON.stringify(received));
app.process().kill('SIGKILL');

if (received?.message === 'AUDIT-F119-TEST') {
  console.log('[F-119] PASS: ollama-error reaches a renderer subscriber through the bridge.');
  process.exit(0);
}
console.error('[F-119] FAIL: broadcast did not reach the subscriber.');
process.exit(1);
