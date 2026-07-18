// GOLDEN TRACE — H4 (routing dead zone). loop.md §2.2 H4: "The question
// classifier/router sends certain questions down a 'no knowledge' or
// 'general chat' branch that never calls retrieval. Previously pinned as
// broken routing dead zones. Test with 10 phrasings of the same answerable
// question; log which branch each takes."
//
// Uses THESIS-051's confirmed-answerable fact (Mercury X1's total weight,
// "55 kg", Table 1 p17) with 10 different phrasings — direct factual,
// conversational, imperative, indirect, embedded-in-context, terse, verbose,
// and a couple of edge-case phrasings that could plausibly get misrouted to
// a "general chat"/no-retrieval branch. Logs the ACTUAL manual-chat surface
// behavior for each: whether the typed EvidencePack governed the turn
// (retrieval happened) and whether the answer contains the required fact.
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
  const c = await api.modesCreate({ name: 'GoldenTrace H4 RoutingDeadZone', templateType: 'lecture' });
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

// 10 phrasings of the SAME answerable fact (Mercury X1 total weight = 55 kg).
const phrasings = [
  { label: 'direct-factual', q: 'What is the total weight of Mercury X1?' },
  { label: 'conversational', q: 'Hey, do you know how much Mercury X1 weighs?' },
  { label: 'imperative', q: 'Tell me the weight of the Mercury X1 robot.' },
  { label: 'indirect', q: "I'm curious about the Mercury X1 — what's its weight?" },
  { label: 'embedded-in-context', q: 'For the spec sheet I\'m building, I need the total weight figure for Mercury X1 — what is it?' },
  { label: 'terse', q: 'Mercury X1 weight?' },
  { label: 'verbose', q: 'Could you please look through the uploaded thesis document and let me know what the total weight specification is for the Mercury X1 humanoid robot platform?' },
  { label: 'small-talk-prefix', q: "That's interesting. Anyway, what's the total weight of Mercury X1?" },
  { label: 'comparison-framed', q: 'Compared to other robots, how much does Mercury X1 weigh?' },
  { label: 'follow-up-style', q: 'And its weight?' },
];

const results = [];
for (const item of phrasings) {
  await R('__e2e__:context-os-prompt-audit-clear');
  const response = await askManual(item.q);
  const audit = await R('__e2e__:context-os-prompt-audit');
  const auditEntry = audit?.audit?.[audit.audit.length - 1];
  const hasFact = /55\s*kg/i.test(response?.answer || '');
  results.push({
    label: item.label,
    question: item.q,
    answer: (response?.answer || '').slice(0, 200),
    governedByTypedPack: auditEntry?.governedByTypedPack ?? null,
    hasTypedEvidencePack: auditEntry?.hasTypedEvidencePack ?? null,
    hasRawUploadedReference: auditEntry?.hasRawUploadedReference ?? null,
    factualBlockCount: auditEntry?.factualBlockCount ?? null,
    hasFact,
  });
}

console.log('H4_ROUTING_DEADZONE_BEGIN');
console.log(JSON.stringify(results, null, 2));
console.log('H4_ROUTING_DEADZONE_END');

await app.close();
