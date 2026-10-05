#!/usr/bin/env node
// Screenshot turns for tools/latency-reasoning.mjs: screens rendered to real PNGs (the way
// benchmarks/coding-contract/vision.mjs does it) and the prompt the app composes for a screenshot turn, written to
// results/latency/screens.json. The app's own prompt modules are taken from a built checkout (--dist); without one
// a plain instruction stands in and the file says so.
//   node tools/latency-screens.mjs [--dist /path/to/dist-electron/electron/llm] [--out results/latency/screens.json]
// These are text screens (code, traces, tables, slides), not photographs or busy app windows.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const DIST = opt('dist', '/Users/evin/natively-cluely-ai-assistant/dist-electron/electron/llm');
const out = path.resolve(ROOT, opt('out', 'results/latency/screens.json'));
const require = createRequire(import.meta.url);
const sharp = (() => { for (const base of [ROOT, '/Users/evin/natively-cluely-ai-assistant']) { try { return require(require.resolve('sharp', { paths: [base] })); } catch { /* next */ } } throw new Error('sharp not found'); })();

const S = (id, difficulty, title, body, question) => ({ id, difficulty, title, body, question });
const SCREENS = [
  S('SCR-code-two-sum', 'easy', '1. Two Sum', `Given an array of integers nums and an integer target, return indices of\nthe two numbers such that they add up to target.\n\nExample: nums = [2,7,11,15], target = 9  ->  [0,1]\n\nclass Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        `, 'How do I answer this'),
  S('SCR-code-valid-parens', 'easy', '20. Valid Parentheses', `Given a string s containing just the characters '(', ')', '{', '}',\n'[' and ']', determine if the input string is valid.\n\nclass Solution {\n    public boolean isValid(String s) {\n\n    }\n}`, 'How do I answer this'),
  S('SCR-code-merge-intervals', 'normal', '56. Merge Intervals', `Given an array of intervals where intervals[i] = [start_i, end_i],\nmerge all overlapping intervals and return the non-overlapping ones.\n\nExample: [[1,3],[2,6],[8,10],[15,18]]  ->  [[1,6],[8,10],[15,18]]\n\nfunction merge(intervals: number[][]): number[][] {\n\n}`, 'What should I say about this?'),
  S('SCR-code-rain-water', 'hard', '42. Trapping Rain Water', `Given n non-negative integers representing an elevation map where\nthe width of each bar is 1, compute how much water it can trap\nafter raining.\n\nExample: height = [0,1,0,2,1,0,1,3,2,1,2,1]  ->  6\n\nclass Solution:\n    def trap(self, height: List[int]) -> int:\n        `, 'What should I say about this?'),
  S('SCR-code-lru', 'hard', '146. LRU Cache', `Design a data structure that follows the constraints of a Least\nRecently Used (LRU) cache. get and put must each run in O(1)\naverage time.\n\nclass LRUCache:\n    def __init__(self, capacity: int):\n\n    def get(self, key: int) -> int:\n\n    def put(self, key: int, value: int) -> None:\n        `, ''),
  S('SCR-code-median-arrays', 'hard', '4. Median of Two Sorted Arrays', `Given two sorted arrays nums1 and nums2 of size m and n, return the\nmedian of the two sorted arrays. The overall run time complexity\nshould be O(log (m+n)).\n\nExample: nums1 = [1,3], nums2 = [2]  ->  2.0\n\nclass Solution {\npublic:\n    double findMedianSortedArrays(vector<int>& nums1, vector<int>& nums2) {\n\n    }\n};`, 'How do I solve this?'),
  S('SCR-code-word-ladder', 'hard', '127. Word Ladder', `Given two words, beginWord and endWord, and a dictionary wordList,\nreturn the number of words in the shortest transformation sequence\nfrom beginWord to endWord, or 0 if no such sequence exists.\nOnly one letter can change at a time; every word must be in wordList.\n\nExample: hit -> cog, ["hot","dot","dog","lot","log","cog"]  ->  5\n\ndef ladderLength(beginWord, endWord, wordList):\n    `, ''),
  S('SCR-sql-second-salary', 'normal', '176. Second Highest Salary', `Table: Employee (id int, salary int)\n\nWrite a solution to find the second highest distinct salary from the\nEmployee table. If there is no second highest salary, return null.\n\n| id | salary |\n| 1  | 100    |\n| 2  | 200    |\n| 3  | 300    |`, 'What should I say about this?'),
  S('SCR-sql-combine', 'easy', '175. Combine Two Tables', `Table: Person (personId, lastName, firstName)\nTable: Address (addressId, personId, city, state)\n\nWrite a solution to report the first name, last name, city and state\nof each person. If personId is not in Address, report null instead.`, ''),
  S('SCR-debug-keyerror', 'normal', 'Terminal — python report.py', `Traceback (most recent call last):\n  File "report.py", line 31, in <module>\n    main()\n  File "report.py", line 24, in main\n    totals[row["region"]] += float(row["amount"])\nKeyError: 'EMEA'\n\n20  totals = {}\n21  with open("sales.csv") as f:\n22      for row in csv.DictReader(f):\n23          # accumulate per region\n24          totals[row["region"]] += float(row["amount"])`, 'Why is this failing and how do I fix it?'),
  S('SCR-debug-react-undefined', 'normal', 'Browser console — OrderList.tsx', `Uncaught TypeError: Cannot read properties of undefined (reading 'map')\n    at OrderList (OrderList.tsx:14:22)\n\n 8  export function OrderList({ customerId }: Props) {\n 9    const [orders, setOrders] = useState<Order[]>();\n10    useEffect(() => {\n11      fetchOrders(customerId).then(setOrders);\n12    }, [customerId]);\n13    return (\n14      <ul>{orders.map((o) => <li key={o.id}>{o.total}</li>)}</ul>\n15    );\n16  }`, 'What is wrong here?'),
  S('SCR-debug-binary-search', 'hard', 'search.py — the test hangs', `def search(nums, target):\n    lo, hi = 0, len(nums) - 1\n    while lo < hi:\n        mid = (lo + hi) // 2\n        if nums[mid] < target:\n            lo = mid\n        else:\n            hi = mid\n    return lo if nums[lo] == target else -1\n\n# search([1, 3, 5, 7], 7) never returns`, 'Why does this loop forever?'),
  S('SCR-debug-go-race', 'hard', 'counter.go — flaky test', `func CountWords(files []string) map[string]int {\n    counts := map[string]int{}\n    var wg sync.WaitGroup\n    for _, f := range files {\n        wg.Add(1)\n        go func() {\n            defer wg.Done()\n            for _, w := range readWords(f) {\n                counts[w]++\n            }\n        }()\n    }\n    wg.Wait()\n    return counts\n}\n\nfatal error: concurrent map writes`, 'What is the bug and what is the fix?'),
  S('SCR-debug-ci-log', 'normal', 'CI — build #4127 failed', `> tsc --noEmit && vitest run\n\nsrc/billing/invoice.ts:88:27 - error TS2345: Argument of type\n  'string | undefined' is not assignable to parameter of type 'string'.\n\n88   const tax = lookupRate(customer.region);\n                             ~~~~~~~~~~~~~~~\n\nFound 1 error in src/billing/invoice.ts:88\nError: Process completed with exit code 2.`, 'Why did the build fail?'),
  S('SCR-complexity-doubling', 'hard', 'Whiteboard — complexity', `for (int i = 1; i <= n; i++) {\n    for (int j = i; j <= n; j *= 2) {\n        work();   // O(1)\n    }\n}\n\nfor (int i = n; i >= 1; i /= 2) {\n    for (int j = 0; j < i; j++) {\n        work();   // O(1)\n    }\n}`, 'What is the time complexity of each of these?'),
  S('SCR-design-bottleneck', 'hard', 'Design review — checkout service', `Client -> API gateway -> Checkout service (12 pods)\n                           |-> Inventory service  (sync HTTP, p99 420 ms)\n                           |-> Payments provider  (sync HTTP, p99 900 ms)\n                           |-> Postgres primary   (1 writer, 2 replicas)\n                           '-> Email service      (sync HTTP, p99 1.8 s)\n\nPeak: 1,400 checkouts/min.  Checkout p99: 3.4 s.  Timeout: 3 s.\nError rate at peak: 6 % (gateway timeouts).`, 'Where is the bottleneck and what would you change first?'),
  S('SCR-dash-pipeline', 'easy', 'Q3 Pipeline Dashboard', `Closed won:        $1.24M     (+18% QoQ)\nOpen pipeline:     $4.80M\nAvg deal size:     $42,300\nWin rate:          31%\n\nTop accounts: Northwind, Initech, Globex, Umbrella`, 'What should I say about this?'),
  S('SCR-pricing-seats', 'hard', 'Pricing — Plans', `Plan         Per seat / month   SSO    Min seats   Annual discount\nStarter      $12                no     1           10 %\nTeam         $19                no     5           15 %\nBusiness     $31                yes    20          15 %\nEnterprise   contact sales      yes    100         negotiated\n\nAdd-on: audit log export  $2 per seat / month (Business and up)`, 'They have 45 seats and need SSO and the audit export. What would a year cost if they pay annually?'),
  S('SCR-sheet-revenue', 'normal', 'Revenue by quarter (USD thousands)', `Region      Q1      Q2      Q3      Q4\nNorth       410     455     470     520\nSouth       290     275     310     345\nEast        505     540     520     610\nWest        330     360     395     410`, 'Which region grew the most from Q1 to Q4 in percent, and what was total Q4 revenue?'),
  S('SCR-slide-elasticity', 'normal', 'Lecture 7 — Price elasticity of demand', `Midpoint method:\n\n  E = [ (Q2 - Q1) / ((Q2 + Q1) / 2) ]  /  [ (P2 - P1) / ((P2 + P1) / 2) ]\n\nCoffee cart: price rises from $3.00 to $3.60;\ncups sold per day fall from 220 to 180.`, 'Using the method on the slide, what is the elasticity, and is demand elastic?'),
  S('SCR-slide-bayes', 'hard', 'Lecture 12 — Bayes\' theorem', `A test for a condition is 95 % sensitive and 90 % specific.\n2 % of the population has the condition.\n\nP(condition | positive) = ?\n\nHint: P(A|B) = P(B|A) P(A) / P(B)`, 'What is the answer to the question on the slide?'),
  S('SCR-slide-second-law', 'easy', 'Lecture 3 — Second law of thermodynamics', `Clausius: heat does not flow spontaneously from a colder body\nto a hotter body.\n\nKelvin-Planck: no cyclic engine converts heat from a single\nreservoir entirely into work.\n\nEntropy of an isolated system never decreases:  dS >= 0`, 'Explain this slide simply.'),
  S('SCR-notes-actions', 'easy', 'Weekly sync — notes', `1. Billing migration: cutover moved from the 14th to the 21st (Priya).\n2. Support backlog is at 312 tickets; target is under 200 by month end.\n3. Dario will draft the incident review for the 3 Oct outage by Friday.\n4. Hiring: two backend offers out, one accepted.\n5. Open question: who owns the SSO renewal? (unassigned)`, 'What are the action items and who owns them?'),
  S('SCR-table-latency', 'normal', 'Load test — results', `Concurrency   p50 ms   p95 ms   p99 ms   errors\n50            82       140      210      0.0 %\n100           88       165      260      0.0 %\n200           97       240      610      0.2 %\n400           180      910      2400     3.1 %\n800           640      3900     8200     17.4 %`, 'What stands out, and where does it fall over?'),
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function render(title, body) {
  const lines = body.split('\n');
  const rows = lines.map((l, i) => `<text x="40" y="${140 + i * 30}" font-family="Menlo, monospace" font-size="20" fill="#d4d4d4" xml:space="preserve">${esc(l)}</text>`).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${200 + lines.length * 30}"><rect width="100%" height="100%" fill="#1e1e1e"/><text x="40" y="70" font-family="Helvetica, Arial" font-size="34" fill="#ffffff">${esc(title)}</text>${rows}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// The app's own composition for a screenshot turn (as benchmarks/coding-contract/vision.mjs mirrors it).
let app = null;
try {
  const imp = (f) => import(pathToFileURL(path.join(DIST, f)).href);
  const [{ buildSystemPromptV2, buildTurnContentV2 }, { SCREEN_DIRECT_VISION_INSTRUCTION }, { planAnswer }, { resolveCodingPromptSignals, isDeicticAsk }] = await Promise.all([imp('promptSystemV2.js'), imp('WhatToAnswerLLM.js'), imp('index.js'), imp('codingPromptSignals.js')]);
  app = { buildSystemPromptV2, buildTurnContentV2, SCREEN_DIRECT_VISION_INSTRUCTION, planAnswer, resolveCodingPromptSignals, isDeicticAsk };
} catch (e) { console.error(`app prompt modules not loaded from ${DIST} (${String(e?.message ?? e).slice(0, 120)}) — using a plain instruction`); }

const outRows = [];
for (const s of SCREENS) {
  const png = await render(s.title, s.body);
  let system; let user;
  if (app) {
    const plan = app.planAnswer({ question: s.question, source: 'manual_input', speakerPerspective: 'user' });
    const resolved = app.resolveCodingPromptSignals({ answerType: plan.answerType, question: s.question });
    const screenIsTheSubject = !s.question.trim() || app.isDeicticAsk(s.question);
    const signals = (!resolved.codingTask && screenIsTheSubject) ? { codingTask: true, codingTaskKind: 'dsa' } : resolved;
    system = app.buildSystemPromptV2({ mode: 'general', action: 'what_to_say', tier: 'cloud', ...signals });
    user = app.buildTurnContentV2({ evidence: [], currentTurn: [app.SCREEN_DIRECT_VISION_INSTRUCTION, s.question || '(no transcript available — the screen is the subject)'].filter(Boolean).join('\n\n') });
  } else {
    system = 'You are a real-time assistant. The attached image is the user\'s current screen. Answer what the user needs about it: for a coding problem give the full solution with a short approach, for an error name the cause and the fix, otherwise answer the question in a few spoken sentences.';
    user = s.question || '(no question — the screen is the subject)';
  }
  outRows.push({ id: s.id, difficulty: s.difficulty, prompt_source: app ? 'app modules' : 'plain instruction', system, user, image_bytes: png.length, image_b64: png.toString('base64') });
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(outRows));
const g = {}; for (const r of outRows) g[r.difficulty] = (g[r.difficulty] ?? 0) + 1;
console.log(`${outRows.length} screens (${JSON.stringify(g)}), prompt from ${app ? 'the app\'s own modules' : 'a plain instruction'}, images ${Math.round(outRows.reduce((p, r) => p + r.image_bytes, 0) / outRows.length / 1024)} KB on average, system prompt ${Math.round(outRows.reduce((p, r) => p + r.system.length, 0) / outRows.length)} chars on average → ${path.relative(ROOT, out)}`);
