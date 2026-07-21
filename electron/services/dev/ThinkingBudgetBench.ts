// electron/services/dev/ThinkingBudgetBench.ts
//
// Dev-only thinking-budget sweep. Runs INSIDE the Electron main process so it
// uses the app's LIVE, key-loaded LLMHelper (the `.env` Gemini key is billing-
// dead with a 403; only the app's decrypted CredentialsManager key works).
//
// For 12 LeetCode problems (4 easy / 4 medium / 4 hard) × each thinking budget
// it calls the app's real streamChat coding path (same CHAT_MODE_PROMPT, same
// answer contract, same temperature/seed), measuring TTFT, total time, output
// tokens-est, tok/s, and CORRECTNESS by executing the generated Python against
// real test cases. Correctness is what makes a "sweet spot" meaningful.
//
// Triggered via the hidden IPC channel 'dev:thinking-budget-bench'. Writes a
// JSON report to userData/thinking-budget-bench-results.json and returns a
// summary. No production code path references this.

import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { CHAT_MODE_PROMPT } from '../../llm/prompts';
import { planAnswer, formatAnswerPlanForPrompt } from '../../llm';
import type { LLMHelper } from '../../LLMHelper';

interface Problem {
  id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  prompt: string;
  entry: string;
  cases: { input: any[]; expected: any }[];
}

// A dataset problem authored with a REFERENCE solution instead of hand-typed
// expected values. The expected output is DERIVED by executing the reference
// (pre-flight), so a typo can never silently corrupt the grade — at worst a
// reference fails pre-flight and is dropped. Every budget is graded against the
// same reference oracle, so the relative comparison stays valid.
interface RefProblem {
  id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  prompt: string;
  entry: string;
  reference: string;       // self-contained python defining `entry`
  inputs: any[][];         // argument-lists; expected derived by running reference
  // Optional INDEPENDENT brute-force solution defining the same `entry`. When
  // present, the pre-flight runs BOTH on every input and keeps the problem ONLY
  // if they agree (canonical form) on every case — a consensus oracle that
  // guards against a wrong reference on hard/novel problems. Drops on disagree.
  bruteforce?: string;
}

