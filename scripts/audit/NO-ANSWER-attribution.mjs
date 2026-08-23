/**
 * Attribute the intermittent "no answer": PRODUCT decision or HARNESS artifact?
 *
 * __e2e__:ask has several settle paths and my earlier probe only read
 * `success`, discarding the diagnostic:
 *   onAnswer  -> success:true
 *   onDiscard -> { success:false, discarded:true, reason }      <-- why?
 *   clarify / recap / follow_up_questions -> a non-answer DECISION
 *   timeout   -> { success:false, timedOut:true }
 *
 * This dumps the FULL payload so the distinction is visible, and repeats each
 * question 4x to measure the rate rather than infer it from one sample.
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
  { speaker: 'interviewer', text: 'How big was the team?' },
  { speaker: 'user', text: 'Four engineers, and I led it.' },
  { speaker: 'interviewer', text: 'And the datastore?' },
  { speaker: 'user', text: 'PostgreSQL, with Redis for caching.' },
];
const QS = ['How many engineers were on the team?', 'Did I lead the migration myself?', 'Which datastore did we use?'];
const REPS = 4;

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 90000 });
await app.firstWindow({ timeout: 45000 });
await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});
const RAW = async (fn, arg) => { for (let a = 0; a < 5; a++) { try { const w = app.windows()[0] || await app.firstWindow(); await w.waitForLoadState('domcontentloaded').catch(() => {}); return await w.evaluate(fn, arg); } catch (e) { if (a === 4) throw e; await new Promise((r) => setTimeout(r, 1800)); } } };
const R = (ch, ...a) => RAW(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });

await R('__e2e__:enable-pro').catch(() => {});
await RAW(async () => { const api = window.electronAPI || window.api;
  try { const c = await api.modesCreate({ name: 'AttributionProbe', templateType: 'general' }); const id = c?.mode?.id ?? c?.id; if (id) await api.modesSetActive(id); } catch {}
  try { await api.setModel('natively'); } catch {} });

const tally = {};
for (const q of QS) {
  console.log(`\n### ${q}`);
  for (let i = 1; i <= REPS; i++) {
    const t0 = Date.now();
    const r = await R('__e2e__:ask', { question: q, timeoutMs: 60000, priorTurns: FULL }).catch((e) => ({ harnessError: String(e).slice(0, 80) }));
    const ms = Date.now() - t0;
    // Classify by the payload's own fields, not by guessing.
    const kind = r?.success ? 'ANSWER'
      : r?.discarded ? `DISCARDED(${r.reason})`
      : r?.decision || r?.nonAnswer ? `DECISION(${JSON.stringify(r.decision ?? r.nonAnswer).slice(0, 40)})`
      : r?.timedOut ? 'TIMEDOUT'
      : `OTHER ${JSON.stringify(r).slice(0, 90)}`;
    tally[kind] = (tally[kind] || 0) + 1;
    console.log(`  run${i}: ${String(ms).padStart(5)}ms  ${kind}`);
    if (!r?.success) console.log(`         payload: ${JSON.stringify(r).slice(0, 220)}`);
  }
}
console.log('\n=== tally across all runs ===');
for (const [k, v] of Object.entries(tally)) console.log(`  ${String(v).padStart(2)}  ${k}`);
await app.close();
