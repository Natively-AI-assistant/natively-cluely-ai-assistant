// Context Intelligence V3 — scoped conversation state.
//
// The isolation tests here mirror the corpus fixtures: two meeting transcripts
// that REVERSE each other's decisions. Carrying state across a meeting change is
// how "we decided ScyllaDB" survives into a meeting that chose Cassandra.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { advance, emptyState, resolveReference, extractEntities, continuitySourceIds, MAX_ENTITIES } =
  await import(pathToFileURL(path.resolve(
    process.cwd(), 'dist-electron/electron/context-intelligence/question/conversation-state.js')).href);

const m1 = { userId: 'u1', meetingId: 'm1' };
const m2 = { userId: 'u1', meetingId: 'm2' };

describe('scope isolation', () => {
  test('state RESETS on meeting change', () => {
    const s1 = advance(null, { scope: m1, question: 'Are we migrating to ScyllaDB?', sourceIds: ['t1'] });
    assert.ok(s1.activeEntities.includes('ScyllaDB'));

    const s2 = advance(s1, { scope: m2, question: 'What did we decide?' });
    assert.equal(s2.scopeId, 'u:u1|m:m2');
    assert.ok(!s2.activeEntities.includes('ScyllaDB'),
      'the previous meeting\'s entities must not survive a meeting change');
    assert.deepEqual(s2.previousSourceIds, []);
  });

  test('continuity source ids are refused across scopes', () => {
    const s1 = advance(null, { scope: m1, question: 'q', sourceIds: ['transcript-m1'] });
    assert.deepEqual(continuitySourceIds(s1, m1), ['transcript-m1']);
    assert.deepEqual(continuitySourceIds(s1, m2), [], 'a different meeting gets nothing');
  });

  test('state accumulates within one scope', () => {
    const a = advance(null, { scope: m1, question: 'Tell me about Cassandra.' });
    const b = advance(a, { scope: m1, question: 'What about Kafka?' });
    assert.ok(b.activeEntities.includes('Kafka'));
    assert.ok(b.activeEntities.includes('Cassandra'), 'earlier entities stay available within the meeting');
  });
});

describe('bounded size', () => {
  test('entities are capped', () => {
    let s = null;
    for (let i = 0; i < 30; i++) s = advance(s, { scope: m1, question: `Tell me about Entity${i}Name.` });
    assert.ok(s.activeEntities.length <= MAX_ENTITIES);
  });

  test('the answer summary is truncated, not stored whole', () => {
    const s = advance(null, { scope: m1, question: 'q', answerSummary: 'x'.repeat(5000) });
    assert.ok(s.previousAnswerSummary.length <= 280,
      'unbounded assistant output is exactly what the legacy blob does');
  });
});

describe('reference resolution', () => {
  test('resolves a pronoun against the active topic', () => {
    const s = advance(null, { scope: m1, question: 'Tell me about the Cassandra migration.' });
    const r = resolveReference('Would it scale?', s);
    assert.equal(r.usedState, true);
    assert.match(r.resolved, /Cassandra/);
  });

  test('returns the question UNCHANGED when there is nothing to resolve against', () => {
    const r = resolveReference('Would it scale?', null);
    assert.equal(r.usedState, false);
    assert.equal(r.resolved, 'Would it scale?',
      'guessing a referent silently redirects retrieval — better to leave it alone');
  });

  test('leaves a self-contained question alone', () => {
    const s = advance(null, { scope: m1, question: 'Tell me about Cassandra.' });
    const r = resolveReference('What is a bloom filter?', s);
    assert.equal(r.usedState, false);
    assert.equal(r.resolved, 'What is a bloom filter?');
  });

  test('does not resolve when state has no entities', () => {
    const r = resolveReference('Why is it slow?', emptyState(m1));
    assert.equal(r.usedState, false);
  });
});

describe('entity extraction', () => {
  test('picks proper nouns and code identifiers, skips stopwords', () => {
    const e = extractEntities('Why did we choose Cassandra over ScyllaDB for MeetingPersistence.ts?');
    assert.ok(e.includes('Cassandra'));
    assert.ok(e.includes('ScyllaDB'));
    assert.ok(e.some((x) => x.includes('MeetingPersistence')));
    assert.ok(!e.some((x) => ['The', 'Why', 'That'].includes(x)));
  });

  test('returns nothing for a question with no entities', () => {
    assert.deepEqual(extractEntities('why is it slow'), []);
  });
});

describe('prior assistant output is a referent, never evidence', () => {
  test('the summary is stored separately from evidence ids', () => {
    const s = advance(null, {
      scope: m1, question: 'q',
      answerSummary: 'The candidate has 10 years of Kubernetes experience.',
      evidenceIds: [],
    });
    // The fabricated claim is retained ONLY as a reference aid; it contributes
    // no evidence, so it cannot support the claim on a later turn.
    assert.deepEqual(s.previousEvidenceIds, []);
    assert.ok(s.previousAnswerSummary.includes('Kubernetes'));
  });
});
