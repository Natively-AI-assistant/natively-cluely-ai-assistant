// GOLDEN TRACE #2 (grounding campaign, Phase 0): same scenario as
// golden-trace-refdoc.mjs but SIMULATING PRODUCTION FLAG DEFAULTS.
//
// Critical finding from trace #1: contextOsEvidencePackEnabled (and
// okfKnowledgePacks / okfHybridRetrieval) default to isInternalDevTestContext()
// = true only when NODE_ENV is 'test'/'development' or NATIVELY_INTERNAL=1.
// A real packaged app the founder runs does NOT set NODE_ENV=development, so
// these flags default OFF there. Our E2E harness (and the pre-existing
// _ks_realfixture_verify.mjs) both set NODE_ENV: 'development', which may be
// silently exercising a DIFFERENT, better-tested code path than what a real
// user hits. This trace explicitly forces the OFF defaults via env vars to
// probe the LEGACY (non-Context-OS-governed) retrieval path for the exact
// same "reference file attached to a mode + first question" scenario.
import { _electron as electron } from '@playwright/test';

const env = {
  ...process.env, NATIVELY_E2E: '1', NODE_ENV: 'production',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  // Explicitly force OFF the Context-OS governed flags a real packaged build
  // would default to OFF (isInternalDevTestContext() = false in production).
  NATIVELY_CONTEXT_OS_EVIDENCE_PACK: '0',
  NATIVELY_OKF_KNOWLEDGE_PACKS: '0',
  NATIVELY_OKF_HYBRID_RETRIEVAL: '0',
  NATIVELY_CONTEXT_OS_PROMPT_AUDIT: '1', // keep audit on so we can still SEE what happened
  NATIVELY_INTELLIGENCE_TRACE: '1',
  NATIVELY_CONTEXT_OS_PROVIDER_CAPTURE: '1',
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
const setModelResult = await RAW(async () => (window.electronAPI || window.api).setModel('natively'));
console.log('[setModel natively]', JSON.stringify(setModelResult));

const DOC_CONTENT = `# Internal Onboarding Guide — Project Aurora

## Section 1: Deployment Cadence
Project Aurora ships to production every Tuesday and Thursday at 2pm PT.
The release captain for the current sprint is Priya Chandrasekaran.

## Section 2: On-call Rotation
The on-call engineer for this week is Marcus Webb. Escalation path:
Marcus Webb -> Priya Chandrasekaran -> VP Engineering (Dana Ostrowski).

## Section 3: Database
Aurora's primary datastore is a sharded PostgreSQL 16 cluster with 12 shards.
The read-replica lag budget is 250ms p99.
`;

const mode = await RAW(async () => {
  const api = window.electronAPI || window.api;
  const c = await api.modesCreate({ name: 'GoldenTrace RefDoc Legacy Lecture', templateType: 'lecture' });
  return c.mode;
});
const contract = await RAW(async ({ id }) => (window.electronAPI || window.api).modesGetSourceContract(id), { id: mode.id });
await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });

const attachedAt = Date.now();
const addResult = await R('__e2e__:add-reference-file', { modeId: mode.id, fileName: 'aurora-onboarding.md', content: DOC_CONTENT });

const askAt = (label, delayMs) => async () => {
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  const fireAt = Date.now();
  await R('__e2e__:context-os-prompt-audit-clear');
  const indexStatus = await R('__e2e__:index-status', mode.id).catch(() => null);
  const ans = await R('__e2e__:ask', { question: 'Who is the on-call engineer this week, and what is the escalation path?', timeoutMs: 45000 });
  const audit = await R('__e2e__:context-os-prompt-audit');
  const last = (audit?.audit || [])[audit?.audit?.length - 1] || {};
  return {
    label,
    delaySinceAttachMs: fireAt - attachedAt,
    indexStatus,
    answer: (ans?.answer || ans?.streamedTokens || ''),
    audit: last,
    mentionsMarcusWebb: /marcus\s+webb/i.test(ans?.answer || ans?.streamedTokens || ''),
    mentionsPriya: /priya/i.test(ans?.answer || ans?.streamedTokens || ''),
    isSafeRefusal: /could not find that in the retrieved sections/i.test(ans?.answer || ans?.streamedTokens || ''),
    isGenericRefusal: /(don't have access|no (uploaded|attached) (document|file|source)|only respond from uploaded|can only answer from)/i.test(ans?.answer || ans?.streamedTokens || ''),
  };
};

const resultT0 = await askAt('t+0ms (immediately after attach)', 0)();
const resultT5 = await askAt('t+5000ms', 5000)();

const verdict = {
  contractSeed: { sourceAuthority: contract?.sourceAuthority, seededForTemplateType: contract?.seededForTemplateType },
  addResult: { fileId: addResult?.file?.id, indexStatusAfterAdd: addResult?.file?.indexStatus },
  t0: resultT0,
  t5: resultT5,
};
console.log('GOLDEN_TRACE_REFDOC_LEGACY_BEGIN');
console.log(JSON.stringify(verdict, null, 2));
console.log('GOLDEN_TRACE_REFDOC_LEGACY_END');
await app.close();
