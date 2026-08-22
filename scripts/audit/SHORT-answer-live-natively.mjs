/**
 * REAL APP + REAL NATIVELY BACKEND.
 *
 * Drives the shipped what-to-answer path (the one carrying the 160-char
 * "useful" gate) with `natively` as the AI provider, and checks whether a
 * CORRECT short answer is ever replaced by the canned substitution line from
 * IntelligenceEngine.ts:2843-2845.
 *
 * Questions are chosen so the correct answer is genuinely SHORT and factually
 * checkable against the injected transcript — so a replacement is unambiguous
 * (we know what the right answer was).
 */
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';

const dotenv = Object.fromEntries(
  fs.readFileSync('/tmp/natively-land-wt/.env', 'utf8').split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const env = {
  ...process.env, ...dotenv,
  NATIVELY_E2E: '1', NODE_ENV: 'development',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  OLLAMA_URL: 'http://127.0.0.1:1',   // ensure no local fallback masks the result
};

const CANNED = [
  "I don't have enough context from the conversation to answer that yet.",
  "The model did not produce an answer in time, so I won't guess from your profile.",
];
const GATE = 160;

const MEETING = [
  { speaker: 'interviewer', text: 'Walk me through the Atlas platform migration.' },
  { speaker: 'user', text: 'We moved the entire stack to AWS last quarter.' },
  { speaker: 'interviewer', text: 'How big was the team?' },
  { speaker: 'user', text: 'Four engineers, and I led it.' },
  { speaker: 'interviewer', text: 'And the datastore?' },
  { speaker: 'user', text: 'PostgreSQL, with Redis for caching.' },
];

// Correct answers here are short and verifiable from the transcript above.
const QS = [
  { q: 'Did we migrate to AWS?',                 expect: /aws/i },
  { q: 'How many engineers were on the team?',   expect: /four|4/i },
  { q: 'Which datastore did we use?',            expect: /postgres/i },
  { q: 'Did I lead the migration myself?',       expect: /led|yes|i did/i },
  { q: 'What did we use for caching?',           expect: /redis/i },
];

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 90000 });
await app.firstWindow({ timeout: 45000 });
await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});
const RAW = async (fn, arg) => {
  for (let a = 0; a < 5; a++) {
    try { const w = app.windows()[0] || await app.firstWindow(); await w.waitForLoadState('domcontentloaded').catch(() => {}); return await w.evaluate(fn, arg); }
    catch (e) { if (a === 4) throw e; await new Promise((r) => setTimeout(r, 1800)); }
  }
};
const R = (ch, ...a) => RAW(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });

await R('__e2e__:enable-pro').catch(() => {});
const setup = await RAW(async () => {
  const api = window.electronAPI || window.api;
  const out = {};
  try { const c = await api.modesCreate({ name: 'NativelyShortProbe', templateType: 'general' }); const id = c?.mode?.id ?? c?.id; if (id) { await api.modesSetActive(id); out.mode = id; } } catch (e) { out.modeErr = String(e).slice(0, 90); }
  try { out.setModel = await api.setModel('natively'); } catch (e) { out.setModelErr = String(e).slice(0, 120); }
  return out;
});
console.log('setup:', JSON.stringify(setup));
const provider = await R('__e2e__:last-provider-model').catch(() => null);
console.log('provider before first ask:', JSON.stringify(provider), '\n');

console.log('question                            | ms    | chars | correct? | CANNED? | answer');
console.log('------------------------------------|-------|-------|----------|---------|-------');
let canned = 0, correctShort = 0, answered = 0, replacedCorrect = 0;
for (const { q, expect } of QS) {
  const t0 = Date.now();
  let res;
  try { res = await R('__e2e__:ask', { question: q, timeoutMs: 70000, priorTurns: MEETING }); }
  catch (e) { console.log(`${q.slice(0,35).padEnd(35)} | ERROR ${String(e.message).slice(0,44)}`); continue; }
  const ms = Date.now() - t0;
  const ans = (res?.answer || '').trim();
  if (!res?.success) { console.log(`${q.slice(0,35).padEnd(35)} | ${String(ms).padEnd(5)} | (no answer)`); continue; }
  answered++;
  const isCanned = CANNED.some((c) => ans.includes(c));
  const correct = expect.test(ans);
  if (isCanned) { canned++; replacedCorrect++; }
  if (!isCanned && correct && ans.length < GATE) correctShort++;
  console.log(`${q.slice(0,35).padEnd(35)} | ${String(ms).padEnd(5)} | ${String(ans.length).padEnd(5)} | ${String(correct).padEnd(8)} | ${String(isCanned).padEnd(7)} | ${ans.slice(0,42)}${ans.length>42?'…':''}`);
}
const model = await R('__e2e__:last-provider-model').catch(() => null);
console.log(`\nprovider actually used: ${JSON.stringify(model)}`);
console.log(`answered ${answered}/${QS.length} | correct SHORT answers delivered intact: ${correctShort} | replaced by canned line: ${canned}`);
console.log(canned > 0
  ? '\nRESULT: a correct answer WAS replaced on the real Natively provider.'
  : '\nRESULT: no replacement observed on the real Natively provider.');
await app.close();
