// A referent note ("… (referring to: X)" / "… (follow-up to: …)") must name
// the thing the question is actually about, or nothing.
//
// Measured live 2026-09-24 (tests/meeting-memory/live-audio, 118-question mock
// technical interview, real STT): 23 questions got a note and about 20 were
// wrong. Replaying the run's question sequence through advance() +
// resolveReference() reproduced 110/118 prompt questions byte for byte, and
// every wrong note came from one of three causes:
//
//   1. STT capitalises the first word of every segment, and a segment often
//      starts mid-sentence ("Balance or do it layer 4 versus layer 7?" for
//      "load balancer"). The sentence-initial skip list only knew question
//      words, so "Balance", "Between", "Cache", "Given", "Step", "Like",
//      "Suppose", "Before" became entities and the next pronoun pointed at them:
//      "And why does it matter? (referring to: Balance)" — the question was
//      about backpressure.
//   2. The topic slot was sticky across unrelated questions. "Postgres" from an
//      MVCC question survived ten turns of a merge-intervals problem, so "Can you
//      write the code for it?" went out as "(referring to: Postgres)".
//   3. A personal pronoun with no known person fell back to the previous
//      QUESTION: "What numbers did she give for the webhook service?" became a
//      follow-up to the candidate's last design answer, and the model answered
//      about its own design although the numbers were in its evidence.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (rel) => pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence', rel)).href;
const { advance, resolveReference, extractEntities } = await import(dist('question/conversation-state.js'));

const scope = { userId: 'local', sessionId: 'm:referents' };
function after(...questions) {
  let s = null;
  for (const q of questions) s = advance(s, { scope, question: q, at: 0 });
  return s;
}

describe('an STT segment\'s capitalised first word is grammar, not an entity', () => {
  for (const [text, word] of [
    ['Balance or do it layer 4 versus layer 7?', 'Balance'],
    ['Between horizontal and vertical scaling?', 'Between'],
    ['Cache and validation in practice?', 'Cache'],
    ['Given the load you mentioned earlier, how did you make sure it kept up?', 'Given'],
    ['Suppose interval', 'Suppose'],
    ['Before we move on, what time complexity did you give?', 'Before'],
  ]) {
    test(`"${text}" does not yield "${word}"`, () => {
      assert.ok(!extractEntities(text).includes(word), JSON.stringify(extractEntities(text)));
    });
  }
  test('a name mid-sentence, an acronym and a CamelCase name still count', () => {
    assert.ok(extractEntities('What isolation level does Postgres use by default?').includes('Postgres'));
    assert.ok(extractEntities('How does MVCC work in MySQL?').includes('MVCC'));
    assert.ok(extractEntities('How does MVCC work in MySQL?').includes('MySQL'));
  });
  test('a sentence-initial name that recurs mid-sentence still counts', () => {
    assert.ok(extractEntities('Kafka is the bus. How is Kafka partitioned?').includes('Kafka'));
  });

  test('live sequence: "And why does it matter?" after the clipped load-balancer question is not about "Balance"', () => {
    const s = after('Between horizontal and vertical scaling?', 'Balance or do it layer 4 versus layer 7?');
    const r = resolveReference('And why does it matter?', s);
    assert.doesNotMatch(r.resolved, /referring to: (Balance|Between)/, r.resolved);
  });
});

describe('a fresh, self-contained question retires the previous topic', () => {
  test('"Can you write the code for it?" is not about Postgres ten questions later', () => {
    const s = after(
      'What does vacuum in Postgres relate to MVCC?',
      'What is the N+1 query problem?',
      'How do you find a slow query in production?',
      'What is the time complexity of your approach?',
    );
    const r = resolveReference('Can you write the code for it?', s);
    assert.doesNotMatch(r.resolved, /Postgres|MVCC/, r.resolved);
  });
  test('the note points at the question just before instead', () => {
    const s = after('What does vacuum in Postgres relate to MVCC?', 'How do you find a slow query in production?');
    const r = resolveReference('How would you catch something like that before it hits production?', s);
    assert.match(r.resolved, /follow-up to: "How do you find a slow query in production\?"/, r.resolved);
  });
  test('a pronoun chain still carries its topic (typed chat, unchanged)', () => {
    const s = after('What is Kubernetes?', 'How does it scale?');
    assert.match(resolveReference('And what does it cost to run?', s).resolved, /referring to: Kubernetes/);
  });
  test('a lowercase topic still carries into the next pronoun (Defect D, unchanged)', () => {
    const s = after('What does this lecture say about quantum computing?');
    assert.match(resolveReference('Can you explain it generally instead?', s).resolved, /quantum computing/);
  });
});

describe('she/he with no known person is not the previous question', () => {
  for (const q of [
    'What numbers did she give for the webhook service?',
    'What constraints did she give for the intervals problem?',
  ]) {
    test(q, () => {
      const s = after('Is there anything you would change in your design now that you have thought about it more?');
      const r = resolveReference(q, s);
      assert.doesNotMatch(r.resolved, /follow-up to/, r.resolved);
    });
  }
  test('a known person still resolves', () => {
    const s = after('What did candidate Leena build at her last job?');
    assert.match(resolveReference('What stack did she use?', s).resolved, /Leena/);
  });
  test('"What did he mean by that?" still anchors — "that" needs the previous turn', () => {
    const s = after('What is eventual consistency?');
    assert.match(resolveReference('What did he mean by that?', s).resolved, /follow-up to|referring to/);
  });
});
