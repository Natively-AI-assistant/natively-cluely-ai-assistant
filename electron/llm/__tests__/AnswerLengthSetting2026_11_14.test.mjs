// electron/llm/__tests__/AnswerLengthSetting2026_11_14.test.mjs
//
// The Answer length (Shorter / Smart / Longer), one setting for the whole app
// in Settings › Overlay (per mode in the Modes editor until 2026-11-15). What
// it must and must not do:
//   - Smart is the app as it was: the LENGTH line is byte-for-byte unchanged.
//   - Shorter / Longer move the three spoken bands and the fuller-answer cap,
//     and say they replace the system prompt's own sentence counts.
//   - Every exemption holds at every length: explicit styles from the question
//     (incl. "tell me about a time"), coding, step-by-step / "in detail".
//   - A length the user wrote into the Real-time prompt still wins: a number
//     silences the app line, and "keep it brief" overrides Longer.
//   - A broken or absent provider reads as Smart; it never breaks a turn.
//   - Shorter and Longer apply only with Pro or a trial (effectiveAnswerLength).
// Pure: no platform branches. Runs on the built dist-electron bundles.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/', p)).href;
const { renderLengthDirectiveForPlan, formatAnswerPlanForPrompt, planAnswer } = await import(dist('AnswerPlanner.js'));
const speak = await import(dist('speakability.js'));
const al = await import(dist('answerLength.js'));
const uic = await import(dist('userInstructionContract.js'));
const { buildProfileJitPrompt } = await import(dist('ProfileJitPromptBuilder.js'));

const plan = (answerType, question, answerStyle) => ({ answerType, answerStyle, question });

// One question per tier/band, as the existing length tests use them.
const STANDARD = plan('general_meeting_answer', 'What questions would you ask me?');
const BRIEF = plan('general_meeting_answer', 'Is Postgres a relational database?');
const FULLER = plan('general_meeting_answer', 'How would you split the system into services?');
const SPOKEN_FULL = plan('behavioral_interview_answer', 'How do you handle conflict within a team?');

afterEach(() => {
  al.registerAnswerLengthProvider(null);
  uic.registerUserInstructionProvider(null);
});

describe('Smart is the app as it was', () => {
  test('no provider, an explicit smart, and a smart provider all give the same line', () => {
    for (const p of [STANDARD, BRIEF, FULLER, SPOKEN_FULL]) {
      const before = renderLengthDirectiveForPlan(p);
      assert.equal(renderLengthDirectiveForPlan(p, { answerLength: 'smart' }), before);
      al.registerAnswerLengthProvider(() => 'smart');
      assert.equal(renderLengthDirectiveForPlan(p), before);
      al.registerAnswerLengthProvider(null);
    }
  });

  test('the Smart lines keep their pinned wording and numbers', () => {
    assert.match(renderLengthDirectiveForPlan(STANDARD), /^LENGTH: aim for about 22s spoken — roughly 40 to 60 words/);
    assert.match(renderLengthDirectiveForPlan(STANDARD), /Hard ceiling: never go past 75 words/);
    assert.match(renderLengthDirectiveForPlan(SPOKEN_FULL), /^LENGTH LIMIT: at most 110 words \(~45 seconds spoken\)/);
    assert.doesNotMatch(renderLengthDirectiveForPlan(STANDARD), /the user chose/);
  });
});

