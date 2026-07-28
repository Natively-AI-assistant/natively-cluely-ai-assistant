// electron/intelligence/__tests__/WtaAnswerDiversityGuardWiring2026_07_28.test.mjs
//
// Answer-pipeline-rebuild Phase 5 finding: the WTA (live-meeting "What should I say?")
// answer path had ZERO repetition protection, regardless of the answerDiversityGuard flag.
// IntelligenceEngine.ts previously called normalizeOutputShape (cleanup + humanizer only,
// never checks or records against a diversity guard) even when the flag was ON — the
// richer applyAnswerContract facade (which DOES run AnswerDiversityGuard.check/record and
// repair a repeated answer) existed but had zero callers. Manual chat, by contrast, always
// runs its own AnswerDiversityGuard unconditionally (ipcHandlers.ts _manualDiversityGuard).
// Net effect: a live meeting could repeat the same canned answer/opening across genuinely
// different questions with no repair, while manual chat would catch and vary it.
//
// Fix: IntelligenceEngine now owns a `wtaDiversityGuard` instance (one per app-lifetime
// engine instance — matches IntelligenceEngine's own single-instance scope, see main.ts)
// and calls applyAnswerContract (not normalizeOutputShape) under the same
// answerDiversityGuard flag, so flag-ON now delivers what its own name promises.
//
// These tests exercise the REAL compiled applyAnswerContract/AnswerDiversityGuard directly
// (not a re-run of the engine), pinning the contract IntelligenceEngine now relies on.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyAnswerContract,
  AnswerDiversityGuard,
} from '../../../dist-electron/electron/intelligence/OutputShapeNormalizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('applyAnswerContract + AnswerDiversityGuard — the fix WTA now relies on', () => {
  test('a repeated OPENING across two different questions (rest of the answer diverges) is detected and repaired', () => {
    // Uses the same_opening_window reason specifically (identical first 8 words, bodies
    // otherwise different) — this is what varySpokenOpening is actually designed to repair
    // per its own doc comment ("vary a repeated spoken answer's OPENING"). An EARLIER version
    // of this test used two answers that were identical in their ENTIRETY (differing only in
    // the opening word), which triggers same_first_sentence/near_duplicate instead: varying
    // just the opening word doesn't change token-level Jaccard similarity enough to escape
    // THAT re-check, so the repair is correctly rejected — a real, structural limitation this
    // ladder shares with manual chat's identical logic (ipcHandlers.ts), not a defect in this
    // fix. Also deliberately does NOT start with any of varySpokenOpening's existing hedge
    // words (honestly/the way/for me/...), which would make it correctly decline to "stack".
    const guard = new AnswerDiversityGuard(20);
    const first = applyAnswerContract({
      answer: 'I would say my biggest strength is teamwork, since I led the payments migration end '
        + 'to end without any drama and the whole squad trusted the plan.',
      answerStyle: 'default',
      isCoding: false,
      answerType: 'behavioral_question_answer',
      question: 'What is your biggest strength?',
      guard,
    });
    assert.equal(first.repetition?.repeated, false, 'first answer is never repeated');

    const second = applyAnswerContract({
      answer: 'I would say my biggest strength is teamwork, though this role also needs strong '
        + 'debugging instincts under real production pressure and tight deadlines daily.',
      answerStyle: 'default',
      isCoding: false,
      answerType: 'behavioral_question_answer',
      question: 'What do you bring to a team?',
      guard,
    });
    assert.equal(second.repetition?.repeated, true, 'a repeated OPENING on a different question is flagged');
    assert.equal(second.repetition?.reason, 'same_opening_window');
    // Code review (2026-07-28) caught a vacuous version of this assertion
    // (`second.text !== second.repetition` — string !== object, always true, so it could
    // never fail regardless of whether a repair actually happened). Assert the REAL
    // observable contract instead: a repeat must actually change the delivered text and
    // record 'diversity_repair', not just detect the repeat and hand it back unchanged —
    // this is exactly the behavior manual chat already had and WTA previously lacked.
    assert.ok(second.applied.includes('diversity_repair'), "'diversity_repair' must be recorded in applied[]");
    assert.notEqual(second.text, first.text, 'the repeated opening must actually be varied, not delivered byte-identical');
  });

  test('the SAME question (or a synonymous phrasing) legitimately repeats — not flagged', () => {
    const guard = new AnswerDiversityGuard(20);
    const answer = 'The team shipped a real-time sync feature using WebSockets and CRDT merge logic.';
    applyAnswerContract({
      answer, answerStyle: 'default', isCoding: false,
      answerType: 'project_about_answer', question: 'What did you build at your last job?', guard,
    });
    const repeat = applyAnswerContract({
      answer, answerStyle: 'default', isCoding: false,
      answerType: 'project_about_answer', question: 'What did you build at your last job?', guard,
    });
    assert.equal(repeat.repetition?.repeated, false, 'same ask legitimately reuses the same factual answer');
  });

  test('coding answers are never diversity-checked (structured shape is intentional)', () => {
    const guard = new AnswerDiversityGuard(20);
    const codeAnswer = '```js\nfunction f(){ return 1; }\n```';
    applyAnswerContract({
      answer: codeAnswer, isCoding: true, answerType: 'dsa_question_answer', question: 'Solve X', guard,
    });
    const again = applyAnswerContract({
      answer: codeAnswer, isCoding: true, answerType: 'dsa_question_answer', question: 'Solve Y (unrelated)', guard,
    });
    assert.equal(again.repetition?.repeated, false, 'coding answers short-circuit the diversity check');
  });

  test('guard.reset() clears history — mirrors IntelligenceEngine.clearWtaDiversityHistory()', () => {
    const guard = new AnswerDiversityGuard(20);
    const answer = 'I would frame it as ownership of the migration from design through rollout.';
    applyAnswerContract({
      answer, answerStyle: 'default', isCoding: false,
      answerType: 'behavioral_question_answer', question: 'Describe your ownership style.', guard,
    });
    guard.reset();
    const afterReset = applyAnswerContract({
      answer, answerStyle: 'default', isCoding: false,
      answerType: 'behavioral_question_answer', question: 'What does ownership mean to you?', guard,
    });
    assert.equal(afterReset.repetition?.repeated, false, 'a fresh session (post-reset) has no prior history to collide with');
  });

  test('never throws on empty/garbage input, mirroring the engine\'s own try/catch', () => {
    const guard = new AnswerDiversityGuard(20);
    for (const bad of ['', '   ', undefined, '***']) {
      assert.doesNotThrow(() => applyAnswerContract({
        answer: bad, answerStyle: 'default', isCoding: false,
        answerType: 'behavioral_question_answer', question: 'x', guard,
      }));
    }
  });
});

