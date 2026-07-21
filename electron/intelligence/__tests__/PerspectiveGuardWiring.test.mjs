// node:test — Phase 3 wiring verification: ProfileTreeService.getCandidatePerspectiveGuard
// (the mode-based "candidate perspective" guard that WIDENS the manual-chat candidate
// sanitizer trigger in ipcHandlers.ts `gemini-chat-stream`, behind profile_tree_v2_enabled
// / NATIVELY_PROFILE_TREE_V2, default OFF).
//
// The live wiring (electron/ipcHandlers.ts ~line 1218) is:
//   let _perspectiveExpectsCandidate = false;
//   try {
//     if (isIntelligenceFlagEnabled('profileTreeV2')) {
//       const guard = ProfileTreeService.getCandidatePerspectiveGuard(mode, message);
//       _perspectiveExpectsCandidate = guard.assistantIdentityWouldLeak;
//     }
//   } catch { /* guard never blocks the answer */ }
//   if (CANDIDATE_VOICE_ANSWER_TYPES.has(answerPlan.answerType) || _perspectiveExpectsCandidate) {
//     ... sanitizeCandidateAnswer(...) ...
//   }
//
// This suite proves the guard's verdict is correct so that widening is SOUND:
//   (a) candidate-voice modes + an identity ask          → assistantIdentityWouldLeak === true
//   (b) genuine app/assistant-identity questions          → isAppIdentityQuestion === true,
//                                                            assistantIdentityWouldLeak === false
//   (c) a non-candidate mode ('sales')                    → assistantIdentityWouldLeak === false
//   (d) widening is SAFE: sanitizeCandidateAnswer is a no-op on a clean candidate answer
//       (repaired === false, text unchanged) so firing the trigger on a correctly-classified
//       answer never over-strips. It DOES strip a genuine assistant-meta tail.
//
// Tests the COMPILED modules (dist-electron) — the exact code the live handler runs.
// Run `npm run build:electron` first.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileTreeService } from '../../../dist-electron/electron/intelligence/ProfileTreeService.js';
import { sanitizeCandidateAnswer } from '../../../dist-electron/electron/llm/ProfileOutputValidator.js';

const NATIVELY_LEAK = /\bi'?m natively\b|\bas an ai assistant\b/i;

// The candidate-identity asks that, in a candidate-voice mode, MUST be answered in the
// candidate's voice — never "I'm Natively". These are intentionally NOT in the
// ASSISTANT_IDENTITY_PATTERNS list (which is reserved for genuine app questions).
const IDENTITY_QUERIES = [
  'introduce yourself',
  'who are you',
  'tell me who you are',
  'what is your name',
];

// Genuine questions ABOUT the app/assistant — here the assistant identity is the CORRECT
// answer, so the guard must NOT force candidate voice (else the app could not answer them).
const APP_IDENTITY_QUERIES = [
  'what is Natively?',
  'are you an AI?',
  'what model are you?',
  'who built you?',
  'are you a real human?',
];

// Modes whose answers are spoken in the candidate/user (first-person) voice. The guard
// also treats an empty/undefined mode as candidate-default (interview-prep posture).
const CANDIDATE_VOICE_MODES = ['technical-interview', 'looking-for-work', 'general', 'recruiting', '', undefined];