// 12 problems with executable verification (Python, deterministic).
const PROBLEMS: Problem[] = [
  // EASY
  { id: 'two-sum', difficulty: 'easy', entry: 'two_sum',
    prompt: 'Write a Python function `two_sum(nums, target)` returning indices of the two numbers adding to target as [i, j] with i < j.',
    cases: [{ input: [[2,7,11,15],9], expected: [0,1] }, { input: [[3,2,4],6], expected: [1,2] }, { input: [[3,3],6], expected: [0,1] }] },
  { id: 'valid-parentheses', difficulty: 'easy', entry: 'is_valid',
    prompt: 'Write a Python function `is_valid(s)` returning True if the bracket string s of ()[]{} is validly matched, else False.',
    cases: [{ input: ['()'], expected: true }, { input: ['()[]{}'], expected: true }, { input: ['(]'], expected: false }, { input: ['([)]'], expected: false }, { input: ['{[]}'], expected: true }] },
  { id: 'fizzbuzz', difficulty: 'easy', entry: 'fizzbuzz',
    prompt: 'Write a Python function `fizzbuzz(n)` returning a list of strings for 1..n: "Fizz" if divisible by 3, "Buzz" if by 5, "FizzBuzz" if both, else the number as a string.',
    cases: [{ input: [5], expected: ['1','2','Fizz','4','Buzz'] }, { input: [15], expected: ['1','2','Fizz','4','Buzz','Fizz','7','8','Fizz','Buzz','11','Fizz','13','14','FizzBuzz'] }] },
  { id: 'reverse-integer', difficulty: 'easy', entry: 'reverse',
    prompt: 'Write a Python function `reverse(x)` that reverses the digits of a signed 32-bit integer x. If the result overflows [-2**31, 2**31-1], return 0.',
    cases: [{ input: [123], expected: 321 }, { input: [-123], expected: -321 }, { input: [120], expected: 21 }, { input: [1534236469], expected: 0 }] },
  // MEDIUM
  { id: 'longest-substring', difficulty: 'medium', entry: 'length_of_longest_substring',
    prompt: 'Write a Python function `length_of_longest_substring(s)` returning the length of the longest substring of s without repeating characters.',
    cases: [{ input: ['abcabcbb'], expected: 3 }, { input: ['bbbbb'], expected: 1 }, { input: ['pwwkew'], expected: 3 }, { input: [''], expected: 0 }, { input: ['dvdf'], expected: 3 }] },
  { id: 'group-anagrams', difficulty: 'medium', entry: 'group_anagrams',
    prompt: 'Write a Python function `group_anagrams(strs)` grouping anagrams together. Sort each group ascending AND sort the list of groups ascending so the output is deterministic.',
    cases: [{ input: [['eat','tea','tan','ate','nat','bat']], expected: [['ate','eat','tea'],['bat'],['nat','tan']] }, { input: [['']], expected: [['']] }, { input: [['a']], expected: [['a']] }] },
  { id: 'coin-change', difficulty: 'medium', entry: 'coin_change',
    prompt: 'Write a Python function `coin_change(coins, amount)` returning the fewest coins to make amount (coins reusable), or -1 if impossible.',
    cases: [{ input: [[1,2,5],11], expected: 3 }, { input: [[2],3], expected: -1 }, { input: [[1],0], expected: 0 }, { input: [[1,2,5],100], expected: 20 }] },
  { id: 'product-except-self', difficulty: 'medium', entry: 'product_except_self',
    prompt: 'Write a Python function `product_except_self(nums)` returning a list where output[i] is the product of all elements except nums[i], without division.',
    cases: [{ input: [[1,2,3,4]], expected: [24,12,8,6] }, { input: [[-1,1,0,-3,3]], expected: [0,0,9,0,0] }] },
  // HARD
  { id: 'median-two-sorted', difficulty: 'hard', entry: 'find_median_sorted_arrays',
    prompt: 'Write a Python function `find_median_sorted_arrays(nums1, nums2)` returning the median of the two sorted arrays as a float.',
    cases: [{ input: [[1,3],[2]], expected: 2.0 }, { input: [[1,2],[3,4]], expected: 2.5 }, { input: [[],[1]], expected: 1.0 }, { input: [[0,0],[0,0]], expected: 0.0 }] },
  { id: 'trapping-rain-water', difficulty: 'hard', entry: 'trap',
    prompt: 'Write a Python function `trap(height)` returning how much rain water can be trapped given the elevation map list height.',
    cases: [{ input: [[0,1,0,2,1,0,1,3,2,1,2,1]], expected: 6 }, { input: [[4,2,0,3,2,5]], expected: 9 }, { input: [[]], expected: 0 }] },
  { id: 'word-break', difficulty: 'hard', entry: 'word_break',
    prompt: 'Write a Python function `word_break(s, word_dict)` returning True if s can be segmented into a space-separated sequence of one or more words from list word_dict.',
    cases: [{ input: ['leetcode',['leet','code']], expected: true }, { input: ['applepenapple',['apple','pen']], expected: true }, { input: ['catsandog',['cats','dog','sand','and','cat']], expected: false }] },
  { id: 'lru-cache', difficulty: 'hard', entry: 'run_ops',
    prompt: 'Write a Python class `LRUCache` with __init__(self, capacity), get(self, key) (returns value or -1), and put(self, key, value) evicting the least-recently-used key when over capacity. ALSO provide a module-level function `run_ops(capacity, ops)` where ops is a list like [["put",1,1],["get",1]]; apply them to an LRUCache and return the list of results from each "get" in order.',
    cases: [{ input: [2, [['put',1,1],['put',2,2],['get',1],['put',3,3],['get',2],['put',4,4],['get',1],['get',3],['get',4]]], expected: [1,-1,-1,3,4] }] },
];

const nowMs = () => Number(process.hrtime.bigint() / 1000000n);

function extractCode(md: string): string | null {
  const m = md.match(/```(?:python|py)?\s*\n([\s\S]*?)```/i);
  if (m) return m[1];
  const m2 = md.match(/```[a-zA-Z0-9+#-]*\s*\n([\s\S]*?)```/);
  return m2 ? m2[1] : null;
}

