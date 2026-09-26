// benchmarks/coding-contract/followup.mjs
//
// Turn 2 of the reported session: the overlay answered a screenshot, the user
// typed `code?` in chat.
//
// Observed twice in the real app, same cause both times:
//   run 1 → a complete, confident BINARY SEARCH answer (a different problem)
//   run 2 → "Please provide the problem description or the function signature"
//
// `code` matches CODING_PATTERNS, so the turn routes coding and receives the
// full contract — with no problem attached, so the model either invents one or
// asks for one. The manual-chat prior-problem recall never ran: the V3 path
// returns ~500 lines before it, and it is gated on conversationMemoryV2
// (default OFF) anyway.
//
//   node benchmarks/coding-contract/followup.mjs [--baseline]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
for (const file of ['.env.local', '.env']) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('No GEMINI_API_KEY'); process.exit(1); }
const MODEL = process.env.E2E_GEMINI_MODEL || 'gemini-3.1-flash-lite';
const BASELINE = process.argv.includes('--baseline');

const dist = (rel) => path.join(ROOT, 'dist-electron/electron/llm', rel);
const { buildSystemPromptV2, buildTurnContentV2 } = await import(dist('promptSystemV2.js'));
const { planAnswer, isBareCodeRequest, isCodingContinuation, looksLikeCodingAnswer, buildPriorCodingContextBlock } = await import(dist('index.js'));
const { resolveCodingPromptSignals } = await import(dist('codingPromptSignals.js'));

// The prose answer the overlay actually produced for the Trapping Rain Water
// screenshot — verbatim from the user's session.
const PRIOR_ANSWER = `To solve this, you can use a two-pointer approach. Maintain pointers at both ends of the array and track the maximum height encountered from each side. At each step, move the pointer pointing to the smaller height, calculating the trapped water based on the difference between the current maximum and the bar's height.`;

const CASES = [
  { id: 'code?', message: 'code?' },
  { id: 'show me the code', message: 'show me the code' },
  { id: 'and the code?', message: 'and the code?' },
  // The exact fragment the user typed — a truncated "code answer". The phrase
  // regex missed it, so the turn again arrived with no problem attached and the
  // model produced a full Missing Number solution for a Trapping Rain Water screen.
  { id: 'code answe (typed fragment)', message: 'code answe' },
  { id: 'code answer', message: 'code answer' },
  // RICHER CONTINUATIONS (2026-08-19 "fix everything" round): these were still
  // un-bridged after an overlay answer — only bare-code was. Each must anchor to
  // the trapping-water prior turn, not re-solve or invent a problem.
  { id: 'complexity follow-up', message: 'what is the time and space complexity',
    grade: { mustContain: [/O\(/i, /trap|water|height|two.?pointer/i], code: false } },
  { id: 'dry run follow-up', message: 'dry run it with [0,1,0,2]',
    grade: { mustContain: [/0.*1.*0.*2/, /trap|water|height/i] } },
  { id: 'optimize follow-up', message: 'now do it with the brute force approach instead',
    grade: { mustContain: [/trap|water|height/i], code: true } },
];

// A follow-up that carries its OWN subject must NOT inherit the prior problem.
const CONTROL = { id: 'CONTROL — own subject', message: 'write code for binary search in python', ownSubject: true };

const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
async function ask(system, user) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'x-goog-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

const results = [];
for (const c of [...CASES, CONTROL]) {
  const plan = planAnswer({ question: c.message, source: 'manual_input', speakerPerspective: 'user' });
  const signals = resolveCodingPromptSignals({ answerType: plan.answerType, question: c.message });

  // Exactly what ipcHandlers' V3 personaBase now composes.
  let priorProblem = '';
  const bare = isBareCodeRequest(c.message);
  if (!BASELINE && (bare || isCodingContinuation(c.message))
      && (bare || looksLikeCodingAnswer(PRIOR_ANSWER))) {
    priorProblem = '\n\n' + buildPriorCodingContextBlock({
      userMessage: '(the question answered just before this one)',
      assistantAnswer: PRIOR_ANSWER,
    });
  }
  const signalsWithPrior = resolveCodingPromptSignals({
    answerType: plan.answerType, question: c.message, priorCodingTurnExists: !!priorProblem,
  });
  const system = buildSystemPromptV2({
    mode: 'general', action: 'answer', tier: 'cloud', chatSurface: true,
    codingTask: signalsWithPrior.codingTask || !!priorProblem,
    codingTaskKind: signalsWithPrior.codingTaskKind,
    codingFormat: (priorProblem && bare) ? 'code_only' : signalsWithPrior.codingFormat,
  }) + priorProblem;
  const user = buildTurnContentV2({ evidence: [], currentTurn: c.message });

  const answer = await ask(system, user);
  const failures = [];
  const hasCode = /```[\s\S]*?```/.test(answer);
  const asksForProblem = /provide the (problem|function|requirements)|which problem|what problem|share the/i.test(answer);

  if (asksForProblem) failures.push('asked the user to supply the problem');
  if (c.grade) {
    for (const re of c.grade.mustContain || []) if (!re.test(answer)) failures.push(`missing ${re}`);
    if (c.grade.code === true && !hasCode) failures.push('NO CODE');
  } else if (c.ownSubject) {
    if (!hasCode) failures.push('NO CODE');
    if (!/binary\s*search|low\s*[,+]|mid\s*=/i.test(answer)) failures.push('lost its OWN subject (binary search)');
  } else {
    if (!hasCode) failures.push('NO CODE');
    // Must be the problem the user is looking at, not a different one.
    if (!/trap|water|height|leftMax|left_max/i.test(answer)) failures.push('answered a DIFFERENT problem than the prior turn');
  }

  const pass = failures.length === 0;
  results.push({ id: c.id, pass, failures, answer });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${c.id}${pass ? '' : '  → ' + failures.join('; ')}`);
}

fs.writeFileSync(path.join(__dirname, 'followup-results.json'), JSON.stringify(results, null, 2));
const passed = results.filter((r) => r.pass).length;
console.log(`\n[followup] ${passed}/${results.length} pass${BASELINE ? '  (BASELINE — pre-fix)' : ''}`);
process.exit(passed === results.length ? 0 : 1);
