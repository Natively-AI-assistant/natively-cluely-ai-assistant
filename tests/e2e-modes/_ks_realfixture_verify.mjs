// REAL-ELECTRON, REAL-FIXTURE verification of the Knowledge Source repair.
// Drives the actual packaged renderer/main/IPC stack (not the Node test harness):
//   1. Create a mode as General (default: reference_files_primary, doc-grounded).
//   2. Switch its template to Technical Interview via modes:update (the exact
//      renderer action from the user's bug report).
//   3. Read back modes:get-source-contract — this is what the Knowledge Source
//      dot-selector itself renders from, so this proves the re-seed reached the
//      panel, not just an internal field.
//   4. Ingest a REAL résumé + JD fixture through the real extraction pipeline.
//   5. Ask a real profile question via the real WhatToAnswer path and inspect
//      the redacted prompt audit + the actual streamed answer.
//   6. Regression-check: a genuine reference-files mode (Lecture) must still
//      forbid profile sources and its contract must stay reference_files_only.
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

// --- 1. Create mode as General ---
const created = await RAW(async () => {
  const api = window.electronAPI || window.api;
  const c = await api.modesCreate({ name: 'KS Repro General->TI', templateType: 'general' });
  return c.mode;
});
const generalContract = await RAW(async ({ id }) => (window.electronAPI || window.api).modesGetSourceContract(id), { id: created.id });

// --- 2. Switch to Technical Interview (the exact renderer action from the bug report) ---
await RAW(async ({ id }) => {
  const api = window.electronAPI || window.api;
  await api.modesUpdate(id, { templateType: 'technical-interview' });
}, { id: created.id });
const tiContract = await RAW(async ({ id }) => (window.electronAPI || window.api).modesGetSourceContract(id), { id: created.id });

await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: created.id });

// --- 3. Ingest REAL résumé + JD fixtures ---
const resume = await R('__e2e__:ingest-profile-doc', { filePath: '/tmp/ctxos-fixtures/resume.txt', docType: 'resume' });
const jd = await R('__e2e__:ingest-profile-doc', { filePath: '/tmp/ctxos-fixtures/jd.txt', docType: 'jd' });

// --- 4. Ask the real profile question from the user's report ---
const ask = async (q) => {
  await R('__e2e__:context-os-prompt-audit-clear');
  const ans = await R('__e2e__:ask', { question: q, timeoutMs: 45000 });
  const audit = await R('__e2e__:context-os-prompt-audit');
  const last = (audit?.audit || [])[audit?.audit?.length - 1] || {};
  return { answer: (ans?.answer || ans?.streamedTokens || ''), audit: last };
};
const projectQ = await ask('Walk me through your most recent project.');

// --- 5. Regression: Lecture (reference_files_only) must still forbid profile ---
const lecture = await RAW(async () => {
  const api = window.electronAPI || window.api;
  const c = await api.modesCreate({ name: 'KS Regression Lecture', templateType: 'lecture' });
  return c.mode;
});
const lectureContract = await RAW(async ({ id }) => (window.electronAPI || window.api).modesGetSourceContract(id), { id: lecture.id });

const verdict = {
  generalSeed: {
    sourceAuthority: generalContract?.sourceAuthority,
    seededForTemplateType: generalContract?.seededForTemplateType,
    origin: generalContract?.origin,
  },
  postSwitchToTechnicalInterview: {
    sourceAuthority: tiContract?.sourceAuthority,
    seededForTemplateType: tiContract?.seededForTemplateType,
    origin: tiContract?.origin,
    reseeded_correctly: tiContract?.sourceAuthority === 'profile_only',
  },
  ingestion: {
    resume_ok: resume?.hasStructuredResume,
    jd_ok: jd?.hasStructuredJD,
  },
  mostRecentProjectAnswer: {
    preview: projectQ.answer.slice(0, 400),
    hasTypedEvidencePack: projectQ.audit.hasTypedEvidencePack,
    hasRawCandidateProfile: projectQ.audit.hasRawCandidateProfile,
    sourceOwner: projectQ.audit.sourceOwner,
    sourceAuthority: projectQ.audit.sourceAuthority,
    sourceAuthorityOrigin: projectQ.audit.sourceAuthorityOrigin,
    mentionsRealCompany: /stripe|datadog|uber/i.test(projectQ.answer),
    isRefusalOrClarify: /i (don't|do not) have|could you clarify|which (source|document)/i.test(projectQ.answer),
  },
  lectureRegression: {
    sourceAuthority: lectureContract?.sourceAuthority,
    stays_reference_files_only: lectureContract?.sourceAuthority === 'reference_files_only',
  },
};
console.log('KS_REALFIXTURE_BEGIN');
console.log(JSON.stringify(verdict, null, 2));
console.log('KS_REALFIXTURE_END');
await app.close().catch(() => {});
console.log('CLOSED');
