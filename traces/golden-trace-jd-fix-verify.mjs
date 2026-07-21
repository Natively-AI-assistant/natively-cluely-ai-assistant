// GOLDEN TRACE #8 (Phase 1 fix verification): full-answer re-run of the
// exact scenario from golden-trace-jd-fit-legacy.mjs / -jd-reqs-repro.mjs,
// AFTER the wtaDecisionAllowsCandidateProfile fix in IntelligenceEngine.ts.
// Prints the FULL answer text (not truncated) for manual zero-hallucination
// verification against the real fixture JD content.
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
  const c = await api.modesCreate({ name: 'GoldenTrace JD Fix Verify TI', templateType: 'technical-interview' });
  return c.mode;
});
await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });

await R('__e2e__:ingest-profile-doc', { filePath: '/tmp/ctxos-fixtures/resume.txt', docType: 'resume' });
await R('__e2e__:ingest-profile-doc', { filePath: '/tmp/ctxos-fixtures/jd.txt', docType: 'jd' });

const jdFit = await R('__e2e__:ask', { question: 'Based on the job description, am I a good fit for this role given my background?', timeoutMs: 45000 });
const jdReqs = await R('__e2e__:ask', { question: 'What are the key requirements of this role according to the JD?', timeoutMs: 45000 });

console.log('GOLDEN_TRACE_JD_FIX_VERIFY_BEGIN');
console.log(JSON.stringify({
  jdFit: { answer: jdFit?.answer },
  jdReqs: { answer: jdReqs?.answer },
}, null, 2));
console.log('GOLDEN_TRACE_JD_FIX_VERIFY_END');
await app.close();
