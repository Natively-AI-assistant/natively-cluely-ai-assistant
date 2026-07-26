// Context OS — REAL Electron E2E: WTA clarification short-circuit (Phase 5).
// A general-mode ambiguous "project phases" question with reference files +
// profile + transcript all plausible must CLARIFY (not answer), and must NOT
// call the provider. Runs with contextOsPropertyValidation ON.

import { _electron as electron } from '@playwright/test';

const THESIS = `The project described here is AgenticVLA. The work consists of four main phases: data preparation, model fine-tuning, agent integration, and evaluation.`;

const env = {
  ...process.env, NATIVELY_E2E: '1', NODE_ENV: 'development',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  NATIVELY_CONTEXT_OS: '1', NATIVELY_CONTEXT_OS_WTA: '1', NATIVELY_CONTEXT_OS_MANUAL_CHAT: '1',
  NATIVELY_CONTEXT_OS_PROPERTY_VALIDATION: '1', // arm the clarify short-circuit
  NATIVELY_INTELLIGENCE_TRACE: '1', OLLAMA_URL: 'http://127.0.0.1:1',
};

const traces = [];
const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 60000 });
app.process().stdout.on('data', (d) => {
  for (const line of d.toString().split('\n')) {
    const i = line.indexOf('[CONTEXT-OS] ');
    if (i !== -1) { try { traces.push(JSON.parse(line.slice(i + 13).trim())); } catch {} }
  }
});
await app.firstWindow({ timeout: 30000 });
await app.windows()[0].waitForLoadState('domcontentloaded').catch(() => {});
const RAW = async (fn, arg) => {
  for (let a = 0; a < 4; a++) {
    try { const w = app.windows()[0] || await app.firstWindow(); await w.waitForLoadState('domcontentloaded').catch(() => {}); return await w.evaluate(fn, arg); }
    catch (e) { if (a === 3) throw e; await new Promise((r) => setTimeout(r, 1500)); }
  }
};
const R = (ch, ...a) => RAW(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });
await R('__e2e__:enable-pro').catch(() => {});

// A GENERAL mode (built-in) with reference files present AND a profile → the
// kernel resolves 'clarify' for an ambiguous "project phases" question.
const modeId = await RAW(async () => {
  const api = window.electronAPI || window.api;
  const c = await api.modesCreate({ name: 'General Clarify Verif', templateType: 'general' });
  await api.modesSetActive(c.mode.id);
  return c.mode.id;
});
await R('__e2e__:add-reference-file', { modeId, fileName: 'thesis.pdf', content: THESIS, pageCount: 2 });

traces.length = 0;
const ans = await R('__e2e__:ask', { question: 'What are the project phases?', timeoutMs: 40000 });
const answer = (ans?.answer || ans?.streamedTokens || '');

const verdict = {
  answer_preview: answer.slice(0, 300),
  is_clarification: /do you mean|which project do you mean|point me at/i.test(answer),
  offers_document: /uploaded document/i.test(answer),
  leaks_doc_phases: /data preparation|fine.?tun|agent integration/i.test(answer),
  trace_source_owner: traces.map((t) => t.sourceOwner),
  trace_final_action: traces.map((t) => t.finalAction),
};
console.log('CTXOS_CLARIFY_BEGIN');
console.log(JSON.stringify(verdict, null, 2));
console.log('CTXOS_CLARIFY_END');
await app.close().catch(() => {});
console.log('CLOSED');
