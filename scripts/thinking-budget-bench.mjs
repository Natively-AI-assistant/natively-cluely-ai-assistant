// scripts/thinking-budget-bench.mjs
//
// Thinking-budget sweep benchmark for the coding answer path.
//
// Calls Gemini EXACTLY the way the app's manual coding-chat path does:
//   - same client: new GoogleGenAI({ apiKey, httpOptions:{ apiVersion:'v1alpha' } })
//   - same system prompt: CHAT_MODE_PROMPT (the manual-chat system prompt)
//   - same user content: "CONTEXT:\n<answer contract>\n\nUSER QUESTION:\n<q>"
//     (coding chat injects formatAnswerPlanForPrompt(plan) as context)
//   - same generationConfig: maxOutputTokens, temperature 0.2, seed 7, +thinkingConfig
//   - streaming via generateContentStream
//
// For each of 12 LeetCode problems (4 easy / 4 medium / 4 hard) × each thinking
// budget, it records: TTFT, total time, output chars/tokens, output tok/s, and
// CORRECTNESS (extracts the ``` code block, runs it against real test cases in
// python3 / node). Correctness is what makes "sweet spot" meaningful — the
// fastest budget that still solves hard problems wins.
//
// Usage:
//   GEMINI_API_KEY=... node scripts/thinking-budget-bench.mjs
//   BENCH_BUDGETS=0,128,512,1024 BENCH_MODEL=gemini-3.1-flash-lite BENCH_REPEATS=1 node scripts/thinking-budget-bench.mjs
//
// Reads GEMINI_API_KEY from env or .env. Results written to
// scripts/thinking-budget-bench-results.json + a printed table.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { GoogleGenAI } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── API key (env or .env) ────────────────────────────────────────────────────
function readGeminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = env.match(/^GEMINI_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* ignore */ }
  return null;
}
const API_KEY = readGeminiKey();
if (!API_KEY) { console.error('No GEMINI_API_KEY found (env or .env).'); process.exit(2); }

// ── Faithful prompt pieces from the compiled app code ────────────────────────
const llmIndex = await import(pathToFileURL(path.join(ROOT, 'dist-electron/electron/llm/index.js')).href);
const promptsMod = await import(pathToFileURL(path.join(ROOT, 'dist-electron/electron/llm/prompts.js')).href);
const { planAnswer, formatAnswerPlanForPrompt } = llmIndex;
const CHAT_MODE_PROMPT = promptsMod.CHAT_MODE_PROMPT;
if (!CHAT_MODE_PROMPT || !planAnswer) { console.error('Could not load app prompt pieces from dist-electron. Run: npm run build:electron'); process.exit(2); }

// ── App-faithful sampling constants (mirror LLMHelper) ───────────────────────
const INTERACTIVE_TEMPERATURE = 0.2;
const INTERACTIVE_SEED = 7;
const MAX_OUTPUT_TOKENS = 65536;

const MODEL = process.env.BENCH_MODEL || 'gemini-3.1-flash-lite';
const BUDGETS = (process.env.BENCH_BUDGETS || '0,128,512,1024,-1').split(',').map(s => Number(s.trim()));
const REPEATS = Number(process.env.BENCH_REPEATS || '1');

const ai = new GoogleGenAI({ apiKey: API_KEY, httpOptions: { apiVersion: 'v1alpha' } });

