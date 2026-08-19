// electron/llm/__tests__/CodingTemplateContract2026_08_18.test.mjs
//
// Coding-answer PRESENTATION contract (audit: .audit/coding-template-audit-2026-08-18.md).
//
// Three defects, all in presentation rather than detection:
//   C1 the DSA six-section contract was attached to EVERY coding turn, so an
//      implementation task received CODING_IMPL_TEMPLATE ("do NOT use the DSA
//      headings") from the planner and the six-heading contract from the v2
//      system prompt at the same time;
//   C2 an explicit format request ("just the code") was honoured in manual chat
//      and ignored on every live surface — its only live consumer,
//      LiveMomentRouter.routeLiveMoment, is called by nothing but its tests;
//   C3 a code template already supplied by the question (signature / stub /
//      class skeleton) had no handling anywhere.
//
// What must NOT regress: a coding question still gets a code answer in EVERY
// mode, not only technical-interview.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __tdir = path.dirname(fileURLToPath(import.meta.url));
const fsReadFile = (rel) => fs.readFileSync(path.resolve(__tdir, rel), 'utf8');
import { test, describe } from 'node:test';
import {
  buildSystemPromptV2,
  getV2PromptDescriptor,
} from '../../../dist-electron/electron/llm/promptSystemV2.js';
import {
  resolveCodingPromptSignals,
  detectSuppliedCodeTemplate,
  codingTaskKindFor,
  isDeicticAsk,
} from '../../../dist-electron/electron/llm/codingPromptSignals.js';
import {
  planAnswer,
  validateAnswerStructure,
  isBareCodeRequest,
  isCodingContinuation,
  looksLikeCodingAnswer,
} from '../../../dist-electron/electron/llm/index.js';

const DSA_HEADINGS = ['## Approach', '## Technique / Data Structure / Algorithm Used', '## Code', '## Dry Run', '## Complexity', '## Interviewer Follow-up Points'];

const build = (over = {}) => buildSystemPromptV2({ mode: 'general', action: 'answer', tier: 'cloud', ...over });

// The eight built-in modes plus 'custom' — the full v2 mode surface.
const ALL_MODES = ['general', 'sales', 'recruiting', 'team-meet', 'looking-for-work', 'technical-interview', 'lecture', 'seminar', 'custom'];

describe('C0 — universal activation must not regress', () => {
  test('a coding turn attaches the coding contract in EVERY mode', () => {
    for (const mode of ALL_MODES) {
      const prompt = build({ mode, codingTask: true, codingTaskKind: 'dsa' });
      assert.ok(prompt.includes('<coding_contract>'), `${mode} lost the coding contract`);
      for (const heading of DSA_HEADINGS) {
        assert.ok(prompt.includes(heading), `${mode} lost "${heading}"`);
      }
    }
  });

  test('a NON-coding turn attaches no contract outside technical-interview', () => {
    for (const mode of ALL_MODES.filter((m) => m !== 'technical-interview')) {
      assert.ok(!build({ mode }).includes('<coding_contract>'), `${mode} attached a coding contract to a non-coding turn`);
    }
  });
});