describe('IntelligenceEngine source wiring (static check — no engine instantiation needed)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');

  test('IntelligenceEngine owns a wtaDiversityGuard instance', () => {
    assert.match(src, /wtaDiversityGuard\s*=\s*new AnswerDiversityGuard/);
  });

  test('clearWtaDiversityHistory() exists and clears wtaDiversityGuard, separate from reset()', () => {
    // Deliberately NOT inside reset(): reset() is also called by
    // IntelligenceManager.resetEngine() (API-key/provider swap mid-meeting), whose own
    // doc comment promises "WITHOUT touching session state" — wiping the guard there would
    // silently defeat this fix's protection for the rest of a live meeting every time a
    // user swaps a key. Only IntelligenceManager.reset() (genuine session teardown) should
    // clear it, via this dedicated method.
    const methodStart = src.indexOf('clearWtaDiversityHistory(): void {');
    assert.ok(methodStart >= 0, 'clearWtaDiversityHistory() should exist as its own method');
    const methodBody = src.slice(methodStart, src.indexOf('\n    }', methodStart));
    assert.match(methodBody, /this\.wtaDiversityGuard\.reset\(\)/);

    const resetStart = src.indexOf('reset(): void {');
    assert.ok(resetStart >= 0, 'reset() should exist');
    const resetBody = src.slice(resetStart, src.indexOf('\n    }', resetStart));
    assert.doesNotMatch(resetBody, /wtaDiversityGuard/, 'reset() must NOT touch wtaDiversityGuard directly');
  });

  test('the WTA output-shape block calls applyAnswerContract, not normalizeOutputShape, and passes the guard', () => {
    const gateStart = src.indexOf("isIntelligenceFlagEnabled('answerDiversityGuard')");
    assert.ok(gateStart >= 0, 'the answerDiversityGuard flag gate should exist');
    const block = src.slice(gateStart, gateStart + 700);
    assert.match(block, /applyAnswerContract\(/);
    assert.match(block, /guard:\s*this\.wtaDiversityGuard/);
  });

  test('a repetition-check trace mark is emitted regardless of whether a repair fired (observability)', () => {
    const gateStart = src.indexOf("isIntelligenceFlagEnabled('answerDiversityGuard')");
    const block = src.slice(gateStart, gateStart + 1500);
    assert.match(block, /trace\.mark\('wta_diversity_guard_checked'/);
  });
});

describe('IntelligenceManager source wiring (static check)', () => {
  const managerSrc = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceManager.ts'), 'utf8');

  test('reset() (genuine session teardown) calls engine.clearWtaDiversityHistory()', () => {
    const resetStart = managerSrc.indexOf('reset(): void {');
    assert.ok(resetStart >= 0, 'IntelligenceManager.reset() should exist');
    const resetBody = managerSrc.slice(resetStart, managerSrc.indexOf('\n    }', resetStart));
    assert.match(resetBody, /this\.engine\.clearWtaDiversityHistory\(\)/);
  });

  test('resetEngine() (API-key/provider swap) does NOT clear wtaDiversityGuard history', () => {
    const start = managerSrc.indexOf('resetEngine(): void {');
    assert.ok(start >= 0, 'resetEngine() should exist');
    const body = managerSrc.slice(start, managerSrc.indexOf('\n    }', start));
    assert.doesNotMatch(body, /clearWtaDiversityHistory|wtaDiversityGuard/,
      'resetEngine() promises "WITHOUT touching session state" — the guard history must survive an API-key swap mid-meeting');
  });
});