function runPython(code: string, cases: Problem['cases'], entry: string): Promise<{ ran: boolean; pass: number; total: number; reason?: string }> {
  return new Promise((resolve) => {
    const runner = `
import json, sys
${code}

cases = json.loads(sys.argv[1])
import inspect as _inspect
_ENTRY = ${JSON.stringify(entry)}
def _resolve_fn():
    # Prefer the declared entry name. The model is TOLD to name its function
    # this, but on hard problems it often picks a natural name instead — don't
    # penalize naming. Fall back to a user-defined function whose arg count
    # matches the test inputs (prefer the LAST defined = the model's top-level
    # solution, skipping helpers when ambiguous).
    f = globals().get(_ENTRY)
    if callable(f):
        return f, "named"
    want = len(cases[0]["input"]) if cases else 0
    cands = []
    for name, obj in list(globals().items()):
        if name.startswith("_"):
            continue
        if _inspect.isfunction(obj):
            try:
                params = _inspect.signature(obj).parameters
                req = [p for p in params.values() if p.default is _inspect._empty and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
                if len(req) == want or (len(params) >= want and len(req) <= want):
                    cands.append((name, obj))
            except (ValueError, TypeError):
                cands.append((name, obj))
    if len(cands) == 1:
        return cands[0][1], "arity:" + cands[0][0]
    if len(cands) > 1:
        return cands[-1][1], "arity_last:" + cands[-1][0]
    return None, "none"

fn, _how = _resolve_fn()
if fn is None:
    print(json.dumps({"no_fn": True})); sys.exit(0)
def _canon(x):
    # Canonicalize order-insensitive shapes so a VALID but differently-ordered
    # answer is not a false negative: a list of lists is compared as a sorted
    # multiset of sorted-or-stringified sublists. Scalars/strings/flat lists are
    # compared as-is. The prompts already instruct sorted output where it matters;
    # this is a safety net so grading reflects correctness, not ordering luck.
    if isinstance(x, list) and x and all(isinstance(e, list) for e in x):
        inner = []
        for e in x:
            try: inner.append(tuple(sorted(e)))
            except Exception: inner.append(tuple(sorted(map(str, e))))
        return sorted(inner)
    return x

def _eq(out, exp):
    if isinstance(exp, float) or isinstance(out, float):
        try: return abs(float(out) - float(exp)) < 1e-6
        except Exception: return False
    if out == exp:
        return True
    # order-insensitive fallback for list-of-lists
    try:
        return _canon(out) == _canon(exp)
    except Exception:
        return False

results = []
for c in cases:
    try:
        out = fn(*c["input"])
        results.append(bool(_eq(out, c["expected"])))
    except Exception:
        results.append(False)
print(json.dumps(results))
`;
    const tmp = path.join(os.tmpdir(), `tbb_${entry}_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
    try { fs.writeFileSync(tmp, runner, 'utf8'); } catch (e: any) { return resolve({ ran: false, pass: 0, total: cases.length, reason: 'write_fail' }); }
    execFile('python3', [tmp, JSON.stringify(cases)], { timeout: 10000 }, (err, stdout) => {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      if (err) return resolve({ ran: false, pass: 0, total: cases.length, reason: 'exec_error:' + String(err.message).slice(0, 100) });
      try {
        const parsed = JSON.parse(String(stdout).trim());
        // {no_fn:true} ⇒ the model's code defined no callable matching the entry
        // name or input arity — a HARNESS/naming miss, not a wrong algorithm.
        if (parsed && parsed.no_fn) return resolve({ ran: false, pass: 0, total: cases.length, reason: 'no_fn' });
        const pass = parsed.filter(Boolean).length;
        resolve({ ran: true, pass, total: cases.length });
      } catch { resolve({ ran: false, pass: 0, total: cases.length, reason: 'parse_fail' }); }
    });
  });
}

const pct = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const mean = (a: number[]) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;

// Run an arbitrary python solution defining `entry` against `inputs`. Returns an
// array of { ok, value? , error? } per input, or null on infra failure.
function runSolution(code: string, entry: string, inputs: any[][]): Promise<Array<{ ok: boolean; value?: any; error?: string }> | { fatal: string }> {
  return new Promise((resolve) => {
    const runner = `
import json, sys
${code}

inputs = json.loads(sys.argv[1])
fn = globals().get(${JSON.stringify(entry)})
if fn is None:
    print(json.dumps({"error": "entry_not_defined"})); sys.exit(0)
out = []
for args in inputs:
    try:
        out.append({"ok": True, "value": fn(*args)})
    except Exception as e:
        out.append({"ok": False, "error": str(e)[:120]})
print(json.dumps(out))
`;
    const tmp = path.join(os.tmpdir(), `sol_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
    try { fs.writeFileSync(tmp, runner, 'utf8'); } catch { return resolve({ fatal: 'write_fail' }); }
    execFile('python3', [tmp, JSON.stringify(inputs)], { timeout: 12000 }, (err, stdout) => {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      if (err) return resolve({ fatal: 'exec_error:' + String(err.message).slice(0, 100) });
      let parsed: any;
      try { parsed = JSON.parse(String(stdout).trim()); } catch { return resolve({ fatal: 'parse_fail' }); }
      if (parsed && parsed.error) return resolve({ fatal: parsed.error });
      if (!Array.isArray(parsed)) return resolve({ fatal: 'bad_shape' });
      resolve(parsed);
    });
  });
}

// Canonical-equality used for BOTH oracle consensus and answer grading.
function canonEqual(a: any, b: any): boolean {
  const c = (x: any): any => {
    if (Array.isArray(x) && x.length && x.every(e => Array.isArray(e))) {
      return x.map(e => { try { return JSON.stringify([...e].sort()); } catch { return JSON.stringify(e); } }).sort();
    }
    return x;
  };
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (JSON.stringify(a) === JSON.stringify(b)) return true;
  try { return JSON.stringify(c(a)) === JSON.stringify(c(b)); } catch { return false; }
}

// Derive expected outputs via a CONSENSUS ORACLE: run the reference AND (if
// present) an independent brute-force on every input; keep the problem only if
// both succeed and AGREE (canonical) on every case. Two independent algorithms
// agreeing is strong evidence the oracle is correct — essential for hard/novel
// problems where a single hand-authored reference could be subtly wrong.
async function deriveExpected(rp: RefProblem): Promise<{ problem: Problem | null; reason?: string }> {
  const ref = await runSolution(rp.reference, rp.entry, rp.inputs);
  if ('fatal' in ref) return { problem: null, reason: 'ref_' + ref.fatal };
  for (let i = 0; i < rp.inputs.length; i++) {
    if (!ref[i] || ref[i].ok !== true) return { problem: null, reason: `ref_case_${i}_threw` };
  }
  // Consensus check against an independent brute force, when provided.
  if (rp.bruteforce) {
    const bf = await runSolution(rp.bruteforce, rp.entry, rp.inputs);
    if ('fatal' in bf) return { problem: null, reason: 'bf_' + bf.fatal };
    for (let i = 0; i < rp.inputs.length; i++) {
      if (!bf[i] || bf[i].ok !== true) return { problem: null, reason: `bf_case_${i}_threw` };
      if (!canonEqual(ref[i].value, bf[i].value)) {
        return { problem: null, reason: `oracle_disagree_case_${i}` };
      }
    }
  }
  const cases = rp.inputs.map((input, i) => ({ input, expected: ref[i].value }));
  return { problem: { id: rp.id, difficulty: rp.difficulty, prompt: rp.prompt, entry: rp.entry, cases } };
}

// Load the optional 100-problem dataset (electron/services/dev/leetcode100.json,
// or a path via THINKING_BENCH_DATASET). Returns [] if absent → falls back to the
// built-in 12.
function loadRefDataset(log: (s: string) => void): RefProblem[] {
  const candidates = [
    process.env.THINKING_BENCH_DATASET,
    path.join(__dirname, 'leetcode100.json'),
    path.join(process.cwd(), 'electron/services/dev/leetcode100.json'),
    path.join(process.cwd(), 'dist-electron/electron/services/dev/leetcode100.json'),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const arr = JSON.parse(fs.readFileSync(c, 'utf8'));
        const probs = Array.isArray(arr) ? arr : arr.problems;
        if (Array.isArray(probs) && probs.length) { log(`[ThinkingBudgetBench] loaded ${probs.length} problems from ${c}`); return probs; }
      }
    } catch (e: any) { log(`[ThinkingBudgetBench] dataset load failed (${c}): ${e?.message}`); }
  }
  return [];
}

