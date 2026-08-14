// AssistantVoiceMisfireGuard2026_06_14.test.mjs
//
// Regression for the Groq-scout E2E sprint finding (2026-06-14): smaller models
// (llama-4-scout) over-apply the prompt's "if asked who you are…" identity reply to
// short, context-free meeting/sales/follow-up questions, emitting
// "I'm Natively, an AI assistant. I was developed by Evin John." or the stock
// "I can't share that information." instead of a real answer. Those answer types are
// ASSISTANT-voice, so they bypass sanitizeCandidateAnswer — detectAssistantVoiceMisfire
// catches the misfire so the caller substitutes an honest line.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectAssistantVoiceMisfire,
  ASSISTANT_VOICE_ANSWER_TYPES,
  CANDIDATE_VOICE_ANSWER_TYPES,
} from '../../../dist-electron/electron/llm/ProfileOutputValidator.js';

describe('detectAssistantVoiceMisfire — identity misfire', () => {
  test('flags the canned identity reply', () => {
    const r = detectAssistantVoiceMisfire("I'm Natively, an AI assistant. I was developed by Evin John.");
    assert.equal(r.isMisfire, true);
    assert.equal(r.reason, 'identity');
  });
  test('flags "I am an AI assistant"', () => {
    assert.equal(detectAssistantVoiceMisfire('I am an AI assistant here to help.').isMisfire, true);
  });
  test('flags "I was developed by Evin John."', () => {
    assert.equal(detectAssistantVoiceMisfire('I was developed by Evin John.').reason, 'identity');
  });
  test('flags "as an AI, I ..." assistant framing', () => {
    assert.equal(detectAssistantVoiceMisfire('As an AI, I cannot attend meetings.').isMisfire, true);
  });
});

describe('detectAssistantVoiceMisfire — stock refusal', () => {
  test('flags the bare "I can\'t share that information."', () => {
    const r = detectAssistantVoiceMisfire("I can't share that information.");
    assert.equal(r.isMisfire, true);
    assert.equal(r.reason, 'refusal');
  });
  test('flags "I cannot share that."', () => {
    assert.equal(detectAssistantVoiceMisfire('I cannot share that.').reason, 'refusal');
  });
});

describe('detectAssistantVoiceMisfire — does NOT over-trigger', () => {
  test('a real meeting answer is not a misfire', () => {
    const real = 'The action items are: Sarah owns the API migration by Friday, and Tom follows up on the pricing deck. The team decided to defer the mobile launch to Q3.';
    assert.equal(detectAssistantVoiceMisfire(real).isMisfire, false);
  });
  test('a real sales answer is not a misfire', () => {
    const real = 'Our pricing model is usage-based with three tiers. The Pro tier at $49/mo covers most teams; enterprise is custom. Want me to walk through which fits their team size?';
    assert.equal(detectAssistantVoiceMisfire(real).isMisfire, false);
  });
  test('a long answer that merely quotes "I can\'t share the exact revenue figure" is not a misfire', () => {
    const real = "Good question — I can't share the exact revenue figure under the NDA, but I can say the segment grew strongly last year and the unit economics improved across both tiers, which is what matters for this comparison.";
    assert.equal(detectAssistantVoiceMisfire(real).isMisfire, false);
  });
  test('an honest no-context clarification is not flagged as a misfire', () => {
    assert.equal(detectAssistantVoiceMisfire("I don't have enough context from the conversation to answer that yet.").isMisfire, false);
  });
  test('"Could you give me a bit more to go on?" is not a misfire', () => {
    assert.equal(detectAssistantVoiceMisfire('Could you give me a bit more to go on?').isMisfire, false);
  });
  test('empty string is not a misfire', () => {
    assert.equal(detectAssistantVoiceMisfire('').isMisfire, false);
  });
  // code-review 2026-06-14 MEDIUM-1: the identity branch must NOT match a legitimate
  // role description that merely starts "I am an assistant…".
  test('"I am an assistant coach…" is NOT a misfire (role, not identity)', () => {
    assert.equal(detectAssistantVoiceMisfire('I am an assistant coach, so I handle the defensive drills.').isMisfire, false);
  });
  test('"I am an AI assistant evangelist…" is NOT a misfire (job title)', () => {
    assert.equal(detectAssistantVoiceMisfire('I am an AI assistant evangelist and I love this space.').isMisfire, false);
  });
  test('"I\'m an assistant manager…" is NOT a misfire', () => {
    assert.equal(detectAssistantVoiceMisfire("I'm an assistant manager on the ops team.").isMisfire, false);
  });
  // …but the real canned misfires still fire after the anchor tightening.
  test('"I\'m an AI assistant." (sentence end) IS a misfire', () => {
    assert.equal(detectAssistantVoiceMisfire("I'm an AI assistant.").isMisfire, true);
  });
  test('"I\'m an AI assistant developed by Evin John." IS a misfire', () => {
    assert.equal(detectAssistantVoiceMisfire("I'm an AI assistant developed by Evin John.").isMisfire, true);
  });
  test('"I am an assistant here to help with your meeting." IS a misfire', () => {
    assert.equal(detectAssistantVoiceMisfire('I am an assistant here to help with your meeting.').isMisfire, true);
  });
});

describe('ASSISTANT_VOICE_ANSWER_TYPES set', () => {
  test('covers the surfaces that leaked in the sprint', () => {
    for (const t of ['general_meeting_answer', 'sales_answer', 'follow_up_answer', 'lecture_answer', 'unknown_answer']) {
      assert.equal(ASSISTANT_VOICE_ANSWER_TYPES.has(t), true, `${t} should be assistant-voice`);
    }
  });
  test('is disjoint from CANDIDATE_VOICE_ANSWER_TYPES (no double-sanitize)', () => {
    for (const t of ASSISTANT_VOICE_ANSWER_TYPES) {
      assert.equal(CANDIDATE_VOICE_ANSWER_TYPES.has(t), false, `${t} must not be in both sets`);
    }
  });
});
