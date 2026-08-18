// electron/llm/__tests__/WtaNarrowingRefinement2026_08_18.test.mjs
//
// WTA audit 2026-08-18 (.audit/wta-audit.md F2): a narrowing refinement
// ("I mean specifically consumer groups") after a question that put an entity
// on the table ("What's your experience with Kafka?") resolved to NOTHING:
// SessionMemory recalled `Kafka`, but the demonstrative-substitution branch
// requires a literal "that" (SKILL_REF_RE) and the rule cascade has no
// narrowing rule, so resolveFollowUp returned NONE (confidence 0) and the
// apply gate at IntelligenceEngine.ts:1354 dropped the recalled entity on the
// floor — the question went downstream unresolved.
//
// Same class: corrections ("Sorry, I mean Kafka." after "Why did you choose
// Redis?") resolved to nothing.
//
// These are mutation tests for the narrowing/correction rules in
// FollowUpResolver.resolveFollowUp — they fail if the rules are removed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;

const { resolveFollowUpOrClarify } = await import(dist('FollowUpResolver.js'));
const { resolveSessionFollowup } = await import(dist('sessionFollowupResolver.js'));
const { SessionMemory } = await import(dist('SessionMemory.js'));

describe('narrowing refinement resolves against the previous question', () => {
  test('"I mean specifically consumer groups." narrows the Kafka experience question', () => {
    const r = resolveFollowUpOrClarify({
      latestQuestion: 'I mean specifically consumer groups.',
      previousQuestion: "What's your experience with Kafka?",
      lastEntity: 'Kafka',
      surface: 'what_to_answer',
      hasPriorContext: true,
    });
    assert.ok(!r.isClarification, 'must not fall to clarification');
    assert.ok(r.confidence >= 0.7, `confidence ${r.confidence} must clear the 0.7 apply gate`);
    assert.match(r.resolvedQuestion, /Kafka/i, 'standalone rewrite keeps the entity');
    assert.match(r.resolvedQuestion, /consumer groups/i, 'standalone rewrite keeps the narrowing focus');
  });

  test('"And specifically the rebalancing problem?" narrows the consumer-groups question', () => {
    const r = resolveFollowUpOrClarify({
      latestQuestion: 'And specifically the rebalancing problem?',
      previousQuestion: 'How did you handle consumer groups?',
      surface: 'what_to_answer',
      hasPriorContext: true,
    });
    assert.ok(r.confidence >= 0.7, `confidence ${r.confidence}`);
    assert.match(r.resolvedQuestion, /consumer groups/i);
    assert.match(r.resolvedQuestion, /rebalancing/i);
  });

  test('narrowing with only a remembered entity (no prior question) still resolves', () => {
    const r = resolveFollowUpOrClarify({
      latestQuestion: 'Specifically the consumer groups part.',
      previousQuestion: undefined,
      lastEntity: 'Kafka',
      surface: 'what_to_answer',
      hasPriorContext: true,
    });
    assert.ok(r.confidence >= 0.7, `confidence ${r.confidence}`);
    assert.match(r.resolvedQuestion, /Kafka/i);
    assert.match(r.resolvedQuestion, /consumer groups/i);
  });
});

describe('correction swaps the corrected entity into the previous question', () => {
  test('"Sorry, I mean Kafka." after "Why did you choose Redis?" → "Why did you choose Kafka?"', () => {
    const r = resolveFollowUpOrClarify({
      latestQuestion: 'Sorry, I mean Kafka.',
      previousQuestion: 'Why did you choose Redis?',
      surface: 'what_to_answer',
      hasPriorContext: true,
    });
    assert.ok(r.confidence >= 0.7, `confidence ${r.confidence}`);
    assert.match(r.resolvedQuestion, /Kafka/);
    assert.doesNotMatch(r.resolvedQuestion, /Redis/, 'the corrected entity replaces the original');
  });
});

describe('topic shift keeps the FULL shifted phrase (wta_skill_054)', () => {
  // Live-benchmark genuine miss: "and Python frameworks?" resolved to
  // "What is your experience with python?" — SKILL_TOKEN_RE kept only the
  // known token and silently dropped "frameworks", answering the wrong
  // (broader) question. Same defect class as "Kafka consumer groups".
  test('"and Python frameworks?" keeps "frameworks" in the standalone rewrite', () => {
    const r = resolveFollowUpOrClarify({
      latestQuestion: 'and Python frameworks?',
      previousQuestion: 'How comfortable are you with Python?',
      surface: 'what_to_answer',
      hasPriorContext: true,
    });
    assert.ok(r.confidence >= 0.7, `confidence ${r.confidence}`);
    assert.match(r.resolvedQuestion, /python frameworks/i, `got "${r.resolvedQuestion}"`);
  });

  test('"What about SQL window functions?" keeps the full phrase', () => {
    const r = resolveFollowUpOrClarify({
      latestQuestion: 'What about SQL window functions?',
      previousQuestion: 'Rate your SQL skills out of 10.',
      previousAnswerType: 'skill_experience_answer',
      surface: 'what_to_answer',
      hasPriorContext: true,
    });
    assert.ok(r.confidence >= 0.7, `confidence ${r.confidence}`);
    assert.match(r.resolvedQuestion, /sql window functions/i, `got "${r.resolvedQuestion}"`);
  });

  test('single-token shift "And SQL?" keeps the exact prior framing (unchanged)', () => {
    const r = resolveFollowUpOrClarify({
      latestQuestion: 'And SQL?',
      previousQuestion: 'Rate your Python skills out of 10.',
      previousAnswerType: 'skill_experience_answer',
      surface: 'what_to_answer',
      hasPriorContext: true,
    });
    assert.equal(r.resolvedQuestion, 'Rate your SQL skills out of 10.');
  });
});