// ── Thinking MATRIX: budgets × levels on a focused problem subset ──────────────
// Mirrors the coding path (CHAT_MODE_PROMPT system + answer-plan context) but
// calls the client DIRECTLY so it can set EITHER thinkingBudget (number) OR
// thinkingLevel (enum) — streamChat only threads a numeric budget. Grades
// correctness with the same consensus oracle + name-agnostic runner, and
// captures thoughtsTokenCount so we can see how much the model actually thought.
interface MatrixConfig { label: string; cfg: any; }

const DEFAULT_MATRIX_CONFIGS: MatrixConfig[] = [
  { label: 'budget:0',    cfg: { thinkingConfig: { thinkingBudget: 0 } } },
  { label: 'budget:512',  cfg: { thinkingConfig: { thinkingBudget: 512 } } },
  { label: 'budget:1024', cfg: { thinkingConfig: { thinkingBudget: 1024 } } },
  { label: 'level:minimal', cfg: { thinkingConfig: { thinkingLevel: 'minimal' } } },
  { label: 'level:low',     cfg: { thinkingConfig: { thinkingLevel: 'low' } } },
  { label: 'level:medium',  cfg: { thinkingConfig: { thinkingLevel: 'medium' } } },
];

// Parse a config spec like "budget:0,budget:512,level:low,level:medium,level:high".
// Per Gemini 3.x docs: numeric thinkingBudget is DEPRECATED in favor of the
// thinkingLevel enum (minimal|low|medium|high); gemini-3.1-pro-preview CANNOT
// disable thinking (rejects budget:0 / has no minimal) — use level low/medium/high.
function parseMatrixConfigs(spec?: string): MatrixConfig[] {
  if (!spec) return DEFAULT_MATRIX_CONFIGS;
  const out: MatrixConfig[] = [];
  for (const tok of spec.split(',').map(s => s.trim()).filter(Boolean)) {
    const [kind, val] = tok.split(':');
    if (kind === 'budget') out.push({ label: tok, cfg: { thinkingConfig: { thinkingBudget: Number(val) } } });
    else if (kind === 'level') out.push({ label: tok, cfg: { thinkingConfig: { thinkingLevel: val } } });
    else if (kind === 'default') out.push({ label: 'default', cfg: {} });
  }
  return out.length ? out : DEFAULT_MATRIX_CONFIGS;
}

