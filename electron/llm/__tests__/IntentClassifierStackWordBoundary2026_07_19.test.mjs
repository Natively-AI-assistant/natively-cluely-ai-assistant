// electron/llm/__tests__/IntentClassifierStackWordBoundary2026_07_19.test.mjs
//
// Campaign 2 longsession (2026-07-19, run-032/033 forensics): the WTA
// intent classifier's DSA/coding regex fast-path (detectIntentByPattern,
// IntentClassifier.ts) had several data-structure nouns (stack, queue, heap,
// trie, graph, tree, recursion) matched as UN-anchored bare substrings — no
// `\b` word-boundary wrapping — so they matched INSIDE unrelated English
// words that merely contain the substring. This is a DIFFERENT bug from the
// earlier "stack up" idiom fix (IntentClassifierStackUpIdiom2026_07_17,
// JdFitStackUpIdiom2026_07_17) — that fix neutralizes the specific "stack
// (s/ed) up" idiom before this regex runs; it does nothing for a bare
// substring match inside an ordinary past-tense verb like "stacked".
//
// Live-confirmed root cause of script-b's (technical deep-dive) near-total
// document-grounded answer-quality collapse in run-032/033: "How many
// identical layers are stacked in the encoder?" — a real, well-grounded
// Transformer-paper question with nothing to do with the data structure —
// matched the bare `stack` alternative, classified as `coding` intent at
// 0.95 confidence, and routed to `coding_question_answer`
// (AnswerPlanner.ts:2609's `input.intentResult?.intent === 'coding'`
// OR-check), which bypasses the ENTIRE doc-grounded validation/retry/repair
// safety net (every doc-grounded guard in IntelligenceEngine.ts gates on
// `!isCoding`), producing a generic non-answer for a genuinely answerable
// question.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { classifyIntent } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/IntentClassifier.js')).href
);

describe('IntentClassifier (WTA) DSA-noun word-boundary fix', () => {
  test('the exact live-failing question is NOT classified as coding via the regex fast-path', async () => {
    const q = 'How many identical layers are stacked in the encoder?';
    const r = await classifyIntent(q, '', 0);
    assert.notEqual(r.intent, 'coding');
  });

  test('a genuine data-structure "stack" question is UNAFFECTED (still fast-paths to coding)', async () => {
    const r = await classifyIntent('can you implement a stack using two queues', '', 0);
    assert.equal(r.intent, 'coding');
    assert.equal(r.confidence, 0.95);
  });

  test('a real DSA problem name still fast-paths to coding', async () => {
    const r = await classifyIntent('two sum problem, can you solve it', '', 0);
    assert.equal(r.intent, 'coding');
    assert.equal(r.confidence, 0.95);
  });

  test('other bare-substring collisions (queue/heap/graph/tree/recursion) do not misfire on ordinary English', async () => {
    // Note: "queue" as a whole word is legitimately DSA-adjacent vocabulary
    // (verified separately below) — a sentence that uses it as a genuine
    // whole word, even in a non-DSA context ("training queue depth"), is
    // expected to still fast-path today; that is pre-existing regex-tier
    // over-eagerness this fix does not attempt to solve, only the bare-
    // substring-inside-another-word class of false match.
    const cases = [
      'how many attention heads are enqueued for parallel processing in this diagram?',
      'the model heaped up a lot of technical debt over the quarter',
      'can you tell me about the org chart, who do you report to on the graphs team?',
      'what does the agraphia section of the paper discuss?',
      'how many pages does the treeatise cover?',
      'the recursively-generated documentation was outdated',
    ];
    for (const q of cases) {
      const r = await classifyIntent(q, '', 0);
      assert.notEqual(r.intent, 'coding', `expected NOT coding for: "${q}", got ${JSON.stringify(r)}`);
    }
  });

  test('genuine whole-word DSA nouns still fast-path to coding', async () => {
    // "walk me through a graph traversal algorithm" is intentionally excluded
    // here — detectIntentByPattern checks the deep_dive pattern ("walk me
    // through") BEFORE the DSA pattern, so it correctly resolves to
    // deep_dive at 0.85, a pre-existing prioritization this fix does not
    // touch (not a regression: deep_dive already covers a "walk me through
    // the algorithm" framing reasonably).
    const cases = [
      'explain how a binary tree works',
      'what is the time complexity of this recursion?',
      'implement a queue using two stacks',
      'explain a min heap',
      'implement a trie for autocomplete',
    ];
    for (const q of cases) {
      const r = await classifyIntent(q, '', 0);
      assert.equal(r.intent, 'coding', `expected coding for: "${q}", got ${JSON.stringify(r)}`);
      assert.equal(r.confidence, 0.95);
    }
  });
});
