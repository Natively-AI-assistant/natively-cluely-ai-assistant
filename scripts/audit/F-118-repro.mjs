// F-118 repro: a live-RAG hard failure double-signals the renderer.
//
// The rag:query-live catch sends a TERMINAL rag:stream-error {live:true}
// (renderer staples "[RAG Error: …]" into the last bubble and clears
// streaming state) AND returns {success:false} (renderer reads non-success
// as "fall through to normal chat" and starts streamGeminiChat into the same
// torn-down row). Only one of the two signals should fire — the fallback owns
// the UX for the live class.
//
// Live repro: fake live-ready RAG manager on the real AppState whose
// queryMeeting async-generator throws a non-fallback error; the real
// rag:query-live handler is invoked from a bridge window (via e2eInvoke)
// with a rag:stream-error subscriber registered.
//
// Expected (correct): invoke resolves {success:false} and NO {live:true}
// error event → exit 0. Bug (F-118): both signals observed → exit 1.
//
// Run: node scripts/audit/F-118-repro.mjs
import { _electron as electron } from '@playwright/test';

const app = await electron.launch({
  args: ['dist-electron/electron/main.js'],
  env: { ...process.env, NODE_ENV: 'production', NATIVELY_DEV_BYPASS_SCREEN_TCC: '1' },
  timeout: 60_000,
});
await app.firstWindow({ timeout: 30_000 }).catch(() => null);
await app.evaluate(() => {
  const Module = process.mainModule.constructor;
  const key = Object.keys(Module._cache).find((k) => k.includes('dist-electron') && k.endsWith('main.js'));
  if (key) globalThis.__auditMainExports = Module._cache[key].exports;
});
await new Promise((r) => setTimeout(r, 3_000));

const poisoned = await app.evaluate(() => {
  const { AppState } = globalThis.__auditMainExports ?? {};
  if (!AppState?.getInstance) return { ok: false };
  const s = AppState.getInstance();
  const prev = s.ragManager;
  globalThis.__f118prev = prev;
  s.ragManager = {
    isReady: () => true,
    isLiveIndexingActive: () => true,
    hasLiveChunks: () => true,
    queryMeeting: async function* () {
      throw new Error('AUDIT-F118-FORCED-LIVE-FAILURE');
      // eslint-disable-next-line no-unreachable
      yield '';
    },
  };
  return { ok: typeof s.getRAGManager === 'function' ? s.getRAGManager() === s.ragManager : true };
});
console.log('[F-118] poisoned:', JSON.stringify(poisoned));
if (!poisoned.ok) {
  console.error('[F-118] Inconclusive: could not install fake RAG manager.');
  app.process().kill('SIGKILL');
  process.exit(2);
}

let win = null;
for (const w of app.windows()) {
  try {
    if (await w.evaluate(() => !!window.electronAPI?.e2eInvoke && !!window.electronAPI?.onRAGStreamError)) { win = w; break; }
  } catch { /* navigating */ }
}
if (!win) {
  console.error('[F-118] Inconclusive: no window with e2eInvoke + onRAGStreamError.');
  app.process().kill('SIGKILL');
  process.exit(2);
}

const result = await win.evaluate(async () => {
  const events = [];
  const off = window.electronAPI.onRAGStreamError((data) => { events.push(data); });
  const res = await window.electronAPI.e2eInvoke('rag:query-live', { query: 'audit question' });
  await new Promise((r) => setTimeout(r, 400));
  off?.();
  return { res, events };
});
console.log('[F-118] result:', JSON.stringify(result));

await app.evaluate(() => {
  const { AppState } = globalThis.__auditMainExports ?? {};
  const s = AppState.getInstance();
  s.ragManager = globalThis.__f118prev ?? null;
});
app.process().kill('SIGKILL');

const gotFallbackReturn = result.res && result.res.success === false;
const gotLiveErrorEvent = result.events.some((e) => e && e.live === true);
if (!gotFallbackReturn) {
  console.error('[F-118] Inconclusive: handler did not take the hard-failure path.');
  process.exit(2);
}
if (gotLiveErrorEvent) {
  console.error('[F-118] FAIL: double signal — terminal {live:true} rag:stream-error AND {success:false} fallback return (F-118 reproduced).');
  process.exit(1);
}
console.log('[F-118] PASS: single signal — fallback return only; the renderer fallback owns the UX.');
process.exit(0);