describe('Phase 3 — getCandidatePerspectiveGuard (mode-based candidate perspective guard)', () => {
  // ── (a) candidate-voice modes + identity ask → assistantIdentityWouldLeak === true ──
  describe('candidate-voice modes flag an identity ask as an assistant-identity LEAK', () => {
    for (const mode of CANDIDATE_VOICE_MODES) {
      for (const q of IDENTITY_QUERIES) {
        const label = mode === undefined ? '(undefined)' : mode === '' ? '(empty)' : mode;
        test(`mode=${label} q="${q}" → assistantIdentityWouldLeak === true`, () => {
          const g = ProfileTreeService.getCandidatePerspectiveGuard(mode, q);
          assert.equal(g.assistantIdentityWouldLeak, true, 'candidate-identity ask in a candidate mode must flag a leak');
          assert.equal(g.expectCandidateVoice, true, 'and must expect candidate voice');
          assert.equal(g.isAppIdentityQuestion, false, 'an identity ask is NOT an app-identity question');
        });
      }
    }
  });

  // ── (b) genuine app questions → isAppIdentityQuestion === true, leak === false ──
  describe('genuine app/assistant-identity questions stay answerable AS the app', () => {
    for (const mode of ['technical-interview', 'general', 'looking-for-work', 'recruiting']) {
      for (const q of APP_IDENTITY_QUERIES) {
        test(`mode=${mode} q="${q}" → isAppIdentityQuestion === true, assistantIdentityWouldLeak === false`, () => {
          const g = ProfileTreeService.getCandidatePerspectiveGuard(mode, q);
          assert.equal(g.isAppIdentityQuestion, true, 'a genuine app question must be recognised as app-identity');
          assert.equal(g.assistantIdentityWouldLeak, false, 'app questions must NOT be flagged as a candidate-voice leak (the app IS the right answer)');
          assert.equal(g.expectCandidateVoice, false, 'and must NOT force candidate voice');
          assert.equal(g.reason, 'app_identity_question_exempt');
        });
      }
    }
  });

  // ── (c) non-candidate mode ('sales') → leak === false (trigger NOT widened) ──
  describe("non-candidate mode ('sales') does NOT widen the sanitizer trigger", () => {
    for (const q of [...IDENTITY_QUERIES, 'what are your projects', 'walk me through your background']) {
      test(`mode=sales q="${q}" → assistantIdentityWouldLeak === false`, () => {
        const g = ProfileTreeService.getCandidatePerspectiveGuard('sales', q);
        assert.equal(g.assistantIdentityWouldLeak, false, 'must NOT force candidate voice / strip assistant-meta in a sales answer');
        assert.equal(g.expectCandidateVoice, false);
        assert.match(g.reason, /^non_candidate_mode:/);
      });
    }

    // An app question in sales also must not widen the trigger.
    test('mode=sales q="are you an AI?" → leak === false, isAppIdentityQuestion === true', () => {
      const g = ProfileTreeService.getCandidatePerspectiveGuard('sales', 'are you an AI?');
      assert.equal(g.assistantIdentityWouldLeak, false);
      assert.equal(g.isAppIdentityQuestion, true);
    });
  });

  // ── never throws + verdict shape is stable (the live call is exception-wrapped, but a
  //    throwing guard would silently disable the widening — assert it can't throw) ──
  describe('verdict shape is total and never throws', () => {
    for (const [mode, q] of [
      ['technical-interview', 'introduce yourself'],
      ['sales', ''],
      [undefined, undefined],
      [null, null],
      ['general', '   '],
      ['some-unknown-mode', 'who are you'],
    ]) {
      test(`getCandidatePerspectiveGuard(${JSON.stringify(mode)}, ${JSON.stringify(q)}) returns a complete verdict`, () => {
        let g;
        assert.doesNotThrow(() => { g = ProfileTreeService.getCandidatePerspectiveGuard(mode, q); });
        assert.equal(typeof g.assistantIdentityWouldLeak, 'boolean');
        assert.equal(typeof g.expectCandidateVoice, 'boolean');
        assert.equal(typeof g.isAppIdentityQuestion, 'boolean');
        assert.equal(typeof g.reason, 'string');
        // expectCandidateVoice and assistantIdentityWouldLeak track each other (the leak IS
        // "answered as the assistant when candidate voice was expected").
        assert.equal(g.assistantIdentityWouldLeak, g.expectCandidateVoice);
      });
    }

    test('an unknown (non-empty) mode is NOT candidate-default → does not widen', () => {
      const g = ProfileTreeService.getCandidatePerspectiveGuard('some-unknown-mode', 'who are you');
      assert.equal(g.assistantIdentityWouldLeak, false, 'only the listed candidate modes + empty/undefined widen; an arbitrary string does not');
    });
  });
});

