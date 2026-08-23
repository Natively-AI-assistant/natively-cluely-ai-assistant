/**
 * Why did 2 of 5 questions return NO ANSWER in the live Natively run?
 *
 * Failing: "How many engineers were on the team?" / "Did I lead the migration myself?"
 * Passing: AWS / datastore / caching.
 *
 * Hypothesis worth testing first: BOTH failing questions are ALREADY ANSWERED
 * verbatim in the injected transcript ("Four engineers, and I led it."), so the
 * app may be correctly declining to answer a question the user already answered.
 * A competing hypothesis is that detection simply never fires for them.
 *
 * Step 1 runs the REAL question extractor the live path uses.
 * Step 2 re-asks each 2x to separate a deterministic decision from flake.
 * Step 3 re-asks the two failures with the "already answered" lines REMOVED
 *        from the transcript — if they answer then, the suppression is the cause.
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
  { speaker: 'user', text: 'Four engineers, and I led it.' },      // <-- answers BOTH failures
  { speaker: 'interviewer', text: 'And the datastore?' },
  { speaker: 'user', text: 'PostgreSQL, with Redis for caching.' },
];
// Same conversation with the pre-answering line removed.
const TRIMMED = FULL.filter((t) => t.text !== 'Four engineers, and I led it.');

const QS = [
  'Did we migrate to AWS?',
  'How many engineers were on the team?',
  'Which datastore did we use?',
  'Did I lead the migration myself?',
  'What did we use for caching?',
];
const FAILED = ['How many engineers were on the team?', 'Did I lead the migration myself?'];

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 90000 });
await app.firstWindow({ timeout: 45000 });
await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});
const RAW = async (fn, arg) => { for (let a = 0; a < 5; a++) { try { const w = app.windows()[0] || await app.firstWindow(); await w.waitForLoadState('domcontentloaded').catch(() => {}); return await w.evaluate(fn, arg); } catch (e) { if (a === 4) throw e; await new Promise((r) => setTimeout(r, 1800)); } } };
const R = (ch, ...a) => RAW(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });

await R('__e2e__:enable-pro').catch(() => {});
await RAW(async () => { const api = window.electronAPI || window.api;
  try { const c = await api.modesCreate({ name: 'NoAnswerProbe', templateType: 'general' }); const id = c?.mode?.id ?? c?.id; if (id) await api.modesSetActive(id); } catch {}
  try { await api.setModel('natively'); } catch {} });

console.log('STEP 1 — does the REAL question extractor detect each question?\n');
for (const q of QS) {
  const d = await R('__e2e__:detect-question', { text: q, priorTurns: FULL }).catch((e) => ({ err: String(e).slice(0, 60) }));
  console.log(`  ${FAILED.includes(q) ? 'FAILED ' : 'ok     '} ${q.padEnd(38)} -> ${JSON.stringify(d).slice(0, 150)}`);
}

const ask = async (q, turns) => {
  const t0 = Date.now();
  const r = await R('__e2e__:ask', { question: q, timeoutMs: 60000, priorTurns: turns }).catch(() => null);
  return { ms: Date.now() - t0, ok: !!r?.success, ans: (r?.answer || '').trim() };
};

console.log('\nSTEP 2 — re-ask each 2x with the FULL transcript (deterministic or flake?)\n');
for (const q of QS) {
  const a = await ask(q, FULL); const b = await ask(q, FULL);
  console.log(`  ${q.padEnd(38)} run1=${a.ok ? 'ANSWER' : 'none  '}(${a.ms}ms) run2=${b.ok ? 'ANSWER' : 'none  '}(${b.ms}ms)`);
}

console.log('\nSTEP 3 — the two failures WITHOUT the pre-answering line in the transcript\n');
for (const q of FAILED) {
  const r = await ask(q, TRIMMED);
  console.log(`  ${q.padEnd(38)} ${r.ok ? 'ANSWER' : 'none  '}(${r.ms}ms) ${r.ans.slice(0, 60)}`);
}
await app.close();
