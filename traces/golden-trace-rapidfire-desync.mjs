// GOLDEN TRACE #11 (H8 — double execution / question-answer desync): fires
// several DISTINCT questions in quick, overlapping succession (not waiting for
// settle) through the real WTA path, to check whether an answer ever attaches
// to the WRONG question — the founder's "answers a completely different
// question" symptom. Each question asks about a DIFFERENT, uniquely-
// identifiable fact from the same reference document, so a correct answer for
// question N must mention ONLY fact N, never fact M (M != N). Uses the same
// real-Electron + real-MiniMax-M3 setup as prior traces.
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
Fact D: The quarterly all-hands is scheduled for the first Friday of each quarter.
`;

const mode = await RAW(async () => {
  const api = window.electronAPI || window.api;
  const c = await api.modesCreate({ name: 'GoldenTrace RapidFire Lecture', templateType: 'lecture' });
  return c.mode;
});
await RAW(async ({ id }) => (window.electronAPI || window.api).modesSetActive(id), { id: mode.id });
await R('__e2e__:add-reference-file', { modeId: mode.id, fileName: 'team-facts.md', content: DOC_CONTENT });
await new Promise((r) => setTimeout(r, 3000)); // let indexing settle so this tests desync, not H1

const questions = [
  { q: 'What is the database migration deadline?', expectMarker: /october\s*3/i, wrongMarkers: [/biscuit/i, /greenturtle/i, /first friday/i] },
  { q: "What is the team's mascot's name?", expectMarker: /biscuit/i, wrongMarkers: [/october\s*3/i, /greenturtle/i, /first friday/i] },
  { q: 'What is the office wifi password?', expectMarker: /greenturtle/i, wrongMarkers: [/october\s*3/i, /biscuit/i, /first friday/i] },
];

// Fire all three in OVERLAPPING flight (do not await between sends) — this is
// the stress condition for H8 (double execution / desync). Each E2E __e2e__:ask
// call resets the engine internally (per its own comment: "clear engine +
// session state before each independent ask"), so this specifically tests
// whether overlapping resets cause cross-wiring, not whether resets exist.
const promises = questions.map((item) => R('__e2e__:ask', { question: item.q, timeoutMs: 45000 }));
const results = await Promise.all(promises);

const analysis = results.map((res, i) => {
  const text = res?.answer || res?.streamedTokens || '';
  const item = questions[i];
  return {
    askedQuestion: item.q,
    returnedQuestionField: res?.question,
    questionFieldMatches: res?.question === item.q,
    answerPreview: text.slice(0, 150),
    hasCorrectFact: item.expectMarker.test(text),
    hasWrongFact: item.wrongMarkers.some((re) => re.test(text)),
  };
});

console.log('GOLDEN_TRACE_RAPIDFIRE_BEGIN');
console.log(JSON.stringify({ analysis }, null, 2));
console.log('GOLDEN_TRACE_RAPIDFIRE_END');
await app.close();