// ── (d) THE KEY RISK: widening the trigger must not OVER-STRIP a correct answer ──
// The live handler only mutates the answer when sanitizeCandidateAnswer reports
// `repaired && !needsFallback` (a genuine assistant-meta sentence was removed). On a CLEAN
// candidate answer the sanitizer must be a no-op, so firing the (now wider) trigger on a
// correctly-classified clean answer changes nothing. We assert that property directly.
describe('Phase 3 safety — widening the trigger never over-strips a clean answer', () => {
  const CLEAN_CANDIDATE_ANSWERS = [
    'My name is Alice Chen and I am a Senior ML Engineer at Acme AI where I built a recommender serving 10M users.',
    'I led the RecoEngine project, a real-time recommender built with Python, PyTorch, and Redis.',
    'I have five years of experience across machine learning and distributed systems.',
    // Legitimate candidate content that LOOKS meta but must survive (NDA caveat / real title /
    // honest "not yet" / a product the candidate built) — confirms the strip is precise.
    'I cannot share the exact revenue figure, but the platform grew 3x year over year.',
    'I work as an AI Researcher focused on retrieval systems.',
    'I built an AI assistant product that screens resumes for recruiters.',
    'I do not have ratings yet, but I am steadily improving my Rust skills.',
  ];

  for (const ans of CLEAN_CANDIDATE_ANSWERS) {
    test(`clean answer is unchanged by the sanitizer: "${ans.slice(0, 48)}…"`, () => {
      const s = sanitizeCandidateAnswer(ans);
      assert.equal(s.repaired, false, 'a clean candidate answer must NOT be marked repaired');
      assert.equal(s.needsFallback, false, 'and must NOT trip the fallback path');
      assert.equal(s.text, ans.trim(), 'text must be returned verbatim (no over-stripping)');
      assert.equal(s.removedMarkers.length, 0, 'no markers fire on clean content');
    });
  }

  // The wiring is sound BECAUSE the sanitizer still removes a genuine leak when one exists —
  // this is the gap the mode guard widens the trigger to catch (a candidate-identity ask
  // misclassified to a non-candidate answerType that tail-leaks "I'm Natively").
  test('a genuine assistant-meta tail IS stripped while the valid content survives', () => {
    const leaky = "I'm a Senior ML Engineer at Acme AI with five years of experience. I'm Natively, an AI assistant, so I can't share personal experiences.";
    const s = sanitizeCandidateAnswer(leaky);
    assert.equal(s.repaired, true, 'the meta tail must be stripped');
    assert.equal(s.needsFallback, false, 'the valid lead survives, so no fallback needed');
    assert.match(s.text, /Senior ML Engineer at Acme AI/, 'valid content is preserved');
    assert.doesNotMatch(s.text, NATIVELY_LEAK, 'the "I\'m Natively / AI assistant" leak is gone');
  });

  // An app-identity answer would NEVER reach this strip in the live path because the guard
  // returns assistantIdentityWouldLeak === false for app questions (so the trigger is not
  // widened for them). Belt-and-suspenders: even if it did, a plain "I'm Natively, an AI
  // assistant..." answer is correctly recognised as all-meta → needsFallback, never shipped
  // as a half-stripped fragment. This documents the boundary; the GUARD is what protects app
  // answers, not the sanitizer.
  test('guard, not sanitizer, is what protects a legitimate app answer (app q → not widened)', () => {
    const g = ProfileTreeService.getCandidatePerspectiveGuard('general', 'are you an AI?');
    assert.equal(g.assistantIdentityWouldLeak, false, 'app question never widens the trigger → its app answer is never sent to the candidate sanitizer');
  });
});