export async function runThinkingMatrix(llmHelper: LLMHelper, opts: { model?: string; log?: (s: string) => void; delayMs?: number; configs?: string } = {}): Promise<any> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const model = opts.model || 'gemini-3.1-flash-lite';
  const delayMs = opts.delayMs ?? 500;
  const MATRIX_CONFIGS = parseMatrixConfigs(opts.configs);
  const appClient = (llmHelper as any).client;
  if (!appClient) { log('[matrix] no Gemini client'); return null; }

  // KEY ROTATION (opt-in): Pro free-tier is 250 req/day/key AND has a ~30s RPM
  // window. Rotating across several keys multiplies effective throughput. When
  // THINKING_BENCH_KEYS_FROM_NATIVELY=1, load every GEMINI_API_KEY* from
  // natively-api/.env, build a client per key, rotate per call, and on a 429
  // retry on the NEXT key after a short backoff. Falls back to the app client.
  const clients: any[] = [];
  if (process.env.THINKING_BENCH_KEYS_FROM_NATIVELY === '1') {
    try {
      const { GoogleGenAI } = require('@google/genai');
      const envPath = path.join(process.cwd(), 'natively-api/.env');
      const env = fs.readFileSync(envPath, 'utf8');
      let keys = [...env.matchAll(/^GEMINI_API_KEY(?:_\d+)?="?([^"\n]+)"?$/mg)].map(m => m[1].trim());
      keys = Array.from(new Set(keys));
      // THINKING_BENCH_KEY_INDICES="1,3" → use only those 1-based keys (skip
      // daily-capped/blocked ones so rotation doesn't waste retries on them).
      const only = (process.env.THINKING_BENCH_KEY_INDICES || '').split(',').map(s => Number(s.trim())).filter(n => n > 0);
      if (only.length) keys = only.map(n => keys[n - 1]).filter(Boolean);
      for (const k of keys) clients.push(new GoogleGenAI({ apiKey: k }));
      log(`[matrix] rotating across ${clients.length} keys from natively-api/.env${only.length ? ` (indices ${only.join(',')})` : ''}`);
    } catch (e: any) { log(`[matrix] key load failed: ${e?.message}; using app client`); }
  }
  if (!clients.length) clients.push(appClient);
  let keyIdx = 0;

  // Load the focused subset + consensus pre-flight (same oracle as the sweep).
  const refSet = loadRefDataset(log);
  if (!refSet.length) { log('[matrix] no dataset (set THINKING_BENCH_DATASET to cf10.json)'); return null; }
  log(`[matrix] pre-flight: consensus-deriving expected for ${refSet.length} problems...`);
  const problems: Problem[] = [];
  for (const rp of refSet) {
    const { problem, reason } = await deriveExpected(rp);
    if (problem) problems.push(problem); else log(`[matrix] dropped ${rp.id} (${reason})`);
  }
  log(`[matrix] ${problems.length} problems usable\n`);

  const MAX_OUTPUT_TOKENS = 65536;
  const all: any[] = [];
  log(`[matrix] model=${model} configs=[${MATRIX_CONFIGS.map(c => c.label).join(', ')}] problems=${problems.length}`);

  for (const mc of MATRIX_CONFIGS) {
    for (const p of problems) {
      // Faithful coding request: answer-plan context + CHAT_MODE_PROMPT, mirroring
      // ipcHandlers' coding-chat path, but as a direct client call.
      const plan = planAnswer({ question: p.prompt, source: 'manual_input', speakerPerspective: 'user' });
      const context = formatAnswerPlanForPrompt(plan);
      const userContent = `CONTEXT:\n${context}\n\nUSER QUESTION:\n${p.prompt}`;
      let ttft: number | null = null; let full = ''; let usage: any = null; let err: string | null = null;
      let t0 = Number(process.hrtime.bigint() / 1000000n);
      // Try across keys: on a 429 (RPM/quota), rotate to the next key and retry.
      const maxAttempts = Math.max(clients.length * 2, 3);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const client = clients[keyIdx % clients.length];
        keyIdx++;
        ttft = null; full = ''; usage = null; err = null;
        t0 = Number(process.hrtime.bigint() / 1000000n);
        try {
          const stream = await client.models.generateContentStream({
            model, contents: [{ text: userContent }],
            config: {
              maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.2, seed: 7,
              systemInstruction: { parts: [{ text: CHAT_MODE_PROMPT }] },
              ...mc.cfg,
            },
          });
          for await (const ch of stream) {
            const tx = typeof ch.text === 'function' ? ch.text() : (ch.text || '');
            if (tx && ttft === null) ttft = Number(process.hrtime.bigint() / 1000000n) - t0;
            if (tx) full += tx;
            if (ch.usageMetadata) usage = ch.usageMetadata;
          }
          break; // success
        } catch (e: any) {
          err = String(e?.message || e).replace(/\s+/g, " ").slice(0, 240);
          const is429 = /"code":\s*429|RESOURCE_EXHAUSTED|Too Many Requests/.test(err);
          if (is429 && attempt < maxAttempts - 1) {
            // short backoff before trying the next key (per-minute window ~30s,
            // but with N keys we usually only wait a little)
            await new Promise(r => setTimeout(r, clients.length > 1 ? 1200 : 32000));
            continue;
          }
          break; // non-429, or out of attempts
        }
      }
      const totalMs = Number(process.hrtime.bigint() / 1000000n) - t0;
      const thoughts = usage?.thoughtsTokenCount ?? 0;
      let verify: any = { ran: false, pass: 0, total: p.cases.length, reason: err ? 'api_error' : 'no_code_block' };
      if (!err) {
        const code = extractCode(full);
        verify = code ? await runPython(code, p.cases, p.entry) : verify;
      }
      const allPass = verify.ran && verify.pass === verify.total;
      log(`  ${mc.label.padEnd(13)} ${p.difficulty.padEnd(6)} ${p.id.padEnd(34)} ttft=${err ? 'ERR' : String(ttft).padStart(5) + 'ms'} total=${String(totalMs).padStart(5)}ms thoughts=${String(thoughts).padStart(4)} ${err ? err : (verify.ran ? `${verify.pass}/${verify.total}${allPass ? ' OK' : ' X'}` : `(${verify.reason})`)}`);
      all.push({ config: mc.label, id: p.id, difficulty: p.difficulty, ttft, totalMs, thoughts, pass: verify.pass, total: verify.total, allPass, ran: verify.ran, reason: verify.reason, err });
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  // Summary per config
  const pctl = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  log(`\n[matrix] SUMMARY (model=${model}, ${problems.length} problems)`);
  log(`config        | ttft p50 | ttft p95 | total p50 | thoughts avg | correct`);
  const summary: any[] = [];
  for (const mc of MATRIX_CONFIGS) {
    const rows = all.filter(r => r.config === mc.label && !r.err);
    if (!rows.length) { log(`${mc.label.padEnd(13)} | (all errored)`); continue; }
    const tt = rows.map(r => r.ttft).filter((x: any) => x != null);
    const th = rows.map(r => r.thoughts);
    const correct = rows.filter(r => r.allPass).length;
    const thoughtsAvg = Math.round(th.reduce((a, b) => a + b, 0) / th.length);
    summary.push({ config: mc.label, ttft_p50: pctl(tt, 0.5), ttft_p95: pctl(tt, 0.95), total_p50: pctl(rows.map(r => r.totalMs), 0.5), thoughts_avg: thoughtsAvg, correct: `${correct}/${rows.length}` });
    log(`${mc.label.padEnd(13)} | ${String(pctl(tt, 0.5)).padStart(8)} | ${String(pctl(tt, 0.95)).padStart(8)} | ${String(pctl(rows.map(r => r.totalMs), 0.5)).padStart(9)} | ${String(thoughtsAvg).padStart(12)} | ${correct}/${rows.length}`);
  }

  const outPath = path.join(app.getPath('userData'), `thinking-matrix-${model.replace(/[^a-z0-9]/gi, '_')}.json`);
  try { fs.writeFileSync(outPath, JSON.stringify({ model, ranAt: new Date().toISOString(), summary, raw: all }, null, 2)); log(`\n[matrix] wrote ${outPath}`); } catch { /* ignore */ }
  return { model, summary, raw: all };
}

