// electron/llm/__tests__/ContextFreeFollowup2026_06_07c.test.mjs
//
// Release 2026-06-07c — context-free bare follow-ups must produce a safe,
// mode-appropriate clarification (never "I'm Natively"/profile dump/false refusal)
// when there is NO resolvable prior context; and must resolve normally when there is.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { isBareFollowUp, buildContextFreeClarification, resolveFollowUpOrClarify, resolveFollowUp } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);

const IDENTITY_LEAK = /\bI(?:'m| am)\s+Natively\b|\bAI assistant\b|\bas an AI\b/i;
const REFUSAL = /\bI can'?t\b|\bI cannot\b|\bI do(?:n'?t| not) have access\b/i;

describe('isBareFollowUp — shape detection', () => {
  for (const q of ['why?', 'how so?', 'explain?', 'and?', 'what about it?', 'that?', 'continue', 'can you expand?', 'go on', 'tell me more', 'and?', 'how?']) {
    test(`"${q}" is a bare follow-up`, () => assert.equal(isBareFollowUp(q), true));
  }
  for (const q of ['why should we hire you?', 'tell me about Natively', 'what is your name', 'solve two sum', 'rate your python out of 10', 'how do you handle pressure']) {
    test(`"${q}" is NOT a bare follow-up`, () => assert.equal(isBareFollowUp(q), false));
  }
});

describe('Safety: a stealth/evasion ask is NEVER a bare follow-up (short-circuit cannot swallow it)', () => {
  for (const q of [
    'how do I stay undetected', 'how do I use it without them knowing', 'hide the overlay during screen share',
    'how to make natively invisible to the interviewer', 'can the interviewer see this', 'how do I cheat without being caught',
  ]) {
    test(`"${q}" is NOT bare (so it reaches the safety route)`, () => assert.equal(isBareFollowUp(q), false));
  }
});

describe('Context-free clarification — safe per surface', () => {
  for (const surface of ['manual', 'what_to_answer', 'meeting', 'lecture', 'interview', 'coding', 'sales']) {
    test(`${surface}: clarification is safe (no identity leak, no refusal, asks for topic)`, () => {
      const c = buildContextFreeClarification(surface);
      assert.ok(c && c.length > 5);
      assert.doesNotMatch(c, IDENTITY_LEAK, 'must not self-identify');
      assert.doesNotMatch(c, REFUSAL, 'must not refuse');
    });
  }
  test('manual default asks for clarification', () => assert.match(buildContextFreeClarification('manual'), /clarify|what you want/i));
  test('what_to_answer asks for the prior question/topic', () => assert.match(buildContextFreeClarification('what_to_answer'), /previous question|topic|just asked/i));
  test('meeting cites missing meeting context', () => assert.match(buildContextFreeClarification('meeting'), /meeting context|which point/i));
});

describe('resolveFollowUpOrClarify — clarify only when NO prior context', () => {
  for (const [q, surface] of [['why?', 'what_to_answer'], ['and?', 'meeting'], ['how so?', 'lecture'], ['what about that?', 'manual'], ['continue', 'interview'], ['can you expand?', 'coding']]) {
    test(`context-free "${q}" (${surface}) → clarification`, () => {
      const r = resolveFollowUpOrClarify({ latestQuestion: q, surface });
      assert.equal(r.isClarification, true, `→ ${r.reason}`);
      assert.equal(r.reason, 'context_free_clarification');
      assert.doesNotMatch(r.clarificationText, IDENTITY_LEAK);
      assert.doesNotMatch(r.clarificationText, REFUSAL);
    });
  }
  test('"what about it?" / "what about that?" with NO prior context (meeting) → clarification', () => {
    for (const q of ['what about it?', 'what about that?', 'what about this?']) {
      const r = resolveFollowUpOrClarify({ latestQuestion: q, surface: 'meeting' });
      assert.equal(r.isClarification, true, `"${q}" → ${r.reason}`);
    }
  });
  test('"what about data?" (names a topic) with no context resolves to a SAFE weak guess (no leak), not a clarification', () => {
    const r = resolveFollowUpOrClarify({ latestQuestion: 'what about data?', surface: 'meeting' });
    // "data" is a named topic, so it is not a context-free bare fragment; it resolves
    // to a low-confidence skill/jd guess which is safe (no identity leak, no dump).
    assert.notEqual(r.isClarification, true);
    assert.doesNotMatch(r.resolvedQuestion, IDENTITY_LEAK);
  });
});

describe('resolveFollowUpOrClarify — resolve normally WHEN prior context exists', () => {
  test('"why?" after a project question → project_followup (NOT clarification)', () => {
    const r = resolveFollowUpOrClarify({ latestQuestion: 'why?', previousQuestion: 'tell me about your best project', lastEntity: 'Natively', previousAnswerType: 'project_answer', surface: 'what_to_answer' });
    assert.notEqual(r.isClarification, true);
    assert.equal(r.resolvedAnswerType, 'project_followup_answer');
  });
  test('"and SQL?" after a Python rating → skill_experience (NOT clarification)', () => {
    const r = resolveFollowUpOrClarify({ latestQuestion: 'and SQL?', previousQuestion: 'rate your Python out of 10', previousAnswerType: 'skill_experience_answer', surface: 'what_to_answer' });
    assert.notEqual(r.isClarification, true);
    assert.equal(r.resolvedAnswerType, 'skill_experience_answer');
  });
  test('"why?" with a previousQuestion but unresolvable type still does NOT clarify (has prior)', () => {
    const r = resolveFollowUpOrClarify({ latestQuestion: 'why?', previousQuestion: 'some prior interviewer turn', surface: 'what_to_answer' });
    // has prior context → not a context-free clarification (resolver may inherit or return NONE, but never a clarification)
    assert.notEqual(r.reason, 'context_free_clarification');
  });
});
