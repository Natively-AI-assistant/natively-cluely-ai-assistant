// electron/llm/__tests__/CodeReviewFixes2026_08_19.test.mjs
//
// Regression pins for the code-review findings fixed on 2026-08-19. Each test
// FAILS against the pre-fix code and states the user-visible consequence.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron');
const load = (rel) => import(pathToFileURL(path.join(base, rel)).href);

const { QuestionLedger } = await load('llm/questionLedger.js');
const { resolveCodingPromptSignals, detectSuppliedCodeTemplate, detectStructuralCodeTemplate } =
  await load('llm/codingPromptSignals.js');
const { scoreAskShape } = await load('llm/questionShapes.js');
const { describeDoubleCaptureFailure } = await load('services/pageCaptureFallback.js');

// ── Finding: one reply closed TWO asks ─────────────────────────────────────
describe('QuestionLedger.ingestCandidateTurn — no double-crediting', () => {
  const twoAsks = () => {
    const ledger = new QuestionLedger();
    ledger.ingestInterviewerTurn({
      text: 'Tell me about your notification project.',
      timestamp: 1000,
      punctuationSource: 'provider_final',
    });
    ledger.ingestInterviewerTurn({
      text: 'Why did you choose kafka?',
      timestamp: 2000,
      punctuationSource: 'provider_final',
    });
    return ledger;
  };

  test('a reply that answers ONE of two open asks leaves the other open', () => {
    const ledger = twoAsks();
    // Echoes the notification-project ask; says nothing about kafka.
    ledger.ingestCandidateTurn({
      text: 'The notification project was a service I built to batch and deliver user notification events reliably.',
      timestamp: 3000,
    });
    const open = ledger.rankActiveAsks(4000);
    const kafka = open.find((a) => /kafka/i.test(a.standaloneText));
    assert.ok(kafka, 'the unanswered kafka ask must still be active — one reply cannot close two asks');
  });

  test('the single-open-ask fallback still answers a lone no-echo reply', () => {
    const ledger = new QuestionLedger();
    ledger.ingestInterviewerTurn({
      text: 'Why did you choose kafka?',
      timestamp: 1000,
      punctuationSource: 'provider_final',
    });
    ledger.ingestCandidateTurn({
      text: 'Mostly because the ordering guarantees matched what that pipeline needed.',
      timestamp: 2000,
    });
    assert.equal(ledger.rankActiveAsks(3000).length, 0, 'a lone open ask is still credited without term echo');
  });

  test('an out-of-order reply cannot answer an ask created after it', () => {
    const ledger = new QuestionLedger();
    ledger.ingestInterviewerTurn({
      text: 'Why did you choose kafka?',
      timestamp: 20000,
      punctuationSource: 'provider_final',
    });
    ledger.ingestCandidateTurn({
      text: 'This reply predates the question entirely and must not close it.',
      timestamp: 1000,
    });
    assert.equal(ledger.rankActiveAsks(21000).length, 1, 'the timestamp guard must apply to the fallback too');
  });
});

// ── Finding: promoted follow-ups lost the coding contract ──────────────────
describe('resolveCodingPromptSignals — caller-side promotion', () => {
  test('a promoted follow_up turn is a coding task', () => {
    const signals = resolveCodingPromptSignals({
      answerType: 'follow_up_answer',
      question: 'now optimize it',
      priorCodingTurnExists: true,
      codingTurnPromoted: true,
    });
    assert.equal(signals.codingTask, true, 'promotion must survive into the v2 SYSTEM prompt signals');
  });

  test('without promotion the behaviour is unchanged', () => {
    const signals = resolveCodingPromptSignals({
      answerType: 'follow_up_answer',
      question: 'now optimize it',
      priorCodingTurnExists: true,
    });
    assert.equal(signals.codingTask, false, 'no surface changes behaviour without opting in');
  });
});

// ── Finding: prose phrases forced a full coding contract ───────────────────
describe('screen-stub promotion requires a STRUCTURAL template', () => {
  const prose = [
    'Can you improve this template for my newsletter?',
    'Can you match the given signature in the contract?',
    'Follow the provided template for the sales deck',
  ];

  test('prose template-words no longer promote a non-coding turn', () => {
    for (const question of prose) {
      assert.equal(detectSuppliedCodeTemplate(question), true, `phrase detector stays inclusive: ${question}`);
      assert.equal(detectStructuralCodeTemplate(question), false, `structural detector rejects prose: ${question}`);
      const signals = resolveCodingPromptSignals({ answerType: 'sales_answer', question });
      assert.equal(signals.codingTask, false, `must not get a DSA contract: ${question}`);
      assert.notEqual(signals.suppliedTemplate, true, `must not claim a template is present: ${question}`);
    }
  });

  test('a real pasted stub still promotes', () => {
    const question = 'Complete this:\n```python\ndef two_sum(nums, target):\n    pass\n```';
    assert.equal(detectStructuralCodeTemplate(question), true);
    const signals = resolveCodingPromptSignals({ answerType: 'unknown_answer', question });
    assert.equal(signals.codingTask, true, 'the canonical reported case must keep working');
    assert.equal(signals.suppliedTemplate, true);
  });

  test('a stub on SCREEN with a deictic ask still promotes', () => {
    const signals = resolveCodingPromptSignals({
      answerType: 'unknown_answer',
      question: 'how do I do this',
      surroundingText: 'class Solution:\n    def trap(self, height: List[int]) -> int:\n        pass',
    });
    assert.equal(signals.codingTask, true);
  });
});

// ── Finding: shadow/live shape-score drift ─────────────────────────────────
describe('scoreAskShape — one table for live and shadow', () => {
  test('a bare question mark scores 0.8 (was 0.85 in the ledger copy)', () => {
    assert.equal(scoreAskShape({ hasMark: true, hasLead: false, punctuationSource: 'provider_final' }), 0.8);
  });

  test('UNKNOWN punctuation provenance is treated as punctuating, not unavailable', () => {
    assert.equal(scoreAskShape({ hasMark: false, hasLead: true, punctuationSource: undefined }), 0.8);
    assert.equal(scoreAskShape({ hasMark: false, hasLead: true, punctuationSource: 'unavailable' }), 0.95);
  });

  test('mark + lead is the top score; no signal defers to the caller tail', () => {
    assert.equal(scoreAskShape({ hasMark: true, hasLead: true, punctuationSource: 'provider_final' }), 0.95);
    assert.equal(scoreAskShape({ hasMark: false, hasLead: false, punctuationSource: 'provider_final' }), null);
  });
});

// ── Finding: macOS-only troubleshooting shown on Windows ───────────────────
describe('describeDoubleCaptureFailure — platform-correct troubleshooting', () => {
  test('macOS names Screen Recording', () => {
    const n = describeDoubleCaptureFailure('no-extension', new Error('capture failed'), 'darwin');
    assert.match(n.detail, /Screen Recording/);
  });

  test('Windows never shows the macOS pane', () => {
    const n = describeDoubleCaptureFailure('no-extension', new Error('capture failed'), 'win32');
    assert.doesNotMatch(n.detail, /Screen Recording|System Settings|macOS/);
    assert.match(n.detail, /protected|DRM|remote-desktop|security software/i);
  });

  test('both platforms still carry the shared, actionable extension guidance', () => {
    for (const platform of ['darwin', 'win32']) {
      const n = describeDoubleCaptureFailure('no-extension', 'denied', platform);
      assert.match(n.detail, /Settings → Sync → Browser Extension/);
      assert.equal(n.kind, 'error');
    }
  });
});
