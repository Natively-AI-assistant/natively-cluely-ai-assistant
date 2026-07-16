// GOLDEN TRACE #5: reproduce and diagnose the empty-answer finding from
// golden-trace-jd-fit-legacy.mjs. That trace's SECOND question ("What are the
// key requirements of this role according to the JD?") returned answer:""
// and audit:{} — a silent non-answer. This trace isolates that single
// question, asked FIRST (not second, to rule out cross-question session
// state pollution — H10), and logs the FULL raw __e2e__:ask response
// (including success/noDecision/nonAnswer/decision fields) instead of just
// the extracted answer text, so we can tell WHICH failure mode this is:
// noDecision (pipeline produced nothing), nonAnswer (a clarify/recap/
// follow-up was chosen instead of an answer), or a genuine empty string
// inside a success:true response.
import { _electron as electron } from '@playwright/test';

const env = {
  ...process.env, NATIVELY_E2E: '1', NODE_ENV: 'production',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  NATIVELY_CONTEXT_OS_EVIDENCE_PACK: '0', NATIVELY_OKF_KNOWLEDGE_PACKS: '0', NATIVELY_OKF_HYBRID_RETRIEVAL: '0',
  NATIVELY_CONTEXT_OS_PROMPT_AUDIT: '1', NATIVELY_INTELLIGENCE_TRACE: '1', NATIVELY_CONTEXT_OS_PROVIDER_CAPTURE: '1',
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
  const c = await api.modesCreate({ name: 'GoldenTrace JDReqs Repro TI', templateType: 'technical-interview' });
  return c.mode;
});
await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });

const resume = await R('__e2e__:ingest-profile-doc', { filePath: '/tmp/ctxos-fixtures/resume.txt', docType: 'resume' });
const jd = await R('__e2e__:ingest-profile-doc', { filePath: '/tmp/ctxos-fixtures/jd.txt', docType: 'jd' });

await R('__e2e__:context-os-prompt-audit-clear');
const rawAns = await R('__e2e__:ask', { question: 'What are the key requirements of this role according to the JD?', timeoutMs: 45000 });
const audit = await R('__e2e__:context-os-prompt-audit');

console.log('GOLDEN_TRACE_JDREQS_REPRO_BEGIN');
console.log(JSON.stringify({
  ingestion: { resume_ok: resume?.hasStructuredResume, jd_ok: jd?.hasStructuredJD },
  rawAnswerResponse: rawAns,
  fullAudit: audit,
}, null, 2));
console.log('GOLDEN_TRACE_JDREQS_REPRO_END');
await app.close();
