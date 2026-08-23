/**
 * V3 coding meta-retry gap — LIVE probe (deepseek-v4-flash).
 *
 * CLAIM UNDER TEST: on the default Context Intelligence V3 manual-chat path,
 * a coding turn whose model output is a META-REPLY (no code) ships to the user
 * as-is, because V3 short-circuits (ipcHandlers.ts:1420) before the legacy
 * CODE-META RETRY at ipcHandlers.ts:3584.
 *
 * Method — nothing here is paraphrased:
 *   1. The two detection predicates are EXTRACTED VERBATIM from ipcHandlers.ts.
 *   2. A real coding turn is sent to deepseek-v4-flash under a prompt shaped
 *      like the condition that originally triggered this (a contract plus a
 *      user message that looks truncated).
 *   3. The REAL predicates are run over the REAL output.
 *   4. The V3 block's source is scanned for any equivalent gate.
 *   5. If a meta-reply is produced, the legacy regen prompt is sent to prove the
 *      retry actually recovers code (i.e. the guard is worth having).
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/tmp/natively-land-wt';
const SRC = fs.readFileSync(path.join(REPO, 'electron/ipcHandlers.ts'), 'utf8');
const KEY = fs.readFileSync(path.join(REPO, '.env'), 'utf8')
  .split('\n').find((l) => l.startsWith('DEEPSEEK_API_KEY='))
  .split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
const MODEL = 'deepseek-v4-flash';

// ── 1. Lift the SHIPPED predicates out of source ────────────────────────────
const lift = (label, anchor) => {
  const line = SRC.split('\n').find((l) => l.includes(anchor));
  if (!line) throw new Error(`could not lift ${label}`);
  const body = line.slice(line.indexOf('=') + 1, line.lastIndexOf('.test(')).trim();
  console.log(`[probe] ${label} (from source): ${body.slice(0, 96)}${body.length > 96 ? '…' : ''}`);
  // eslint-disable-next-line no-eval
  return eval(body);
};
const looksMetaRe = lift('looksMeta ', 'const looksMeta =');
const hasFenceRe  = lift('hasCodeFence', 'const hasCodeFence =');

const ask = async (messages, tag) => {
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0, max_tokens: 900 }),
  });
  if (!r.ok) throw new Error(`${tag}: HTTP ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.choices[0].message.content ?? '';
};

// ── 2. A real coding turn under the triggering condition ────────────────────
// The contract language + an apparently-truncated question is what made the
// provider answer ABOUT the request instead of answering it.
const CONTRACT = `You are a coding assistant. Follow <answer_contract> exactly.
<answer_contract>
Produce: ## Approach, a fenced code block, ## Complexity, ## Edge cases.
If the user's request is incomplete, say so and ask for the full problem.
</answer_contract>`;
const TRUNCATED_ASK = 'Implement the function described above for the case where n is';

console.log(`\n[probe] model=${MODEL}  turn=coding, user message looks truncated`);
const first = await ask(
  [{ role: 'system', content: CONTRACT }, { role: 'user', content: TRUNCATED_ASK }],
  'first',
);
console.log(`[probe] --- REAL model output (${first.length} chars) ---`);
console.log(first.split('\n').slice(0, 8).map((l) => '        ' + l).join('\n'));

// ── 3. Run the SHIPPED predicates over the REAL output ──────────────────────
const looksMeta = looksMetaRe.test(first);
const hasFence  = hasFenceRe.test(first);
const legacyWouldRetry = looksMeta && !hasFence;
console.log(`\n[probe] looksMeta=${looksMeta}  hasCodeFence=${hasFence}`);
console.log(`[probe] LEGACY path would retry : ${legacyWouldRetry}`);

// ── 4. Does the V3 short-circuit have ANY equivalent gate? ───────────────────
const v3Start = SRC.indexOf('CONTEXT INTELLIGENCE V3 — wired manual-chat surface');
const v3End   = SRC.indexOf('const isCodingChat', v3Start);
const v3Block = SRC.slice(v3Start, v3End > v3Start ? v3End : v3Start + 40000);
const v3HasGate = /looksMeta|meta_retry|checkCodeCompleteness|validateAnswerStructure/.test(v3Block);
console.log(`[probe] V3 block spans ${v3Block.length} chars; contains a coding-recovery gate: ${v3HasGate}`);
console.log(`[probe] V3 path would retry     : ${v3HasGate}`);

// ── 5. Would the retry actually recover code? ───────────────────────────────
let regenRecovers = null;
if (legacyWouldRetry) {
  const regen = await ask([
    { role: 'system', content: CONTRACT },
    { role: 'user', content: TRUNCATED_ASK },
    { role: 'assistant', content: first },
    { role: 'user', content: 'Do not ask for clarification. Assume a reasonable interpretation and output the full solution now, including a fenced code block.' },
  ], 'regen');
  regenRecovers = hasFenceRe.test(regen);
  console.log(`\n[probe] regen produced a closed code fence: ${regenRecovers} (${regen.length} chars)`);
}

// ── Verdict ─────────────────────────────────────────────────────────────────
console.log('\n[probe] ================ VERDICT ================');
if (!legacyWouldRetry) {
  console.log('[probe] INCONCLUSIVE: the provider did not emit a meta-reply on this turn,');
  console.log('[probe] so the gap was not exercised. The asymmetry in step 4 still holds:');
  console.log(`[probe]   legacy has the gate, V3 has one: ${v3HasGate}`);
  process.exit(2);
}
console.log('[probe] CONFIRMED: a real provider returned a code-free meta-reply on a coding turn.');
console.log(`[probe]   legacy: detected -> regenerates -> code recovered = ${regenRecovers}`);
console.log(`[probe]   V3    : no gate -> this text ships to the user verbatim`);
process.exit(v3HasGate ? 1 : 0);