describe('C1 — the implementation contract must be reachable', () => {
  test("kind 'impl' gets the implementation contract, NOT the DSA walkthrough", () => {
    const prompt = build({ codingTask: true, codingTaskKind: 'impl' });
    assert.ok(prompt.includes('IMPLEMENTATION RESPONSE CONTRACT'));
    assert.ok(prompt.includes('ready-to-run implementation'));
    // The defining symptom: the six mandatory headings forced onto "build me a
    // component". The impl contract names those headings only to FORBID them,
    // so assert on the mandate, not on the words.
    assert.ok(prompt.includes('Do NOT use the DSA interview section headings'));
    assert.ok(!prompt.includes('Every heading is mandatory'), 'impl turn still mandates the six headings');
    assert.ok(!prompt.includes('- Walk through ONE sample input step by step'), 'impl turn still demands a dry run');
  });

  test("kind 'dsa' keeps the validator-pinned six sections", () => {
    const prompt = build({ codingTask: true, codingTaskKind: 'dsa' });
    for (const heading of DSA_HEADINGS) assert.ok(prompt.includes(heading), `missing ${heading}`);
    assert.ok(!prompt.includes('IMPLEMENTATION RESPONSE CONTRACT'));
  });

  test('an absent kind keeps the pre-fix DSA default (legacy callers unchanged)', () => {
    const prompt = build({ codingTask: true });
    for (const heading of DSA_HEADINGS) assert.ok(prompt.includes(heading), `missing ${heading}`);
  });

  test('the impl contract reaches the local tier too', () => {
    const prompt = build({ codingTask: true, codingTaskKind: 'impl', tier: 'local' });
    assert.ok(prompt.includes('IMPLEMENTATION RESPONSE CONTRACT'));
    assert.ok(!prompt.includes('Every heading is mandatory'));
  });

  // The kind is resolved from the answer type AND the question, never the type
  // alone. `coding_question_answer` is the FALLTHROUGH coding route, not a
  // synonym for "implementation": `dsa_question_answer` requires a hit in
  // AnswerPlanner's finite DSA_PATTERNS list, and measured over 40 canonical
  // interview problems only 10 matched. Reading 'impl' off the type would have
  // given 30 of 40 classic problems the code-first shape with no dry run and no
  // complexity — caught by the live benchmark, not by prompt-level tests.
  const kindOf = (question) =>
    codingTaskKindFor(planAnswer({ question, source: 'manual_input', speakerPerspective: 'user' }).answerType, question);

  const CANONICAL_PROBLEMS = [
    'two sum', 'three sum', 'valid parentheses', 'merge intervals', 'climbing stairs',
    'group anagrams', 'course schedule', 'binary search', 'merge two sorted lists',
    'best time to buy and sell stock', 'product of array except self', 'number of islands',
    'word break', 'coin change', 'lru cache', 'trapping rain water', 'maximum subarray',
    'rotate array', 'valid anagram', 'longest palindromic substring', 'house robber',
    'edit distance', 'top k frequent elements', 'spiral matrix', 'subsets', 'permutations',
    'jump game', 'clone graph', 'implement trie', 'min stack', 'decode ways', 'unique paths',
  ];
  test('every canonical interview problem gets the DSA shape', () => {
    const wrong = CANONICAL_PROBLEMS.filter((p) => kindOf(`Solve ${p}`) !== 'dsa');
    assert.deepEqual(wrong, [], `these lost the six-section shape: ${wrong.join(', ')}`);
  });

  const BUILD_TASKS = [
    'Write a React stopwatch component with start, stop and reset',
    'Build me a CSV parser in typescript',
    'Create a CSV parser in typescript',
    'Make me a debounce utility',
    'Build a React login form',
    'build an express endpoint that uploads to S3',
    'Write a SQL query that returns the top 5 customers by revenue this month',
    'Write a python script that renames every .jpeg in a folder to .jpg',
    'Generate a migration script for the users table',
  ];
  test('every build task gets the implementation shape', () => {
    const wrong = BUILD_TASKS.filter((q) => kindOf(q) !== 'impl');
    assert.deepEqual(wrong, [], `these did not reach the impl contract: ${wrong.join(' | ')}`);
  });

  // The build/create/make verbs are paired with a software OBJECT, never bare —
  // a bare verb would repeat the `class`/`method` P0 documented in
  // answerPlannerPatterns.ts (a thesis question answered with Two Sum).
  const NOT_CODING = [
    'build rapport with the customer',
    'create a deck for the board meeting',
    'make a decision on the pricing tier',
    'we need to build a relationship with procurement',
    'build consensus in the team',
    'tell me about a project you built',
    'what did you build at your last job',
  ];
  test('ordinary non-coding uses of build/create/make stay non-coding', () => {
    const wrong = NOT_CODING.filter((q) => kindOf(q) !== undefined);
    assert.deepEqual(wrong, [], `these were hijacked into the coding route: ${wrong.join(' | ')}`);
  });

  test('the resolver never contradicts the validator for the same answer type', () => {
    // An impl answer that is code-only must PASS validation; if the prompt asked
    // for six sections while the validator accepted a bare fence, the model was
    // being told to produce something nothing downstream wanted.
    const implOnlyCode = '```tsx\nexport const Stopwatch = () => <div />;\n```';
    assert.equal(validateAnswerStructure('coding_question_answer', implOnlyCode).ok, true);
    assert.equal(validateAnswerStructure('dsa_question_answer', implOnlyCode).ok, false);
  });
});