// ── 12 LeetCode problems with executable verification ────────────────────────
// Each: { id, difficulty, prompt, lang, entry, cases:[{input:[...], expected}] }
// `entry` = the function name the model is asked to define. We force python for
// deterministic execution and tell the model the exact signature.
const PROBLEMS = [
  // ---------- EASY ----------
  { id: 'two-sum', difficulty: 'easy',
    prompt: 'Write a Python function `two_sum(nums, target)` that returns indices of the two numbers in `nums` that add up to `target`. Return them as a list [i, j] with i < j.',
    entry: 'two_sum',
    cases: [ {input: [[2,7,11,15], 9], expected: [0,1]}, {input: [[3,2,4], 6], expected: [1,2]}, {input: [[3,3], 6], expected: [0,1]} ] },
  { id: 'valid-parentheses', difficulty: 'easy',
    prompt: 'Write a Python function `is_valid(s)` that returns True if the string `s` of brackets ()[]{} is validly matched/nested, else False.',
    entry: 'is_valid',
    cases: [ {input: ['()'], expected: true}, {input: ['()[]{}'], expected: true}, {input: ['(]'], expected: false}, {input: ['([)]'], expected: false}, {input: ['{[]}'], expected: true} ] },
  { id: 'fizzbuzz', difficulty: 'easy',
    prompt: 'Write a Python function `fizzbuzz(n)` that returns a list of strings for 1..n: "Fizz" if divisible by 3, "Buzz" if by 5, "FizzBuzz" if both, else the number as a string.',
    entry: 'fizzbuzz',
    cases: [ {input: [5], expected: ['1','2','Fizz','4','Buzz']}, {input: [15], expected: ['1','2','Fizz','4','Buzz','Fizz','7','8','Fizz','Buzz','11','Fizz','13','14','FizzBuzz']} ] },
  { id: 'reverse-integer', difficulty: 'easy',
    prompt: 'Write a Python function `reverse(x)` that reverses the digits of a signed 32-bit integer `x`. If reversing causes overflow outside [-2**31, 2**31-1], return 0.',
    entry: 'reverse',
    cases: [ {input: [123], expected: 321}, {input: [-123], expected: -321}, {input: [120], expected: 21}, {input: [1534236469], expected: 0} ] },

  // ---------- MEDIUM ----------
  { id: 'longest-substring', difficulty: 'medium',
    prompt: 'Write a Python function `length_of_longest_substring(s)` returning the length of the longest substring of `s` without repeating characters.',
    entry: 'length_of_longest_substring',
    cases: [ {input: ['abcabcbb'], expected: 3}, {input: ['bbbbb'], expected: 1}, {input: ['pwwkew'], expected: 3}, {input: [''], expected: 0}, {input: ['dvdf'], expected: 3} ] },
  { id: 'group-anagrams', difficulty: 'medium',
    prompt: 'Write a Python function `group_anagrams(strs)` that groups anagrams together. Return a list of groups; sort each group ascending and sort the list of groups ascending so output is deterministic.',
    entry: 'group_anagrams',
    cases: [ {input: [['eat','tea','tan','ate','nat','bat']], expected: [['ate','eat','tea'],['bat'],['nat','tan']]}, {input: [['']], expected: [['']]}, {input: [['a']], expected: [['a']]} ] },
  { id: 'coin-change', difficulty: 'medium',
    prompt: 'Write a Python function `coin_change(coins, amount)` returning the fewest number of coins to make `amount` (each coin reusable), or -1 if impossible.',
    entry: 'coin_change',
    cases: [ {input: [[1,2,5], 11], expected: 3}, {input: [[2], 3], expected: -1}, {input: [[1], 0], expected: 0}, {input: [[1,2,5], 100], expected: 20} ] },
  { id: 'product-except-self', difficulty: 'medium',
    prompt: 'Write a Python function `product_except_self(nums)` returning a list where output[i] is the product of all elements except nums[i], without using division.',
    entry: 'product_except_self',
    cases: [ {input: [[1,2,3,4]], expected: [24,12,8,6]}, {input: [[-1,1,0,-3,3]], expected: [0,0,9,0,0]} ] },

  // ---------- HARD ----------
  { id: 'median-two-sorted', difficulty: 'hard',
    prompt: 'Write a Python function `find_median_sorted_arrays(nums1, nums2)` returning the median of the two sorted arrays as a float.',
    entry: 'find_median_sorted_arrays',
    cases: [ {input: [[1,3],[2]], expected: 2.0}, {input: [[1,2],[3,4]], expected: 2.5}, {input: [[],[1]], expected: 1.0}, {input: [[0,0],[0,0]], expected: 0.0} ] },
  { id: 'trapping-rain-water', difficulty: 'hard',
    prompt: 'Write a Python function `trap(height)` returning how much rain water can be trapped given the elevation map list `height`.',
    entry: 'trap',
    cases: [ {input: [[0,1,0,2,1,0,1,3,2,1,2,1]], expected: 6}, {input: [[4,2,0,3,2,5]], expected: 9}, {input: [[]], expected: 0} ] },
  { id: 'word-break', difficulty: 'hard',
    prompt: 'Write a Python function `word_break(s, word_dict)` returning True if `s` can be segmented into a space-separated sequence of one or more words from the list `word_dict`.',
    entry: 'word_break',
    cases: [ {input: ['leetcode', ['leet','code']], expected: true}, {input: ['applepenapple', ['apple','pen']], expected: true}, {input: ['catsandog', ['cats','dog','sand','and','cat']], expected: false} ] },
  { id: 'lru-cache', difficulty: 'hard',
    prompt: 'Write a Python class `LRUCache` with `__init__(self, capacity)`, `get(self, key)` (returns value or -1), and `put(self, key, value)` evicting the least-recently-used key when over capacity. Provide a module-level function `run_ops(capacity, ops)` where ops is a list like [["put",1,1],["get",1]] that applies them to an LRUCache and returns the list of results from each "get" in order.',
    entry: 'run_ops',
    cases: [ {input: [2, [["put",1,1],["put",2,2],["get",1],["put",3,3],["get",2],["put",4,4],["get",1],["get",3],["get",4]]], expected: [1,-1,-1,3,4]} ] },
];

