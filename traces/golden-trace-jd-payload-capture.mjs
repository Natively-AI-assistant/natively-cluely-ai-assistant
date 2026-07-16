// GOLDEN TRACE #6: capture the EXACT provider payload for the JD-requirements
// question from trace #5, to see the literal evidence block (or lack of one)
// that produced a hallucinated generic answer instead of grounding in the
// real fixture JD ("AI Product Engineer @ Helio Labs... LLM prompt
// engineering, streaming UIs, and Postgres").
//
// Uses Playwright _electron's app.evaluate() to read
// globalThis.__contextOsProviderPayloadCapture directly in the MAIN process
// (captureProviderPayload in electron/llm/providerPayloadCapture.ts pushes to
// a main-process global — the renderer's globalThis is a different context).
import { _electron as electron } from '@playwright/test';

const env = {
  ...process.env, NATIVELY_E2E: '1', NODE_ENV: 'production',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  NATIVELY_CONTEXT_OS_EVIDENCE_PACK: '0', NATIVELY_OKF_KNOWLEDGE_PACKS: '0', NATIVELY_OKF_HYBRID_RETRIEVAL: '0',
  NATIVELY_CONTEXT_OS_PROMPT_AUDIT: '1', NATIVELY_INTELLIGENCE_TRACE: '1',
  NATIVELY_CONTEXT_OS_PROVIDER_CAPTURE: '1', // MUST be paired with NATIVELY_E2E=1 (see providerPayloadCapture.ts enabled())
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
  const c = await api.modesCreate({ name: 'GoldenTrace JD Payload Capture TI', templateType: 'technical-interview' });
  return c.mode;
});
await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });

await R('__e2e__:ingest-profile-doc', { filePath: '/tmp/ctxos-fixtures/resume.txt', docType: 'resume' });
await R('__e2e__:ingest-profile-doc', { filePath: '/tmp/ctxos-fixtures/jd.txt', docType: 'jd' });

// Clear capture ring right before asking so we only see this turn's payload.
await app.evaluate(({ }) => {
  const g = globalThis;
  g.__contextOsProviderPayloadCapture = [];
});

const ans = await R('__e2e__:ask', { question: 'What are the key requirements of this role according to the JD?', timeoutMs: 45000 });

const capture = await app.evaluate(({ }) => {
  const g = globalThis;
  return Array.isArray(g.__contextOsProviderPayloadCapture) ? g.__contextOsProviderPayloadCapture : [];
});

console.log('GOLDEN_TRACE_JD_PAYLOAD_BEGIN');
console.log(JSON.stringify({ answer: ans?.answer, captureCount: capture.length, capture }, null, 2));
console.log('GOLDEN_TRACE_JD_PAYLOAD_END');
await app.close();