describe('C2 — explicit format requests bind every surface', () => {
  // `priorCodingTurnExists` distinguishes a SELF-CONTAINED format request from a
  // CONTINUATION one — see the first-turn suite below.
  const CASES = [
    ['just give me the code for two sum', 'code_only', 'CODE ONLY', false],
    ['what is the time and space complexity', 'complexity_only', 'COMPLEXITY', true],
    ['dry run this with [2,7,11,15]', 'dry_run_only', 'DRY RUN', true],
    ['explain it without code', 'explain_only', 'NO CODE', false],
  ];

  for (const [question, expected, marker, priorCodingTurnExists] of CASES) {
    test(`"${question}" → ${expected}, and the six sections stand down`, () => {
      const signals = resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question, priorCodingTurnExists });
      assert.equal(signals.codingFormat, expected);

      const prompt = build({ codingTask: true, ...signals });
      assert.ok(prompt.includes(marker), `directive missing for ${expected}`);
      assert.ok(prompt.includes('stated format WINS'));
      // The whole point: no mandatory-heading language survives.
      assert.ok(!prompt.includes('Every heading is mandatory'), `${expected} still forces the template`);
      assert.ok(!prompt.includes('## Interviewer Follow-up Points'), `${expected} still forces follow-up points`);
    });
  }

  test('the repair layer respects the same constraint (prompt-only would be undone)', () => {
    // A code-only answer has none of the six sections. Without the contract the
    // validator repairs it back into the full template.
    const codeOnly = '```python\ndef two_sum(nums, target):\n    return []\n```';
    assert.equal(validateAnswerStructure('dsa_question_answer', codeOnly).ok, false);
    assert.equal(validateAnswerStructure('dsa_question_answer', codeOnly, 'code_only').ok, true);
  });

  test('a plain coding question carries no format constraint', () => {
    const signals = resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question: 'solve two sum' });
    assert.equal(signals.codingFormat, undefined);
    assert.ok(build({ codingTask: true, ...signals }).includes('Every heading is mandatory'));
  });
});

describe('C2b — a continuation format must not strip a FIRST-turn answer', () => {
  // Regression from the C2 fix itself, caught in review: two of the four format
  // verdicts are CONTINUATION contracts whose directive references "the solution
  // already in the conversation". Honouring them on a first turn answers
  // "solve two sum and give me the time complexity" with a bare complexity line
  // and no code — the exact opposite of the requirement. code_only and
  // explain_only are self-contained and stay unconditional.
  const FIRST_TURN_FULL_ANSWERS = [
    'Solve two sum and give me the time complexity',
    'solve two sum and dry run it with [2,7,11,15]',
    'write binary search and give me the big-o',
  ];
  for (const question of FIRST_TURN_FULL_ANSWERS) {
    test(`"${question.slice(0, 44)}" still gets the full contract on a first turn`, () => {
      const signals = resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question });
      assert.equal(signals.codingFormat, undefined, 'a continuation format leaked onto a first turn');
      assert.ok(build({ ...signals }).includes('Every heading is mandatory'));
    });
  }

  test('the same question DOES take the continuation format once a prior turn exists', () => {
    const signals = resolveCodingPromptSignals({
      answerType: 'dsa_question_answer',
      question: 'what is the time and space complexity',
      priorCodingTurnExists: true,
    });
    assert.equal(signals.codingFormat, 'complexity_only');
  });

  test('self-contained formats need no prior turn', () => {
    for (const [question, expected] of [['just give me the code', 'code_only'], ['explain it without code', 'explain_only']]) {
      assert.equal(resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question }).codingFormat, expected);
    }
  });

  test('the default is the FULL contract, never a stripped one', () => {
    // An un-wired surface must degrade to "more than asked", not "missing the code".
    assert.equal(resolveCodingPromptSignals({ answerType: 'dsa_question_answer', question: 'dry run it' }).codingFormat, undefined);
  });
});