export interface BenchOptions { budgets?: number[]; repeats?: number; log?: (s: string) => void; model?: string; }

/**
 * Thinking-config PROBE — answers "how is the thinking budget actually honored on
 * this model?" empirically. Calls the live Gemini client DIRECTLY (reusing the
 * app's decrypted-key client) under several configs and reads back the response's
 * `thoughtsTokenCount`. If thoughtsTokenCount==0 under thinkingBudget:0, the
 * budget is honored (thinking disabled). If thoughts>0 despite budget:0, the model
 * IGNORES thinkingBudget and we'd need thinkingLevel instead. Run once per model.
 */
export async function probeThinkingConfig(llmHelper: LLMHelper, model: string, log: (s: string) => void): Promise<any[]> {
  const client = (llmHelper as any).client;
  if (!client) { log('[probe] no Gemini client'); return []; }
  const q = 'Write a Python function `two_sum(nums, target)` returning the indices [i,j] (i<j) of the two numbers adding to target. Put the code in a ```python block.';
  const configs: { label: string; cfg: any }[] = [
    { label: 'default (no thinkingConfig)', cfg: {} },
    { label: 'thinkingBudget:0', cfg: { thinkingConfig: { thinkingBudget: 0 } } },
    { label: 'thinkingBudget:512', cfg: { thinkingConfig: { thinkingBudget: 512 } } },
    { label: "thinkingLevel:'minimal'", cfg: { thinkingConfig: { thinkingLevel: 'minimal' } } },
    { label: "thinkingLevel:'low'", cfg: { thinkingConfig: { thinkingLevel: 'low' } } },
  ];
  const out: any[] = [];
  log(`\n[probe] model=${model} — how is thinking honored? (thoughtsTokenCount tells us)`);
  for (const { label, cfg } of configs) {
    const t0 = Number(process.hrtime.bigint() / 1000000n);
    let ttft: number | null = null; let full = ''; let usage: any = null; let err: string | null = null;
    try {
      const stream = await client.models.generateContentStream({
        model, contents: [{ text: q }],
        config: { maxOutputTokens: 4096, temperature: 0.2, ...cfg },
      });
      for await (const ch of stream) {
        const tx = typeof ch.text === 'function' ? ch.text() : (ch.text || '');
        if (tx && ttft === null) ttft = Number(process.hrtime.bigint() / 1000000n) - t0;
        if (tx) full += tx;
        if (ch.usageMetadata) usage = ch.usageMetadata;
      }
    } catch (e: any) { err = String(e?.message || e).replace(/\s+/g, " ").slice(0, 240); }
    const thoughts = usage?.thoughtsTokenCount ?? null;
    const cand = usage?.candidatesTokenCount ?? null;
    out.push({ label, ttft, thoughts, candidates: cand, chars: full.length, err });
    log(`  ${label.padEnd(28)} ttft=${err ? 'ERR' : String(ttft).padStart(5) + 'ms'} thoughts=${thoughts ?? '?'} candidates=${cand ?? '?'}${err ? ' ' + err : ''}`);
    await new Promise(r => setTimeout(r, 400));
  }
  return out;
}

