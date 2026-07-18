// GOLDEN TRACE #15 (iteration 10): investigate the remaining 6 untraced
// confirmed false-refusal cases from the thesis benchmark (THESIS-072, 088,
// 091, 093, 129, 131) using the same 2-step methodology proven on THESIS-079/
// THESIS-094: (1) raw retrieval inspection via __e2e__:inspect-retrieval to
// check if the answer-bearing text is retrievable at all, (2) full manual-
// chat path trace with docgrounded-reason tagging to see whether the cap fix
// (already landed) resolved these too, or whether they need a different fix.
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
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
  const c = await api.modesCreate({ name: 'GoldenTrace ThesisBatch2', templateType: 'lecture' });
  return c.mode;
});
await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });

const upload = await R('__e2e__:upload-reference-file-from-path', { modeId: mode.id, filePath: thesisPath });
if (!upload?.success) { console.error('UPLOAD_FAILED', JSON.stringify(upload)); await app.close(); process.exit(1); }
let ready = false;
for (let i = 0; i < 30 && !ready; i++) {
  const status = await R('__e2e__:index-status', mode.id).catch(() => null);
  ready = status?.statuses?.every((s) => s.status === 'ready') ?? false;
  if (!ready) await new Promise((r) => setTimeout(r, 1000));
}

const askManual = async (question, timeoutMs = 60000) => {
  return await RAW(async ({ question, timeoutMs }) => {
    const api = window.electronAPI || window.api;
    return new Promise((resolve) => {
      let text = ''; let settled = false;
      const stop = () => { offToken?.(); offDone?.(); offError?.(); clearTimeout(timer); };
      const done = (result) => { if (settled) return; settled = true; stop(); resolve(result); };
      const offToken = api.onGeminiStreamToken((token) => { text += token; });
      const offDone = api.onGeminiStreamDone((payload) => done({ success: true, answer: payload?.finalText || text }));
      const offError = api.onGeminiStreamError((error) => done({ success: false, error: String(error), answer: text }));
      const timer = setTimeout(() => done({ success: false, timedOut: true, answer: text }), timeoutMs);
      api.streamGeminiChat(question, undefined, undefined, undefined).catch((error) => done({ success: false, error: String(error?.message || error), answer: text }));
    });
  }, { question, timeoutMs });
};

const questions = [
  { id: 'THESIS-072', q: 'Which two standards bodies identify robotics as a key vertical for 6G?', expectMarkers: ['ITU', '3GPP'] },
  { id: 'THESIS-088', q: 'Why was Open X-Embodiment insufficient for this thesis?', expectMarkers: ['dual-arm'] },
  { id: 'THESIS-091', q: 'What example instruction is given for the dataset template?', expectMarkers: ['yellow banana', 'red plate'] },
  { id: 'THESIS-093', q: 'What two objects are visible but never interacted with?', expectMarkers: ['apple', 'orange'] },
  { id: 'THESIS-129', q: 'What model is the visual backbone for the Self-Awareness Tool?', expectMarkers: ['Gemma 3 12B'] },
  { id: 'THESIS-131', q: 'What camera perspective does the Self-Awareness Tool use?', expectMarkers: ['Third-person'] },
];

const results = [];
for (const item of questions) {
  // Step 1: raw retrieval inspection
  const inspection = await R('__e2e__:inspect-retrieval', { modeId: mode.id, query: item.q, forceDocumentGrounding: true });
  const block = inspection?.block || '';
  const foundInRetrieval = item.expectMarkers.filter((m) => block.toLowerCase().includes(m.toLowerCase()));

  // Step 2: full manual-chat path
  await R('__e2e__:context-os-benchmark-audit-clear');
  const response = await askManual(item.q);
  const text = response?.answer || '';

  results.push({
    caseId: item.id,
    question: item.q,
    retrievalBlockLength: inspection?.blockLength,
    foundInRawRetrieval: foundInRetrieval,
    allFoundInRetrieval: foundInRetrieval.length === item.expectMarkers.length,
    fullPathAnswer: text.slice(0, 300),
    foundInFullPathAnswer: item.expectMarkers.filter((m) => text.toLowerCase().includes(m.toLowerCase())),
    isSafeRefusal: /could not find that in the retrieved sections|couldn't find that in the uploaded material/i.test(text),
  });
}

console.log('GOLDEN_TRACE_THESIS_BATCH2_BEGIN');
console.log(JSON.stringify(results, null, 2));
console.log('GOLDEN_TRACE_THESIS_BATCH2_END');
await app.close();
