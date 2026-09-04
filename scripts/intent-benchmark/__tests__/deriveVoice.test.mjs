// scripts/intent-benchmark/__tests__/deriveVoice.test.mjs
//
// voice is derived, not labelled. These pin the two deviations the Phase 1
// audit documented, and the one error that would have been self-defeating to
// ship.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveVoice } from '../lib/deriveVoice.mjs';

const row = (mode, mode_intent, needs_response = 'yes', extra = {}) =>
  ({ mode, ...extra, labels: { mode_intent, needs_response } });

describe('derived voice', () => {
  test('anything needing no response is silent, in every mode', () => {
    for (const m of ['sales', 'recruiting', 'team-meet', 'lecture', 'seminar', 'general']) {
      assert.equal(deriveVoice(row(m, 'whatever', 'no')), 'silent', m);
    }
  });

  test('RECRUITING is never first person, whatever the intent', () => {
    // The user is the INTERVIEWER. First person would hand the recruiter the
    // candidate's words. That is exactly the channel inversion this campaign
    // exists to fix, and an LLM labelling pass produced 51 rows of it.
    for (const intent of ['candidate_answer_to_evaluate', 'candidate_question', 'red_flag', 'probe_needed', 'scorecard_moment']) {
      assert.equal(deriveVoice(row('recruiting', intent)), 'advisor', intent);
    }
  });

  test('modes where the user speaks get first_person_script', () => {
    for (const m of ['technical-interview', 'looking-for-work', 'sales', 'seminar', 'call-center']) {
      assert.equal(deriveVoice(row(m, 'anything')), 'first_person_script', m);
    }
  });

  test('TEAM MEET captures by default and speaks only when called on', () => {
    assert.equal(deriveVoice(row('team-meet', 'action_item')), 'capture');
    assert.equal(deriveVoice(row('team-meet', 'decision')), 'capture');
    assert.equal(deriveVoice(row('team-meet', 'risk_blocker')), 'capture');
    assert.equal(deriveVoice(row('team-meet', 'called_on_for_status')), 'first_person_script');
    assert.equal(deriveVoice(row('team-meet', 'question_to_me')), 'first_person_script');
  });

  test('LECTURE advises except when the student is answering', () => {
    assert.equal(deriveVoice(row('lecture', 'new_concept')), 'advisor');
    assert.equal(deriveVoice(row('lecture', 'formula')), 'advisor');
    assert.equal(deriveVoice(row('lecture', 'question_to_room')), 'first_person_script');
    // A rhetorical question the lecturer answers themselves needs no response,
    // so it never reaches the first-person branch.
    assert.equal(deriveVoice(row('lecture', 'question_to_room', 'no')), 'silent');
  });

  test('GENERAL follows the sensed scenario, since it has no fixed persona', () => {
    assert.equal(deriveVoice(row('general', 'interview_answer')), 'first_person_script');
    assert.equal(deriveVoice(row('general', 'sales_objection')), 'first_person_script');
    assert.equal(deriveVoice(row('general', 'meeting_capture')), 'capture');
    assert.equal(deriveVoice(row('general', 'lecture_concept')), 'advisor');
    assert.equal(deriveVoice(row('general', 'something_unmapped')), 'advisor', 'unknown intents fall back, never throw');
  });

  test('a custom mode uses its spec default, and General advisor without one', () => {
    const r = row('custom', 'case_question', 'yes', { custom_mode_key: 'custom-therapy-supervision' });
    assert.equal(deriveVoice(r, { defaultVoice: 'advisor' }), 'advisor');
    assert.equal(deriveVoice(r, null), 'advisor', 'a custom mode is a renamed General');
  });

  test('never throws on a malformed row', () => {
    for (const junk of [null, undefined, {}, { labels: {} }]) {
      assert.doesNotThrow(() => deriveVoice(junk));
    }
  });
});
