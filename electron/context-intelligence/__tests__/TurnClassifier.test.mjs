// Context Intelligence V3 — turn classifier.
//
// The measured motivation: EVERY retrieval configuration returned a ranked pool
// for EVERY question, including "What is idempotency?". The retriever has no
// "should I run" concept, so that decision must be made here — and be
// deterministic, so a misclassification is reproducible rather than stochastic.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { classifyTurn } = await import(pathToFileURL(path.join(base, 'question/turn-classifier.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);

const classify = (q, modeId = 'technical-interview', over = {}) =>
  classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES[modeId], isFollowUp: false, ...over });

describe('FAST path — general questions must NOT retrieve', () => {
  // These are the corpus category-B questions. Retrieving here is the
  // false-positive that §13.1 forbids and that costs live-meeting latency.
  for (const q of [
    'What is idempotency in the context of an HTTP API?',
    'Explain the difference between optimistic and pessimistic locking.',
    'What is a bloom filter?',
    'How does TCP congestion control work?',
  ]) {
    test(`"${q.slice(0, 42)}…"`, () => {
      const r = classify(q);
      assert.equal(r.path, 'FAST', r.reason);
      assert.equal(r.shouldRetrieve, false);
      assert.deepEqual(r.requiredSourceTypes, []);
    });
  }

  test('a pure coding task takes the fast path — no profile retrieval', () => {
    const r = classify('Reverse a linked list in place.');
    assert.equal(r.shouldRetrieve, false, 'a DSA question must not pull the resume');
    assert.ok(r.questionTypes.includes('CODING_TASK'));
  });
});

describe('GROUNDED path — questions about the user require evidence', () => {
  test('personal project requires RESUME', () => {
    const r = classify('Tell me about your WebRTC project.');
    assert.equal(r.path, 'GROUNDED');
    assert.equal(r.shouldRetrieve, true);
    assert.ok(r.requiredSourceTypes.includes('RESUME'));
    assert.ok(r.claimTypes.includes('USER_PROJECT'));
  });

  test('personal skill requires RESUME and claims USER_SKILL', () => {
    const r = classify('Do you have experience with Kubernetes?');
    assert.ok(r.claimTypes.includes('USER_SKILL'));
    assert.ok(r.requiredSourceTypes.includes('RESUME'));
  });

  test('job requirement requires JOB_DESCRIPTION', () => {
    const r = classify('What are the required skills for this role?');
    assert.ok(r.requiredSourceTypes.includes('JOB_DESCRIPTION'));
    assert.ok(r.claimTypes.includes('JOB_REQUIRED_SKILL'));
  });

  test('meeting fact requires MEETING_TRANSCRIPT', () => {
    const r = classify('What did we decide about the ledger migration?', 'team-meet');
    assert.ok(r.requiredSourceTypes.includes('MEETING_TRANSCRIPT'));
    assert.ok(r.claimTypes.includes('MEETING_STATEMENT'));
  });

  test('document fact requires REFERENCE_FILE', () => {
    const r = classify('According to the paper, how many layers are in the encoder?', 'seminar');
    assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'));
  });
});

describe('MIXED — claim-level split', () => {
  test('personal project + general explanation is MIXED and retrieves', () => {
    const r = classify('Tell me about your WebRTC project and explain how WebRTC establishes a connection.');
    assert.ok(r.questionTypes.includes('MIXED'), r.questionTypes.join(','));
    assert.equal(r.shouldRetrieve, true, 'the personal half still needs evidence');
    assert.ok(r.requiredSourceTypes.includes('RESUME'));
  });
});

describe('mode authorization bounds required sources', () => {
  test('a mode never has an unauthorized source forced into it', () => {
    // team-meet does not authorize RESUME, so a personal question there must not
    // demand it — modes AUTHORIZE sources, they do not have them imposed.
    const r = classify('Tell me about your project.', 'team-meet');
    assert.equal(r.requiredSourceTypes.includes('RESUME'), false);
  });

  test('recruiting requires CANDIDATE_FILE, never the user\'s RESUME', () => {
    const r = classify('What are the required skills for this role?', 'recruiting');
    assert.equal(r.requiredSourceTypes.includes('RESUME'), false);
  });
});