// ── Build the app-faithful request for a coding question ─────────────────────
function buildRequest(problemPrompt) {
  // Mirror ipcHandlers gemini-chat-stream coding path: planAnswer → context =
  // formatAnswerPlanForPrompt(plan); systemPromptOverride = CHAT_MODE_PROMPT.
  const plan = planAnswer({ question: problemPrompt, source: 'manual_input', speakerPerspective: 'user' });
  const context = formatAnswerPlanForPrompt(plan);
  const userContent = `CONTEXT:\n${context}\n\nUSER QUESTION:\n${problemPrompt}`;
  return { systemInstruction: CHAT_MODE_PROMPT, userContent, answerType: plan.answerType };
}

function nowMs() { return Number(process.hrtime.bigint() / 1000000n); }

async function runOne(model, thinkingBudget, problem) {
  const { systemInstruction, userContent } = buildRequest(problem.prompt);
  const config = {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: INTERACTIVE_TEMPERATURE,
    seed: INTERACTIVE_SEED,
    thinkingConfig: { thinkingBudget },
    systemInstruction: { parts: [{ text: systemInstruction }] },
  };
  const t0 = nowMs();
  let ttft = null;
  let full = '';
  let chunks = 0;
  let usage = null;
  try {
    const stream = await ai.models.generateContentStream({ model, contents: [{ text: userContent }], config });
    for await (const chunk of stream) {
      let txt = '';
      if (typeof chunk.text === 'function') txt = chunk.text();
      else if (typeof chunk.text === 'string') txt = chunk.text;
      else txt = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (txt && ttft === null) ttft = nowMs() - t0;
      if (txt) { full += txt; chunks++; }
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e), ttft, totalMs: nowMs() - t0 };
  }
  const totalMs = nowMs() - t0;
  const outChars = full.length;
  const outTokens = usage?.candidatesTokenCount ?? null;
  const thoughtsTokens = usage?.thoughtsTokenCount ?? null;
  const promptTokens = usage?.promptTokenCount ?? null;
  const genMs = ttft != null ? Math.max(1, totalMs - ttft) : totalMs;
  const tokPerSec = outTokens ? Math.round((outTokens / genMs) * 1000) : null;
  const charPerSec = Math.round((outChars / genMs) * 1000);
  const correct = verify(problem, full);
  return { ok: true, ttft, totalMs, outChars, outTokens, thoughtsTokens, promptTokens, tokPerSec, charPerSec, correct, answer: full };
}

// ── Extract first fenced code block and run it against test cases ────────────
function extractCode(md) {
  const m = md.match(/```(?:python|py)?\s*\n([\s\S]*?)```/i);
  if (m) return m[1];
  // fallback: any fenced block
  const m2 = md.match(/```[a-zA-Z0-9+#-]*\s*\n([\s\S]*?)```/);
  return m2 ? m2[1] : null;
}

