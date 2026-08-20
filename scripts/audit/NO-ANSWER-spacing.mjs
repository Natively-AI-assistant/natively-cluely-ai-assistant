/**
 * Is the intermittent `noDecision` a rapid-succession race, or intrinsic?
 *
 * `handleSuggestionTrigger` resolves, a brief flush window passes, and if no
 * suggested_answer arrived the ask settles `noDecision` with EMPTY
 * streamedTokens — so the pipeline genuinely produced nothing.
 *
 * The earlier probes fired asks back-to-back. If a gap between asks removes it,
 * the cause is contention with the previous turn's still-running generation
 * (real, but only reachable when questions arrive faster than answers finish).
 * If it survives the gap, it is intrinsic and worse.
 */
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';

const dotenv = Object.fromEntries(
  fs.readFileSync('/tmp/natively-land-wt/.env', 'utf8').split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const env = { ...process.env, ...dotenv, NATIVELY_E2E: '1', NODE_ENV: 'development',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test', OLLAMA_URL: 'http://127.0.0.1:1' };

const FULL = [
  { speaker: 'interviewer', text: 'Walk me through the Atlas platform migration.' },
  { speaker: 'user', text: 'We moved the entire stack to AWS last quarter.' },
  { speaker: 'interviewer', text: 'And the datastore?' },
  { speaker: 'user', text: 'PostgreSQL, with Redis for caching.' },
];
const Q = 'Which datastore did we use?';
const REPS = 6;

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 90000 });
await app.firstWindow({ timeout: 45000 });
await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});
const RAW = async (fn, arg) => { for (let a = 0; a < 5; a++) { try { const w = app.windows()[0] || await app.firstWindow(); await w.waitForLoadState('domcontentloaded').catch(() => {}); return await w.evaluate(fn, arg); } catch (e) { if (a === 4) throw e; await new Promise((r) => setTimeout(r, 1800)); } } };
const R = (ch, ...a) => RAW(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await R('__e2e__:enable-pro').catch(() => {});
await RAW(async () => { const api = window.electronAPI || window.api;
  try { const c = await api.modesCreate({ name: 'SpacingProbe', templateType: 'general' }); const id = c?.mode?.id ?? c?.id; if (id) await api.modesSetActive(id); } catch {}
  try { await api.setModel('natively'); } catch {} });

const run = async (label, gapMs) => {
  let noDecision = 0, answered = 0;
  console.log(`\n### ${label} (gap ${gapMs}ms between asks)`);
  for (let i = 1; i <= REPS; i++) {
    if (i > 1 && gapMs) await sleep(gapMs);
    const t0 = Date.now();
    const r = await R('__e2e__:ask', { question: Q, timeoutMs: 60000, priorTurns: FULL }).catch(() => null);
    const ms = Date.now() - t0;
    const nd = r?.noDecision === true;
    if (nd) noDecision++; else if (r?.success) answered++;
    console.log(`  run${i}: ${String(ms).padStart(6)}ms  ${nd ? 'noDecision' : r?.success ? 'ANSWER' : 'other'}`);
  }
  console.log(`  => answered ${answered}/${REPS}, noDecision ${noDecision}/${REPS}`);
  return noDecision;
};

const backToBack = await run('BACK-TO-BACK (as the earlier probes ran)', 0);
const spaced = await run('SPACED', 6000);

console.log('\n=== conclusion ===');
console.log(`  back-to-back noDecision: ${backToBack}/${REPS}`);
console.log(`  spaced       noDecision: ${spaced}/${REPS}`);
console.log(spaced === 0 && backToBack > 0
  ? '  => spacing ELIMINATES it: contention with the previous turn, not intrinsic.'
  : spaced > 0 ? '  => it SURVIVES spacing: intrinsic, not a rapid-fire artifact.'
               : '  => inconclusive: it did not reproduce in either arm this run.');
await app.close();
