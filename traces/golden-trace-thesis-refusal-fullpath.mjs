// GOLDEN TRACE #14: for THESIS-079/THESIS-094, retrieval WAS confirmed
// correct (golden-trace-thesis-false-refusal.mjs showed the answer-bearing
// text IS in the retrieved block). This traces the FULL manual-chat path
// (the same askManual/streamGeminiChat the real benchmark uses) for these
// exact questions, on a FRESH mode + FRESH ask each (no accumulated
// conversation history, unlike the real 140-question benchmark run which
// asks all questions in one continuous session) to see whether the model
// still refuses despite having real evidence, or whether this only
// reproduces under a longer conversation history (context dilution).
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
  NATIVELY_CONTEXT_OS_PROVIDER_CAPTURE: '1',
  NATIVELY_TRACE_EVIDENCE_SELECTION: '1',
  OLLAMA_URL: 'http://127.0.0.1:1',
  NATIVELY_API_URL: 'http://localhost:3000',
};

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 60000 });
const mainLogs = [];
app.process().stdout?.on('data', (d) => { mainLogs.push(d.toString()); });
app.process().stderr?.on('data', (d) => { mainLogs.push(d.toString()); });
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
  const c = await api.modesCreate({ name: 'GoldenTrace ThesisFullPath', templateType: 'lecture' });
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
  { id: 'THESIS-079', q: 'What camera model was used for the USB camera views?', expectMarkers: ['Logitech C920'] },
  { id: 'THESIS-094', q: 'How many total episodes make up the Mercury X1 dataset?', expectMarkers: ['480'] },
];

const results = [];
for (const item of questions) {
  await R('__e2e__:context-os-benchmark-audit-clear');
  await R('__e2e__:context-os-prompt-audit-clear');
  mainLogs.length = 0;
  const response = await askManual(item.q);
  await new Promise((r) => setTimeout(r, 500));
  const relevantLogs = mainLogs.filter((l) => l.includes('TRACE:docgrounded') || l.includes('DocGrounded') || l.includes('TRACE:evidence-selection'));
  const audit = await R('__e2e__:context-os-benchmark-audit');
  const records = audit?.records || [];
  const terminal = records.at(-1) || null;
  const text = response?.answer || '';
  results.push({
    caseId: item.id,
    question: item.q,
    answer: text,
    isSafeRefusal: /could not find that in the retrieved sections/i.test(text),
    foundMarkers: item.expectMarkers.filter((m) => text.includes(m)),
    terminalAnswerPolicy: terminal?.answerPolicy,
    terminalPackItemCount: terminal?.pack?.items?.length,
    terminalPromptSources: terminal?.promptSources,
    relevantMainLogs: relevantLogs.join(''),
  });
}

console.log('GOLDEN_TRACE_THESIS_FULLPATH_BEGIN');
console.log(JSON.stringify(results, null, 2));
console.log('GOLDEN_TRACE_THESIS_FULLPATH_END');
await app.close();