/**
 * Run the sweep against the app's live LLMHelper. Sets the model to flash-lite
 * for the duration (restores afterward), and threads each thinking budget via
 * streamChat's trailing arg (the same path coding answers use).
 */
export async function runThinkingBudgetBench(llmHelper: LLMHelper, opts: BenchOptions = {}): Promise<any> {
  const budgets = opts.budgets ?? [0, 128, 512, 1024, -1];
  const repeats = opts.repeats ?? 1;
  const log = opts.log ?? ((s: string) => console.log(s));
  const model = opts.model || 'gemini-3.1-flash-lite';

  // First: probe how thinking is honored on this model (thoughtsTokenCount).
  const probe = await probeThinkingConfig(llmHelper, model, log);

  // Build the problem set: prefer the external 100-set (expected DERIVED from
  // reference solutions via pre-flight), else the built-in 12. Pre-flight runs
  // every reference BEFORE any API call — a reference that throws is dropped and
  // logged, so the graded set contains only problems with a trusted oracle.
  let problems: Problem[] = PROBLEMS;
  const refSet = loadRefDataset(log);
  if (refSet.length) {
    log(`[ThinkingBudgetBench] pre-flight: deriving expected outputs from ${refSet.length} reference solutions...`);
    const derived: Problem[] = [];
    const dropped: { id: string; reason: string }[] = [];
    for (const rp of refSet) {
      const { problem, reason } = await deriveExpected(rp);
      if (problem) derived.push(problem); else dropped.push({ id: rp.id, reason: reason || 'unknown' });
    }
    log(`[ThinkingBudgetBench] pre-flight done: ${derived.length} usable, ${dropped.length} dropped`);
    if (dropped.length) log(`[ThinkingBudgetBench] dropped: ${dropped.map(d => `${d.id}(${d.reason})`).join(', ')}`);
    if (derived.length >= 12) problems = derived;
    else log(`[ThinkingBudgetBench] only ${derived.length} usable refs — falling back to built-in 12`);
  }

  // Pin to flash-lite for the sweep, restore the user's model after.
  const prevModel = (llmHelper as any).currentModelId as string | undefined;
  try { llmHelper.setModel(model); } catch { /* ignore */ }

  const counts = { easy: problems.filter(p => p.difficulty==='easy').length, medium: problems.filter(p => p.difficulty==='medium').length, hard: problems.filter(p => p.difficulty==='hard').length };
  log(`\n[ThinkingBudgetBench] model=${model} budgets=[${budgets.join(', ')}] repeats=${repeats} problems=${problems.length} (E${counts.easy}/M${counts.medium}/H${counts.hard})`);
  const all: any[] = [];

  for (const budget of budgets) {
    for (const p of problems) {
      for (let r = 0; r < repeats; r++) {
        const plan = planAnswer({ question: p.prompt, source: 'manual_input', speakerPerspective: 'user' });
        const context = formatAnswerPlanForPrompt(plan);
        const t0 = nowMs();
        let ttft: number | null = null;
        let full = '';
        try {
          // Mirror the coding-chat call: ignoreKnowledgeMode + skipModeInjection
          // true, CHAT_MODE_PROMPT override, context = answer contract, and the
          // trailing thinkingBudget arg. No abort signal.
          const stream = llmHelper.streamChat(p.prompt, undefined, context, CHAT_MODE_PROMPT, true, true, [], undefined, budget);
          for await (const tok of stream) {
            if (tok && ttft === null) ttft = nowMs() - t0;
            full += tok;
          }
        } catch (e: any) {
          log(`  budget=${budget} ${p.difficulty} ${p.id} ERROR ${String(e?.message).slice(0, 80)}`);
          all.push({ budget, id: p.id, difficulty: p.difficulty, repeat: r, ok: false, error: String(e?.message).slice(0, 200) });
          continue;
        }
        const totalMs = nowMs() - t0;
        const code = extractCode(full);
        const verify = code ? await runPython(code, p.cases, p.entry) : { ran: false, pass: 0, total: p.cases.length, reason: 'no_code_block' };
        const allPass = verify.ran && verify.pass === verify.total;
        const genMs = ttft != null ? Math.max(1, totalMs - ttft) : totalMs;
        const charPerSec = Math.round((full.length / genMs) * 1000);
        log(`  budget=${String(budget).padStart(5)} ${p.difficulty.padEnd(6)} ${p.id.padEnd(22)} ttft=${String(ttft).padStart(5)}ms total=${String(totalMs).padStart(5)}ms ${verify.ran ? `${verify.pass}/${verify.total}${allPass ? ' OK' : ' X'}` : `(${verify.reason})`}`);
        all.push({ budget, id: p.id, difficulty: p.difficulty, repeat: r, ok: true, ttft, totalMs, chars: full.length, charPerSec, pass: verify.pass, total: verify.total, allPass, ran: verify.ran, reason: verify.reason });
        // Inter-call pacing (env THINKING_BENCH_DELAY_MS, default 250ms) to avoid
        // tripping Gemini per-minute rate limits over a long 100-problem sweep.
        const delayMs = Number(process.env.THINKING_BENCH_DELAY_MS || '250');
        if (delayMs > 0) await new Promise(res => setTimeout(res, delayMs));
      }
    }
  }

  // restore model
  if (prevModel) { try { llmHelper.setModel(prevModel); } catch { /* ignore */ } }

  // aggregate
  const summary: any[] = [];
  for (const budget of budgets) {
    const rows = all.filter(r => r.ok && r.budget === budget);
    if (!rows.length) continue;
    const ttfts = rows.map(r => r.ttft).filter((x: any) => x != null);
    const totals = rows.map(r => r.totalMs);
    const byDiff = (d: string) => { const rr = rows.filter(r => r.difficulty === d); return `${rr.filter(r => r.allPass).length}/${rr.length}`; };
    summary.push({
      budget,
      ttft_p50: pct(ttfts, 0.5), ttft_p95: pct(ttfts, 0.95),
      total_p50: pct(totals, 0.5), total_p95: pct(totals, 0.95),
      charPerSec_mean: mean(rows.map(r => r.charPerSec)),
      correct_all: `${rows.filter(r => r.allPass).length}/${rows.length}`,
      easy: byDiff('easy'), medium: byDiff('medium'), hard: byDiff('hard'),
    });
  }

  log(`\n[ThinkingBudgetBench] SUMMARY`);
  log(`budget | ttft p50 | ttft p95 | total p50 | char/s | correct | easy | med | hard`);
  for (const s of summary) {
    log(`${String(s.budget).padStart(6)} | ${String(s.ttft_p50).padStart(8)} | ${String(s.ttft_p95).padStart(8)} | ${String(s.total_p50).padStart(9)} | ${String(s.charPerSec_mean).padStart(6)} | ${s.correct_all.padStart(7)} | ${s.easy.padStart(4)} | ${s.medium.padStart(3)} | ${s.hard.padStart(4)}`);
  }

  const outPath = path.join(app.getPath('userData'), 'thinking-budget-bench-results.json');
  const report = { model, probe, budgets, repeats, ranAt: new Date().toISOString(), summary, raw: all };
  try { fs.writeFileSync(outPath, JSON.stringify(report, null, 2)); log(`\n[ThinkingBudgetBench] wrote ${outPath}`); } catch { /* ignore */ }
  return report;
}
