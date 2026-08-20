/**
 * LIVE test through the REAL app (Playwright _electron), real backend.
 *
 * Drives the actual what-to-answer path — the one carrying the 160-char
 * "useful" gate — via the app's own __e2e__:ask IPC, with an injected meeting
 * transcript so the WTA path is genuinely exercised.
 *
 * For each turn it records the TERMINAL answer and what actually STREAMED to
 * the UI, then checks whether the answer is one of the canned substitution
 * lines from IntelligenceEngine.ts:2843-2845 — i.e. whether a real short
 * answer was discarded and replaced.
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
  OLLAMA_URL: 'http://127.0.0.1:1',           // force the cloud/gateway route
};

const CANNED = [
  "I don't have enough context from the conversation to answer that yet.",
  "The model did not produce an answer in time, so I won't guess from your profile.",
];
const GATE = 160;

const MEETING = [
  { speaker: 'interviewer', text: 'We are discussing the Atlas platform migration.' },
  { speaker: 'user', text: 'We moved the whole stack to AWS last quarter.' },
  { speaker: 'interviewer', text: 'The team was four engineers.' },
  { speaker: 'user', text: 'We used PostgreSQL as the primary datastore.' },
];

// Questions whose correct answer is SHORT — the exposed shape.
const QS = [
  'Did we migrate to AWS?',
  'How many engineers were on the team?',
  'Which datastore did we use?',
  'Was the migration completed last quarter?',
];

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 90000 });
await app.firstWindow({ timeout: 45000 });
await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});

const RAW = async (fn, arg) => {
  for (let a = 0; a < 5; a++) {
    try {
      const w = app.windows()[0] || await app.firstWindow();
      await w.waitForLoadState('domcontentloaded').catch(() => {});
      return await w.evaluate(fn, arg);
    } catch (e) { if (a === 4) throw e; await new Promise((r) => setTimeout(r, 1800)); }
  }
};
const R = (ch, ...a) => RAW(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });

await R('__e2e__:enable-pro').catch(() => {});
// Mode setup is best-effort: the WTA path runs under whatever mode is active,
// and a probe that dies here would tell us nothing about the gate.
const modeInfo = await RAW(async () => {
  const api = window.electronAPI || window.api;
  try {
    const c = await api.modesCreate({ name: 'ShortAnswerProbe', templateType: 'general' });
    const id = c?.mode?.id ?? c?.id ?? null;
    if (id) { await api.modesSetActive(id); return { created: true, id }; }
    return { created: false, raw: JSON.stringify(c).slice(0, 120) };
  } catch (e) { return { created: false, error: String(e).slice(0, 120) }; }
}).catch((e) => ({ created: false, error: String(e).slice(0, 120) }));
console.log('mode setup:', JSON.stringify(modeInfo), '\n');

console.log('question                            | ms    | answer chars | streamed? | CANNED? | answer');
console.log('------------------------------------|-------|--------------|-----------|---------|-------');
let canned = 0, shortOk = 0, n = 0;
for (const q of QS) {
  const t0 = Date.now();
  let res;
  try { res = await R('__e2e__:ask', { question: q, timeoutMs: 60000, priorTurns: MEETING }); }
  catch (e) { console.log(`${q.slice(0,35).padEnd(35)} | ERROR ${String(e.message).slice(0,50)}`); continue; }
  const ms = Date.now() - t0;
  const ans = (res?.answer || '').trim();
  const streamed = (res?.streamedTokens || '').trim();
  if (!res?.success) { console.log(`${q.slice(0,35).padEnd(35)} | ${String(ms).padEnd(5)} | (no answer: timedOut=${res?.timedOut})`); continue; }
  n++;
  const isCanned = CANNED.some((c) => ans.includes(c));
  if (isCanned) canned++;
  if (!isCanned && ans.length < GATE) shortOk++;
  console.log(`${q.slice(0,35).padEnd(35)} | ${String(ms).padEnd(5)} | ${String(ans.length).padEnd(12)} | ${String(streamed.length > 0).padEnd(9)} | ${String(isCanned).padEnd(7)} | ${ans.slice(0,44)}${ans.length>44?'…':''}`);
}
console.log(`\n  answered: ${n}/${QS.length} | SHORT answers delivered intact: ${shortOk} | replaced by a canned line: ${canned}`);
await app.close();
