// electron/llm/__tests__/AnswerLengthDocumentMode2026_11_25.test.mjs
//
// Discussion #794: a custom mode answering from reference files, Answer length
// set to Shorter, a Real-time prompt asking for "25–40 words for most
// questions", and answers still ran 100–150 words. Two causes:
//
//   1. A reference-file mode routes an ordinary question to lecture_answer for
//      its sources, and lecture_answer was STRUCTURED_FULL: no length line at
//      any setting. Now only an overview/summary ask is; an open question is
//      spoken (AnswerPlan.documentOpenQuestion) and gets the spoken tiers,
//      Smart included. Lecture mode's own lecture_answer is unchanged.
//   2. "for most questions" read as a condition, so the length was thrown away
//      while still silencing the Answer length setting. A "most"/"usually"
//      scope now resolves as the user's default; real conditions still don't.
//
// Pure: no platform branches. Runs on the built dist-electron bundles.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/', p)).href;
const { planAnswer, renderLengthDirectiveForPlan, formatAnswerPlanForPrompt } = await import(dist('llm/AnswerPlanner.js'));
const speak = await import(dist('llm/speakability.js'));
const al = await import(dist('llm/answerLength.js'));
const uic = await import(dist('llm/userInstructionContract.js'));
const { routeLiveMoment } = await import(dist('intelligence/LiveMomentRouter.js'));

const mode = (o) => ({ id: 'research', name: 'Research Assistant', isCustom: true, hasCustomPrompt: true, ...o });
const DOC_MODE = mode({
  templateType: 'general', hasReferenceFiles: true, documentGrounded: true,
  documentGroundedCustomModeActive: true, strictDocumentGroundedActive: true,
});
const LECTURE_MODE = mode({
  templateType: 'lecture', hasReferenceFiles: false, documentGrounded: false,
  documentGroundedCustomModeActive: false, strictDocumentGroundedActive: false,
});

const live = (question, activeMode) => planAnswer({ question, source: 'what_to_answer', speakerPerspective: 'interviewer', activeMode });

const OPEN_QUESTIONS = [
  'Why did they choose a qualitative approach?',
  'Can you explain the findings?',
  'Tell me about your research',
];

afterEach(() => {
  al.registerAnswerLengthProvider(null);
  uic.registerUserInstructionProvider(null);
});

describe('cause 1: an open question in a reference-file mode is a spoken answer', () => {
  for (const q of OPEN_QUESTIONS) {
    test(`"${q}" keeps lecture_answer for its sources and gets a length line at every setting`, () => {
      const plan = live(q, DOC_MODE);
      assert.equal(plan.answerType, 'lecture_answer');
      assert.equal(plan.documentOpenQuestion, true);
      assert.notEqual(speak.classifyTargetSpeakability(plan.answerType, plan.answerStyle, q, { documentOpenQuestion: true }), 'STRUCTURED_FULL');
      for (const answerLength of ['shorter', 'smart', 'longer']) {
        const line = renderLengthDirectiveForPlan(plan, { answerLength });
        assert.match(line, /LENGTH/, `${answerLength}: no length line`);
      }
      assert.match(renderLengthDirectiveForPlan(plan, { answerLength: 'shorter' }), /the user chose Shorter answers/);
    });
  }

  test('the length line reaches the answer contract', () => {
    al.registerAnswerLengthProvider(() => 'shorter');
    const prompt = formatAnswerPlanForPrompt(live(OPEN_QUESTIONS[0], DOC_MODE));
    assert.match(prompt, /LENGTH \(the user chose Shorter answers\)/);
  });

  test('a summary / overview ask stays notes-style: no length line', () => {
    for (const q of ['Summarize the paper', 'Give me a high-level overview of the thesis']) {
      const plan = live(q, DOC_MODE);
      assert.equal(plan.answerType, 'lecture_answer', q);
      assert.equal(plan.documentOpenQuestion, false, q);
      assert.equal(renderLengthDirectiveForPlan(plan, { answerLength: 'shorter' }), '', q);
    }
  });

  test('"in detail" in a reference-file mode stays uncapped', () => {
    const plan = live('Explain the methodology in detail', DOC_MODE);
    assert.equal(renderLengthDirectiveForPlan(plan, { answerLength: 'shorter' }), '');
  });

  test('Lecture mode without files is unchanged: lecture_answer stays uncapped', () => {
    const plan = live('Can you explain the lecture on photosynthesis?', LECTURE_MODE);
    assert.equal(plan.answerType, 'lecture_answer');
    assert.equal(plan.documentOpenQuestion, false);
    assert.equal(speak.classifyTargetSpeakability('lecture_answer', plan.answerStyle, plan.question), 'STRUCTURED_FULL');
    assert.equal(renderLengthDirectiveForPlan(plan, { answerLength: 'shorter' }), '');
  });

  test('the bare type with no turn facts is still STRUCTURED_FULL (every old caller)', () => {
    assert.equal(speak.classifyTargetSpeakability('lecture_answer', 'default', 'Why did they choose it?'), 'STRUCTURED_FULL');
  });

  test('telemetry measures the open question as spoken', () => {
    const words = Array.from({ length: 120 }, () => 'word').join(' ');
    const d = speak.decideSpeakability(words, 'lecture_answer', 'default', OPEN_QUESTIONS[0], false, 'smart', { documentOpenQuestion: true });
    assert.equal(d.target, 'SPOKEN_SHORT');
    assert.equal(d.overBudget, true);
    const old = speak.decideSpeakability(words, 'lecture_answer', 'default', OPEN_QUESTIONS[0]);
    assert.equal(old.exceptionReason, 'target:STRUCTURED_FULL:answer_type:lecture_answer');
  });

  test('the live moment router reads the same tier', () => {
    const d = routeLiveMoment({ question: OPEN_QUESTIONS[0], source: 'what_to_answer', speakerPerspective: 'interviewer', activeMode: DOC_MODE });
    assert.notEqual(d.speakabilityTarget, 'STRUCTURED_FULL');
  });
});

