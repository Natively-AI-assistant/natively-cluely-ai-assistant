/**
 * WHY does the pipeline decide not to answer? Capture the app's own main-process
 * logs across repeated asks and diff the log lines of a noDecision run against
 * an ANSWER run for the SAME question.
 */
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';

const dotenv = Object.fromEntries(
  fs.readFileSync('/tmp/natively-land-wt/.env', 'utf8').split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const env = { ...process.env, ...dotenv, NATIVELY_E2E: '1', NODE_ENV: 'development',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test', OLLAMA_URL: 'http://127.0.0.1:1',
  NATIVELY_INTELLIGENCE_TRACE: '1', NATIVELY_CONTEXT_DEBUG: '1' };

const FULL = [
  { speaker: 'interviewer', text: 'Walk me through the Atlas platform migration.' },
  { speaker: 'user', text: 'We moved the entire stack to AWS last quarter.' },
  { speaker: 'interviewer', text: 'And the datastore?' },
  { speaker: 'user', text: 'PostgreSQL, with Redis for caching.' },
];
const Q = 'Which datastore did we use?';

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 90000 });
let logBuf = [];
app.process().stdout?.on('data', (d) => logBuf.push(...String(d).split('\n').filter(Boolean)));
app.process().stderr?.on('data', (d) => logBuf.push(...String(d).split('\n').filter(Boolean)));

await app.firstWindow({ timeout: 45000 });
await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});
const RAW = async (fn, arg) => { for (let a = 0; a < 5; a++) { try { const w = app.windows()[0] || await app.firstWindow(); await w.waitForLoadState('domcontentloaded').catch(() => {}); return await w.evaluate(fn, arg); } catch (e) { if (a === 4) throw e; await new Promise((r) => setTimeout(r, 1800)); } } };
const R = (ch, ...a) => RAW(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });

await R('__e2e__:enable-pro').catch(() => {});
await RAW(async () => { const api = window.electronAPI || window.api;
  try { const c = await api.modesCreate({ name: 'LogProbe', templateType: 'general' }); const id = c?.mode?.id ?? c?.id; if (id) await api.modesSetActive(id); } catch {}
  try { await api.setModel('natively'); } catch {} });

// Widened: the first pass MISSED the actual cause because "Speculative stream
// accepted" matches none of those keywords. Guard names, not guessed symptoms.
const INTERESTING = /Speculative|Jaccard|planner|silent|NO_ACTION|sentinel|suppress|decline|discard|supersed|WhatToAnswer|IntelligenceEngine|runWhatShouldISay|decision/i;
const runs = [];
for (let i = 1; i <= 12; i++) {
  logBuf = [];
  const t0 = Date.now();
  const r = await R('__e2e__:ask', { question: Q, timeoutMs: 60000, priorTurns: FULL }).catch(() => null);
  const ms = Date.now() - t0;
  const nd = r?.noDecision === true;
  runs.push({ i, ms, nd, hits: logBuf.filter((l) => INTERESTING.test(l)).slice(-16), all: logBuf.slice(-40) });
  console.log(`run${i}: ${String(ms).padStart(6)}ms  ${nd ? 'noDecision' : r?.success ? 'ANSWER' : 'other'}`);
}

const bad = runs.find((r) => r.nd);
const good = runs.find((r) => !r.nd);
if (!bad) { console.log('\nnoDecision did not reproduce in this run.'); }
else {
  console.log('\n================ noDecision run — relevant log lines ================');
  (bad.hits.length ? bad.hits : bad.all).forEach((l) => console.log('  ' + l.slice(0, 190)));
  console.log('\n================ ANSWER run — relevant log lines ================');
  ((good?.hits?.length ? good.hits : good?.all) ?? []).slice(-16).forEach((l) => console.log('  ' + l.slice(0, 190)));
}
await app.close();