describe('C3 — a template supplied in the question is followed', () => {
  test('conformance rules ride every coding contract', () => {
    for (const kind of ['dsa', 'impl']) {
      const prompt = build({ codingTask: true, codingTaskKind: kind });
      assert.ok(prompt.includes('TEMPLATE CONFORMANCE'), `${kind} lost the conformance rule`);
      assert.ok(prompt.includes('WRITE YOUR SOLUTION INTO IT'), `${kind} lost the "write into the given stub" rule`);
    }
    // …including on an explicit-format turn, where the shape changes but the
    // supplied signature is just as binding.
    assert.ok(build({ codingTask: true, codingFormat: 'code_only' }).includes('TEMPLATE CONFORMANCE'));
    assert.ok(build({ codingTask: true, tier: 'local' , codingTaskKind: 'dsa' }).includes('TEMPLATE CONFORMANCE'));
  });

  test('a detected template turns the conditional rule into an affirmative one', () => {
    const without = build({ codingTask: true, codingTaskKind: 'dsa' });
    const withTemplate = build({ codingTask: true, codingTaskKind: 'dsa', suppliedTemplate: true });
    assert.ok(!without.includes('A code template IS present'));
    assert.ok(withTemplate.includes('A code template IS present'));
  });

  const TEMPLATES = [
    'class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        pass',
    'keep the given signature',
    'use the provided stub',
    'public int[] twoSum(int[] nums, int target) {\n}',
    'func TwoSum(nums []int, target int) []int {\n}',
    'fn two_sum(nums: Vec<i32>, target: i32) -> Vec<i32> {}',
    'here is the starter code, fill it in',
    '```python\ndef solve(n):\n    # your code here\n```',
    'const solve = (nums) => { }',
  ];
  for (const q of TEMPLATES) {
    test(`detects the template in ${JSON.stringify(q.slice(0, 48))}`, () => {
      assert.equal(detectSuppliedCodeTemplate(q), true);
    });
  }

  const NOT_TEMPLATES = [
    // Plain action phrasings with no artifact: these must NOT raise the
    // AFFIRMATIVE "a code template IS present" line, because there isn't one.
    // The always-on conditional conformance rule still covers them if a stub
    // does turn out to be on screen.
    'complete the following function to merge two sorted arrays',
    'implement the method that reverses a string',
    'solve two sum in python',
    'what is the time complexity of quicksort',
    'how would you design a rate limiter',
    'can you write a function that reverses a string',
    'tell me about your last project',
    '',
    null,
  ];
  for (const q of NOT_TEMPLATES) {
    test(`no false positive on ${JSON.stringify(q)}`, () => {
      assert.equal(detectSuppliedCodeTemplate(q), false);
    });
  }

  test('a stub on SCREEN raises the signal even when the question is bare', () => {
    // The canonical reported case: the question is spoken ("solve this"), the
    // stub is in the editor. It never reaches answerPlan.question.
    const signals = resolveCodingPromptSignals({
      answerType: 'dsa_question_answer',
      question: 'solve this one',
      surroundingText: 'class Solution:\n    def twoSum(self, nums, target):\n        pass',
    });
    assert.equal(signals.suppliedTemplate, true);
  });

  test('the resolver reports a supplied template end to end', () => {
    const signals = resolveCodingPromptSignals({
      answerType: 'dsa_question_answer',
      question: 'class Solution:\n    def twoSum(self, nums, target):\n        pass',
    });
    assert.equal(signals.suppliedTemplate, true);
    assert.ok(build({ ...signals }).includes('A code template IS present'));
  });
});

