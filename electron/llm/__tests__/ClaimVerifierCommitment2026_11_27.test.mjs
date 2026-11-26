// EXPERIMENT (autopilot 2026-11-27, awaiting the owner's decision): in Looking for work, a heard question that asks the
// candidate to commit (salary, relocation, notice, start date, job-search status, why they left) is checked even with
// a résumé loaded. Baseline (Natively API, deepseek-flash): "I'd be moving for this role" and an invented interview
// status came back although the answer prompt's commitment notice sat next to the question. Technical Interview is
// left out: "remote procedure call", "hybrid search" and "compensating transaction" would open the gate there.
// NATIVELY_VERIFY_COMMITMENT=0 turns it off. String work only: no platform branches, same on macOS and Windows.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/ClaimVerifierCommitment2026_11_27.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimVerifierKind } from '../../../dist-electron/electron/llm/claimVerifier.js';
import { isCommitmentQuestion } from '../../../dist-electron/electron/llm/commitmentQuestion.js';

const LIVE = [
  'What are your salary expectations?', 'Are you interviewing anywhere else right now?',
  "You're in Portland and this is hybrid in Denver, three days a week. How does that work for you?",
  'Would you relocate?', "What's your notice period?", 'When could you start?', 'Why did you leave your last job?',
  'Do you have any other offers on the table?',
];
const kind = (modeId, question, surface = 'spoken') => claimVerifierKind({ modeId, question, draft: "I'd be moving for this role.", surface, noDocuments: false });

test('spoken commitment questions are checked in Looking for work, with documents loaded', () => {
  delete process.env.NATIVELY_VERIFY_COMMITMENT;
  for (const q of LIVE) {
    assert.equal(isCommitmentQuestion(q), true, q);
    assert.equal(kind('looking-for-work', q), 'personal', q);
  }
});
test('typed, Technical Interview, or switched off: unchanged one-pass decision', () => {
  for (const q of LIVE) {
    assert.equal(kind('looking-for-work', q, 'typed'), null, `typed: ${q}`);
    assert.equal(kind('technical-interview', q), null, `TI: ${q}`);
  }
  process.env.NATIVELY_VERIFY_COMMITMENT = '0';
  try { for (const q of LIVE) assert.equal(kind('looking-for-work', q), null, `off: ${q}`); }
  finally { delete process.env.NATIVELY_VERIFY_COMMITMENT; }
});
test('ordinary Looking for work questions are not commitment questions', () => {
  for (const q of ['Tell me about the Kafka migration.', 'What does Haulwise do?', 'How would you design a dispatch queue?']) {
    assert.equal(isCommitmentQuestion(q), false, q);
    assert.equal(kind('looking-for-work', q), null, q);
  }
});
