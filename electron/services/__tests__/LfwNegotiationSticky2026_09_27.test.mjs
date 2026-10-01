// Looking-for-work: ordinary interview questions must not route to salary
// negotiation just because the recruiter has spoken (live 2026-09-27).
//
// Every final interviewer utterance feeds NegotiationConversationTracker, and
// its first one entered PROBE, so isActive() — which the orchestrator passed
// as `negotiationActive` — was true for the whole call. With that flag, any
// question holding a soft comp token as a SUBSTRING ("pay" in "payout") or any
// ≤4-word reply ("And why?") classified as negotiation: the live answer waited
// up to 2 s on the coaching call and lost its résumé grounding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const K = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge');
const { classifyIntentWithContext } = require(path.join(K, 'IntentClassifier.js'));
const { NegotiationConversationTracker } = require(path.join(K, 'NegotiationConversationTracker.js'));

test('the tracker is "active" after any recruiter line, but only NEGOTIATING after comp', () => {
  const t = new NegotiationConversationTracker();
  t.addRecruiterUtterance("Hi, this is Priya from the talent team. Is now still a good time?");
  t.addRecruiterUtterance('Walk me through your background.');
  assert.equal(t.isActive(), true, 'unchanged: other read sites keep their meaning');
  assert.equal(t.isNegotiating(), false, 'no amount, no offer: not a negotiation');
  t.addRecruiterUtterance('The base for this level is one hundred and fifty thousand, so $150,000 to $175,000.');
  assert.equal(t.isNegotiating(), true);
});

test('soft comp tokens are whole words: payout, payments, PayPal do not stick', () => {
  for (const q of [
    'Tell me more about the payout service rewrite on your resume.',
    'So how did you handle PayPal refunds?',
    'Was the refactor worthwhile for the team?',
  ]) {
    assert.notEqual(classifyIntentWithContext(q, { negotiationActive: true }), 'negotiation', q);
  }
});

test('a genuine comp follow-up in a live thread still sticks', () => {
  assert.equal(classifyIntentWithContext('what about the range', { negotiationActive: true }), 'negotiation');
  assert.equal(classifyIntentWithContext('is the pay negotiable', { negotiationActive: true }), 'negotiation');
  assert.equal(classifyIntentWithContext('is that number flexible?', { recentIntentWasNegotiation: true }), 'negotiation');
});

test('the orchestrator classifies with isNegotiating(), not isActive()', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../../premium/electron/knowledge/KnowledgeOrchestrator.ts'), 'utf8');
  assert.match(src, /const negotiationActive = this\.negotiationTracker\.isNegotiating\(\);/);
  assert.doesNotMatch(src, /const negotiationActive = this\.negotiationTracker\.isActive\(\);/);
});