describe("C3b — a pasted stub must not be mistaken for a source-code-evidence ask", () => {
  // Found by the behavioural matrix, not by reading: SOURCE_CODE_EVIDENCE_PATTERNS
  // had an OPTIONAL lead-in, so the pattern reduced to a bare "your code" anywhere
  // in the text. "// your code here" — the most common starter-stub comment on
  // LeetCode/HackerRank — therefore routed a PASTED CODING TEMPLATE to
  // source_code_evidence_answer, which is not a coding answer type, so the turn
  // got no coding contract at all outside technical-interview mode. The exact
  // shape the user reported: a question that already carries a template.
  const plan = (question) => planAnswer({ question, source: 'manual_input', speakerPerspective: 'user' }).answerType;

  test('a pasted stub carrying "// your code here" routes to a coding type', () => {
    for (const stub of [
      'public int[] twoSum(int[] nums, int target) {\n  // your code here\n}',
      'def solve(n):\n    # your code here',
      'function reverse(list) {\n  // your code here\n}',
    ]) {
      const type = plan(stub);
      assert.ok(['dsa_question_answer', 'coding_question_answer'].includes(type), `${JSON.stringify(stub.slice(0, 40))} routed to ${type}`);
      assert.equal(resolveCodingPromptSignals({ answerType: type, question: stub }).suppliedTemplate, true);
    }
  });

  test('genuine source-code-evidence asks are unchanged', () => {
    for (const q of [
      'what does your actual retrieval code look like',
      'show me your code',
      'can you show me the natively code for embeddings',
      'give me a repo-verifiable snippet',
    ]) {
      assert.equal(plan(q), 'source_code_evidence_answer', `${JSON.stringify(q)} lost its source-evidence route`);
    }
  });
});

describe('C3c — a stub on screen promotes a deictic ask into a coding turn', () => {
  // KNOWN-OPEN gap, pinned since 2026-08-05 in
  // context-intelligence/__tests__/ScreenCodeAskCodingTask2026_08_05.test.mjs:
  // a code ask with screen evidence never claims CODING_TASK. Live-measured:
  // "How do I do this" with a Java stub on screen produced prose, no code.
  const signals = (question, surroundingText) => resolveCodingPromptSignals({
    answerType: planAnswer({ question, source: 'manual_input', speakerPerspective: 'user' }).answerType,
    question,
    surroundingText,
  });
  const JAVA_STUB = 'class Solution {\n  public boolean isValid(String s) {\n  }\n}';

  test('a deictic ask + a structural stub on screen becomes a coding turn', () => {
    for (const q of ['How do I do this', 'What goes here', 'fix this', 'what should this return']) {
      const s = signals(q, JAVA_STUB);
      assert.equal(s.codingTask, true, `"${q}" was not promoted`);
      assert.equal(s.suppliedTemplate, true);
      assert.equal(s.codingTaskKind, 'dsa', 'promotion must default to the shape that CONTAINS the code');
    }
  });

  test('promotion needs BOTH halves', () => {
    // deictic but no template on screen
    assert.equal(signals('How do I do this', 'a dashboard with some charts').codingTask, false);
    // template on screen but not a deictic ask
    assert.equal(signals('What are the action items from this meeting so far, summarised for the team', JAVA_STUB).codingTask, false);
  });

  // The exact wording from the reported failing session. It routes
  // `profile_fact_answer` — the planner reads "what should I say" as a question
  // about the user's own profile — so a gate on `unknown_answer` alone missed it,
  // which is why the same screenshot answered in prose one turn and in six
  // sections the next.
  test('screen-directed questions are recognised regardless of what they route to', () => {
    for (const q of ['What should I say about this?', 'How do I answer this', 'What about this', 'solve this', 'whats the answer here']) {
      assert.equal(isDeicticAsk(q), true, `"${q}" is not treated as screen-directed`);
    }
    assert.equal(planAnswer({ question: 'What should I say about this?', source: 'manual_input', speakerPerspective: 'user' }).answerType, 'profile_fact_answer',
      'routing changed — the promotion gate must stay independent of the routed type');
  });

  test('a question carrying its own subject is not screen-directed', () => {
    for (const q of [
      'What should I say about my experience with Kafka',
      'what should I say about the pricing objection from Acme',
      'tell me about my last project',
    ]) {
      assert.equal(isDeicticAsk(q), false, `"${q}" was treated as screen-directed`);
    }
  });

  test('retrospective small talk is never promoted, even with an editor on screen', () => {
    for (const q of ['how did that go', 'was that ok', 'what have you done here']) {
      assert.equal(signals(q, JAVA_STUB).codingTask, false, `"${q}" was hijacked into a coding turn`);
    }
  });
});