describe('Shorter and Longer move the numbers', () => {
  const cases = [
    ['shorter', STANDARD, 15, 35, 45],
    ['shorter', BRIEF, 10, 20, 25],
    ['shorter', FULLER, 25, 40, 50],
    ['longer', STANDARD, 90, 140, 175],
    ['longer', BRIEF, 40, 60, 75],
    ['longer', FULLER, 140, 200, 220],
  ];
  for (const [length, p, min, max, ceiling] of cases) {
    test(`${length}: "${p.question}" → ${min}-${max} words, ceiling ${ceiling}`, () => {
      const d = renderLengthDirectiveForPlan(p, { answerLength: length });
      assert.match(d, new RegExp(`the user chose ${length === 'shorter' ? 'Shorter' : 'Longer'} answers`));
      assert.match(d, new RegExp(`roughly ${min} to ${max} words`));
      assert.match(d, new RegExp(`never go past ${ceiling} words`));
    });
  }

  test('the band still follows the question: yes/no < normal < reasoning, at every length', () => {
    for (const length of ['shorter', 'smart', 'longer']) {
      const max = (p) => Number(renderLengthDirectiveForPlan(p, { answerLength: length }).match(/to (\d+) words/)[1]);
      assert.ok(max(BRIEF) < max(STANDARD) && max(STANDARD) < max(FULLER), length);
    }
  });

  test('each length sits where its name says, band by band', () => {
    for (const p of [BRIEF, STANDARD, FULLER]) {
      const max = (length) => Number(renderLengthDirectiveForPlan(p, { answerLength: length }).match(/to (\d+) words/)[1]);
      assert.ok(max('shorter') < max('smart') && max('smart') < max('longer'), p.question);
    }
  });

  test('a fuller spoken answer: 70 words Shorter, 110 Smart, 200 Longer', () => {
    assert.match(renderLengthDirectiveForPlan(SPOKEN_FULL, { answerLength: 'shorter' }), /at most 70 words \(~30 seconds spoken\)/);
    assert.match(renderLengthDirectiveForPlan(SPOKEN_FULL, { answerLength: 'longer' }), /at most 200 words \(~85 seconds spoken\)/);
    assert.equal(speak.spokenFullPromptMaxWords('smart'), speak.SPOKEN_FULL_PROMPT_MAX_WORDS);
  });

  test('each line says which way it overrides the system prompt\'s own counts', () => {
    assert.match(renderLengthDirectiveForPlan(STANDARD, { answerLength: 'shorter' }), /replaces every longer length target in this prompt, including sentence counts/);
    assert.match(renderLengthDirectiveForPlan(STANDARD, { answerLength: 'longer' }), /replaces every shorter length target in this prompt, including sentence counts/);
  });

  test('no line asks for a story or an example (on behavioral turns that invited invented events)', () => {
    for (const length of ['shorter', 'longer']) {
      for (const p of [STANDARD, BRIEF, FULLER, SPOKEN_FULL]) {
        assert.doesNotMatch(renderLengthDirectiveForPlan(p, { answerLength: length }), /\bstor(y|ies)\b|\bexample\b|\bonce\b/i, `${length}: ${p.question}`);
      }
    }
  });
});

describe('the exemptions hold at every length', () => {
  for (const length of ['shorter', 'longer']) {
    test(`${length}: explicit styles from the question keep their own length`, () => {
      for (const style of ['star', 'short', 'one_liner', 'detailed', 'bullets', 'notes', 'code_only', 'beginner']) {
        assert.equal(renderLengthDirectiveForPlan(plan('general_meeting_answer', 'x', style), { answerLength: length }), '', style);
      }
    });
    test(`${length}: coding and structured answers get no line`, () => {
      for (const [type, q] of [
        ['coding_question_answer', 'Solve two sum.'],
        ['dsa_question_answer', 'Reverse a linked list.'],
        ['system_design_answer', 'Design a rate limiter.'],
        ['general_meeting_answer', 'Can you walk me through the auth flow step by step?'],
      ]) {
        assert.equal(renderLengthDirectiveForPlan(plan(type, q), { answerLength: length }), '', type);
      }
    });
  }
});

describe('the setting is read through the provider', () => {
  test('the registered length applies whichever mode the turn is pinned to', () => {
    al.registerAnswerLengthProvider(() => 'longer');
    assert.match(renderLengthDirectiveForPlan(STANDARD, { pinnedModeId: 'm-any' }), /roughly 90 to 140 words/);
    assert.match(renderLengthDirectiveForPlan(STANDARD), /roughly 90 to 140 words/);
    al.registerAnswerLengthProvider(() => 'shorter');
    assert.match(renderLengthDirectiveForPlan(STANDARD), /roughly 15 to 35 words/);
  });

  test('Shorter and Longer need Pro or a trial; Smart and junk read as Smart either way', () => {
    assert.equal(al.effectiveAnswerLength('longer', true), 'longer');
    assert.equal(al.effectiveAnswerLength('shorter', true), 'shorter');
    assert.equal(al.effectiveAnswerLength('longer', false), 'smart');
    assert.equal(al.effectiveAnswerLength('shorter', false), 'smart');
    assert.equal(al.effectiveAnswerLength('smart', false), 'smart');
    assert.equal(al.effectiveAnswerLength(undefined, true), 'smart');
    assert.equal(al.effectiveAnswerLength('huge', true), 'smart');
  });

  test('a throwing provider or a junk value reads as Smart', () => {
    const smart = renderLengthDirectiveForPlan(STANDARD);
    al.registerAnswerLengthProvider(() => { throw new Error('db closed'); });
    assert.equal(renderLengthDirectiveForPlan(STANDARD), smart);
    al.registerAnswerLengthProvider(() => 'huge');
    assert.equal(renderLengthDirectiveForPlan(STANDARD), smart);
    assert.equal(al.getRegisteredAnswerLength(), 'smart');
  });

  test('exempt turns never ask the provider (no setting read for code or stories)', () => {
    let asked = 0;
    al.registerAnswerLengthProvider(() => { asked += 1; return 'longer'; });
    renderLengthDirectiveForPlan(plan('coding_question_answer', 'Solve two sum.'));
    renderLengthDirectiveForPlan(plan('general_meeting_answer', 'x', 'star'));
    assert.equal(asked, 0);
  });
});

