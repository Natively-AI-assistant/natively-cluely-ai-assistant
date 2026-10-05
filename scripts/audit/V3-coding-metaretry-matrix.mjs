/**
 * Meta-reply detection matrix — LIVE (deepseek-v4-flash).
 *
 * Two questions, one run:
 *   Q1. Does the SHIPPED keyword detector (ipcHandlers.ts `looksMeta`) actually
 *       recognise a code-free meta-reply from a provider other than the one it
 *       was tuned against?
 *   Q2. Would a STRUCTURAL predicate — "coding turn produced no code fence" —
 *       do better, without firing on genuine answers?
 *
 * Both predicates are lifted verbatim from source. Every row is a real call.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/tmp/natively-land-wt';
const SRC = fs.readFileSync(path.join(REPO, 'electron/ipcHandlers.ts'), 'utf8');
const KEY = fs.readFileSync(path.join(REPO, '.env'), 'utf8')
  .split('\n').find((l) => l.startsWith('DEEPSEEK_API_KEY='))
  .split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
const MODEL = 'deepseek-v4-flash';

const lift = (anchor) => {
  const line = SRC.split('\n').find((l) => l.includes(anchor));
  // eslint-disable-next-line no-eval
  return eval(line.slice(line.indexOf('=') + 1, line.lastIndexOf('.test(')).trim());
};
const looksMetaRe = lift('const looksMeta =');
const hasFenceRe  = lift('const hasCodeFence =');

const CONTRACT = `You are a coding assistant. Follow <answer_contract> exactly.
<answer_contract>
Produce: ## Approach, a fenced code block, ## Complexity, ## Edge cases.
If the user's request is incomplete, say so and ask for the full problem.
</answer_contract>`;

const ask = async (user) => {
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL, temperature: 0, max_tokens: 3000,
      messages: [{ role: 'system', content: CONTRACT }, { role: 'user', content: user }],
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`);
  const j = await r.json();
  const c = j.choices[0];
  if (c.finish_reason === 'length') {
    throw new Error('output hit the token cap — a truncated answer would read as "no code" and make this measurement an artifact');
  }
  return c.message.content ?? '';
};

// expectCode=false => this SHOULD be caught as a meta-reply.
const CASES = [
  ['truncated request',      'Implement the function described above for the case where n is', false],
  ['refers to missing code', 'Fix the bug in the code I pasted earlier.',                      false],
  ['ambiguous referent',     'Write the function for the thing we discussed.',                 false],
  ['normal DSA question',    'Implement an LRU cache with O(1) get and put.',                  true ],
  ['the BFS phrasing',       'Write a BFS shortest-path function for an unweighted graph.',    true ],
];

console.log(`model=${MODEL}\n`);
console.log('case                     | code? | looksMeta | STRUCTURAL(no fence) | verdict');
console.log('-------------------------|-------|-----------|----------------------|--------');

let kwCaught = 0, structCaught = 0, structFalsePos = 0, metaTotal = 0, ok = 0;
for (const [name, q, expectCode] of CASES) {
  const out = await ask(q);
  const fence = hasFenceRe.test(out);
  const kw = looksMetaRe.test(out);
  const structural = !fence;                       // on a coding turn, no code == failure
  const isMeta = !expectCode;
  if (isMeta) {
    metaTotal++;
    if (kw && !fence) kwCaught++;
    if (structural) structCaught++;
  } else if (structural) {
    structFalsePos++;
  }
  const correct = isMeta ? structural : !structural;
  if (correct) ok++;
  console.log(
    `${name.padEnd(24)} | ${String(fence).padEnd(5)} | ${String(kw && !fence).padEnd(9)} | ${String(structural).padEnd(20)} | ${correct ? 'ok' : 'MISS'}`,
  );
}

console.log(`\nmeta-replies produced by the provider : ${metaTotal}`);
console.log(`  caught by the SHIPPED keyword gate  : ${kwCaught}/${metaTotal}`);
console.log(`  caught by the STRUCTURAL gate       : ${structCaught}/${metaTotal}`);
console.log(`genuine answers wrongly flagged       : ${structFalsePos}/${CASES.length - metaTotal}`);
console.log(`structural predicate correct overall  : ${ok}/${CASES.length}`);
