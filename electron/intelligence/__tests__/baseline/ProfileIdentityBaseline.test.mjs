// PHASE 2 BASELINE — Profile identity regression characterization.
// These tests pin the CURRENT deterministic behavior of the profile fast path so
// later phases can't regress it. They target the real shipped functions
// (tryBuildManualProfileFastPathAnswer, isAssistantIdentityQuestion) — the exact
// surface the manual + WTA paths call. The "specific bugs to prevent" list from the
// prompt is encoded here as assertions.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  tryBuildManualProfileFastPathAnswer,
  isAssistantIdentityQuestion,
} from '../../../../dist-electron/electron/llm/manualProfileIntelligence.js';

const PROFILE = {
  identity: { name: 'Evin John' },
  experience: [{ role: 'AI Engineer', company: 'Acme', bullets: ['Built real-time AI copilots'] }],
  projects: [{ name: 'Natively', description: 'an AI meeting copilot', technologies: ['Electron', 'TypeScript'] }],
  skills: ['TypeScript', 'Python', 'Electron', 'React'],
  education: [{ degree: 'BS', field: 'CS', institution: 'State University' }],
};

const NATIVELY_LEAK = /\bi'?m natively\b|\bi am natively\b|\ban ai assistant\b|\bas an ai\b/i;

// The bug list from the prompt: identity questions must NOT answer "I'm Natively".
const IDENTITY_QUESTIONS = [
  'introduce yourself',
  'who are you?',
  'what is your name?',
  'what is your full name?',
  'what should I call you?',
  'tell me about yourself',
  'walk me through your background',
];

describe('PHASE2 baseline — profile identity (candidate voice, no Natively leak)', () => {
  for (const q of IDENTITY_QUESTIONS) {
    test(`"${q}" → candidate answer, never "I am Natively"`, () => {
      const route = tryBuildManualProfileFastPathAnswer({
        question: q, profile: PROFILE, source: 'what_to_answer',
      });
      assert.ok(route, `expected a deterministic fast-path answer for "${q}"`);
      assert.ok(route.answer && route.answer.trim().length > 0);
      assert.doesNotMatch(route.answer, NATIVELY_LEAK, `"${q}" leaked assistant identity`);
      // Must reference the loaded candidate, not refuse.
      assert.doesNotMatch(route.answer, /\bi don'?t (know|have)\b/i);
    });
  }

  test('identity questions use the deterministic fast path (no provider needed)', () => {
    const route = tryBuildManualProfileFastPathAnswer({
      question: 'what is your name?', profile: PROFILE, source: 'what_to_answer',
    });
    assert.equal(route?.usedDeterministicFastPath, true);
    assert.equal(route?.providerUsed, false);
    assert.match(route.answer, /Evin John/);
  });

  test('GENUINE app/assistant questions DO bail to the assistant path', () => {
    for (const q of ['are you an AI?', 'what is Natively?', 'what model are you?', 'are you ChatGPT?', 'who built you?']) {
      assert.equal(isAssistantIdentityQuestion(q), true, `"${q}" should be assistant-meta`);
      // The fast path returns null for assistant-meta → handled by assistant identity logic.
      const route = tryBuildManualProfileFastPathAnswer({ question: q, profile: PROFILE, source: 'manual_input' });
      assert.equal(route, null, `"${q}" must NOT be answered as the candidate`);
    }
  });

  test('candidate identity asks are NOT misclassified as assistant-meta', () => {
    for (const q of ['who are you?', 'what is your name?', 'introduce yourself']) {
      assert.equal(isAssistantIdentityQuestion(q), false, `"${q}" must read as candidate identity when a profile is loaded`);
    }
  });

  test('project listing is deterministic and complete', () => {
    const route = tryBuildManualProfileFastPathAnswer({
      question: 'what are your projects', profile: PROFILE, source: 'what_to_answer',
    });
    assert.ok(route);
    assert.match(route.answer, /Natively/);
  });
});
