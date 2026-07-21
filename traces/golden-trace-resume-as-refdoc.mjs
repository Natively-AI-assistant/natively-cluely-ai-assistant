// GOLDEN TRACE #3 (grounding campaign, Phase 0): tests founder symptom #3
// under a DIFFERENT interpretation than _ks_realfixture_verify.mjs covered.
//
// _ks_realfixture_verify.mjs attaches the resume/JD via the DEDICATED profile
// ingestion pipeline (__e2e__:ingest-profile-doc) into a profile_only mode
// (Technical Interview) and found it grounds correctly via the legacy
// raw-candidate-profile path (hasRawCandidateProfile:true).
//
// This trace probes: what if the user's mental model is "attach my resume as
// a REFERENCE FILE" (the same mechanism as any other document) to a GENERAL
// mode (reference_files_primary, NOT profile_only — General mode's
// allowedExplicitSwitches is ONLY ['reference_files'], it can never become
// profile-owned)? A resume is prose-dense, non-obviously-structured content;
// unlike the single-salient-fact aurora-onboarding.md doc (golden-trace-refdoc),
// this tests retrieval PRECISION (H6) on a synthesis-style question ("walk me
// through your background") against chunk-level RAG, not structured profile
// extraction. This is the gap between "document grounding works for literal
// lookups" and "document grounding works for narrative synthesis."
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';

const env = {
  ...process.env, NATIVELY_E2E: '1', NODE_ENV: 'production',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  NATIVELY_CONTEXT_OS_EVIDENCE_PACK: '0', NATIVELY_OKF_KNOWLEDGE_PACKS: '0', NATIVELY_OKF_HYBRID_RETRIEVAL: '0',
  NATIVELY_CONTEXT_OS_PROMPT_AUDIT: '1', NATIVELY_INTELLIGENCE_TRACE: '1', NATIVELY_CONTEXT_OS_PROVIDER_CAPTURE: '1',
  OLLAMA_URL: 'http://127.0.0.1:1',
  NATIVELY_API_URL: 'http://localhost:3000',
};

const RESUME_CONTENT = fs.readFileSync('/tmp/ctxos-fixtures/resume.txt', 'utf8');

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
  const c = await api.modesCreate({ name: 'GoldenTrace Resume-as-RefDoc General', templateType: 'general' });
  return c.mode;
});
const contract = await RAW(async ({ id }) => (window.electronAPI || window.api).modesGetSourceContract(id), { id: mode.id });
await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });

await R('__e2e__:add-reference-file', { modeId: mode.id, fileName: 'marcus-holloway-resume.txt', content: RESUME_CONTENT });
await new Promise((r) => setTimeout(r, 6000)); // let indexing settle so this isn't confounded with H1

const ask = async (q) => {
  await R('__e2e__:context-os-prompt-audit-clear');
  const ans = await R('__e2e__:ask', { question: q, timeoutMs: 45000 });
  const audit = await R('__e2e__:context-os-prompt-audit');
  const last = (audit?.audit || [])[audit?.audit?.length - 1] || {};
  const text = ans?.answer || ans?.streamedTokens || '';
  return {
    question: q,
    answer: text.slice(0, 500),
    audit: last,
    isSafeRefusal: /could not find that in the retrieved sections/i.test(text),
    isGenericRefusal: /(don't have access|no (uploaded|attached) (document|file|source)|only respond from uploaded|can only answer from)/i.test(text),
    mentionsStripe: /stripe/i.test(text),
    mentionsDatadog: /datadog/i.test(text),
  };
};

const q1 = await ask('Walk me through this person\'s most recent role and what they achieved there.');
const q2 = await ask('What companies has this person worked at, in order?');
const q3 = await ask('What is this person\'s favorite programming language?'); // genuinely unanswerable — must safe-refuse

console.log('GOLDEN_TRACE_RESUME_REFDOC_BEGIN');
console.log(JSON.stringify({ contractSeed: { sourceAuthority: contract?.sourceAuthority }, q1, q2, q3 }, null, 2));
console.log('GOLDEN_TRACE_RESUME_REFDOC_END');
await app.close();
