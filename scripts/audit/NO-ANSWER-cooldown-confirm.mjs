/**
 * CONFIRM the cause: a 3s trigger COOLDOWN silences the planner.
 *
 * PlannerDecision.ts:61  ->  now - lastTriggerTime < cooldownMs (3000)
 *                            => { kind: 'silent', reason: 'cooldown' }
 * IntelligenceEngine.ts:230 -> triggerCooldown = 3000
 *
 * handleSuggestionTrigger returns on a silent decision without running the WTA
 * pipeline at all — which is exactly what the logs showed (no [WhatToAnswerLLM]
 * lines on a failing run) and why every failure clustered at ~2.57s: the ask
 * settles on its own flush timer, not on any model work.
 *
 * PREDICTION: gaps < 3s produce noDecision; gaps > 3s do not. If that holds, the
 * "no answer" is a deliberate rate-limit, not a defect.
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

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 90000 });
await app.firstWindow({ timeout: 45000 });
await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});
const RAW = async (fn, arg) => { for (let a = 0; a < 5; a++) { try { const w = app.windows()[0] || await app.firstWindow(); await w.waitForLoadState('domcontentloaded').catch(() => {}); return await w.evaluate(fn, arg); } catch (e) { if (a === 4) throw e; await new Promise((r) => setTimeout(r, 1800)); } } };
const R = (ch, ...a) => RAW(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await R('__e2e__:enable-pro').catch(() => {});
await RAW(async () => { const api = window.electronAPI || window.api;
  try { const c = await api.modesCreate({ name: 'CooldownProbe', templateType: 'general' }); const id = c?.mode?.id ?? c?.id; if (id) await api.modesSetActive(id); } catch {}
  try { await api.setModel('natively'); } catch {} });

// Gap measured from the END of the previous ask — the cooldown is stamped
// during that ask, so a short gap should land inside the 3s window.
const arm = async (gapMs, reps) => {
  let nd = 0;
  for (let i = 0; i < reps; i++) {
    if (i > 0) await sleep(gapMs);
    const r = await R('__e2e__:ask', { question: Q, timeoutMs: 60000, priorTurns: FULL }).catch(() => null);
    if (r?.noDecision === true) nd++;
  }
  return nd;
};

console.log('PREDICTION: gap < 3000ms -> noDecision; gap > 3000ms -> none\n');
for (const gap of [0, 1000, 3500, 5000]) {
  const nd = await arm(gap, 6);
  const inWindow = gap < 3000;
  const matches = inWindow ? nd > 0 : nd === 0;
  console.log(`  gap ${String(gap).padStart(4)}ms  noDecision ${nd}/6   (inside 3s cooldown: ${String(inWindow).padEnd(5)})  prediction ${matches ? 'HOLDS' : 'FAILS'}`);
}
await app.close();
