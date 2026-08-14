// electron/llm/__tests__/WtaManualParity.test.mjs
//
// Issue 3: What-to-answer must NOT have a separate weaker routing system. For an
// equivalent question, the WTA plan (source='what_to_answer') and the manual plan
// (source='manual_input') must agree on answerType and profileContextPolicy — only
// the VOICE differs by mode (WTA = first-person candidate). This proves
// AnswerPlanner is the single source of truth for both surfaces.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);

const manual = (q) => planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' });
const wta = (q) => planAnswer({ question: q, source: 'what_to_answer', speakerPerspective: 'interviewer' });

describe('Issue 3: WTA ↔ manual routing parity (single source of truth)', () => {
  const questions = [
    'What is your name?', 'What projects have you done?', 'Rate your Python skills out of 10.',
    'How would you use SQL?', 'How have you used SQL?', 'Solve Two Sum.', 'Explain BFS.',
    'What salary are you expecting?', 'What are the action items?', 'Why should we hire you?',
    'Tell me about Natively.', 'Where did you study?', 'What is your biggest strength?',
  ];
  for (const q of questions) {
    test(`"${q}" — same answerType + profileContextPolicy across modes`, () => {
      const m = manual(q), w = wta(q);
      assert.equal(w.answerType, m.answerType, `answerType: manual ${m.answerType} vs wta ${w.answerType}`);
      assert.equal(w.profileContextPolicy, m.profileContextPolicy, `policy: manual ${m.profileContextPolicy} vs wta ${w.profileContextPolicy}`);
    });
  }

  test('WTA profile/identity answers always use first_person_candidate voice', () => {
    for (const q of ['What is your name?', 'Why should we hire you?', 'Rate your Python skills out of 10.', 'Tell me about Natively.']) {
      assert.equal(wta(q).voicePerspective, 'first_person_candidate', q);
    }
  });

  test('coding/technical/meeting answers forbid profile in BOTH modes', () => {
    for (const q of ['Solve Two Sum.', 'Explain BFS.', 'What are the action items?']) {
      assert.equal(manual(q).profileContextPolicy, 'forbidden', `manual ${q}`);
      assert.equal(wta(q).profileContextPolicy, 'forbidden', `wta ${q}`);
    }
  });
});