describe('C4 — a bare "code?" must inherit the problem just answered', () => {
  // Live repro 2026-08-18: the overlay solved a Trapping Rain Water screenshot,
  // the user typed "code?" in chat, and got a complete, confident BINARY SEARCH
  // answer. "code" matches CODING_PATTERNS so the turn was routed coding and
  // handed the full contract — with no problem attached, so the model chose one.
  // Matched as a TOKEN SET, not a phrase list: the user's second failing turn was
  // "code answe" — a truncated "code answer" — which a phrase regex missed, and
  // the model answered a Missing Number problem for a Trapping Rain Water screen.
  const BARE = ['code?', 'code', 'the code', 'show the code', 'show me the code',
    'can I see the code', 'give me the code', 'code please', 'and the code?', 'now the code',
    'code answe', 'code answer', 'full solution please', 'code pls', 'the solution'];
  test('bare code requests are recognised as continuations', () => {
    for (const q of BARE) {
      assert.equal(isBareCodeRequest(q), true, `"${q}" not recognised`);
      assert.equal(isCodingContinuation(q), true, `"${q}" is not a continuation`);
    }
  });

  test('a question carrying its own subject is NOT a bare code request', () => {
    for (const q of [
      'write code for two sum',
      'code for binary search in python',
      'what does this code do',
      'the code review went well',
      'can I see the code you wrote at your last job',
      'what is the answer to the pricing question',
      'answer the customer objection about cost',
      'solve two sum',
    ]) {
      assert.equal(isBareCodeRequest(q), false, `"${q}" was treated as subject-less`);
    }
  });
});

describe('C5 — channel audit: every screen transport reaches the contract (2026-08-19)', () => {
  // Three live repros, three different transports (pixels, DOM text, OCR), each
  // dark in turn because a behaviour was keyed to ONE of them. These pins assert
  // the union wiring survives on every surface that composes a prompt.
  const read = (rel) => fsReadFile(rel);

  test('WhatToAnswerLLM unions domContext + OCR and gates on images OR screen text', () => {
    const src = read('../WhatToAnswerLLM.ts');
    assert.match(src, /\[domContext, screenContext\?\.ocrText\]/, 'WTA lost the channel union');
    assert.match(src, /hasAttachedImages \|\| hasScreenText/, 'WTA promotion keys on a single transport again');
    assert.match(src, /SCREEN_DOM_INSTRUCTION/, 'the DOM-capture screen instruction is gone');
  });

  test('IntelligenceEngine V3 personaBase unions domContext + OCR and promotes deictic screen turns', () => {
    const src = read('../../IntelligenceEngine.ts');
    assert.match(src, /\[options\?\.domContext, options\?\.screenContext\?\.ocrText\]/, 'IE personaBase lost the channel union');
    assert.match(src, /_screenIsSubject/, 'IE personaBase lost the screen promotion');
  });

  test('chat V3 personaBase promotes an attached screenshot with a deictic ask', () => {
    const src = read('../../ipcHandlers.ts');
    assert.match(src, /imagePaths\?\.length \?\? 0\) > 0\s*&&\s*\(!v3Question\.trim\(\) \|\| require\('\.\/llm\/codingPromptSignals'\)\.isDeicticAsk\(v3Question\)/, 'chat V3 lost the screenshot promotion');
    assert.match(src, /codingTask: codingTask \|\| codingSignals\.codingTask \|\| !!priorProblem/, 'the promoted codingTask is not fed into the composed prompt');
  });

  test('both legacy LLMHelper transports promote an attached screenshot', () => {
    const src = read('../../LLMHelper.ts');
    const hits = (src.match(/imagePaths\?\.length \?\? 0\) > 0\s*&&\s*\(!message\?\.trim\(\) \|\| isDeicticAsk\(message\)/g) || []).length;
    assert.equal(hits, 2, `expected the promotion on BOTH LLMHelper entry points, got ${hits}`);
  });

  test('code_hint stays contract-by-action (the always-covered channel)', () => {
    const src = read('../promptSystemV2.ts');
    assert.match(src, /CODING_CONTRACT_ACTIONS.*=.*new Set\(\['code_hint'\]\)/, 'code_hint left the always-contract action set');
  });
});

