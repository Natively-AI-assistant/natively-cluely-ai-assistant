// GOLDEN TRACE #4 (grounding campaign, Phase 0): re-run of the
// _ks_realfixture_verify.mjs scenario (resume+JD in a Technical Interview
// mode) but with Context-OS governed flags forced OFF (production defaults),
// to see whether the LEGACY path (not the dev/test-default-on governed path)
// exhibits the founder's symptom #3 (mode+knowledge combination broken) on a
// JD-FIT question that genuinely requires BOTH resume AND JD evidence
// together — the hardest version of H3.
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
  const c = await api.modesCreate({ name: 'GoldenTrace JDFit Legacy TI', templateType: 'technical-interview' });
  return c.mode;
});
const contract = await RAW(async ({ id }) => (window.electronAPI || window.api).modesGetSourceContract(id), { id: mode.id });
await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });

const resume = await R('__e2e__:ingest-profile-doc', { filePath: '/tmp/ctxos-fixtures/resume.txt', docType: 'resume' });
const jd = await R('__e2e__:ingest-profile-doc', { filePath: '/tmp/ctxos-fixtures/jd.txt', docType: 'jd' });

const ask = async (q) => {
  await R('__e2e__:context-os-prompt-audit-clear');
  const ans = await R('__e2e__:ask', { question: q, timeoutMs: 45000 });
  const audit = await R('__e2e__:context-os-prompt-audit');
  const last = (audit?.audit || [])[audit?.audit?.length - 1] || {};
  const text = ans?.answer || ans?.streamedTokens || '';
  return {
    question: q,
    answer: text.slice(0, 600),
    audit: last,
    isSafeRefusal: /could not find that in the retrieved sections/i.test(text),
    isGenericRefusal: /(don't have access|no (uploaded|attached) (document|file|source)|only respond from uploaded|can only answer from|not (in|part of) (the|my) (uploaded|reference|knowledge))/i.test(text),
    mentionsHelio: /helio/i.test(text),
    mentionsPostgres: /postgres/i.test(text),
    mentionsStripe: /stripe/i.test(text),
  };
};

const jdFit = await ask('Based on the job description, am I a good fit for this role given my background?');
const jdReqs = await ask('What are the key requirements of this role according to the JD?');

console.log('GOLDEN_TRACE_JDFIT_LEGACY_BEGIN');
console.log(JSON.stringify({
  contractSeed: { sourceAuthority: contract?.sourceAuthority },
  ingestion: { resume_ok: resume?.hasStructuredResume, jd_ok: jd?.hasStructuredJD },
  jdFit,
  jdReqs,
}, null, 2));
console.log('GOLDEN_TRACE_JDFIT_LEGACY_END');
await app.close();
