// A question that NAMES an attached file, or points at a document with a
// definite article, must be a document question (2026-09-07).
//
// THE DEFECT, measured in technical-interview with tech_error_log.txt and
// tech_array_problem.md attached:
//   "Which function threw the uncaught exception in the error log?"
//   "so um in the error log what what was undefined"
// TECH_SELF_TALK_RE ("error", "exception") classified both GENERAL_TECHNICAL →
// FAST → shouldRetrieve=false. The live answer was "I cannot answer that
// without seeing the log itself" about a log the mode had indexed; the manual
// surface invented "parsePayload" as the function.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);
const { classifyTurn, mentionsAttachedFile, namesTitledTask } = await load('question/turn-classifier.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');
const { decide, bareFragmentQuery } = await load('orchestration/orchestrator.js');

const TI_FILES = ['tech_error_log.txt', 'tech_array_problem.md'];
const classify = (q, modeId, over = {}) =>
  classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES[modeId], isFollowUp: false, ...over });

describe('mentionsAttachedFile', () => {
  test('two consecutive filename words, or one distinctive word', () => {
    assert.equal(mentionsAttachedFile('what was undefined in the error log', TI_FILES), true);
    assert.equal(mentionsAttachedFile('What constraint does the array problem place on the input?', TI_FILES), true);
    assert.equal(mentionsAttachedFile('What are the action items from the postmortem?', ['team_meet_incident_postmortem.txt']), true);
    assert.equal(mentionsAttachedFile('Who owns the launch checklist?', ['team_meet_launch_checklist.md']), true);
  });
  test('generic filename tokens alone never match', () => {
    assert.equal(mentionsAttachedFile('what is a tech lead?', TI_FILES), false);
    assert.equal(mentionsAttachedFile('reverse a linked list', TI_FILES), false);
    assert.equal(mentionsAttachedFile('anything', []), false);
    assert.equal(mentionsAttachedFile('anything', undefined), false);
  });
});

describe('technical-interview: questions about the attached log/problem retrieve', () => {
  const cases = [
    'Which function threw the uncaught exception in the error log?',
    'so um in the error log what what was undefined',
    'At what line in handlers.ts did the TypeError occur, according to the log?',
    'What does the attached spec say about retries?',
    'Summarize the postmortem for me.',
  ];
  for (const q of cases) {
    test(q, () => {
      const r = classify(q, 'technical-interview', { hasAttachedDocuments: true, attachedFileNames: [...TI_FILES, 'retry-spec.md', 'incident-postmortem.txt'] });
      assert.ok(r.questionTypes.includes('DOCUMENT_FACT'), JSON.stringify(r.questionTypes));
      assert.equal(r.shouldRetrieve, true, r.reason);
      assert.ok(r.requiredSourceTypes.some((s) => s === 'REFERENCE_FILE' || s === 'PROJECT_FILE' || s === 'CODING_SAMPLE'), JSON.stringify(r.requiredSourceTypes));
    });
  }

  test('with NO documents attached the same wording keeps the fast path (nothing to retrieve)', () => {
    const r = classify('Which function threw the uncaught exception in the error log?', 'general', { hasAttachedDocuments: false });
    assert.equal(r.shouldRetrieve, false, r.reason);
  });

  test('coding self-talk without a document pointer is untouched', () => {
    const r = classify('Why do I get a segfault when I run this code?', 'technical-interview', { hasAttachedDocuments: true, attachedFileNames: TI_FILES });
    assert.ok(!r.questionTypes.includes('DOCUMENT_FACT'), JSON.stringify(r.questionTypes));
    const r2 = classify('Reverse a singly linked list in Python.', 'technical-interview', { hasAttachedDocuments: true, attachedFileNames: TI_FILES });
    assert.ok(!r2.questionTypes.includes('DOCUMENT_FACT'), JSON.stringify(r2.questionTypes));
    assert.ok(!r2.requiredSourceTypes.includes('RESUME'), JSON.stringify(r2.requiredSourceTypes));
  });

  test('a bare follow-up is not re-typed by the deixis rule', () => {
    const r = classify('why?', 'technical-interview', { hasAttachedDocuments: true, attachedFileNames: TI_FILES });
    assert.ok(r.questionTypes.includes('FOLLOW_UP'), JSON.stringify(r.questionTypes));
    assert.ok(!r.questionTypes.includes('DOCUMENT_FACT'), JSON.stringify(r.questionTypes));
  });
});

