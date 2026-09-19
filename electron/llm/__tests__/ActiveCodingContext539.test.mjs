// Regression coverage for GitHub issue #539.
// Run: npm run build:electron && node --test electron/llm/__tests__/ActiveCodingContext539.test.mjs

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (...parts) => path.resolve(__dirname, '../../../dist-electron/electron', ...parts);

const {
  isHighConfidenceStandaloneCodingProblem,
  isSelfContainedCodingRequest,
  mergeActiveCodingProblem,
  resolveActiveCodingContext,
} = await import(pathToFileURL(dist('llm/activeCodingContext.js')).href);
const { isCodingContinuation } = await import(pathToFileURL(dist('llm/codingFollowup.js')).href);
const { isPromotedScreenCodingTurn } = await import(pathToFileURL(dist('llm/codingPromptSignals.js')).href);
const { planAnswer, isCodingAnswerType } = await import(pathToFileURL(dist('llm/AnswerPlanner.js')).href);
const { prepareTranscriptForWhatToAnswer, deduplicateTranscriptEchoes } = await import(pathToFileURL(dist('llm/transcriptCleaner.js')).href);
const { extractLatestQuestion } = await import(pathToFileURL(dist('llm/transcriptQuestionExtractor.js')).href);
const { SessionTracker } = await import(pathToFileURL(dist('SessionTracker.js')).href);
const { classifyTurn } = await import(pathToFileURL(dist('context-intelligence/question/turn-classifier.js')).href);
const { resolveModePolicy } = await import(pathToFileURL(dist('context-intelligence/policies/mode-policy-registry.js')).href);

const CRYPTO_PROBLEM = [
  'Service A encrypts whole messages and Service B decrypts them.',
  'Rotate the active key at the top of every hour.',
  'Retain at least five key versions so older messages remain decryptable.',
].join(' ');

const realDateNow = Date.now;
afterEach(() => { Date.now = realDateNow; });