describe('follow-ups never take the fast path', () => {
  test('a bare "why?" retrieves — it may reference grounded content by pronoun', () => {
    const r = classify('Why?', 'technical-interview', { isFollowUp: true });
    assert.notEqual(r.path, 'FAST');
    assert.ok(/follow-up/.test(r.reason));
  });

  test('"would that scale?" is a follow-up despite looking general', () => {
    const r = classify('Would that scale?', 'technical-interview', { isFollowUp: true });
    assert.notEqual(r.path, 'FAST');
  });
});

describe('screen context', () => {
  test('screen-specific question requires SCREEN_CONTEXT', () => {
    const r = classify('What does this error mean?', 'technical-interview', { hasScreenContext: true });
    assert.ok(r.requiredSourceTypes.includes('SCREEN_CONTEXT'));
  });
});

describe('determinism and traceability', () => {
  test('the same input yields byte-identical output', () => {
    const a = classify('Tell me about your WebRTC project.');
    const b = classify('Tell me about your WebRTC project.');
    assert.deepEqual(a, b);
  });

  test('every decision carries a reason for the trace', () => {
    for (const q of ['What is a mutex?', 'Tell me about your project.', 'Why?']) {
      assert.ok(classify(q).reason.length > 0, `no reason for "${q}"`);
    }
  });

  test('an ambiguous question retrieves conservatively rather than guessing', () => {
    const r = classify('Thoughts?');
    assert.ok(r.questionTypes.includes('AMBIGUOUS'));
    assert.notEqual(r.path, 'FAST');
  });
});

describe('unsupported-in-mode is distinct from "no source needed"', () => {
  test('a meeting question in technical-interview does NOT take the fast path', () => {
    // technical-interview does not authorize MEETING_TRANSCRIPT, so
    // requiredSourceTypes comes back empty — but for a reason that has nothing
    // to do with the question being general. Before this signal existed the two
    // collapsed and the turn was answered from model knowledge.
    const r = classify('How many backend roles are we opening this quarter?', 'technical-interview');
    assert.notEqual(r.path, 'FAST', 'must not answer a meeting question from model knowledge');
    assert.deepEqual(r.unsupportedInMode, ['MEETING_TRANSCRIPT']);
    assert.equal(r.shouldRetrieve, false, 'there is nothing authorized to retrieve');
    assert.match(r.reason, /does not authorize/);
  });

  test('the same question in team-meet IS supported and retrieves', () => {
    const r = classify('How many backend roles are we opening this quarter?', 'team-meet');
    assert.deepEqual(r.unsupportedInMode, []);
    assert.ok(r.requiredSourceTypes.includes('MEETING_TRANSCRIPT'));
    assert.equal(r.shouldRetrieve, true);
  });

  test('a genuinely general question reports NO unsupported sources', () => {
    const r = classify('What is idempotency in an HTTP API?', 'technical-interview');
    assert.equal(r.path, 'FAST');
    assert.deepEqual(r.unsupportedInMode, []);
  });

  test('third-person phrasing requires a source (shadow-run regression)', () => {
    const r = classify('What is the name of the price-comparison website the candidate built?');
    assert.notEqual(r.path, 'FAST', 'third-person phrasing must not bypass grounding');
    assert.ok(r.requiredSourceTypes.includes('RESUME'));
  });

  test('a named-entity lookup is not mistaken for a general concept question', () => {
    const r = classify('What is the discount floor for Acme?', 'seminar');
    assert.notEqual(r.path, 'FAST', '"what is X" about a specific entity is a document lookup');
  });

  test('common tech acronyms do NOT trigger the entity signal', () => {
    for (const q of ['What is idempotency in an HTTP API?', 'Explain the difference between TCP and UDP.']) {
      assert.equal(classify(q).path, 'FAST', q);
    }
  });
});
