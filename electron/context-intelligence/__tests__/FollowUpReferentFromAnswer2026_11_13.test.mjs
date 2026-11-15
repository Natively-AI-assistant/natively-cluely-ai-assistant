// F-CTX-05 (live-pipeline forensics, 2026-11-13): a follow-up's referent was taken
// from the previous QUESTION only, never from the previous ANSWER. P2-s05:
//   Q1 "Tell me about the Ledgerline project you led."   A1 "Ledgerline is a Go reconciliation service…"
//   Q2 "Okay. What about the second one on your resume?" A2 "The second is Atlas Search, a Python relevance pipeline."
//   Q3 "And how did you test it?"
// went out as `And how did you test it? (follow-up to: "Okay. What about the second
// one on your resume?")` — "the second one" is only resolved by the answer, the
// evidence held both projects (Atlas rank 1, Ledgerline rank 2), and the history
// header told the model assistant lines are never a source of facts. Which
// project the answer was about depended on the model.
//
// Now: when the previous question named no entity of its own, the entity the
// previous answer named is the referent, and the question line says so.
//
// Run: npm run build:electron && NATIVELY_RAG_LOCAL_RERANK=off node --test electron/context-intelligence/__tests__/FollowUpReferentFromAnswer2026_11_13.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (rel) => pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence', rel)).href;
const { advance, resolveReference, appendTurn } = await import(dist('question/conversation-state.js'));
const { composePrompt } = await import(dist('generation/prompt-composer.js'));
const { MODE_POLICIES } = await import(dist('policies/mode-policy-registry.js'));
const { decide } = await import(dist('orchestration/orchestrator.js'));

const scope = { userId: 'local', sessionId: 'm:f-ctx-05' };
/** Run [question, answer] pairs through the state the way orchestrate + recordAnswerSummary do. */
function chain(...pairs) {
  let s = null;
  for (const [q, a] of pairs) {
    s = advance(s, { scope, question: q, at: 0 });
    if (a) s = { ...s, turns: appendTurn(s.turns, q, a), previousAnswerSummary: a.slice(0, 280) };
  }
  return s;
}

const LEDGERLINE = ['Tell me about the Ledgerline project you led.', 'Ledgerline is a Go reconciliation service; I cut nightly reconciliation from 6 hours to 40 minutes.'];
const SECOND = ['Okay. What about the second one on your resume?', 'The second is Atlas Search, a Python relevance pipeline.'];

describe('a follow-up resolves against the previous answer', () => {
  test('P2-s05: "how did you test it?" after "the second one" is about Atlas Search', () => {
    const r = resolveReference('And how did you test it?', chain(LEDGERLINE, SECOND), scope);
    assert.equal(r.referent, 'Atlas Search', JSON.stringify(r));
    assert.match(r.resolved, /Atlas Search/);
    assert.doesNotMatch(r.resolved, /Ledgerline/);
  });
  test('a generic previous question ("a project you are proud of") resolves to the project the answer named', () => {
    const s = chain(['Tell me about a project you are proud of.', 'Ledgerline, a Go reconciliation service I led at Brightpay.']);
    const r = resolveReference('How did you test it?', s, scope);
    assert.equal(r.referent, 'Ledgerline', JSON.stringify(r));
  });
  test('a previous question that named its own subject keeps it', () => {
    const s = chain(['Tell me about the Kafka migration.', 'Sure. At Brightpay we moved from RabbitMQ to Kafka over two quarters.']);
    const r = resolveReference('Why did you do it?', s, scope);
    assert.notEqual(r.referent, 'Brightpay');
    assert.doesNotMatch(r.resolved, /Brightpay|RabbitMQ/);
  });
  test('no answer recorded yet → unchanged (anchored to the previous question)', () => {
    const r = resolveReference('And how did you test it?', chain(LEDGERLINE, [SECOND[0]]), scope);
    assert.match(r.resolved, /follow-up to: "Okay\. What about the second one on your resume\?"/);
  });
  test('a personal pronoun never binds to an answer entity', () => {
    const s = chain(['Who reviewed the design?', 'Priya Raman reviewed it with the Atlas Search team.']);
    const r = resolveReference('What did she say?', s, scope);
    assert.notEqual(r.referent, 'Atlas Search');
  });
});

describe('the prompt tells the model what the follow-up is about', () => {
  const r = resolveReference('And how did you test it?', chain(LEDGERLINE, SECOND), scope);
  const d = decide({
    requestId: 'r', requestSequence: 1, surface: 'what-to-answer', modeId: 'technical-interview',
    scope: { userId: 'local' }, sessionId: 's05', transcriptQuestion: r.resolved, isFollowUp: true,
  });
  const c = composePrompt({
    decision: d, policy: MODE_POLICIES['technical-interview'], evidence: [],
    conversationSummary: `Question heard in the meeting: ${SECOND[0]}\nAssistant: ${SECOND[1]}`,
  });
  test('the question line names the entity', () => {
    assert.match(c.user, /# Question\nAnd how did you test it\? \(referring to: Atlas Search/);
  });
  test('the history header lets assistant lines resolve what a follow-up points to, never supply facts', () => {
    const header = c.user.split('\n').find((l) => l.startsWith('# Conversation so far'));
    assert.ok(header, 'history section present');
    assert.match(header, /what a follow-up .*points to/i);
    assert.match(header, /never a source of facts/);
  });
});