describe('cause 2: a length scoped to "most" questions is the user\'s default', () => {
  const RESOLVES = [
    ['Keep answers short, natural, and conversational (25–40 words for most questions).', { count: 40, min: 25 }],
    ['Keep answers short, natural and conversational. 25-40 words for most questions.', { count: 40, min: 25 }],
    ['Keep answers 25–40 words for most questions, longer only if the question is complex.', { count: 40, min: 25 }],
    ['Usually keep answers under 50 words.', { count: 50 }],
  ];
  for (const [text, want] of RESOLVES) {
    test(`resolves as usual: ${text}`, () => {
      const a = uic.analyzeUserInstructions(text);
      assert.ok(a.length, 'no length resolved');
      assert.equal(a.length.unit, 'words');
      assert.equal(a.length.count, want.count);
      assert.equal(a.length.min, want.min);
      assert.equal(a.length.usually, true);
      const [line] = uic.renderResolvedInstructionLines(a);
      assert.match(line, /LENGTH is set by the user: usually /);
      assert.match(line, /Go past it only when the question clearly needs more/);
      assert.doesNotMatch(line, /do not run past it/);
    });
  }

  test('"for all questions" is unconditional, not usual', () => {
    const a = uic.analyzeUserInstructions('Answer in 40 words for all questions.');
    assert.equal(a.length?.count, 40);
    assert.notEqual(a.length?.usually, true);
  });

  const STAYS_UNRESOLVED = [
    'Answer in 25-40 words for simple questions and up to 80 for complex ones.',
    '100 words for behavioral questions.',
    'Answer in 100 words if the question is about coding.',
    'Answer in 30 words, longer if they ask for detail.',
  ];
  for (const text of STAYS_UNRESOLVED) {
    test(`a real condition still resolves to nothing: ${text}`, () => {
      const a = uic.analyzeUserInstructions(text);
      assert.equal(a.length, null);
      assert.equal(a.mentionsLength, true);
    });
  }

  test('the resolved default replaces the app line, on a reference-file open question too', () => {
    al.registerAnswerLengthProvider(() => 'shorter');
    uic.registerUserInstructionProvider(() => 'Keep answers short, natural and conversational. 25-40 words for most questions.');
    const prompt = formatAnswerPlanForPrompt(live(OPEN_QUESTIONS[0], DOC_MODE));
    assert.doesNotMatch(prompt, /the user chose Shorter answers/);
    const block = uic.renderUserInstructionBlock('Keep answers short, natural and conversational. 25-40 words for most questions.');
    assert.match(block, /usually between 25 and 40 words/);
    assert.equal(uic.registeredInstructionsSetLength(null), true);
  });
});
