// Context OS FINAL VERIFICATION — Profile-mode through the REAL app + REAL provider.
// Ingests a résumé + JD (real LLM extraction), sets an interview mode, asks the
// profile questions via WTA (__e2e__:ask), captures answers + the redacted prompt
// audit. Proves: profile facts used, document absent, JD≠candidate experience,
// persona style-only, and WHETHER the typed pack governs profile turns (gap check).

import { _electron as electron } from '@playwright/test';

const env = {
  ...process.env, NATIVELY_E2E: '1', NODE_ENV: 'development',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  NATIVELY_CONTEXT_OS: '1', NATIVELY_CONTEXT_OS_WTA: '1', NATIVELY_CONTEXT_OS_MANUAL_CHAT: '1',
  NATIVELY_CONTEXT_OS_EVIDENCE_PACK: '1', NATIVELY_CONTEXT_OS_PROPERTY_VALIDATION: '1',
  NATIVELY_CONTEXT_OS_PROMPT_AUDIT: '1', NATIVELY_INTELLIGENCE_TRACE: '1',
  OLLAMA_URL: 'http://127.0.0.1:1',
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

// Ingest résumé + JD through the REAL extraction pipeline.
const resume = await R('__e2e__:ingest-profile-doc', { filePath: '/tmp/ctxos-fixtures/resume.txt', docType: 'resume' });
const jd = await R('__e2e__:ingest-profile-doc', { filePath: '/tmp/ctxos-fixtures/jd.txt', docType: 'jd' });

// Set an interview/profile mode (not doc-grounded).
const modeId = await RAW(async () => {
  const api = window.electronAPI || window.api;
  const c = await api.modesCreate({ name: 'Profile Verif', templateType: 'technical-interview' });
  await api.modesSetActive(c.mode.id);
  return c.mode.id;
});

const ask = async (q) => {
  await R('__e2e__:context-os-prompt-audit-clear');
  const ans = await R('__e2e__:ask', { question: q, timeoutMs: 45000 });
  const audit = await R('__e2e__:context-os-prompt-audit');
  const last = (audit?.audit || [])[audit?.audit?.length - 1] || {};
  return { answer: (ans?.answer || ans?.streamedTokens || ''), audit: last };
};

const best = await ask('What is my best project?');
const skills = await ask('What are my strongest skills?');
const kube = await ask('Do I have Kubernetes experience?');
const fit = await ask('Explain why I am suitable for this role.');

const verdict = {
  ingest: { resume_ok: resume?.hasStructuredResume, jd_ok: jd?.hasStructuredJD },
  best_project: {
    preview: best.answer.slice(0, 200),
    mentions_natively: /natively/i.test(best.answer),
    leaks_document: /agenticvla|mercury|openvla/i.test(best.answer),
    hasTypedEvidencePack: best.audit.hasTypedEvidencePack,
    hasRawCandidateProfile: best.audit.hasRawCandidateProfile,
    factualBlockCount: best.audit.factualBlockCount,
    model: best.audit.model,
  },
  skills: {
    preview: skills.answer.slice(0, 200),
    mentions_ts: /typescript|javascript|node|electron/i.test(skills.answer),
    leaks_kube: /kubernetes/i.test(skills.answer),
  },
  kubernetes: {
    preview: kube.answer.slice(0, 260),
    claims_experience: /\b(i have|yes,? i|my experience with kubernetes|worked with kubernetes)\b/i.test(kube.answer),
    admits_limited_or_no: /(not|no|limited|experiment|once|don'?t have|haven'?t)/i.test(kube.answer),
  },
  role_fit: {
    preview: fit.answer.slice(0, 240),
    fabricates_kube_aws: /\b(i have|my)\b[^.]{0,40}\b(kubernetes|aws)\b/i.test(fit.answer),
  },
};
console.log('CTXOS_PROFILE_BEGIN');
console.log(JSON.stringify(verdict, null, 2));
console.log('CTXOS_PROFILE_END');
await app.close().catch(() => {});
console.log('CLOSED');
