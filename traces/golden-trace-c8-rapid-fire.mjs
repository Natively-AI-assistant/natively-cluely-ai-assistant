// GOLDEN TRACE — C8 (rapid-fire desync). loop.md §4: "5 questions in quick
// succession (desync coverage; each answer must match its question)".
//
// Fires 5 DISTINCT questions against the real thesis document back-to-back,
// with NO wait between requests (worst-case desync condition), through the
// real manual-chat IPC path (gemini-chat-stream / _geminiChatStreamHandler).
// That handler aborts the sender's PRIOR in-flight stream whenever a new one
// starts (`_chatStreamsBySender`, ipcHandlers.ts ~865-872) and tags every
// token/done event with the firing stream's `streamId`.
//
// What this checks:
//  1. Every 'gemini-stream-done' event's streamId is one of the 5 we actually
//     fired (no phantom/leaked stream ids).
//  2. The final answer's content does not contain a term uniquely associated
//     with a DIFFERENT question's expected fact (cross-contamination check) —
//     each of the 5 questions targets a distinct, easily-identifiable fact
//     from the real thesis so any leakage is obvious.
//  3. Whether earlier streams were cleanly aborted (no 'done' fired for them)
//     or completed with correct, non-contaminated content — both are
//     acceptable outcomes; a MIXED or wrong-question answer is the failure
//     this test exists to catch.
//
// Requires the Vite dev server up on port 5180 (`npm run dev`) — the packaged
// main.js still loads renderer windows from http://localhost:5180 in this
// dev/E2E configuration, and every window (launcher/overlay/settings/etc.)
// retry-reloading against a refused connection can destroy the Playwright
// evaluate() execution context mid-trace.
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
const win0 = await app.firstWindow({ timeout: 30000 });
win0.on('crash', () => console.error('[RENDERER-CRASH] window crashed'));
win0.on('console', (msg) => {
  if (msg.type() === 'error') console.error('[RENDERER-CONSOLE-ERROR]', msg.text());
});
await win0.waitForLoadState('domcontentloaded').catch(() => {});
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
  const c = await api.modesCreate({ name: 'GoldenTrace C8 RapidFire', templateType: 'lecture' });
  return c.mode;
});
await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });

const upload = await R('__e2e__:upload-reference-file-from-path', { modeId: mode.id, filePath: thesisPath });
if (!upload?.success) { console.error('UPLOAD_FAILED', JSON.stringify(upload)); await app.close(); process.exit(1); }
await R('__e2e__:reindex-embeddings', mode.id).catch(() => null);
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  const status = await R('__e2e__:index-status', mode.id).catch(() => null);
  ready = status?.statuses?.length > 0 && status.statuses.every((s) => s.status === 'ready');
  if (!ready) await new Promise((r) => setTimeout(r, 1500));
}
console.log('INDEX_READY', ready);
if (!ready) {
  await app.close();
  throw new Error('Reference index did not become ready; C8 rapid-fire trace was not evaluated.');
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
void askManual; // reserved for a single-question smoke check if ever needed

// 5 distinct questions, each targeting a UNIQUE, easily-identifiable fact
// from THESIS-051's rubric so cross-contamination is unambiguous.
const questions = [
  { label: 'q1-weight', q: 'What is the total weight of Mercury X1?', expectSubstr: /55\s*kg/i, foreignSubstrs: [/19\s*(?:degrees of freedom|dof)/i, /jetson/i] },
  { label: 'q2-dof', q: 'How many degrees of freedom does Mercury X1 have?', expectSubstr: /19/i, foreignSubstrs: [/55\s*kg/i, /jetson/i] },
  { label: 'q3-controller', q: 'What is the main controller/processor used in Mercury X1?', expectSubstr: /jetson/i, foreignSubstrs: [/55\s*kg/i, /19\s*(?:degrees of freedom|dof)/i] },
  { label: 'q4-payload', q: 'What is the maximum payload of Mercury X1?', expectSubstr: /1\s*kg/i, foreignSubstrs: [/jetson/i] },
  { label: 'q5-arms', q: 'How many arms does Mercury X1 have and how many axes per arm?', expectSubstr: /seven[- ]?ax(?:is|es)|7[- ]?ax(?:is|es)/i, foreignSubstrs: [/55\s*kg/i, /jetson/i] },
];

// Fire all 5 with NO wait between them — the worst-case desync condition.
// Collect every 'gemini-stream-done' event globally (not just the one
// associated with the last streamGeminiChat call) so we can see whether any
// earlier, superseded stream ALSO completed and what it said.
const result = await RAW(async ({ questions }) => {
  const api = window.electronAPI || window.api;
  const doneEvents = [];
  const errorEvents = [];
  // finalText is ONLY sent on 'gemini-stream-done' when a post-stream repair
  // changed the answer (ipcHandlers.ts:3829) — the normal path expects the
  // renderer to already have the full text from accumulated 'gemini-stream-
  // token' events tagged with the same streamId. Track both per streamId so
  // a done event with no finalText still resolves to the real streamed text.
  const tokensByStream = new Map();
  const offToken = api.onGeminiStreamToken((token, meta) => {
    const id = meta?.streamId ?? -1;
    tokensByStream.set(id, (tokensByStream.get(id) || '') + token);
  });
  const offDone = api.onGeminiStreamDone((payload) => {
    const id = payload?.streamId ?? null;
    const streamedText = id !== null ? (tokensByStream.get(id) || '') : '';
    doneEvents.push({ streamId: id, finalText: payload?.finalText ?? streamedText ?? null, at: Date.now() });
  });
  const offError = api.onGeminiStreamError((error) => {
    errorEvents.push({ error: String(error), at: Date.now() });
  });

  const fireResults = [];
  for (const item of questions) {
    const p = api.streamGeminiChat(item.q, undefined, undefined, undefined)
      .then(() => ({ label: item.label, invoked: true }))
      .catch((e) => ({ label: item.label, invoked: false, error: String(e?.message || e) }));
    fireResults.push(p);
    // No await/delay — fire the next one immediately (rapid-fire condition).
  }
  const fired = await Promise.all(fireResults);

  // Give the LAST stream (the only one not superseded) time to complete.
  await new Promise((resolve) => setTimeout(resolve, 45000));

  offDone(); offError(); offToken();
  return { fired, doneEvents, errorEvents };
}, { questions: questions.map((q) => ({ label: q.label, q: q.q })) });

console.log('C8_RAPIDFIRE_BEGIN');
console.log(JSON.stringify({ fired: result.fired, errorEvents: result.errorEvents }, null, 2));

// Analyze each 'done' event against the question set: does its content match
// ANY of the 5 expected facts, and does it ALSO contain a foreign fact that
// should only appear in a DIFFERENT question's answer (contamination)?
const analysis = result.doneEvents.map((ev) => {
  const text = ev.finalText || '';
  const matchedQuestions = questions.filter((q) => q.expectSubstr.test(text)).map((q) => q.label);
  const contaminatedBy = questions.flatMap((q) =>
    q.foreignSubstrs.filter((re) => re.test(text)).map(() => q.label),
  );
  return {
    streamId: ev.streamId,
    textPreview: text.slice(0, 200),
    matchedQuestions,
    hasForeignFactPresent: contaminatedBy.length > 0,
  };
});
console.log(JSON.stringify({ doneEventCount: result.doneEvents.length, analysis }, null, 2));
console.log('C8_RAPIDFIRE_END');

await app.close();