function verify(problem, md) {
  const code = extractCode(md);
  if (!code) return { ran: false, pass: 0, total: problem.cases.length, reason: 'no_code_block' };
  // Build a python runner that imports the model's code, calls entry(*input) per
  // case, and prints JSON pass/fail. Comparison is order-insensitive only where
  // the prompt guarantees determinism (we sorted those), else strict equality
  // with float tolerance.
  const runner = `
import json, sys
${code}

def _norm(x):
    return x

cases = json.loads(sys.argv[1])
entry = ${JSON.stringify(problem.entry)}
fn = globals().get(entry)
results = []
for c in cases:
    try:
        out = fn(*c["input"])
        exp = c["expected"]
        # float tolerance
        if isinstance(exp, float) or isinstance(out, float):
            ok = abs(float(out) - float(exp)) < 1e-6
        else:
            ok = out == exp
        results.append(bool(ok))
    except Exception as e:
        results.append(False)
print(json.dumps(results))
`;
  const tmp = path.join(os.tmpdir(), `bench_${problem.id}_${Math.random().toString(36).slice(2)}.py`);
  try {
    fs.writeFileSync(tmp, runner, 'utf8');
    const out = execFileSync('python3', [tmp, JSON.stringify(problem.cases)], { timeout: 10000, encoding: 'utf8' });
    const arr = JSON.parse(out.trim());
    const pass = arr.filter(Boolean).length;
    return { ran: true, pass, total: problem.cases.length, allPass: pass === problem.cases.length };
  } catch (e) {
    return { ran: false, pass: 0, total: problem.cases.length, reason: 'exec_error:' + String(e?.message || e).slice(0, 120) };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ── Sweep ─────────────────────────────────────────────────────────────────────
const pct = (arr, p) => { if (!arr.length) return 0; const s=[...arr].sort((a,b)=>a-b); return s[Math.min(s.length-1, Math.floor(s.length*p))]; };
const mean = (arr) => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : 0;

console.log(`\nThinking-budget sweep — model=${MODEL}, budgets=[${BUDGETS.join(', ')}], repeats=${REPEATS}`);
console.log(`12 problems (4 easy / 4 medium / 4 hard), correctness verified by executing the generated code.\n`);

const all = [];
for (const budget of BUDGETS) {
  for (const problem of PROBLEMS) {
    for (let r = 0; r < REPEATS; r++) {
      process.stdout.write(`  budget=${String(budget).padStart(5)}  ${problem.difficulty.padEnd(6)} ${problem.id.padEnd(22)} `);
      const res = await runOne(MODEL, budget, problem);
      if (!res.ok) {
        console.log(`ERROR ${res.error?.slice(0,80)}`);
        all.push({ budget, ...problem, repeat: r, ok: false, error: res.error });
        continue;
      }
      const c = res.correct;
      console.log(`ttft=${String(res.ttft).padStart(5)}ms total=${String(res.totalMs).padStart(5)}ms ${res.tokPerSec ?? '?'}tok/s thoughts=${res.thoughtsTokens ?? '?'} ${c.ran ? `${c.pass}/${c.total}${c.allPass?' ✓':' ✗'}` : `(${c.reason})`}`);
      all.push({ budget, id: problem.id, difficulty: problem.difficulty, repeat: r, ok: true,
        ttft: res.ttft, totalMs: res.totalMs, outTokens: res.outTokens, thoughtsTokens: res.thoughtsTokens,
        tokPerSec: res.tokPerSec, pass: c.pass, total: c.total, allPass: !!c.allPass, ran: c.ran, reason: c.reason });
    }
  }
}

// ── Aggregate per budget ──────────────────────────────────────────────────────
console.log(`\n\n================ SUMMARY ================\n`);
const header = ['budget','ttft p50','ttft p95','total p50','tok/s','thoughts avg','correct(all)','easy','med','hard'];
console.log(header.join(' | '));
const summary = [];
for (const budget of BUDGETS) {
  const rows = all.filter(r => r.ok && r.budget === budget);
  if (!rows.length) continue;
  const ttfts = rows.map(r => r.ttft).filter(x => x != null);
  const totals = rows.map(r => r.totalMs);
  const toks = rows.map(r => r.tokPerSec).filter(Boolean);
  const thoughts = rows.map(r => r.thoughtsTokens).filter(x => x != null);
  const byDiff = (d) => { const rr = rows.filter(r => r.difficulty===d); const p = rr.filter(r=>r.allPass).length; return `${p}/${rr.length}`; };
  const allPass = rows.filter(r => r.allPass).length;
  const row = {
    budget,
    ttft_p50: pct(ttfts,0.5), ttft_p95: pct(ttfts,0.95),
    total_p50: pct(totals,0.5),
    tokPerSec_mean: mean(toks),
    thoughts_mean: mean(thoughts),
    correct_all: `${allPass}/${rows.length}`,
    easy: byDiff('easy'), medium: byDiff('medium'), hard: byDiff('hard'),
  };
  summary.push(row);
  console.log([
    String(budget).padStart(6), String(row.ttft_p50).padStart(8), String(row.ttft_p95).padStart(8),
    String(row.total_p50).padStart(9), String(row.tokPerSec_mean).padStart(5),
    String(row.thoughts_mean).padStart(12), row.correct_all.padStart(12),
    row.easy.padStart(4), row.medium.padStart(4), row.hard.padStart(4),
  ].join(' | '));
}

const outPath = path.join(__dirname, 'thinking-budget-bench-results.json');
fs.writeFileSync(outPath, JSON.stringify({ model: MODEL, budgets: BUDGETS, repeats: REPEATS, ranAt: new Date().toISOString(), summary, raw: all }, null, 2));
console.log(`\nFull results: ${outPath}`);
console.log(`\nSweet-spot rule: the LOWEST budget whose hard-problem correctness matches the best, with ttft still low.\n`);