describe('C6 — richer continuations inherit the prior answer, gated on it looking technical (2026-08-19)', () => {
  const CODING_PRIOR = 'To solve this, use a two-pointer approach and track the maximum height from each side, giving linear time and constant space complexity.';
  const SALES_PRIOR = 'I would acknowledge the pricing concern, restate the value the pilot showed, and offer the annual tier with the onboarding credit.';

  test('coding continuations are recognised', () => {
    for (const q of ['what is the time and space complexity', 'dry run it with [0,1,0,2]',
      'now do it with the brute force approach instead', 'can you memoize it', 'make it iterative']) {
      assert.equal(isCodingContinuation(q), true, `"${q}" not a continuation`);
    }
  });

  test('the technical gate lets a coding prior in and keeps a sales prior out', () => {
    assert.equal(looksLikeCodingAnswer(CODING_PRIOR), true, 'the overlay prose answer must qualify');
    assert.equal(looksLikeCodingAnswer(SALES_PRIOR), false, 'a sales answer must never become a "prior coding problem"');
    assert.equal(looksLikeCodingAnswer(''), false);
    assert.equal(looksLikeCodingAnswer(null), false);
  });

  test('both chat paths carry the extended guard (source pins)', () => {
    const ipc = fsReadFile('../../ipcHandlers.ts');
    const hits = (ipc.match(/isBareCodeRequest\(\w+\) \|\| isCodingContinuation\(\w+\)/g) || []).length;
    assert.equal(hits, 2, `expected the extended guard on BOTH chat paths (V3 personaBase + legacy), got ${hits}`);
    assert.match(ipc, /looksLikeCodingAnswer\(lastAnywhere\)/, 'the technical gate on the recalled answer is gone');
    assert.match(ipc, /priorCodingTurnExists: !!priorProblem/, 'a recalled prior no longer unlocks the continuation formats');
  });
});

describe('C7 — a repeat press on the same problem re-answers it (2026-08-19)', () => {
  // Live repro: turn 1 (screenshot) produced the full six-section answer; the
  // three FOLLOWING blind presses on the same LeetCode page produced commentary
  // — the model agreeing with its own prior answer, which rode the prompt as
  // conversation history while the intent classifier read the blind turn as
  // follow_up. The fix: a promoted blind screen turn WITHHOLDS prior responses
  // and carries an explicit repeat-press directive.
  test('WhatToAnswerLLM withholds history and attaches the directive on promoted turns (source pins)', () => {
    const src = fsReadFile('../WhatToAnswerLLM.ts');
    assert.match(src, /promotedScreenCodingTurn = true/, 'the promotion flag is gone');
    assert.match(src, /<repeat_press_directive>/, 'the repeat-press directive is gone');
    assert.match(src, /!promotedScreenCodingTurn\s*&&\s*temporalContext\?\.hasRecentResponses/,
      'prior responses are no longer withheld on promoted screen turns');
  });

  test('the bare trigger phrasings count as screen-directed', () => {
    for (const q of ['What should I say?', 'what do i say', 'what can I answer?']) {
      assert.equal(isDeicticAsk(q), true, `"${q}" missed`);
    }
  });

  test('trigger phrasings WITH their own subject stay out', () => {
    for (const q of ['What should I say about my experience with Kafka', 'what should I say to the recruiter about salary', 'what should I say in my intro']) {
      assert.equal(isDeicticAsk(q), false, `"${q}" wrongly promoted`);
    }
  });
});

describe('resolver contract', () => {
  test('a non-coding answer type produces no signals at all', () => {
    const signals = resolveCodingPromptSignals({ answerType: 'behavioral_interview_answer', question: 'just give me the code' });
    assert.deepEqual(signals, { codingTask: false });
    assert.ok(!build({ ...signals }).includes('<coding_contract>'));
  });

  test('missing input never throws', () => {
    assert.deepEqual(resolveCodingPromptSignals({}), { codingTask: false });
    assert.deepEqual(resolveCodingPromptSignals({ answerType: null, question: null }), { codingTask: false });
  });

  test('signals survive into the prompt descriptor (cloud→local recomposition)', () => {
    const prompt = build({ codingTask: true, codingTaskKind: 'impl', codingFormat: 'code_only', suppliedTemplate: true });
    const descriptor = getV2PromptDescriptor(prompt);
    assert.equal(descriptor.codingTaskKind, 'impl');
    assert.equal(descriptor.codingFormat, 'code_only');
    assert.equal(descriptor.suppliedTemplate, true);
  });
});