describe('issue #539 active coding context', () => {
  for (const followup of [
    'show in python',
    'show the solution in python',
    'show me how you would implement in python',
    'implement this',
    'encrypt the entire text, not character by character',
  ]) {
    test(`resolves and routes coding continuation: ${followup}`, () => {
      assert.equal(isCodingContinuation(followup), true);
      const resolved = resolveActiveCodingContext(followup, CRYPTO_PROBLEM);
      assert.equal(resolved.usedActiveProblem, true);
      assert.equal(resolved.needsClarification, false);
      assert.match(resolved.resolvedQuestion, /Service A encrypts/i);
      assert.match(resolved.resolvedQuestion, /five key versions/i);
      assert.match(resolved.resolvedQuestion, new RegExp(followup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

      const plan = planAnswer({
        question: resolved.resolvedQuestion,
        source: 'what_to_answer',
        speakerPerspective: 'interviewer',
      });
      assert.equal(isCodingAnswerType(plan.answerType), true, `planned ${plan.answerType}`);
      assert.equal(plan.profileContextPolicy, 'forbidden');
      assert.ok(plan.forbiddenContextLayers.includes('prior_assistant_responses'));
    });
  }

  test('domain-overlapping short implementation request inherits the active problem', () => {
    const followup = 'write a function for rotate, encrpt, descrypt';
    const resolved = resolveActiveCodingContext(followup, CRYPTO_PROBLEM);
    assert.equal(resolved.usedActiveProblem, true);
    assert.match(resolved.resolvedQuestion, /older messages remain decryptable/i);
    assert.match(resolved.resolvedQuestion, /encrpt/i);
  });

  test('a context-dependent request with no active problem asks for clarification', () => {
    for (const fragment of [
      'show in python',
      'write a function for rotate, encrpt, descrypt',
      'write a function for encrypt and decrypt',
      'Return -1 when absent',
    ]) {
      const resolved = resolveActiveCodingContext(fragment, null);
      assert.equal(resolved.usedActiveProblem, false, fragment);
      assert.equal(resolved.needsClarification, true, fragment);
      assert.equal(resolved.resolvedQuestion, fragment);
    }
  });

  test('a deictic implementation request cannot become a standalone active problem', () => {
    const resolved = resolveActiveCodingContext('implement this', null);
    assert.equal(resolved.needsClarification, true);
    assert.equal(resolved.usedActiveProblem, false);
  });

  test('an unrelated standalone coding problem does not inherit stale crypto context', () => {
    const resolved = resolveActiveCodingContext('Implement a binary search tree', CRYPTO_PROBLEM);
    assert.equal(resolved.usedActiveProblem, false);
    assert.equal(resolved.needsClarification, false);
    assert.doesNotMatch(resolved.resolvedQuestion, /Service A/i);
  });

  test('a language-qualified request with its own subject does not inherit stale context', () => {
    const followup = 'show the solution in Python for binary search tree';
    assert.equal(isCodingContinuation(followup), false);
    const resolved = resolveActiveCodingContext(followup, CRYPTO_PROBLEM);
    assert.equal(resolved.usedActiveProblem, false);
    assert.doesNotMatch(resolved.resolvedQuestion, /Service A/i);
  });

  test('an explicit format plus standalone subject does not require missing context', () => {
    const resolved = resolveActiveCodingContext('write code only for Two Sum in Python', null);
    assert.equal(resolved.needsClarification, false);
    assert.equal(resolved.usedActiveProblem, false);
  });

  test('a new same-family named problem replaces stale context', () => {
    const resolved = resolveActiveCodingContext(
      'Implement an LFU cache with get and put',
      'Implement an LRU cache with get and put',
    );
    assert.equal(resolved.usedActiveProblem, false);
    assert.doesNotMatch(resolved.resolvedQuestion, /LRU/i);
  });

  test('a constraint already merged into the active problem resolves without topic words', () => {
    const active = `${CRYPTO_PROBLEM} Assume all inputs are valid.`;
    const resolved = resolveActiveCodingContext('assume all inputs are valid', active);
    assert.equal(resolved.usedActiveProblem, true);
  });

  test('common language ellipses inherit active context and clarify without it', () => {
    for (const followup of [
      'show it in Python',
      'write it in C++',
      'code this in C#',
      'can you show the solution in Python?',
      'use Rust',
      'Python please',
    ]) {
      assert.equal(isCodingContinuation(followup), true, followup);
      assert.equal(resolveActiveCodingContext(followup, CRYPTO_PROBLEM).usedActiveProblem, true, followup);
      assert.equal(resolveActiveCodingContext(followup, null).needsClarification, true, followup);
    }
  });

  test('analysis-only format requests remain continuations of the active problem', () => {
    for (const followup of [
      'Give time and space complexity',
      'Analyze the time complexity',
      'Provide a dry run',
      'Show edge cases',
    ]) {
      const resolved = resolveActiveCodingContext(followup, CRYPTO_PROBLEM);
      assert.equal(resolved.usedActiveProblem, true, followup);
      assert.match(resolved.resolvedQuestion, /Service A encrypts/i);
    }
  });

  test('typed subjectless constraints inherit and persist without retaining presentation directives', () => {
    const active = 'Implement an LRU cache with get and put.';
    for (const constraint of [
      'Assume all inputs are valid',
      'Use constant space',
      'The input is sorted',
      'There can be negative values',
      'Return -1 when absent',
      'Give O(n) time complexity',
      'Time and space complexity must be O(n) and O(1).',
    ]) {
      const resolved = resolveActiveCodingContext(constraint, active);
      assert.equal(resolved.usedActiveProblem, true, constraint);
      assert.match(resolved.resolvedQuestion, /LRU cache/i, constraint);
    }

    const mixed = 'show code only and assume capacity is positive';
    assert.equal(resolveActiveCodingContext(mixed, active).usedActiveProblem, true);
    const merged = mergeActiveCodingProblem(active, mixed);
    assert.match(merged, /assume capacity is positive/i);
    assert.doesNotMatch(merged, /show code only/i);
  });

  test('a presentation directive plus a complete result problem replaces stale context', () => {
    for (const next of [
      'show code only and return the longest palindromic substring',
      'Return the index of the maximum element in an array',
      'Return the value at the kth index',
      'Handle a stream of events and emit the running median',
    ]) {
      assert.equal(isSelfContainedCodingRequest(next), true, next);
      assert.equal(resolveActiveCodingContext(next, null).needsClarification, false, next);
      const resolved = resolveActiveCodingContext(next, 'Implement an LRU cache with get and put.');
      assert.equal(resolved.usedActiveProblem, false, next);
      assert.equal(resolved.needsClarification, false, next);
      assert.doesNotMatch(resolved.resolvedQuestion, /LRU/i, next);
    }
  });

  test('planner-bypass persistence is limited to the declarative crypto requirement', () => {
    assert.equal(isHighConfidenceStandaloneCodingProblem(
      'Service A encrypts messages and Service B decrypts them.',
    ), true);
    for (const nonProblem of [
      'Explain database indexing without code',
      'Explain how encryption and decryption work',
      'Design a graph for the quarterly report',
      'We should implement a REST API for the dashboard next sprint.',
    ]) {
      assert.equal(isHighConfidenceStandaloneCodingProblem(nonProblem), false, nonProblem);
    }
  });

  test('conceptual paired-service questions are not standalone coding problems', () => {
    for (const question of [
      'Does Service A encrypt messages before Service B decrypts them?',
      'Should Service A encrypt messages while Service B decrypts them?',
      'Why does Service A encrypt messages before Service B decrypts them?',
    ]) {
      assert.equal(isHighConfidenceStandaloneCodingProblem(question), false, question);
    }
  });

  test('conceptual paired-service questions do not replace an active coding problem', () => {
    for (const [index, question] of [
      'Does Service A encrypt messages before Service B decrypts them?',
      'Should Service A encrypt messages while Service B decrypts them?',
      'Why does Service A encrypt messages before Service B decrypts them?',
    ].entries()) {
      const tracker = new SessionTracker();
      const active = 'Implement an LRU cache with get and put.';
      const now = Date.now() + index * 10_000;
      tracker.setCodingQuestion(active, 'transcript');
      tracker.handleTranscript({ speaker: 'interviewer', text: question, timestamp: now, final: true });
      assert.equal(tracker.getDetectedCodingQuestion().question, active, question);
    }
  });

  test('explicit how-would-you coding asks still replace through self-contained planning', () => {
    for (const [index, question] of [
      'How would you implement Service A encrypting messages while Service B decrypts them?',
      'How would you design Service A to encrypt messages while Service B decrypts them?',
    ].entries()) {
      assert.equal(isHighConfidenceStandaloneCodingProblem(question), false, question);
      assert.equal(isSelfContainedCodingRequest(question), true, question);
      const tracker = new SessionTracker();
      const now = Date.now() + index * 10_000;
      tracker.setCodingQuestion('Implement an LRU cache with get and put.', 'transcript');
      tracker.handleTranscript({ speaker: 'interviewer', text: question, timestamp: now, final: true });
      assert.equal(tracker.getDetectedCodingQuestion().question, question);
    }
  });

  test('ordinary meeting fragments never inherit the active coding problem', () => {
    const active = 'Implement an LRU cache with get and put.';
    for (const statement of [
      'Should we take a break?',
      'There can be a delay before the next question',
      'Should we accept the offer?',
      'Retain the meeting notes',
    ]) {
      const resolved = resolveActiveCodingContext(statement, active);
      assert.equal(resolved.usedActiveProblem, false, statement);
      assert.equal(resolved.needsClarification, false, statement);
    }
  });

  test('an attached screen can supply the subject for a coding continuation', () => {
    assert.equal(isPromotedScreenCodingTurn({
      alreadyCoding: false,
      question: 'show in python',
      hasImages: true,
    }), true);
    assert.equal(isPromotedScreenCodingTurn({
      alreadyCoding: false,
      question: 'show in python',
      hasImages: false,
    }), false);
    assert.equal(isPromotedScreenCodingTurn({
      alreadyCoding: false,
      question: 'show in python',
      hasImages: false,
      screenText: 'def solve(nums):\n    pass',
    }), true);
  });

  test('complete Q2 shapes never inherit a stale coding problem', () => {
    for (const nextProblem of [
      'Implement a cache that supports TTL',
      'Explain database indexing without code',
      'Implement merge sort',
      'Find the longest substring without repeating characters',
      'Implement a graph where every node has the same degree',
      'give me code for DFS',
    ]) {
      assert.equal(isSelfContainedCodingRequest(nextProblem), true, nextProblem);
      const resolved = resolveActiveCodingContext(nextProblem, 'Implement BFS traversal for a graph');
      assert.equal(resolved.usedActiveProblem, false, nextProblem);
      assert.equal(resolved.needsClarification, false, nextProblem);
    }
  });

  test('a continuation about a conflicting domain clarifies instead of using stale context', () => {
    const resolved = resolveActiveCodingContext(
      'encrypt the entire text, not character by character',
      'Implement a cache with TTL support',
    );
    assert.equal(resolved.usedActiveProblem, false);
    assert.equal(resolved.needsClarification, true);
  });

  test('bounded active context preserves the original head and newest constraint', () => {
    const longProblem = `Implement a parser. ${'Preserve this original parsing requirement. '.repeat(80)}`;
    const merged = mergeActiveCodingProblem(longProblem, 'Return -1 when the token is absent.');
    assert.ok(merged.length <= 2_400);
    assert.match(merged, /^Implement a parser/i);
    assert.match(merged, /Return -1 when the token is absent/i);
    const resolved = resolveActiveCodingContext('show in Python', merged);
    assert.match(resolved.resolvedQuestion, /Return -1 when the token is absent/i);
  });

  test('durable merging keeps corrections and drops one-turn presentation directives', () => {
    const base = 'Implement an LRU cache with get and put.';
    assert.equal(mergeActiveCodingProblem(base, 'show in Python'), base);
    assert.equal(mergeActiveCodingProblem(base, 'show in C++'), base);

    const numericCorrection = mergeActiveCodingProblem(`${base} Return 10 when absent.`, 'Return 1 when absent.');
    assert.match(numericCorrection, /Return 10 when absent/i);
    assert.match(numericCorrection, /Return 1 when absent/i);

    const polarityCorrection = mergeActiveCodingProblem(`${base} Do not rotate the key.`, 'Rotate the key.');
    assert.match(polarityCorrection, /Do not rotate the key/i);
    assert.match(polarityCorrection, /; Rotate the key/i);
  });
});

describe('issue #539 SessionTracker active problem lifecycle', () => {
  const segment = (text, timestamp) => ({
    speaker: 'interviewer', text, timestamp, final: true, confidence: 1,
  });

  test('accumulates split crypto requirements and survives hot-window eviction', () => {
    const tracker = new SessionTracker();
    const base = 10_000_000;
    Date.now = () => base;
    tracker.handleTranscript(segment('Service A encrypts whole messages and Service B decrypts them.', base));
    tracker.handleTranscript(segment('Rotate the active key at the top of every hour.', base + 1_000));
    tracker.handleTranscript(segment('Retain at least five key versions so older messages remain decryptable.', base + 2_000));

    const active = tracker.getDetectedCodingQuestion();
    assert.equal(active.source, 'transcript');
    assert.match(active.question, /Service A encrypts/i);
    assert.match(active.question, /Rotate the active key/i);
    assert.match(active.question, /five key versions/i);

    Date.now = () => base + 183_001;
    assert.equal(tracker.getContext(180).length, 0, 'hot transcript should have expired');
    assert.match(tracker.getDetectedCodingQuestion().question, /Service A encrypts/i, 'active problem must remain durable');
  });

  test('discovers a declarative crypto problem split across STT final segments', () => {
    const tracker = new SessionTracker();
    const now = Date.now();
    tracker.handleTranscript(segment('Service A encrypts whole messages.', now));
    assert.equal(tracker.getDetectedCodingQuestion().question, null, 'one actor alone is not enough to claim a coding problem');
    tracker.handleTranscript(segment('Service B decrypts those messages.', now + 1_000));

    const active = tracker.getDetectedCodingQuestion().question;
    assert.match(active, /Service A encrypts whole messages/i);
    assert.match(active, /Service B decrypts those messages/i);
  });

  test('joins an LRU constraint instead of replacing the answerable ask', () => {
    const tracker = new SessionTracker();
    const now = Date.now();
    tracker.handleTranscript(segment('Implement an LRU cache with get and put.', now));
    tracker.handleTranscript(segment('You can assume capacity is positive.', now + 1_000));
    const active = tracker.getDetectedCodingQuestion().question;
    assert.match(active, /Implement an LRU cache/i);
    assert.match(active, /capacity is positive/i);
  });

  test('a recent screenshot problem accepts spoken constraints without losing source', () => {
    const tracker = new SessionTracker();
    const now = Date.now();
    tracker.setCodingQuestion('Implement an LRU cache with get and put.', 'screenshot');
    tracker.handleTranscript(segment('You can assume capacity is positive.', now + 1_000));
    const active = tracker.getDetectedCodingQuestion();
    assert.equal(active.source, 'screenshot');
    assert.match(active.question, /capacity is positive/i);
  });

  test('a distinct complete spoken problem overrides a recent screenshot problem', () => {
    const tracker = new SessionTracker();
    const now = Date.now();
    tracker.setCodingQuestion('Implement an LRU cache with get and put.', 'screenshot');
    tracker.handleTranscript(segment('Reverse a linked list in place.', now + 1_000));
    const active = tracker.getDetectedCodingQuestion();
    assert.equal(active.source, 'transcript');
    assert.match(active.question, /Reverse a linked list/i);
    assert.doesNotMatch(active.question, /LRU/i);
  });

  test('ordinary meeting language does not pollute an active coding problem', () => {
    const tracker = new SessionTracker();
    const now = Date.now();
    const original = 'Implement an LRU cache with get and put.';
    tracker.setCodingQuestion(original, 'transcript');
    tracker.handleTranscript(segment('Could you write a summary and put it in the shared document?', now + 1_000));
    tracker.handleTranscript(segment('We should retain every client message for the meeting notes.', now + 2_000));
    tracker.handleTranscript(segment("Let's return to your previous experience.", now + 3_000));
    tracker.handleTranscript(segment('We should return to the candidate previous experience.', now + 4_000));
    tracker.handleTranscript(segment('We should discuss the key requirements for the role.', now + 5_000));
    tracker.handleTranscript(segment('The entire team should discuss capacity planning.', now + 6_000));
    tracker.handleTranscript(segment('Could you write a message to the client?', now + 7_000));
    tracker.handleTranscript(segment('We should implement a REST API for the dashboard next sprint.', now + 8_000));
    tracker.handleTranscript(segment('Explain how encryption and decryption work.', now + 9_000));
    assert.equal(tracker.getDetectedCodingQuestion().question, original);
  });

  test('complete imperative and declarative Q2s replace Q1', () => {
    const cases = [
      'Implement merge sort.',
      'Implement quicksort.',
      'Implement FizzBuzz.',
      'Given an array of integers, return the maximum subarray sum.',
      'Find the longest substring without repeating characters.',
      'Find the median of two sorted arrays.',
      'Service A encrypts messages and Service B decrypts them.',
    ];
    for (const [index, nextProblem] of cases.entries()) {
      const tracker = new SessionTracker();
      const now = Date.now() + index * 10_000;
      tracker.setCodingQuestion('Implement an LRU cache with get and put.', 'transcript');
      tracker.handleTranscript(segment(nextProblem, now + 1_000));
      assert.match(tracker.getDetectedCodingQuestion().question, new RegExp(nextProblem.slice(0, 18), 'i'), nextProblem);
      assert.doesNotMatch(tracker.getDetectedCodingQuestion().question, /LRU/i, nextProblem);
    }
  });

  test('typed Q2 replaces Q1 and its continuation resolves only Q2', () => {
    const tracker = new SessionTracker();
    tracker.setCodingQuestion('Implement an LRU cache with get and put.', 'manual');
    tracker.setCodingQuestion('Reverse a linked list in place.', 'manual');
    const active = tracker.getDetectedCodingQuestion();
    const resolved = resolveActiveCodingContext('show in Python', active.question);
    assert.match(resolved.resolvedQuestion, /Reverse a linked list/i);
    assert.doesNotMatch(resolved.resolvedQuestion, /LRU/i);
  });

  test('declarative typed Q2 replaces Q1 before the next continuation', () => {
    const tracker = new SessionTracker();
    tracker.setCodingQuestion('Implement an LRU cache with get and put.', 'manual');
    const q2 = 'Service A encrypts messages and Service B decrypts them.';
    const planned = planAnswer({ question: q2, source: 'manual_input', speakerPerspective: 'user' });
    assert.equal(isHighConfidenceStandaloneCodingProblem(q2), true);
    if (isCodingAnswerType(planned.answerType) || isHighConfidenceStandaloneCodingProblem(q2)) {
      tracker.setCodingQuestion(q2, 'manual');
    }
    const resolved = resolveActiveCodingContext('show in Python', tracker.getDetectedCodingQuestion().question);
    assert.match(resolved.resolvedQuestion, /Service A encrypts/i);
    assert.doesNotMatch(resolved.resolvedQuestion, /LRU/i);
  });

  test('a same-family declarative Q2 replaces rather than contaminates Q1', () => {
    const tracker = new SessionTracker();
    const now = Date.now();
    tracker.handleTranscript(segment('Service A encrypts messages and Service B decrypts them.', now));
    tracker.handleTranscript(segment('Service C encrypts files and Service D decrypts them.', now + 1_000));
    const active = tracker.getDetectedCodingQuestion().question;
    assert.match(active, /Service C encrypts files/i);
    assert.doesNotMatch(active, /Service A/i);
    const resolved = resolveActiveCodingContext('show in Python', active);
    assert.match(resolved.resolvedQuestion, /Service C encrypts files/i);
    assert.doesNotMatch(resolved.resolvedQuestion, /Service A/i);
  });

  test('a repeated declarative base statement cannot erase newer constraints', () => {
    const tracker = new SessionTracker();
    const now = Date.now();
    const base = 'Service A encrypts messages and Service B decrypts them.';
    tracker.handleTranscript(segment(base, now));
    tracker.handleTranscript(segment('Rotate the active key at the top of every hour.', now + 1_000));
    tracker.handleTranscript(segment('Retain at least five key versions.', now + 2_000));
    tracker.handleTranscript(segment(base, now + 3_000));
    const active = tracker.getDetectedCodingQuestion().question;
    assert.match(active, /Service A encrypts/i);
    assert.match(active, /top of every hour/i);
    assert.match(active, /five key versions/i);
  });

  test('a different standalone problem replaces the old topic, and reset clears it', () => {
    const tracker = new SessionTracker();
    const now = Date.now();
    tracker.handleTranscript(segment('Service A encrypts messages while Service B decrypts each message.', now));
    tracker.handleTranscript(segment('Implement a binary search tree with insert and lookup methods.', now + 1_000));
    assert.match(tracker.getDetectedCodingQuestion().question, /binary search tree/i);
    assert.doesNotMatch(tracker.getDetectedCodingQuestion().question, /Service A/i);
    tracker.reset();
    assert.equal(tracker.getDetectedCodingQuestion().question, null);
  });

  test('an older imperative Q1 cannot displace a newer declarative active Q2', () => {
    const tracker = new SessionTracker();
    const now = Date.now();
    tracker.handleTranscript(segment('Implement count ways for climbing stairs.', now));
    tracker.handleTranscript(segment('Service A encrypts messages and Service B decrypts them.', now + 1_000));
    tracker.handleTranscript(segment('Retain at least five key versions.', now + 2_000));
    const active = tracker.getDetectedCodingQuestion().question;
    assert.match(active, /Service A encrypts/i);
    assert.doesNotMatch(active, /count ways/i);
    const resolved = resolveActiveCodingContext('show in Python', active);
    assert.match(resolved.resolvedQuestion, /Service A encrypts/i);
    assert.doesNotMatch(resolved.resolvedQuestion, /count ways/i);
  });

  test('mode-context clear prevents cross-session coding leakage', () => {
    const tracker = new SessionTracker();
    tracker.setCodingQuestion('Implement an LRU cache with get and put.', 'transcript');
    tracker.addAssistantMessage('```python\nprint("manual answer")\n```', undefined, 'manual_chat');
    const beforeClear = tracker.getCodingQuestionRevision();
    const beforeEpoch = tracker.getSessionLifecycleEpoch();
    tracker.clearSessionContext();
    assert.deepEqual(tracker.getDetectedCodingQuestion(), { question: null, source: null });
    assert.equal(tracker.getLastAssistantMessage('manual_chat'), null);
    assert.ok(tracker.getCodingQuestionRevision() > beforeClear);
    assert.ok(tracker.getSessionLifecycleEpoch() > beforeEpoch);
  });

  test('full reset clears per-surface assistant state and advances the coding revision', () => {
    const tracker = new SessionTracker();
    tracker.setMeetingMetadata({ id: 'previous-meeting', title: 'Previous meeting' });
    tracker.setCodingQuestion('Implement an LRU cache.', 'manual');
    tracker.addAssistantMessage('```python\nprint("answer")\n```', undefined, 'manual_chat');
    const beforeReset = tracker.getCodingQuestionRevision();
    const beforeEpoch = tracker.getSessionLifecycleEpoch();
    tracker.reset();
    assert.equal(tracker.getLastAssistantMessage('manual_chat'), null);
    assert.equal(tracker.getMeetingMetadata(), null, 'a metadata-less fresh meeting must not inherit the previous meeting id');
    assert.ok(tracker.getCodingQuestionRevision() > beforeReset);
    assert.ok(tracker.getSessionLifecycleEpoch() > beforeEpoch);
  });

  test('an old asynchronous transcript compaction cannot mutate a reset session', async () => {
    const tracker = new SessionTracker();
    let finishSummary;
    tracker.setRecapLLM({
      generate: () => new Promise((resolve) => { finishSummary = resolve; }),
    });

    for (let i = 0; i < 1_801; i++) {
      tracker.addTranscript({
        speaker: 'interviewer',
        text: `old session segment ${i}`,
        timestamp: i + 1,
        final: true,
      });
    }
    assert.equal(typeof finishSummary, 'function', 'compaction should be awaiting the recap provider');

    tracker.reset();
    tracker.addTranscript({
      speaker: 'interviewer',
      text: 'new session segment must survive',
      timestamp: 2_000,
      final: true,
    });
    finishSummary('OLD SESSION SECRET SUMMARY');
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(
      tracker.getFullTranscript().map((entry) => entry.text),
      ['new session segment must survive'],
    );
    assert.doesNotMatch(tracker.getFullSessionContext(), /OLD SESSION SECRET SUMMARY/);
  });
});

describe('issue #539 duplex transcript echo deduplication', () => {
  test('near-duplicate cross-channel speech keeps the interviewer copy', () => {
    const turns = [
      { role: 'user', text: 'Show me the solution in Python please', timestamp: 1_000 },
      { role: 'interviewer', text: 'show me solution in python, please.', timestamp: 1_400 },
      { role: 'user', text: 'A genuinely different response stays here.', timestamp: 2_000 },
    ];
    const out = deduplicateTranscriptEchoes(turns);
    assert.equal(out.length, 2);
    assert.equal(out[0].role, 'interviewer');
    assert.match(out[1].text, /genuinely different/i);
  });

  test('retaining a newer interviewer echo preserves chronological question order', () => {
    const turns = [
      { role: 'user', text: 'Show me the solution in Python please', timestamp: 1_000 },
      { role: 'interviewer', text: 'What data structure would you use?', timestamp: 1_200 },
      { role: 'interviewer', text: 'show me solution in python, please.', timestamp: 1_400 },
    ];
    const out = deduplicateTranscriptEchoes(turns);
    assert.deepEqual(out.map(turn => turn.timestamp), [1_200, 1_400]);
    assert.match(extractLatestQuestion(out).latestQuestion, /solution in python/i);
  });

  test('echoes are removed before the 12-turn budget so the original problem survives', () => {
    const turns = [{
      role: 'interviewer',
      text: 'Implement an LRU cache with get and put operations.',
      timestamp: 1_000,
    }];
    for (let i = 0; i < 6; i++) {
      const text = `Requirement ${i}: rotate the active encryption key every hour`;
      turns.push({ role: 'user', text, timestamp: 2_000 + i * 1_000 });
      turns.push({ role: 'interviewer', text: `${text}.`, timestamp: 2_200 + i * 1_000 });
    }
    turns.push({ role: 'interviewer', text: 'Show the solution in Python.', timestamp: 9_000 });

    const prepared = prepareTranscriptForWhatToAnswer(turns, 12);
    assert.match(prepared, /implement an lru cache/i);
    assert.match(prepared, /show the solution in python/i);
    assert.equal(prepared.split('\n').length, 8, 'six echo pairs should consume six, not twelve, slots');
  });

  test('semantic corrections are not collapsed as duplex echoes', () => {
    for (const [left, right] of [
      ['Rotate the key every hour', 'Do not rotate the key every hour'],
      ['Retain five key versions for old messages', 'Retain six key versions for old messages'],
      ['Return -1 when absent', 'Return 1 when absent'],
      ['Show the solution in C++', 'Show the solution in C#'],
      ['Service A encrypts and Service B decrypts the payload.', 'Service A decrypts and Service B encrypts the payload.'],
      ['Return the maximum value before updating the index.', 'Return the index before updating the maximum value.'],
      ['Implement get and put operations.', 'Implement get and put operations using TTL.'],
      ['Return the maximum value in the array.', 'Return the maximum value in the sorted array.'],
      ['Implement get and put operations.', 'Implement get, put, and remove operations.'],
      ['Use constant time lookup.', 'Use linear time lookup.'],
      ['Use breadth first search.', 'Use depth first search.'],
    ]) {
      const out = deduplicateTranscriptEchoes([
        { role: 'user', text: left, timestamp: 1_000 },
        { role: 'interviewer', text: right, timestamp: 1_100 },
      ]);
      assert.equal(out.length, 2, `${left} / ${right}`);
    }
  });

  test('opposite-role repetition outside the acoustic echo window is retained', () => {
    const out = deduplicateTranscriptEchoes([
      { role: 'user', text: 'Show me the solution in Python please', timestamp: 1_000 },
      { role: 'interviewer', text: 'Show me the solution in Python please', timestamp: 4_001 },
    ]);
    assert.equal(out.length, 2);
  });
});

describe('issue #539 production wiring', () => {
  test('default V3 manual path resolves active context before prompt construction', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');
    const raw = source.indexOf('const v3RawQuestion');
    const resolved = source.indexOf('const v3ActiveResolution = resolveActiveCodingContext', raw);
    const prompt = source.indexOf('const composed = await buildV3Prompt', resolved);
    const reference = source.indexOf('referenceContext: v3CodingReferenceContext', prompt);
    assert.ok(raw >= 0 && resolved > raw && prompt > resolved && reference > prompt);
    assert.match(source.slice(prompt, reference + 200), /v3CanonicalAnswerType/);
    const persona = source.slice(source.indexOf('personaBase:', prompt), source.indexOf('if (composed)', prompt));
    assert.doesNotMatch(persona, /base\s*\+\s*priorProblem|CURRENT CODING REQUEST/);
    assert.match(source, /codingTurnPromoted:\s*v3CodingTurnPromoted/);
    assert.match(source, /const v3RoutingQuestion = v3CodingTurnPromoted/);
    assert.match(source, /const v3CodingReferenceDataScope:[\s\S]*?v3CodingReferenceContext/);
    assert.match(source, /const v3MessageDataScopes:[\s\S]*?composed\.messageDataScopes[\s\S]*?v3CodingReferenceDataScope/);
    assert.match(source, /question:\s*v3RoutingQuestion/);
    assert.match(source, /isFollowUp:\s*v3CodingTurnPromoted \? false : undefined/);
    assert.match(source, /messageDataScopes:\s*v3MessageDataScopes/);
  });

  test('direct manual-answer entry point plans from resolved context but audits the raw question', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');
    const wrapper = source.slice(
      source.indexOf('async runManualAnswer(question:'),
      source.indexOf('private async runManualAnswerInner('),
    );
    const start = source.indexOf('private async runManualAnswerInner(');
    const end = source.indexOf('async runCodeHint(', start);
    const manual = source.slice(start, end);
    assert.match(manual, /const rawManualQuestion/);
    assert.match(manual, /const manualActiveResolution = resolveActiveCodingContext/);
    assert.match(manual, /question:\s*manualQuestion,[\s\S]*source:\s*'manual_input'/);
    assert.match(manual, /originalQuestion:\s*rawManualQuestion/);
    assert.match(manual, /resolvedQuestion:\s*manualQuestion/);
    assert.match(manual, /referenceContext:\s*manualCodingReferenceContext/);
    assert.match(manual, /referenceContextDataScope:/);
    assert.match(manual, /answerLLM\.generate\(\s*manualQuestion,\s*context,\s*answerPlan,/);
    assert.match(manual, /Which coding problem should I continue\?/);
    assert.match(manual, /const manualSessionEpoch = this\.session\.getSessionLifecycleEpoch\(\)/);
    assert.ok((manual.match(/getSessionLifecycleEpoch\(\) !== manualSessionEpoch/g) ?? []).length >= 2);
    assert.match(wrapper, /getSessionLifecycleEpoch\(\) !== manualSessionEpoch/);
  });

  test('phone mirror resolves coding context without changing source-governance input', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');
    const start = source.indexOf("} else if (cmd.type === 'chat')");
    const end = source.indexOf("} else if (cmd.type === 'screenshot')", start);
    const phone = source.slice(start, end);
    assert.match(phone, /const phoneActiveResolution = resolveActiveCodingContext/);
    assert.match(phone, /question:\s*phoneQuestion,[\s\S]*source:\s*'manual_input'/);
    assert.match(phone, /streamChat\(\s*phoneQuestion,/);
    assert.match(phone, /phoneActiveDataScopes/);
    assert.match(phone, /codingTurnPromoted:\s*phoneCodingTurnPromoted/);
    assert.match(phone, /_pResolveSwitch\(String\(message \|\| ''\)\)/);
    assert.match(phone, /Which coding problem should I continue\?/);
  });

  test('a successful fresh meeting fully resets durable intelligence state', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../main.ts'), 'utf8');
    const start = source.indexOf('private async startMeetingTransition(');
    const end = source.indexOf('public endMeeting()', start);
    const meetingStart = source.slice(start, end);
    const pendingTeardown = meetingStart.indexOf('await this._pendingTeardown');
    const invalidate = meetingStart.indexOf('invalidateIpcChatStreamsForSessionBoundary();');
    const reset = meetingStart.indexOf('this.intelligenceManager.reset();');
    const sessionReset = meetingStart.indexOf("'session-reset'", reset);
    assert.ok(pendingTeardown >= 0 && invalidate > pendingTeardown && reset > invalidate && sessionReset > reset);
    assert.doesNotMatch(meetingStart.slice(reset - 300, reset + 100), /clearSessionContext\(/);
  });

  test('meeting stop invalidates chat completions before clearing the hidden overlay', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../main.ts'), 'utf8');
    const start = source.indexOf('private async endMeetingTransition(');
    const end = source.indexOf('private async processCompletedMeetingForRAG(', start);
    const meetingStop = source.slice(start, end);
    const hidden = meetingStop.indexOf("this.windowHelper.setWindowMode('launcher')");
    const invalidate = meetingStop.indexOf('invalidateIpcChatStreamsForSessionBoundary();');
    const sessionReset = meetingStop.indexOf("'session-reset'", invalidate);
    const persist = meetingStop.indexOf('this.intelligenceManager.stopMeeting()');
    assert.ok(
      start >= 0 && end > start
        && hidden >= 0 && invalidate > hidden && sessionReset > invalidate && persist > sessionReset,
      'stop must invalidate completions after hiding and before UI reset, without resetting the transcript before persistence',
    );
    assert.doesNotMatch(meetingStop.slice(hidden, persist), /intelligenceManager\.reset\(/);
  });

  test('session boundary invalidates desktop and phone chat completions', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');
    assert.match(source, /export function invalidateIpcChatStreamsForSessionBoundary\(\)/);
    const install = source.slice(
      source.indexOf('invalidateIpcSessionBoundaryImpl = () =>'),
      source.indexOf('// Senders that already have', source.indexOf('invalidateIpcSessionBoundaryImpl = () =>')),
    );
    assert.match(install, /abortAndInvalidateChatStreams\(_chatStreamsBySender\)/);
    assert.match(install, /_phoneChatLatestId\+\+/);
    assert.match(install, /_manualConversationMemory\.clearAllSessions\(\)/);
    assert.match(install, /_manualCodingState\.clearAllSessions\(\)/);

    const explicitReset = source.slice(
      source.indexOf("safeHandle('reset-intelligence'"),
      source.indexOf('// Phase 3 — Dynamic Actions IPC', source.indexOf("safeHandle('reset-intelligence'")),
    );
    assert.ok(
      explicitReset.indexOf('invalidateIpcChatStreamsForSessionBoundary();') >= 0
        && explicitReset.indexOf('invalidateIpcChatStreamsForSessionBoundary();') < explicitReset.indexOf('intelligenceManager.reset();'),
      'explicit reset must invalidate IPC completions before clearing SessionTracker',
    );

    const modeSwitch = source.slice(
      source.indexOf("safeHandle('modes:set-active'"),
      source.indexOf("safeHandle('modes:get-active'", source.indexOf("safeHandle('modes:set-active'")),
    );
    assert.ok(
      modeSwitch.indexOf('_phoneChatLatestId++;') >= 0
        && modeSwitch.indexOf('_phoneChatLatestId++;') < modeSwitch.indexOf('ModesManager.getInstance().setActiveMode(id)'),
      'mode switch must supersede phone completions before flipping modes',
    );

    const v3Fallback = source.slice(
      source.indexOf('catch (v3Err:'),
      source.indexOf('const myTurnId = mintTurnId()', source.indexOf('catch (v3Err:')),
    );
    assert.match(v3Fallback, /_chatStreamsBySender\.get\(senderId\)\?\.streamId !== myStreamId/);
  });

  test('WTA guards durable state commits with the coding revision', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');
    assert.match(source, /let effectiveCodingRevision = this\.session\.getCodingQuestionRevision\(\)/);
    assert.match(source, /this\.session\.getCodingQuestionRevision\(\) === effectiveCodingRevision/);
  });

  test('retained active problems keep transcript/screenshot provenance through every transport', () => {
    const engine = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');
    const ipc = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');
    const wta = fs.readFileSync(path.resolve(__dirname, '../WhatToAnswerLLM.ts'), 'utf8');
    const answer = fs.readFileSync(path.resolve(__dirname, '../AnswerLLM.ts'), 'utf8');
    const helper = fs.readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');
    const bridge = fs.readFileSync(path.resolve(__dirname, '../../context-intelligence/orchestration/engine-bridge.ts'), 'utf8');
    assert.match(engine, /referenceContextDataScope:\s*_scopedCodingReference[\s\S]*?'screenshots'[\s\S]*?'transcript'/);
    assert.match(engine, /packedDataScopes:[\s\S]*?_v3[\s\S]*?packedDataScopes/);
    assert.match(engine, /messageDataScopes:[\s\S]*?_v3[\s\S]*?messageDataScopes/);
    assert.match(engine, /outboundDataScopes:[\s\S]*?'screenshots'[\s\S]*?'transcript'/);
    assert.match(ipc, /const manualActiveDataScopes:[\s\S]*?'screenshots'[\s\S]*?'transcript'/);
    assert.match(ipc, /messageDataScopes:\s*manualActiveDataScopes/);
    assert.match(ipc, /const phoneActiveDataScopes:[\s\S]*?'screenshots'[\s\S]*?'transcript'/);
    assert.match(wta, /requestSnapshot\?\.v3Prompt\?\.packedDataScopes/);
    assert.match(wta, /requestSnapshot\?\.outboundDataScopes/);
    assert.match(wta, /messageDataScopes:\s*activeReferentMessageScopes/);
    assert.match(bridge, /messageDataScopes:\s*\[\.\.\.messageDataScopes\]/);
    assert.match(bridge, /if \(convoSummary\) messageDataScopes\.add\('transcript'\)/);
    assert.match(bridge, /if \(historyCarriesScreenText && convoSummary\) messageDataScopes\.add\('screenshots'\)/);
    assert.match(answer, /extraDataScopes:\s*ProviderDataScope\[\]\s*=\s*\[\]/);
    assert.match(answer, /messageDataScopes:\s*ProviderDataScope\[\]\s*=\s*\[\]/);
    assert.match(answer, /messageDataScopes,[\s\S]*?answerPlan/);
    assert.match(helper, /routeOptions\?\.messageDataScopes[\s\S]*?No protected context was sent/);
  });

  test('the promoted V3 routing question stays on the coding fast path', () => {
    const engine = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');
    const wtaV3Start = engine.indexOf('const wtaV3Prompt = await');
    const wtaV3End = engine.indexOf('const requestSnapshot:', wtaV3Start);
    const wtaV3 = engine.slice(wtaV3Start, wtaV3End);
    assert.ok(wtaV3Start >= 0 && wtaV3End > wtaV3Start, 'WTA V3 production block must exist');
    assert.match(
      wtaV3,
      /isFollowUp:\s*activeCodingResolution\.usedActiveProblem\s*\?\s*false\s*:\s*extractedQuestion\.isFollowUp/,
      'WTA must not reopen generic source continuity after durable coding state resolved the referent',
    );
    const policy = resolveModePolicy('technical-interview');
    for (const request of ['show in python', 'what is the complexity']) {
      const result = classifyTurn({
        resolvedQuestion: `Solve the active coding problem. Current request: ${request}`,
        policy,
        // The bridge supplies the active referent separately; marking this as
        // V3's generic FOLLOW_UP would intentionally enable source continuity.
        isFollowUp: false,
        hasScreenContext: false,
        hasAttachedDocuments: true,
        inLiveMeeting: false,
      });
      assert.ok(result.questionTypes.includes('CODING_TASK'), request);
      assert.equal(result.path, 'FAST', request);
      assert.ok(!result.questionTypes.includes('DOCUMENT_FACT'), request);
      assert.ok(!result.questionTypes.includes('JOB_REQUIREMENT'), request);
    }
  });

  test('screenshot code-hint and brainstorm entry points persist explicit problems', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');
    const hint = source.slice(source.indexOf('async runCodeHint('), source.indexOf('async runBrainstorm('));
    const brainstorm = source.slice(source.indexOf('async runBrainstorm('));
    assert.match(hint, /setCodingQuestion\(explicitProblemStatement, 'screenshot'\)/);
    assert.match(brainstorm, /setCodingQuestion\(explicitProblemStatement, 'screenshot'\)/);
  });
});
