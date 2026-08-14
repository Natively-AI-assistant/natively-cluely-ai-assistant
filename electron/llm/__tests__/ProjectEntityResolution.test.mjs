// electron/llm/__tests__/ProjectEntityResolution.test.mjs
//
// Phase 5 coverage (test-engineer review 2026-06-05): the project follow-up
// ENTITY resolution paths — pronoun + extractedQuestion.followUpTarget, the
// exported extractProjectEntity edge cases (hyphenated names, lowercase,
// stopword-prefix leak), and the 'allowed' policy tier.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer, extractProjectEntity } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerPlanner.js')).href
);

describe('extractProjectEntity edge cases', () => {
  test('explicit capitalized name', () => {
    assert.equal(extractProjectEntity('how is Natively developed?'), 'Natively');
  });
  test('hyphenated name preserved (SQL-Copilot)', () => {
    assert.equal(extractProjectEntity('what was your role in SQL-Copilot?'), 'SQL-Copilot');
  });
  test('pronoun-only → empty', () => {
    assert.equal(extractProjectEntity('how was it built?'), '');
    assert.equal(extractProjectEntity('how is that developed?'), '');
  });
  test('lowercase common word → empty (requires a capitalized name)', () => {
    assert.equal(extractProjectEntity('how is natively developed?'), '');
  });
  test('stopword-prefix does NOT leak ("The Project" / "My Project" → stripped)', () => {
    assert.equal(extractProjectEntity('how is The Project built?'), '');
    assert.equal(extractProjectEntity('what was your role in My Project?'), '');
  });
  test('stopword-prefixed REAL name keeps the name ("The Natively" → "Natively")', () => {
    // The capture stops at the first lowercase token ("app"), and the leading
    // stopword "The" is stripped — leaving the real capitalized name.
    assert.equal(extractProjectEntity('how is The Natively built?'), 'Natively');
  });
});

describe('project_followup pronoun path + followUpTarget resolution', () => {
  const p = (over) => planAnswer({ question: over.q, source: 'what_to_answer', speakerPerspective: 'interviewer', extractedQuestion: over.eq });

  test('pronoun "how was it built?" routes to project_followup with no resolvedEntity', () => {
    const r = p({ q: 'how was it built?' });
    assert.equal(r.answerType, 'project_followup_answer');
    assert.equal(r.voicePerspective, 'first_person_candidate');
    assert.equal(r.profileContextPolicy, 'required');
    assert.equal(r.resolvedEntity, undefined);
    assert.ok(r.forbiddenContextLayers.includes('negotiation') && r.forbiddenContextLayers.includes('jd'));
  });

  test('pronoun + followUpTarget from prior turn resolves the entity', () => {
    const r = p({ q: 'how was it built?', eq: { latestQuestion: 'how was it built?', questionType: 'follow_up', followUpTarget: 'Natively', confidence: 0.8, detectedSpeaker: 'interviewer', isFollowUp: true } });
    assert.equal(r.answerType, 'project_followup_answer');
    assert.equal(r.resolvedEntity, 'Natively');
  });

  test('explicit name in the question wins for resolvedEntity', () => {
    assert.equal(p({ q: 'what was your role in SQL-Copilot?' }).resolvedEntity, 'SQL-Copilot');
  });
});

describe("profileContextPolicy 'allowed' tier", () => {
  const t = (q) => planAnswer({ question: q, source: 'what_to_answer', speakerPerspective: 'interviewer' }).profileContextPolicy;
  test('negotiation → allowed', () => {
    assert.equal(t('what salary are you expecting?'), 'allowed');
  });
  // general_meeting recaps must NOT pull the candidate's profile (benchmark
  // 2026-06-05 context-leak fix): "action items?", "what did we decide?",
  // "so what do you think about all this?" are about the CONVERSATION.
  test('general meeting → forbidden (no profile leak)', () => {
    assert.equal(t('so what do you think about all this?'), 'forbidden');
    assert.equal(t('what are the action items?'), 'forbidden');
  });
  test('empty/unknown → allowed', () => {
    assert.equal(planAnswer({ question: '', source: 'manual_input' }).profileContextPolicy, 'allowed');
  });
});

describe('manual-input second-person voice (beyond identity)', () => {
  const v = (q) => planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' }).voicePerspective;
  test('project question (manual) → second_person_user', () => {
    assert.equal(v('What projects have you done?'), 'second_person_user');
  });
  test('jd-fit question (manual) → second_person_user', () => {
    assert.equal(v('How does your background match this role?'), 'second_person_user');
  });
});
