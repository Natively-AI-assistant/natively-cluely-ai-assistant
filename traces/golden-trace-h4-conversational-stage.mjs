// H4 forensic: capture only the conversational question's pre-dispatch stages.
// E2E-only stage logs are enabled by NATIVELY_H4_STAGE_TRACE and removed after
// the live trace pins the stalled stage.
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const inputRoot = path.join(repoRoot, 'test-fixtures/modes-corpus/thesis');
const thesisPath = path.join(inputRoot, 'institutional_thesis.pdf');
const question = 'Hey, do you know how much Mercury X1 weighs?';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-h4-stage-'));

const env = {
  ...process.env,
  NATIVELY_E2E: '1',
  NODE_ENV: 'development',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
  NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  NATIVELY_E2E_REFERENCE_ROOT: inputRoot,
  NATIVELY_CONTEXT_OS_PROMPT_AUDIT: '1',
  NATIVELY_CONTEXT_OS_PROVIDER_CAPTURE: '1',
  NATIVELY_CONTEXT_OS_BENCHMARK_AUDIT: '1',
  NATIVELY_INTELLIGENCE_TRACE: '1',
  NATIVELY_H4_STAGE_TRACE: '1',
  OLLAMA_URL: 'http://127.0.0.1:1',
  NATIVELY_API_URL: 'http://localhost:3000',
};

const app = await electron.launch({
  args: ['dist-electron/electron/main.js', `--user-data-dir=${userDataDir}`],
  env: { ...env, NATIVELY_TEST_USERDATA: userDataDir },
  timeout: 60000,
});
const mainLogs = [];
app.process().stdout?.on('data', (data) => mainLogs.push(data.toString()));
app.process().stderr?.on('data', (data) => mainLogs.push(data.toString()));
await app.firstWindow({ timeout: 30000 });
await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});

const raw = async (fn, arg) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const window = app.windows()[0] || await app.firstWindow();
      await window.waitForLoadState('domcontentloaded').catch(() => {});
      return await window.evaluate(fn, arg);
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1800));
    }
  }
};
const invoke = (channel, ...args) => raw(
  async ({ channel, args }) => (window.electronAPI || window.api).e2eInvoke(channel, ...args),
  { channel, args },
);
const askManual = (text, timeoutMs = 60000) => raw(async ({ text, timeoutMs }) => {
  const api = window.electronAPI || window.api;
  return new Promise((resolve) => {
    let answer = ''; let settled = false;
    const stop = () => { offToken?.(); offDone?.(); offError?.(); clearTimeout(timer); };
    const done = (result) => { if (!settled) { settled = true; stop(); resolve(result); } };
    const offToken = api.onGeminiStreamToken((token) => { answer += token; });
    const offDone = api.onGeminiStreamDone((payload) => done({ success: true, answer: payload?.finalText || answer }));
    const offError = api.onGeminiStreamError((error) => done({ success: false, error: String(error), answer }));
    const timer = setTimeout(() => done({ success: false, timedOut: true, answer }), timeoutMs);
    api.streamGeminiChat(text, undefined, undefined, undefined)
      .catch((error) => done({ success: false, error: String(error?.message || error), answer }));
  });
}, { text, timeoutMs });

await invoke('__e2e__:enable-pro').catch(() => {});
await raw(async () => (window.electronAPI || window.api).setModel('natively'));
const mode = await raw(async () => (await (window.electronAPI || window.api)
  .modesCreate({ name: 'GoldenTrace H4 Conversational Stage', templateType: 'lecture' })).mode);
await raw(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });
const upload = await invoke('__e2e__:upload-reference-file-from-path', { modeId: mode.id, filePath: thesisPath });
if (!upload?.success) throw new Error(`UPLOAD_FAILED ${JSON.stringify(upload)}`);
for (let attempt = 0; attempt < 30; attempt++) {
  const status = await invoke('__e2e__:index-status', mode.id).catch(() => null);
  if (status?.statuses?.every((item) => item.status === 'ready')) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

await invoke('__e2e__:context-os-prompt-audit-clear');
await invoke('__e2e__:context-os-benchmark-audit-clear');
await app.evaluate(() => { globalThis.__contextOsProviderPayloadCapture = []; });
const startedAt = Date.now();
const response = await askManual(question);
await new Promise((resolve) => setTimeout(resolve, 500));
const promptAudit = await invoke('__e2e__:context-os-prompt-audit');
const benchmarkAudit = await invoke('__e2e__:context-os-benchmark-audit');
const providerPayloads = await app.evaluate(() => globalThis.__contextOsProviderPayloadCapture || []);
const stageLogs = mainLogs.join('').split('\n').filter((line) =>
  line.includes('[TRACE:H4-STAGE]') || line.includes('[TRACE:H4-RESOLVER]') || line.includes('[TRACE:H4-HYBRID]'),
);

console.log('H4_CONVERSATIONAL_STAGE_BEGIN');
console.log(JSON.stringify({ question, elapsedMs: Date.now() - startedAt, response, promptAudit, benchmarkAudit, providerPayloadCount: providerPayloads.length, stageLogs }, null, 2));
console.log('H4_CONVERSATIONAL_STAGE_END');
await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