describe('the Real-time prompt still wins', () => {
  // Evin 2026-11-15: "real time prompt user saying 500 words and in the answer
  // size its like short or smart, in that scenario follow real time prompt".
  test('"Answer in 500 words" in the prompt: no app length line at any setting', () => {
    const real = planAnswer({ question: 'What is your return policy for opened items?', source: 'what_to_answer' });
    for (const length of ['shorter', 'smart', 'longer']) {
      al.registerAnswerLengthProvider(() => length);
      uic.registerUserInstructionProvider(null);
      assert.match(formatAnswerPlanForPrompt(real), /LENGTH/, `precondition: ${length} states a length`);
      uic.registerUserInstructionProvider(() => 'Answer in 500 words.');
      assert.equal(uic.registeredInstructionsSetLength(), true);
      assert.doesNotMatch(formatAnswerPlanForPrompt(real), /LENGTH|Hard ceiling|words \(/, length);
    }
    uic.registerUserInstructionProvider(null);
    assert.equal(uic.registeredInstructionsSetLength(), false);
  });

  test('profile answers state no word target when the prompt sets the length', () => {
    const base = { question: 'Tell me about your last role.', answerType: 'profile_answer', evidence: { items: [], checkedSources: [] } };
    assert.match(buildProfileJitPrompt({ ...base, maxAnswerWords: 90 }).userPrompt, /target <= 90 words/);
    const deferred = buildProfileJitPrompt({ ...base, maxAnswerWords: null }).userPrompt;
    assert.doesNotMatch(deferred, /target <=/);
    assert.match(deferred, /Take its length from the user's own instructions/);
    assert.match(buildProfileJitPrompt(base).userPrompt, /target <= 90 words/, 'absent still means 90');
  });


  test('a number in the prompt silences the app line at Shorter and Longer alike', () => {
    const real = planAnswer({ question: 'What is your return policy for opened items?', source: 'what_to_answer' });
    for (const length of ['shorter', 'longer']) {
      al.registerAnswerLengthProvider(() => length);
      uic.registerUserInstructionProvider(null);
      assert.match(formatAnswerPlanForPrompt(real), /the user chose/, `precondition: ${length} rides the legacy contract`);
      uic.registerUserInstructionProvider(() => 'Answer in 100 words.');
      const contract = formatAnswerPlanForPrompt(real);
      assert.doesNotMatch(contract, /the user chose|Hard ceiling/, length);
    }
  });

  test('"keep it brief" in the prompt outranks Longer (Smart line instead)', () => {
    uic.registerUserInstructionProvider(() => 'Keep your answers brief and to the point.');
    al.registerAnswerLengthProvider(() => 'longer');
    const analysis = uic.analyzeUserInstructions('Keep your answers brief and to the point.');
    assert.equal(analysis.qualitativeLength, 'short', 'the analyser reads "brief" as short');
    assert.equal(renderLengthDirectiveForPlan(STANDARD), renderLengthDirectiveForPlan(STANDARD, { answerLength: 'smart' }));
  });

  test('a prompt that says nothing about length leaves Longer in force', () => {
    uic.registerUserInstructionProvider(() => 'Senior backend role at a payments company. Focus on Go.');
    al.registerAnswerLengthProvider(() => 'longer');
    assert.match(renderLengthDirectiveForPlan(STANDARD), /roughly 90 to 140 words/);
  });
});

describe('the other places length is set', () => {
  test('profile answers: 50 / 90 / 200 words, and "in detail" keeps 180 (200 at Longer)', () => {
    assert.equal(al.profileAnswerWordCap(undefined, 'shorter'), 50);
    assert.equal(al.profileAnswerWordCap(undefined, 'smart'), 90);
    assert.equal(al.profileAnswerWordCap(undefined, 'longer'), 200);
    for (const length of ['shorter', 'smart']) assert.equal(al.profileAnswerWordCap('detailed', length), 180);
    assert.equal(al.profileAnswerWordCap('detailed', 'longer'), 200);
  });

  test('telemetry measures against the set length: 180 words is on target for Longer only', () => {
    const text = Array.from({ length: 180 }, (_, i) => `word${i}`).join(' ') + '.';
    const smart = speak.decideSpeakability(text, 'general_meeting_answer', undefined, 'What would you ask me?', false);
    const longer = speak.decideSpeakability(text, 'general_meeting_answer', undefined, 'What would you ask me?', false, 'longer');
    assert.equal(smart.overBudget, true);
    assert.equal(longer.overBudget, false);
    const short = speak.decideSpeakability(Array.from({ length: 60 }, () => 'w').join(' '), 'general_meeting_answer', undefined, 'What would you ask me?', false, 'shorter');
    assert.equal(short.overBudget, true);
  });

  test('normalize: only the three names survive', () => {
    assert.deepEqual(['shorter', 'smart', 'longer', 'SHORTER', '', null, undefined, 3].map(al.normalizeAnswerLength),
      ['shorter', 'smart', 'longer', 'smart', 'smart', 'smart', 'smart', 'smart']);
  });
});
