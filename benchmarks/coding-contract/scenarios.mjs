// benchmarks/coding-contract/scenarios.mjs
//
// The scenario matrix for the coding-answer contract (audit:
// .audit/coding-template-audit-2026-08-18.md). Each entry is a REAL question
// put through the REAL planner + prompt composer and answered by a REAL model;
// `expect` is graded deterministically against the returned text.
//
// Axes:
//   A  DSA problems            → six-section walkthrough, code present
//   B  implementation tasks    → code-first, correct fence, NO DSA headings
//   C  supplied templates      → the given signature + language survive
//   D  explicit formats        → the stated shape wins
//   E  first-turn continuation → code is NOT stripped (the C2b trap)
//   F  mode independence       → the same coding question in all 8 modes
//   G  non-coding controls     → no code dump, no section scaffold
//   H  screen-supplied stub    → template on screen, bare spoken question
//
// `expect` keys:
//   code          true = at least one fenced block, false = none
//   lang          expected fence tag(s) — array means any of
//   dsa           'all' = all six headings, 'none' = no DSA headings
//   mustContain   regexes that must match the answer
//   mustNotContain regexes that must not

const DSA = [
  ['two sum', 'Solve two sum in python', 'python'],
  ['reverse linked list', 'How do I reverse a linked list in python', 'python'],
  ['valid parentheses', 'Solve valid parentheses', null],
  ['binary search', 'Write binary search in python', 'python'],
  ['longest substring', 'Longest substring without repeating characters, in python', 'python'],
  ['merge intervals', 'Solve merge intervals', null],
  ['max depth binary tree', 'Maximum depth of a binary tree in python', 'python'],
  ['climbing stairs', 'Solve climbing stairs with dynamic programming', null],
  ['group anagrams', 'Solve group anagrams in python', 'python'],
  ['course schedule', 'Solve course schedule using topological sort', null],
];

const IMPL = [
  ['react stopwatch', 'Write a React stopwatch component with start, stop and reset', ['tsx', 'jsx']],
  ['csv parser', 'Build me a CSV parser in typescript that handles quoted fields', ['typescript', 'ts']],
  ['debounce util', 'Write a debounce utility in javascript', ['javascript', 'js']],
  ['express endpoint', 'Write an express endpoint that uploads a file to S3', ['javascript', 'typescript', 'js', 'ts']],
  ['sql report', 'Write a SQL query that returns the top 5 customers by revenue this month', ['sql']],
  ['python script', 'Write a python script that renames every .jpeg in a folder to .jpg', ['python']],
  ['react hook', 'Write a useLocalStorage React hook in typescript', ['tsx', 'typescript', 'ts']],
  ['bash-ish node cli', 'Write a node CLI that counts lines in every file passed as an argument', ['javascript', 'typescript', 'js', 'ts']],
];

