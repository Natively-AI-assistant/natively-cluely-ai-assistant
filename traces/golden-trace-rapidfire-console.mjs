// GOLDEN TRACE #12: same rapid-fire desync scenario as
// golden-trace-rapidfire-desync.mjs but capturing main-process console output
// AND the raw __e2e__:ask response objects in full, to understand the
// mechanism (event-listener cross-talk between overlapping
// im.handleSuggestionTrigger calls, vs a shared engine-reset race, vs
// something else).
import { _electron as electron } from '@playwright/test';

const env = {
  ...process.env, NATIVELY_E2E: '1', NODE_ENV: 'production',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test',
  NATIVELY_CONTEXT_OS_EVIDENCE_PACK: '0', NATIVELY_OKF_KNOWLEDGE_PACKS: '0', NATIVELY_OKF_HYBRID_RETRIEVAL: '0',
  NATIVELY_CONTEXT_OS_PROMPT_AUDIT: '1', NATIVELY_INTELLIGENCE_TRACE: '1',
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

const DOC_CONTENT = `# Team Directory & Facts

Fact A: The database migration deadline is October 3rd.
Fact B: The team's mascot is a red panda named Biscuit.
Fact C: The office wifi password is "GreenTurtle42".
`;

const mode = await RAW(async () => {
  const api = window.electronAPI || window.api;
  const c = await api.modesCreate({ name: 'GoldenTrace RapidFireConsole Lecture', templateType: 'lecture' });
  return c.mode;
});
await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });
await R('__e2e__:add-reference-file', { modeId: mode.id, fileName: 'team-facts.md', content: DOC_CONTENT });
await new Promise((r) => setTimeout(r, 3000));

mainLogs.length = 0;
const questions = [
  'What is the database migration deadline?',
  "What is the team's mascot's name?",
  'What is the office wifi password?',
];
const promises = questions.map((q) => R('__e2e__:ask', { question: q, timeoutMs: 45000 }));
const results = await Promise.all(promises);
await new Promise((r) => setTimeout(r, 500));

console.log('GOLDEN_TRACE_RAPIDFIRE_CONSOLE_BEGIN');
console.log('RAW RESULTS:', JSON.stringify(results, null, 2));
console.log('--- MAIN PROCESS LOGS ---');
console.log(mainLogs.join(''));
console.log('GOLDEN_TRACE_RAPIDFIRE_CONSOLE_END');
await app.close();
