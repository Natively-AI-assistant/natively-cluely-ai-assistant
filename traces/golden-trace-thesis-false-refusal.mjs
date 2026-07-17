// GOLDEN TRACE #13 (Phase 1 continuation, iteration 6): investigate the 8
// confirmed false-refusal cases from the existing 200q thesis benchmark
// (iteration 5, traces/forensic-report.md §6d) by inspecting RAW RETRIEVAL
// directly, bypassing the LLM generation step entirely. Uses the existing
// __e2e__:inspect-retrieval handler (buildRetrievedActiveModeContextBlockHybrid)
// against the real ingested thesis PDF to see whether the answer-bearing
// chunk is retrieved at all, and if so at what rank/confidence.
//
// Reuses the same parser-faithful upload path as
// tests/context-os-real-backend/run-200q-benchmark.mjs (ingestModeReferenceFile
// via __e2e__:upload-reference-file-from-path, gated on
// NATIVELY_E2E_REFERENCE_ROOT) so retrieval is exercised for real, not a
// synthetic fixture.
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const inputRoot = path.join(repoRoot, 'test-fixtures/modes-corpus/thesis');
const thesisPath = path.join(inputRoot, 'institutional_thesis.pdf');

const env = {
  ...process.env, NATIVELY_E2E: '1', NODE_ENV: 'development',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  NATIVELY_E2E_REFERENCE_ROOT: inputRoot,
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
  const c = await api.modesCreate({ name: 'GoldenTrace ThesisFalseRefusal', templateType: 'lecture' });
  return c.mode;
});
await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });

const upload = await R('__e2e__:upload-reference-file-from-path', { modeId: mode.id, filePath: thesisPath });
if (!upload?.success) {
  console.error('UPLOAD_FAILED', JSON.stringify(upload));
  await app.close();
  process.exit(1);
}
// Wait for indexing to fully settle before inspecting retrieval, per the
// existing benchmark runner's pattern.
let ready = false;
for (let i = 0; i < 30 && !ready; i++) {
  const status = await R('__e2e__:index-status', mode.id).catch(() => null);
  ready = status?.statuses?.every((s) => s.status === 'ready') ?? false;
  if (!ready) await new Promise((r) => setTimeout(r, 1000));
}

const questions = [
  { id: 'THESIS-072', q: 'Which two standards bodies identify robotics as a key vertical for 6G?', expectMarkers: ['ITU', '3GPP'] },
  { id: 'THESIS-079', q: 'What camera model was used for the USB camera views?', expectMarkers: ['Logitech C920'] },
  { id: 'THESIS-094', q: 'How many total episodes make up the Mercury X1 dataset?', expectMarkers: ['480'] },
];

const results = [];
for (const item of questions) {
  const inspection = await R('__e2e__:inspect-retrieval', { modeId: mode.id, query: item.q, forceDocumentGrounding: true });
  const block = inspection?.block || '';
  const foundMarkers = item.expectMarkers.filter((m) => block.includes(m));
  results.push({
    caseId: item.id,
    question: item.q,
    retrievalSuccess: inspection?.success,
    blockLength: inspection?.blockLength,
    retrievalConfidence: inspection?.retrievalConfidence,
    expectMarkers: item.expectMarkers,
    foundMarkersInRetrievedBlock: foundMarkers,
    allMarkersRetrieved: foundMarkers.length === item.expectMarkers.length,
    blockPreview: block.slice(0, 500),
  });
}

console.log('GOLDEN_TRACE_THESIS_FALSE_REFUSAL_BEGIN');
console.log(JSON.stringify(results, null, 2));
console.log('GOLDEN_TRACE_THESIS_FALSE_REFUSAL_END');
await app.close();