// Supplied templates. `must` asserts the given entry point survived verbatim.
const TEMPLATES = [
  {
    id: 'python class Solution',
    question: 'Solve this:\n\nclass Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        pass',
    lang: ['python'],
    must: [/def\s+twoSum\s*\(\s*self\s*,\s*nums/, /class\s+Solution/],
  },
  {
    id: 'java signature',
    question: 'Complete this:\n\npublic int[] twoSum(int[] nums, int target) {\n    // your code here\n}',
    lang: ['java'],
    must: [/public\s+int\[\]\s+twoSum\s*\(\s*int\[\]\s+nums\s*,\s*int\s+target\s*\)/],
    mustNot: [/^\s*def\s+two_sum/m],
  },
  {
    id: 'go func',
    question: 'Finish this:\n\nfunc twoSum(nums []int, target int) []int {\n}',
    lang: ['go'],
    must: [/func\s+twoSum\s*\(\s*nums\s+\[\]int\s*,\s*target\s+int\s*\)\s*\[\]int/],
  },
  {
    id: 'rust fn',
    question: 'Implement this:\n\nfn two_sum(nums: Vec<i32>, target: i32) -> Vec<i32> {\n}',
    lang: ['rust'],
    must: [/fn\s+two_sum\s*\(\s*nums:\s*Vec<i32>\s*,\s*target:\s*i32\s*\)/],
  },
  {
    id: 'typescript arrow',
    question: 'Fill this in:\n\nconst twoSum = (nums: number[], target: number): number[] => {\n};',
    lang: ['typescript', 'ts'],
    must: [/twoSum\s*[=:(]/],
  },
  {
    id: 'cpp vector',
    question: 'Solve:\n\nvector<int> twoSum(vector<int>& nums, int target) {\n}',
    lang: ['cpp', 'c++'],
    // `std::` qualification is a legitimate C++ variant of the SAME signature
    // (it compiles without `using namespace std`), so the qualifier is optional
    // here. The name and parameter types are what conformance is about.
    must: [/(?:std::)?vector<int>\s+twoSum\s*\(\s*(?:std::)?vector<int>\s*&\s*nums/],
  },
  {
    id: 'python snake_case name preserved',
    question: 'Complete:\n\ndef find_pair_with_sum(numbers, wanted_total):\n    pass',
    lang: ['python'],
    must: [/def\s+find_pair_with_sum\s*\(\s*numbers\s*,\s*wanted_total\s*\)/],
    mustNot: [/def\s+two_?[Ss]um/],
  },
  {
    id: 'java non-leetcode signature',
    question: 'Implement this method:\n\npublic static boolean isBalanced(String expression) {\n}',
    lang: ['java'],
    must: [/public\s+static\s+boolean\s+isBalanced\s*\(\s*String\s+expression\s*\)/],
  },
  {
    id: 'fenced starter block',
    question: 'Here is the starter code, finish it:\n\n```python\ndef merge_sorted(a, b):\n    # your code here\n    pass\n```',
    lang: ['python'],
    must: [/def\s+merge_sorted\s*\(\s*a\s*,\s*b\s*\)/],
  },
  {
    id: 'javascript class method',
    question: 'Complete:\n\nclass LRUCache {\n  constructor(capacity) {\n  }\n  get(key) {\n  }\n  put(key, value) {\n  }\n}',
    lang: ['javascript', 'typescript', 'js', 'ts'],
    must: [/class\s+LRUCache/, /\bput\s*\(\s*key\s*,\s*value\s*\)/],
  },
];

const scenarios = [];
const push = (s) => scenarios.push(s);

// ── A. DSA ──────────────────────────────────────────────────────────────────
for (const [id, question, lang] of DSA) {
  push({
    group: 'A-dsa', id, question, mode: 'general',
    expect: { code: true, lang: lang ? [lang] : null, dsa: 'all' },
  });
}

// ── B. implementation ───────────────────────────────────────────────────────
for (const [id, question, lang] of IMPL) {
  push({
    group: 'B-impl', id, question, mode: 'general',
    expect: {
      code: true, lang, dsa: 'none',
      mustNotContain: [/##\s*Dry Run/i, /##\s*Interviewer Follow-up/i],
    },
  });
}

// ── C. supplied templates ───────────────────────────────────────────────────
for (const t of TEMPLATES) {
  push({
    group: 'C-template', id: t.id, question: t.question, mode: 'general',
    expect: { code: true, lang: t.lang, mustContain: t.must, mustNotContain: t.mustNot || [] },
  });
  // …and the same template inside a NON-coding mode: the supplied signature
  // must survive there too (the whole point of mode-independent coding).
  push({
    group: 'C-template-sales', id: `${t.id} @sales`, question: t.question, mode: 'sales',
    expect: { code: true, lang: t.lang, mustContain: t.must },
  });
}

// ── D. explicit formats ─────────────────────────────────────────────────────
push({
  group: 'D-format', id: 'code_only', mode: 'general',
  question: 'Just give me the code for two sum in python, nothing else',
  expect: { code: true, lang: ['python'], dsa: 'none', mustNotContain: [/##\s*Approach/i, /##\s*Complexity/i] },
});
push({
  group: 'D-format', id: 'code_only @lecture', mode: 'lecture',
  question: 'Only the code for reversing a string in python please',
  expect: { code: true, lang: ['python'], dsa: 'none' },
});
push({
  group: 'D-format', id: 'explain_only', mode: 'general',
  question: 'Explain the sliding window technique for longest substring without code',
  expect: { code: false, dsa: 'none' },
});
push({
  group: 'D-format', id: 'explain_only @technical-interview', mode: 'technical-interview',
  question: 'Explain how quicksort partitions, conceptually, no code',
  expect: { code: false },
});
push({
  group: 'D-format', id: 'complexity_only (with prior turn)', mode: 'general',
  question: 'What is the time and space complexity',
  priorCodingTurnExists: true,
  prior: {
    question: 'Solve two sum in python',
    answer: '## Approach\nUse a hash map of value → index.\n\n## Code\n```python\ndef twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n```',
  },
  expect: { code: false, mustContain: [/time complexity/i, /space complexity/i, /O\(/] },
});
push({
  group: 'D-format', id: 'dry_run_only (with prior turn)', mode: 'general',
  question: 'Dry run it with [2,7,11,15] and target 9',
  priorCodingTurnExists: true,
  prior: {
    question: 'Solve two sum in python',
    answer: '## Code\n```python\ndef twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n```',
  },
  expect: { mustContain: [/\b(2|7|11|15)\b/] },
});

// ── E. FIRST-TURN CONTINUATION TRAP (the C2b regression) ────────────────────
const TRAPS = [
  ['solve+complexity', 'Solve two sum and give me the time complexity'],
  ['solve+dryrun', 'Solve two sum and dry run it with [2,7,11,15]'],
  ['write+bigo', 'Write binary search and give me the big-o'],
  ['implement+complexity', 'Implement merge sort and state the complexity'],
  ['code+trace', 'Write BFS shortest path and trace through an example'],
  ['solve+walkthrough', 'Solve valid parentheses and walk me through the code'],
];
for (const [id, question] of TRAPS) {
  push({
    group: 'E-first-turn-trap', id, question, mode: 'general',
    // The defining assertion: the CODE must still be there. A continuation
    // contract leaking onto a first turn produces a bare complexity line.
    expect: { code: true, mustContain: [/O\(/] },
  });
}

// ── F. mode independence ────────────────────────────────────────────────────
const ALL_MODES = ['general', 'sales', 'recruiting', 'team-meet', 'looking-for-work', 'technical-interview', 'lecture', 'seminar'];
for (const mode of ALL_MODES) {
  push({
    group: 'F-mode-dsa', id: `two sum @${mode}`, mode,
    question: 'Solve two sum in python',
    expect: { code: true, lang: ['python'], dsa: 'all' },
  });
  push({
    group: 'F-mode-impl', id: `react stopwatch @${mode}`, mode,
    question: 'Write a React stopwatch component with start, stop and reset',
    expect: { code: true, lang: ['tsx', 'jsx'], dsa: 'none' },
  });
  push({
    group: 'F-mode-template', id: `java stub @${mode}`, mode,
    question: 'Complete this:\n\npublic int[] twoSum(int[] nums, int target) {\n    // your code here\n}',
    expect: { code: true, lang: ['java'], mustContain: [/public\s+int\[\]\s+twoSum/] },
  });
}

// ── G. non-coding controls (must NOT get a code dump) ───────────────────────
const CONTROLS = [
  ['behavioral', 'Tell me about a time you handled conflict on your team', 'looking-for-work'],
  ['sales objection', 'The customer says we are too expensive, how should I respond', 'sales'],
  ['lecture recap', 'What were the key points about photosynthesis just now', 'lecture'],
  ['recruiting', 'What follow-up question should I ask this candidate about their last role', 'recruiting'],
  ['team meeting', 'What are the action items from this discussion', 'team-meet'],
  ['definitional', 'What does idempotent mean', 'general'],
  ['system design discussion', 'How would you approach designing a rate limiter, at a high level', 'general'],
  ['smalltalk', 'How is the weather looking for the offsite', 'general'],
];
for (const [id, question, mode] of CONTROLS) {
  push({
    group: 'G-control', id, question, mode,
    expect: { code: false, dsa: 'none' },
  });
}

// ── H. template on SCREEN, bare spoken question ─────────────────────────────
push({
  group: 'H-screen', id: 'screen stub python', mode: 'technical-interview',
  question: 'Can you solve this one',
  screen: 'LeetCode 1. Two Sum\nclass Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        ',
  expect: { code: true, lang: ['python'], mustContain: [/def\s+twoSum\s*\(\s*self\s*,\s*nums/] },
});
push({
  group: 'H-screen', id: 'screen stub java @general', mode: 'general',
  question: 'How do I do this',
  screen: 'class Solution {\n    public boolean isValid(String s) {\n        \n    }\n}',
  expect: { code: true, lang: ['java'], mustContain: [/public\s+boolean\s+isValid\s*\(\s*String\s+s\s*\)/] },
});
push({
  group: 'H-screen', id: 'screen stub go @sales', mode: 'sales',
  question: 'What goes here',
  screen: 'func maxProfit(prices []int) int {\n\n}',
  expect: { code: true, lang: ['go'], mustContain: [/func\s+maxProfit\s*\(\s*prices\s+\[\]int\s*\)/] },
});

// ── I. local/tiny tier ──────────────────────────────────────────────────────
push({
  group: 'I-local', id: 'dsa @local tier', mode: 'general', tier: 'local',
  question: 'Solve two sum in python',
  expect: { code: true, dsa: 'all' },
});
push({
  group: 'I-local', id: 'impl @local tier', mode: 'general', tier: 'local',
  question: 'Write a React stopwatch component', expect: { code: true, dsa: 'none' },
});
push({
  group: 'I-local', id: 'template @local tier', mode: 'general', tier: 'local',
  question: 'Complete:\n\npublic int[] twoSum(int[] nums, int target) {\n}',
  expect: { code: true, mustContain: [/twoSum/] },
});

// ── J. build/create/make phrasings (were NOT detected as coding at all) ─────
// Measured 2026-08-18: only "write a …" reliably reached a coding type.
// "Build me a CSV parser" landed on project_answer — answered as a résumé
// project story. These are the phrasings, not the algorithms.
const BUILD_PHRASINGS = [
  ['build me', 'Build me a CSV parser in typescript that handles quoted fields', ['typescript', 'ts']],
  ['create a', 'Create a debounce utility in javascript', ['javascript', 'js']],
  ['make me', 'Make me a React login form component', ['tsx', 'jsx']],
  ['build an endpoint', 'Build an express endpoint that uploads a file to S3', ['javascript', 'typescript', 'js', 'ts']],
  ['generate a', 'Generate a migration script for the users table in SQL', ['sql']],
  ['build a hook', 'Build a useDebounce hook in typescript', ['tsx', 'typescript', 'ts']],
];
for (const [id, question, lang] of BUILD_PHRASINGS) {
  push({
    group: 'J-build-verb', id, question, mode: 'general',
    expect: { code: true, lang, dsa: 'none' },
  });
  push({
    group: 'J-build-verb-sales', id: `${id} @sales`, question, mode: 'sales',
    expect: { code: true, lang },
  });
}

// ── K. canonical problems that FELL THROUGH the DSA list ────────────────────
// 30 of 40 canonical interview problems missed AnswerPlanner's DSA_PATTERNS and
// would have received the code-first implementation shape — no dry run, no
// complexity — once the kind started selecting the contract.
const FELL_THROUGH = [
  'valid parentheses', 'coin change', 'trapping rain water', 'number of islands',
  'maximum subarray', 'top k frequent elements', 'climbing stairs', 'word break',
  'longest palindromic substring', 'merge intervals', 'group anagrams', 'jump game',
];
for (const problem of FELL_THROUGH) {
  push({
    group: 'K-dsa-fallthrough', id: problem, mode: 'general',
    question: `Solve ${problem} in python`,
    expect: { code: true, lang: ['python'], dsa: 'all' },
  });
}

// ── L. non-coding build/create/make (must stay non-coding) ──────────────────
const BUILD_CONTROLS = [
  ['build rapport', 'How do I build rapport with this customer', 'sales'],
  ['create a deck', 'Should I create a deck for the board meeting or send a memo', 'team-meet'],
  ['make a decision', 'Help me make a decision on which pricing tier to offer', 'sales'],
  ['build a relationship', 'We need to build a relationship with procurement, what is my opening', 'sales'],
  ['project you built', 'Tell me about a project you built recently', 'looking-for-work'],
];
for (const [id, question, mode] of BUILD_CONTROLS) {
  push({ group: 'L-build-control', id, question, mode, expect: { code: false, dsa: 'none' } });
}

export default scenarios;
