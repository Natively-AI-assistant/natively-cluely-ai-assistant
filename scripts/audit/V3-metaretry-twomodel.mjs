/**
 * Meta-reply detection — TWO-MODEL live evidence.
 *   deepseek-v4-flash   (DeepSeek)
 *   gemini-3.1-flash-lite (Google) — this project's default cloud model
 *
 * Tests whether the finding generalises:
 *   Q1. Does the SHIPPED keyword detector (ipcHandlers.ts `looksMeta`) catch a
 *       code-free meta-reply from EITHER provider?
 *   Q2. Does the STRUCTURAL predicate (coding turn -> no closed code fence)
 *       catch them, WITHOUT firing on genuine coding answers?
 *
 * Both predicates are lifted verbatim from source. Every cell is a real call.
 * Any response that hits the token cap is reported as TRUNC and excluded from
 * scoring — a cut-off answer reads as "no code" and would fake a positive.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/tmp/natively-land-wt';
const SRC = fs.readFileSync(path.join(REPO, 'electron/ipcHandlers.ts'), 'utf8');
const env = fs.readFileSync(path.join(REPO, '.env'), 'utf8');
const key = (n) => env.split('\n').find((l) => l.startsWith(n + '='))
  .split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
const DS = key('DEEPSEEK_API_KEY');
const GM = key('GEMINI_API_KEY');

const lift = (anchor) => {
  const line = SRC.split('\n').find((l) => l.includes(anchor));
  // eslint-disable-next-line no-eval
  return eval(line.slice(line.indexOf('=') + 1, line.lastIndexOf('.test(')).trim());
};
const looksMetaRe = lift('const looksMeta =');
const hasFenceRe  = lift('const hasCodeFence =');

// REFINED structural predicate. Bare "no closed fence" misses a meta-reply that
// emits an EMPTY/placeholder fence to satisfy the contract's shape: measured on
// deepseek-v4-flash, "Fix the bug in the code I pasted earlier" produced a fence
// in 2/5 runs, with fence bodies of 21-22 chars and 0/5 runs containing real
// code. So the signal is not "is there a fence" but "is there any CODE in it".
const MIN_CODE_BODY = 40;
function fenceBodyChars(text) {
  let max = 0;
  for (const m of text.matchAll(/```[a-zA-Z0-9_+\-]*\n([\s\S]*?)```/g)) {
    max = Math.max(max, (m[1] ?? '').trim().length);
  }
  return max;
}
const producedCode = (text) => hasFenceRe.test(text) && fenceBodyChars(text) >= MIN_CODE_BODY;

const CONTRACT = `You are a coding assistant. Follow <answer_contract> exactly.
<answer_contract>
Produce: ## Approach, a fenced code block, ## Complexity, ## Edge cases.
If the user's request is incomplete, say so and ask for the full problem.
</answer_contract>`;

const TRUNC = Symbol('truncated');

async function deepseek(user) {
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DS}` },
    body: JSON.stringify({ model: 'deepseek-v4-flash', temperature: 0, max_tokens: 3000,
      messages: [{ role: 'system', content: CONTRACT }, { role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error(`deepseek HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const c = (await r.json()).choices[0];
  return c.finish_reason === 'length' ? TRUNC : (c.message.content ?? '');
}

async function gemini(user) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GM}`;
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: CONTRACT }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 3000 },
    }),
  });
  if (!r.ok) throw new Error(`gemini HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const cand = (await r.json()).candidates?.[0];
  if (!cand) return '';
  if (cand.finishReason === 'MAX_TOKENS') return TRUNC;
  return (cand.content?.parts ?? []).map((p) => p.text ?? '').join('');
}

// expectCode=false => a correct system MUST catch this as a non-answer.
const CASES = [
  ['truncated request',       'Implement the function described above for the case where n is', false],
  ['code never pasted',       'Fix the bug in the code I pasted earlier.',                      false],
  ['ambiguous referent',      'Write the function for the thing we discussed.',                 false],
  ['missing spec',            'Optimise it.',                                                   false],
  ['dangling constraint',     'Rewrite the sort so that it handles the case where',             false],
  ['LRU cache',               'Implement an LRU cache with O(1) get and put.',                  true ],
  ['BFS shortest path',       'Write a BFS shortest-path function for an unweighted graph.',    true ],
  ['level order traversal',   'Given a binary tree, return its level order traversal.',         true ],
  ['two sum',                 'Solve two sum and give the complexity.',                         true ],
  ['debounce',                'Implement a debounce function in JavaScript.',                   true ],
];

const MODELS = [['deepseek-v4-flash', deepseek], ['gemini-3.1-flash-lite', gemini]];
const tally = {};

for (const [modelName, call] of MODELS) {
  console.log(`\n=== ${modelName} ===`);
  console.log('case                   | expect | fence | body  | looksMeta | STRUCTURAL | verdict');
  console.log('-----------------------|--------|-------|-------|-----------|------------|--------');
  const t = { kwCaught: 0, structCaught: 0, metaN: 0, fp: 0, codeN: 0, trunc: 0 };
  for (const [name, q, expectCode] of CASES) {
    let out;
    try { out = await call(q); } catch (e) { console.log(`${name.padEnd(22)} | ERROR ${e.message}`); continue; }
    if (out === TRUNC) { t.trunc++; console.log(`${name.padEnd(22)} | ${(expectCode?'code':'meta').padEnd(6)} | TRUNC — excluded from scoring`); continue; }
    const fence = hasFenceRe.test(out);
    const body = fenceBodyChars(out);
    const kw = looksMetaRe.test(out) && !fence;
    const structural = !producedCode(out);   // refined: no fence OR no code in it
    if (expectCode) { t.codeN++; if (structural) t.fp++; }
    else { t.metaN++; if (kw) t.kwCaught++; if (structural) t.structCaught++; }
    const correct = expectCode ? !structural : structural;
    console.log(`${name.padEnd(22)} | ${(expectCode?'code':'meta').padEnd(6)} | ${String(fence).padEnd(5)} | ${String(body).padEnd(5)} | ${String(kw).padEnd(9)} | ${String(structural).padEnd(10)} | ${correct?'ok':'MISS'}`);
  }
  tally[modelName] = t;
}

console.log('\n================ SUMMARY ================');
for (const [m, t] of Object.entries(tally)) {
  console.log(`\n${m}`);
  console.log(`  meta-replies produced          : ${t.metaN}/5`);
  console.log(`  caught by SHIPPED keyword gate : ${t.kwCaught}/${t.metaN}`);
  console.log(`  caught by STRUCTURAL gate      : ${t.structCaught}/${t.metaN}`);
  console.log(`  genuine answers false-flagged  : ${t.fp}/${t.codeN}`);
  console.log(`  truncated (excluded)           : ${t.trunc}`);
}