describe('a TITLED task points at the attached question bank (2026-09-07)', () => {
  const BANK = ['01_coding_questions.md', '02_architecture_questions.md'];
  test('"the debounce problem" / "the two-sum question" retrieve when files are attached', () => {
    for (const q of [
      'Implement the debounce problem and explain how you prevent stale network responses from overwriting newer results.',
      'Solve the two-sum question in Python.',
      'Walk me through the rate-limiter exercise.',
    ]) {
      const r = classify(q, 'technical-interview', { hasAttachedDocuments: true, attachedFileNames: BANK });
      assert.ok(r.questionTypes.includes('DOCUMENT_FACT'), `${q}: ${JSON.stringify(r.questionTypes)}`);
      assert.equal(r.shouldRetrieve, true, `${q}: ${r.reason}`);
    }
  });
  test('the rule itself ignores a generic modifier ("this problem", "the same question", "the main problem")', () => {
    // Other, older rules may still route these to the documents (a short
    // claimless fragment in a document mode looks the documents up); what this
    // rule promises is only that a generic "problem"/"question" is not a TITLE.
    for (const q of ['This problem is harder than it looks, why?', 'Is the same question going to come up again?', 'What is the main problem with my approach?', 'the first question', 'that other exercise']) {
      assert.equal(namesTitledTask(q), false, q);
    }
    for (const q of ['the debounce problem', 'Solve the two-sum question', 'the rate-limiter exercise', 'this LRU task']) {
      assert.equal(namesTitledTask(q), true, q);
    }
    const r = classify('Why is this problem harder than it looks when I run my code?', 'technical-interview', { hasAttachedDocuments: true, attachedFileNames: BANK });
    assert.ok(!r.questionTypes.includes('DOCUMENT_FACT'), JSON.stringify(r.questionTypes));
  });
  test('without documents a titled task keeps the fast path', () => {
    const r = classify('Implement the debounce problem.', 'general', { hasAttachedDocuments: false });
    assert.equal(r.shouldRetrieve, false, r.reason);
  });
});

describe('a bare fragment borrows the attached file names as its retrieval subject (2026-09-07)', () => {
  test('"explain" with files attached retrieves against the attachments', () => {
    const d = decide({
      requestId: 'r', requestSequence: 1, surface: 'what_to_answer', modeId: 'technical-interview',
      scope: { userId: 'u', modeId: 'technical-interview' }, sessionId: 's',
      manualQuestion: 'explain', hasAttachedDocuments: true, attachedFileNames: TI_FILES,
    });
    assert.equal(d.resolvedQuestion, 'explain', 'the resolved question itself is unchanged');
    assert.equal(d.retrievalPlan.shouldRetrieve, true);
    assert.match(d.retrievalPlan.queries[0], /tech error log/);
    assert.match(d.retrievalPlan.queries[0], /tech array problem/);
  });
  test('a real question, or no attachments, keeps its own query', () => {
    assert.equal(bareFragmentQuery('Which function threw the exception?', TI_FILES), null);
    assert.equal(bareFragmentQuery('explain', []), null);
    assert.equal(bareFragmentQuery('explain', undefined), null);
  });
});

describe('STT fragments and "you got" (2026-09-07)', () => {
  test('a short claimless fragment in a document mode retrieves against the documents', () => {
    for (const [q, mode] of [['l four base', 'recruiting'], ['rate per hour and and the cap', 'seminar'], ['the sev', 'team-meet'], ['batna', 'seminar']]) {
      const r = classify(q, mode, { hasAttachedDocuments: true, attachedFileNames: ['a.md'] });
      assert.ok(r.questionTypes.includes('DOCUMENT_FACT'), `${q}: ${JSON.stringify(r.questionTypes)}`);
      assert.equal(r.shouldRetrieve, true, `${q}: ${r.reason}`);
    }
  });
  test('arithmetic, coding tasks and design asks keep their general route', () => {
    for (const q of ['what is 2 + 2', 'reverse a linked list', 'design a rate limiter', 'why do I get a segfault here']) {
      const r = classify(q, 'technical-interview', { hasAttachedDocuments: true, attachedFileNames: ['a.md'] });
      assert.ok(!r.questionTypes.includes('DOCUMENT_FACT'), `${q}: ${JSON.stringify(r.questionTypes)}`);
    }
  });
  test('without documents a fragment is unchanged', () => {
    const r = classify('l four base', 'general', { hasAttachedDocuments: false });
    assert.equal(r.shouldRetrieve, false);
  });
  test('"the latency you got" is a second-person claim that reaches the résumé pool', () => {
    const r = classify('what was the latency you got on the fastapi backend', 'technical-interview', { hasAttachedDocuments: true, attachedFileNames: TI_FILES });
    assert.ok(r.claimTypes.some((c) => c.startsWith('USER_')), JSON.stringify(r.claimTypes));
    assert.ok(r.requiredSourceTypes.includes('RESUME'), JSON.stringify(r.requiredSourceTypes));
  });
});
