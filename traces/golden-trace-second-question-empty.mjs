// GOLDEN TRACE #9: isolate a SEPARATE nondeterminism finding surfaced while
// verifying the Phase 1 fix (golden-trace-jd-fix-verify.mjs): asking a JD-fit
// question FIRST, then a JD-requirements question SECOND in the same session,
// reproducibly returns an EMPTY result for the second question — even though
// the exact same JD-requirements question asked ALONE (fresh session, first
// question) grounds correctly. This traces founder symptom #2 (nondeterminism
// / "sometimes silence/no answer"). Logs the FULL raw __e2e__:ask response
// (not just extracted answer) for question #2 to classify the failure mode:
// noDecision, nonAnswer(clarify/recap/follow_up), or empty-inside-success.
import { _electron as electron } from '@playwright/test';

const env = {
  ...process.env, NATIVELY_E2E: '1', NODE_ENV: 'production',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  NATIVELY_CONTEXT_OS_EVIDENCE_PACK: '0', NATIVELY_OKF_KNOWLEDGE_PACKS: '0', NATIVELY_OKF_HYBRID_RETRIEVAL: '0',
  NATIVELY_CONTEXT_OS_PROMPT_AUDIT: '1', NATIVELY_INTELLIGENCE_TRACE: '1',
  OLLAMA_URL: 'http://127.0.0.1:1',
  NATIVELY_API_URL: 'http://localhost:3000',
};

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 60000 });
const mainLogs = [];
app.process().stdout?.on('data', (d) => { mainLogs.push(d.toString()); });
app.process().stderr?.on('data', (d) => { mainLogs.push(d.toString()); });
await app.firstWindow({ timeout: 30000 });
await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});
const RAW = async (fn, arg) => {
  for (let a = 0; a < 5; a++) {
    try { const w = app.windows()[0] || await app.firstWindow(); await w.waitForLoadState('domcontentloaded').catch(() => {}); return await w.evaluate(fn, arg); }
    catch (e) { if (a === 4) throw e; await new Promise((r) => setTimeout(r, 1800)); }
  }
};
const R = (ch, ...a) => RAW(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });
await R('__e2e__:enable-pro').catch(() => {});
await RAW(async () => (window.electronAPI || window.api).setModel('natively'));

const mode = await RAW(async () => {
  const api = window.electronAPI || window.api;
  const c = await api.modesCreate({ name: 'GoldenTrace SecondQEmpty TI', templateType: 'technical-interview' });
  return c.mode;
});
await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });

await R('__e2e__:ingest-profile-doc', { filePath: '/tmp/ctxos-fixtures/resume.txt', docType: 'resume' });
await R('__e2e__:ingest-profile-doc', { filePath: '/tmp/ctxos-fixtures/jd.txt', docType: 'jd' });

const q1 = await R('__e2e__:ask', { question: 'Based on the job description, am I a good fit for this role given my background?', timeoutMs: 45000 });

mainLogs.length = 0;
const q2 = await R('__e2e__:ask', { question: 'What are the key requirements of this role according to the JD?', timeoutMs: 45000 });
await new Promise((r) => setTimeout(r, 500));

console.log('GOLDEN_TRACE_SECONDQ_EMPTY_BEGIN');
console.log(JSON.stringify({ q1RawResponse: q1, q2RawResponse: q2 }, null, 2));
console.log('--- MAIN PROCESS LOGS (q2 only) ---');
console.log(mainLogs.join(''));
console.log('GOLDEN_TRACE_SECONDQ_EMPTY_END');
await app.close();