describe('project drill-in preserves the asked question (wta_project_041)', () => {
  // Live-benchmark defect: "What tech stack did you use there?" (no resolved
  // entity) was REPLACED by the canned "Can you go deeper on that project?" —
  // the type inheritance is the value of this rule; swapping the words loses
  // the actual ask (tech stack → generic drill-in).
  test('a specific drill-in question keeps its own words when no entity resolved', () => {
    const r = resolveFollowUpOrClarify({
      latestQuestion: 'What tech stack did you use there?',
      previousQuestion: 'Tell me about your best project.',
      previousAnswerType: 'project_answer',
      surface: 'what_to_answer',
      hasPriorContext: true,
    });
    assert.ok(r.confidence >= 0.7, `confidence ${r.confidence}`);
    assert.equal(r.resolvedAnswerType, 'project_followup_answer');
    assert.match(r.resolvedQuestion, /tech stack/i, `got "${r.resolvedQuestion}"`);
  });

  test('a truly bare drill-in fragment still gets a usable generic rewrite', () => {
    const r = resolveFollowUpOrClarify({
      latestQuestion: 'That project?',
      previousQuestion: 'Tell me about your best project.',
      previousAnswerType: 'project_answer',
      surface: 'what_to_answer',
      hasPriorContext: true,
    });
    assert.ok(r.confidence >= 0.7, `confidence ${r.confidence}`);
    assert.ok(r.resolvedQuestion.length > 10, 'bare fragment expands to something answerable');
  });

  test('entity substitution branch is unchanged', () => {
    const r = resolveFollowUpOrClarify({
      latestQuestion: 'How is it developed?',
      previousQuestion: 'Which is your best project?',
      lastEntity: 'Natively',
      surface: 'what_to_answer',
      hasPriorContext: true,
    });
    assert.match(r.resolvedQuestion, /Natively/);
  });
});

describe('guards: ordinary statements are untouched', () => {
  test('"I think we are done here." is not a follow-up', () => {
    const r = resolveFollowUpOrClarify({
      latestQuestion: 'I think we are done here.',
      previousQuestion: 'Why did you choose Redis?',
      surface: 'what_to_answer',
      hasPriorContext: true,
    });
    assert.equal(r.confidence, 0);
  });

  test('"I mean it was hard work." (no narrowing marker) is not synthesized', () => {
    const r = resolveFollowUpOrClarify({
      latestQuestion: 'I mean it was hard work.',
      previousQuestion: "What's your experience with Kafka?",
      surface: 'what_to_answer',
      hasPriorContext: true,
    });
    assert.equal(r.confidence, 0);
  });

  test('existing topic-shift rule is not shadowed: "And SQL?" still resolves as skill shift', () => {
    const r = resolveFollowUpOrClarify({
      latestQuestion: 'And SQL?',
      previousQuestion: 'Rate your Python skills out of 10.',
      previousAnswerType: 'skill_experience_answer',
      surface: 'what_to_answer',
      hasPriorContext: true,
    });
    assert.equal(r.reason, 'topic_shift_skill');
    assert.match(r.resolvedQuestion, /SQL/i);
  });
});

describe('session-memory integration: the recalled entity is no longer dropped', () => {
  test('recalled Kafka + narrowing fragment resolves with resolvedVia !== "none"', () => {
    const mem = new SessionMemory();
    mem.note('skill', 'Kafka', 100, 'interview');
    const r = resolveSessionFollowup({
      latestQuestion: 'I mean specifically consumer groups.',
      previousQuestion: "What's your experience with Kafka?",
      now: 160,
      mode: 'interview',
      surface: 'what_to_answer',
      memory: mem,
      expectedKind: 'skill',
    });
    assert.ok(r.confidence >= 0.7, `confidence ${r.confidence}`);
    assert.match(r.resolvedQuestion, /consumer groups/i);
    assert.notEqual(r.resolvedVia, 'none');
  });
});
