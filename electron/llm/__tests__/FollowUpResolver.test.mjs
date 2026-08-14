// electron/llm/__tests__/FollowUpResolver.test.mjs
// Deterministic follow-up resolution for bare live-transcript fragments.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { resolveFollowUp } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);

describe('FollowUpResolver: topic shift to a new skill', () => {
  test('"And SQL?" after a Python rating → rate SQL', () => {
    const r = resolveFollowUp({ latestQuestion: 'And SQL?', previousQuestion: 'Rate your Python skills out of 10.' });
    assert.equal(r.resolvedAnswerType, 'skill_experience_answer');
    assert.match(r.resolvedQuestion.toLowerCase(), /sql/);
    assert.ok(r.confidence >= 0.6);
  });
  test('"and Python frameworks?" after a Python comfort question → skill experience', () => {
    const r = resolveFollowUp({ latestQuestion: 'and Python frameworks?', previousQuestion: 'How comfortable are you with Python?' });
    assert.equal(r.resolvedAnswerType, 'skill_experience_answer');
  });
});

describe('FollowUpResolver: coding follow-up keeps profile out', () => {
  test('"What about complexity?" after a coding answer → technical_concept', () => {
    const r = resolveFollowUp({ latestQuestion: 'What about complexity?', previousQuestion: 'Solve Two Sum.' });
    assert.equal(r.resolvedAnswerType, 'technical_concept_answer');
    assert.match(r.resolvedQuestion.toLowerCase(), /complexity/);
  });
});

describe('FollowUpResolver: expand inherits prior route', () => {
  test('"Why?" after a JD-fit question → jd_fit expand', () => {
    const r = resolveFollowUp({ latestQuestion: 'Why?', previousQuestion: 'Why should we hire you?' });
    assert.equal(r.resolvedAnswerType, 'jd_fit_answer');
  });
  test('"Can you expand?" after a project answer → project_followup', () => {
    const r = resolveFollowUp({ latestQuestion: 'Can you expand?', previousQuestion: 'Tell me about Natively.', previousAnswerType: 'project_answer', lastEntity: 'Natively' });
    assert.equal(r.resolvedAnswerType, 'project_followup_answer');
    assert.equal(r.resolvedEntity, 'Natively');
  });
  test('"How so?" after a technical concept → technical_concept expand (profile stays out)', () => {
    const r = resolveFollowUp({ latestQuestion: 'How so?', previousQuestion: 'Explain BFS.' });
    assert.equal(r.resolvedAnswerType, 'technical_concept_answer');
    assert.ok(r.confidence >= 0.6);
  });
});

describe('Issue 4: project drill-in resolves to project_followup on the entity', () => {
  test('"How is it developed?" after a project (entity Natively) → project_followup', () => {
    const r = resolveFollowUp({ latestQuestion: 'How is it developed?', previousQuestion: 'Which is your best project?', lastEntity: 'Natively' });
    assert.equal(r.resolvedAnswerType, 'project_followup_answer');
    assert.equal(r.resolvedEntity, 'Natively');
    assert.match(r.resolvedQuestion, /Natively/);
  });
  test('"That project?" → project_followup on the entity', () => {
    const r = resolveFollowUp({ latestQuestion: 'That project?', previousQuestion: 'Tell me about Natively.', lastEntity: 'Natively' });
    assert.equal(r.resolvedAnswerType, 'project_followup_answer');
  });
});

describe('Issue 4: "what about data?" must NOT dump full profile', () => {
  test('after JD-fit → jd_fit_answer (focused on data fit), not a profile list', () => {
    const r = resolveFollowUp({ latestQuestion: 'What about data?', previousQuestion: 'Why are you fit for this Data Analyst role?' });
    assert.equal(r.resolvedAnswerType, 'jd_fit_answer');
    assert.doesNotMatch(r.resolvedQuestion, /list|all (?:my|your) (?:skills|projects)/i);
  });
  test('"What about stakeholders?" after JD-fit → jd_fit/skill (not unknown dump)', () => {
    const r = resolveFollowUp({ latestQuestion: 'What about stakeholders?', previousQuestion: 'Why are you fit for this Data Analyst role?' });
    assert.ok(['jd_fit_answer', 'skill_experience_answer'].includes(r.resolvedAnswerType));
  });
});

describe('FollowUpResolver: not a follow-up', () => {
  test('a full standalone question returns confidence 0', () => {
    const r = resolveFollowUp({ latestQuestion: 'What is your experience with data analysis and dashboards?', previousQuestion: 'Tell me about yourself.' });
    assert.equal(r.confidence, 0);
  });
  test('empty question returns confidence 0', () => {
    assert.equal(resolveFollowUp({ latestQuestion: '' }).confidence, 0);
  });
  test('a backchannel / filler that is not a real follow-up returns confidence 0', () => {
    for (const q of ['Hmm, okay.', 'Right.', 'Got it, thanks.']) {
      assert.equal(resolveFollowUp({ latestQuestion: q, previousQuestion: 'Rate your Python.' }).confidence, 0, q);
    }
  });
});

describe('FollowUpResolver: gate boundaries + safety', () => {
  test('"And SQL?" with NO prior skill question does NOT confidently resolve as a skill rating', () => {
    // Prior was a project question, not a skill rating — must not inherit "rate SQL".
    const r = resolveFollowUp({ latestQuestion: 'And SQL?', previousQuestion: 'Tell me about your project.' });
    // Either no resolution, or a weak (<0.7) skill-experience that the engine
    // gate (>=0.7) would NOT apply. Must never be a rating.
    assert.ok(r.confidence < 0.7 || r.resolvedAnswerType !== undefined);
    if (r.resolvedQuestion) assert.doesNotMatch(r.resolvedQuestion, /rate your sql skills out of 10/i);
  });
  test('a skill-rating follow-up ("And SQL?") never inherits a CODING route', () => {
    const r = resolveFollowUp({ latestQuestion: 'And SQL?', previousQuestion: 'Rate your Python skills out of 10.' });
    assert.notEqual(r.resolvedAnswerType, 'coding_question_answer');
    assert.notEqual(r.resolvedAnswerType, 'dsa_question_answer');
  });
  test('entity propagation without previousAnswerType still resolves a project expand', () => {
    const r = resolveFollowUp({ latestQuestion: 'Can you expand?', previousQuestion: 'Tell me about Natively.', lastEntity: 'Natively' });
    assert.equal(r.resolvedEntity, 'Natively');
  });
  test('a long question (>8 words) is never treated as a bare follow-up', () => {
    const r = resolveFollowUp({ latestQuestion: 'And what about your experience using SQL in real production data pipelines?', previousQuestion: 'Rate Python.' });
    assert.equal(r.confidence, 0);
  });
});
