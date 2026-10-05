// F-120 repro: embedding degradation broadcasts have no listeners.
//
// EmbeddingPipeline broadcasts 'embedding:fallback-activated' (primary
// embedding provider failed → quality-degraded fallback) and
// 'embedding:space-persist-failed' (vectors stuck "pending" until re-index).
// Repo-wide, each channel had exactly one producer and zero consumers — the
// silent degradation the sibling channels (incompatible-provider warning,
// reindex progress) explicitly surface.
//
// Expected (correct): the bridge exposes onEmbeddingDegraded and BOTH
// channels reach a renderer subscriber → exit 0. Bug: bridge method
// undefined → exit 1.
//
// Run: node scripts/audit/F-120-repro.mjs
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
  try { if (await w.evaluate(() => !!window.electronAPI)) { win = w; break; } } catch { /* navigating */ }
}
if (!win) {
  console.error('[F-120] Inconclusive: no bridge window.');
  app.process().kill('SIGKILL');
  process.exit(2);
}

const type = await win.evaluate(() => typeof window.electronAPI.onEmbeddingDegraded);
console.log('[F-120] typeof onEmbeddingDegraded:', type);
if (type !== 'function') {
  console.error('[F-120] FAIL: no consumer surface for the embedding degradation broadcasts (F-120 reproduced).');
  app.process().kill('SIGKILL');
  process.exit(1);
}

await win.evaluate(() => {
  window.__f120 = [];
  window.electronAPI.onEmbeddingDegraded((data) => { window.__f120.push(data); });
});
await app.evaluate(({ BrowserWindow }) => {
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.webContents.send('embedding:fallback-activated', { meetingId: 'm1', fallbackProvider: 'local-onnx', reason: 'audit' });
      w.webContents.send('embedding:space-persist-failed', { fallbackProvider: 'local-onnx', space: 's', reason: 'audit' });
    } catch { /* noop */ }
  }
});
await new Promise((r) => setTimeout(r, 500));
const received = await win.evaluate(() => window.__f120);
console.log('[F-120] received:', JSON.stringify(received));
app.process().kill('SIGKILL');

const kinds = new Set((received ?? []).map((d) => d.kind));
if (kinds.has('fallback') && kinds.has('persist-failed')) {
  console.log('[F-120] PASS: both degradation channels reach the renderer subscriber.');
  process.exit(0);
}
console.error('[F-120] FAIL: broadcasts did not reach the subscriber:', [...kinds]);
process.exit(1);
