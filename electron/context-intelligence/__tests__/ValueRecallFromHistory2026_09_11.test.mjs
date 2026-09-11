// "repeat the number" resolves to the most recent answer that carries one (2026-09-11).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { advance, resolveReference, valueRecallReferent } =
  await import(pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence/question/conversation-state.js')).href);

const scope = { userId: 'local', sessionId: 's' };
let s = advance(null, { scope, question: 'tell me about the duplicate charges thing', answerSummary: 'At Zephyr in 2024, about 0.8% of payment intents were producing duplicate charges during network retries. Support was seeing around 300 tickets a week.' });
s = advance(s, { scope, question: 'hmm and the ttl', answerSummary: 'I chose the 24-hour TTL because the duplicate window came from network retries.' });
s = advance(s, { scope, question: 'explain the second point again', answerSummary: 'The second point is the fencing token. I paired it with the idempotency key so a late retry could not overwrite a completed intent.' });

describe('value recall from history', () => {
  test('"can you repeat the number" points at the most recent answer with a value', () => {
    const r = resolveReference('can you repeat the number', s, scope);
    assert.equal(r.reason, 'VALUE_RECALL_FROM_HISTORY');
    assert.equal(r.usedState, true);
    assert.match(r.resolved, /\(referring to: I chose the 24-hour TTL/);
  });
  test('when the previous answer already carries a value, the ordinary anchoring stands', () => {
    const s2 = advance(s, { scope, question: 'and the ticket volume', answerSummary: 'Around 300 tickets a week at the peak.' });
    const r = resolveReference('can you repeat the number', s2, scope);
    assert.notEqual(r.reason, 'VALUE_RECALL_FROM_HISTORY');
  });
  test('a long self-contained question is not a value recall', () => {
    assert.equal(valueRecallReferent('what was the number of consumers the brokers can take before we cap the partitions', s.turns), null);
  });
  test('no ring, no referent', () => {
    assert.equal(valueRecallReferent('repeat the number', []), null);
    assert.equal(valueRecallReferent('repeat the number', undefined), null);
  });
  test('an answer with no value anywhere in the ring yields nothing', () => {
    const t = [{ q: 'a', a: 'no digits here' }, { q: 'b', a: 'none here either' }];
    assert.equal(valueRecallReferent('remind me of the date', t), null);
  });
});

describe('a refinement of the previous answer anchors to the previous question (2026-09-11)', () => {
  test('"in simple words" after a grounded answer is a rephrasing request, not a fresh lookup', () => {
    let st = advance(null, { scope, question: 'and the payment terms', answerSummary: 'Payment terms are net 45, late payments accrue 1.25% a month.' });
    const r = resolveReference('in simple words', st, scope);
    assert.equal(r.reason, 'REPHRASE_ANCHORED_TO_PREVIOUS_QUESTION');
    assert.match(r.resolved, /rephrasing request: how to phrase the answer to "and the payment terms"/);
  });
  test('"shorter" and "as a one-liner" behave the same', () => {
    const st = advance(null, { scope, question: 'what are the service credit tiers', answerSummary: 'Credits are 5%, 15% and 30% by tier.' });
    for (const q of ['shorter', 'as a one-liner']) assert.equal(resolveReference(q, st, scope).reason, 'REPHRASE_ANCHORED_TO_PREVIOUS_QUESTION', q);
  });
});
