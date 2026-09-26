// F-117 repro: e2eInvoke is an ungated passthrough to every production IPC
// channel.
//
// preload exposes e2eInvoke(channel, ...args) → ipcRenderer.invoke(channel,…)
// unconditionally. The inline comment claims it is a "no-op surface in a
// shipped app (the handlers aren't registered)" — but NATIVELY_E2E gates only
// the __e2e__:* HANDLERS, not the channel argument: any renderer code can
// reach all ~349 production channels ('quit-app', 'set-openai-api-key',
// 'delete-meeting', …), defeating the curated bridge's containment.
//
// Two launches: WITHOUT the env, the passthrough must be absent; WITH
// NATIVELY_E2E=1 it must remain available (the e2e probes depend on it).
//
// Expected (correct): absent without env + present with env → exit 0.
// Bug (F-117): available without env and able to invoke a production
// channel → exit 1.
//
// Run: node scripts/audit/F-117-repro.mjs
import { _electron as electron } from '@playwright/test';

async function probe(envExtra) {
  const app = await electron.launch({
    args: ['dist-electron/electron/main.js'],
    env: { ...process.env, NODE_ENV: 'production', NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', ...envExtra },
    timeout: 60_000,
  });
  await app.firstWindow({ timeout: 30_000 }).catch(() => null);
  await new Promise((r) => setTimeout(r, 2_500));
  let res = { type: 'no-bridge-window' };
  for (const w of app.windows()) {
    try {
      const out = await w.evaluate(async () => {
        const fn = window.electronAPI?.e2eInvoke;
        if (typeof fn !== 'function') return { type: typeof fn };
        try {
          const v = await fn('get-meeting-active');
          return { type: 'function', productionInvoke: true, value: v };
        } catch (e) {
          return { type: 'function', productionInvoke: false, error: String(e).slice(0, 100) };
        }
      });
      res = out; break;
    } catch { /* navigating */ }
  }
  app.process().kill('SIGKILL');
  return res;
}

const closed = await probe({});
console.log('[F-117] without NATIVELY_E2E:', JSON.stringify(closed));
if (closed.type === 'no-bridge-window') {
  console.error('[F-117] Inconclusive: no bridge window.');
  process.exit(2);
}
if (closed.type === 'function') {
  console.error('[F-117] FAIL: e2eInvoke exposed without the E2E env' +
    (closed.productionInvoke ? ' and it reaches production channels' : '') + ' (F-117 reproduced).');
  process.exit(1);
}

const open = await probe({ NATIVELY_E2E: '1' });
console.log('[F-117] with NATIVELY_E2E=1:', JSON.stringify(open));
if (open.type !== 'function') {
  console.error('[F-117] FAIL: gating broke the E2E surface — probes need e2eInvoke under NATIVELY_E2E=1.');
  process.exit(1);
}
console.log('[F-117] PASS: passthrough gated to NATIVELY_E2E sessions only.');
process.exit(0);
