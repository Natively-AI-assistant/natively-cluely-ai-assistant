/**
 * DECISIVE LIVE TEST — real app (Playwright _electron), real WTA path, with the
 * provider forced into the exposed condition by a fake Ollama server that:
 *   1. emits a SHORT answer (34 chars) immediately, then
 *   2. holds the stream OPEN past the local first-useful deadline
 *      (LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS = 30000).
 *
 * This is the ONE configuration my earlier probes could not reach: cloud
 * providers close in 1-3s, so the second condition never occurred there.
 * Everything below the fake provider is the REAL shipped code — the same
 * IntelligenceEngine gate at :2763/:2843.
 *
 * PASS  = the app shows the model's real short answer.
 * FAIL  = the app discards it and shows a canned "no answer" line.
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
  OLLAMA_URL: 'http://127.0.0.1:11499',      // the fake, lingering provider
};

const EXPECTED = 'Yes — lead with the AWS migration.';
const CANNED = [
  "I don't have enough context from the conversation to answer that yet.",
  "The model did not produce an answer in time, so I won't guess from your profile.",
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
  try { const c = await api.modesCreate({ name: 'ForcedShortProbe', templateType: 'general' }); const id = c?.mode?.id ?? c?.id; if (id) { await api.modesSetActive(id); out.mode = id; } } catch (e) { out.modeErr = String(e).slice(0, 80); }
  // setModel('ollama-*') flips the route but does NOT set the host — ollamaUrl
  // is only applied via switchToOllama(model, url). Without this the app talks
  // to the real Ollama on 11434 instead of the fake, which is what happened on
  // the first attempt.
  try { out.switchToOllama = await api.switchToOllama('fake:latest', 'http://127.0.0.1:11499'); } catch (e) { out.switchErr = String(e).slice(0, 120); }
  try { out.setModel = await api.setModel('ollama-fake:latest'); } catch (e) { out.setModelErr = String(e).slice(0, 120); }
  return out;
});
console.log('setup:', JSON.stringify(setup));
console.log(`provider: fake Ollama on 11499 — emits "${EXPECTED}" then holds the stream open 35s\n`);

const t0 = Date.now();
let res;
try { res = await R('__e2e__:ask', { question: 'Should I mention the AWS migration?', timeoutMs: 75000, priorTurns: [{ speaker: 'interviewer', text: 'Tell me about a migration you led.' }] }); }
catch (e) { console.log('ASK ERROR:', String(e.message).slice(0, 200)); await app.close(); process.exit(1); }
const ms = Date.now() - t0;
const ans = (res?.answer || '').trim();
const streamed = (res?.streamedTokens || '').trim();

console.log(`elapsed            : ${ms}ms`);
console.log(`terminal answer    : ${JSON.stringify(ans).slice(0, 160)}`);
console.log(`streamed to the UI : ${JSON.stringify(streamed).slice(0, 160)}`);

const gotReal = ans.includes('AWS migration') || streamed.includes('AWS migration');
const gotCanned = CANNED.some((c) => ans.includes(c) || streamed.includes(c));
console.log(`\nreal short answer delivered : ${gotReal}`);
console.log(`canned substitution shown   : ${gotCanned}`);
console.log(gotCanned && !gotReal
  ? '\nRESULT: CONFIRMED — the real app DISCARDED a complete short answer and showed a canned line.'
  : gotReal ? '\nRESULT: NOT REPRODUCED — the app delivered the short answer.'
            : '\nRESULT: INCONCLUSIVE — neither the real answer nor a canned line was observed.');
await app.close();
