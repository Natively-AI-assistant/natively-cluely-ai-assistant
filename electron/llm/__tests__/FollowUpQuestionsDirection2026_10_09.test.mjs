// Follow-up questions came out as the INTERVIEWER's questions (2026-10-09).
//
// Reported: in an interview the button gave the kind of question an
// interviewer asks a candidate ("How would you handle Redis going down?"),
// when the person pressing it is the one being interviewed and wants the
// questions they could ask the interviewer back.
//
// The v2 action said only "three short, specific questions grounded in the
// newest topic": nothing about who asks whom. The legacy prompt it replaced
// did say it ("this interview candidate could ask ... how things work at their
// specific company"). Measured through the real engine and the real
// LLMHelper.streamChat, three questions per run, each labelled by a judge
// model. Questions that are the user's, about the other person's side (their
// team, systems, scale), before (4 runs, 12 questions) -> after (8 runs, 24):
//
//                                  claude-haiku-5.5  deepseek-chat  gemini-flash-lite
//   General, interview transcript  4/12 -> 22/24     0/12 -> 22/24  0/12 -> 22/24
//   Looking for work               6/12 -> 23/24     3/12 -> 23/24  10/12 -> 24/24
//   Technical interview            0/12 -> 23/24     0/12 -> 22/24  0/12 -> 23/24
//   General, question TYPED        0/18 -> 17/24     (already mostly right: 23/24, 20/24 after)
//
// The judge is strict: read by hand, most "misses" after are still addressed
// to the interviewer ("How do you handle versioning when an API changes?"),
// where the misses before were probes of the candidate ("How would you handle
// Redis going down?") or questions for the assistant ("Can you give me an
// example of an API?").
//
// Three things earlier wordings got wrong, each pinned below:
//   - Written into the action for every mode, "a candidate's questions back
//     to the interviewer ... your team" made a student in Lecture mode ask the
//     lecturer how "your team" tunes a learning rate (11 of 12 on Haiku). The
//     interview rule is an overlay on General, Looking for work, Technical
//     interview and custom modes only. Lecture after: 69 of 72 are questions
//     about the material.
//   - "in the user's own voice" made Haiku wrap Recruiting's questions in
//     quotation marks 6 runs in 8. Removed, and the action says no quotation
//     marks: 0 in 8.
//   - The typed case. The user types the question they were just asked, the
//     transcript shows [ME] asking and [ASSISTANT] answering, and a rule that
//     only says "when the user is being interviewed" did not fire on Haiku:
//     7 runs of 8 were questions for the assistant. General now reads as an
//     interview unless the conversation plainly is something else, and names
//     the typed case.
//
// Recruiting (the user IS the interviewer) and Sales (the user is the seller)
// were already right and still are: 68 of 72 and 72 of 72 after. The rule is
// "the user asks the other person", not "always a candidate".
//
// Known limit: a class attended in GENERAL mode has its lecturer labelled
// [INTERVIEWER] in the transcript, so it reads as an interview and gets
// candidate questions. Lecture mode is the mode for that.
//
// Run under Electron, as `npm test` does:
//   npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/llm/__tests__/FollowUpQuestionsDirection2026_10_09.test.mjs

import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const dist = (p) => path.join(repoRoot, 'dist-electron/electron', p);

const FLAG = 'NATIVELY_PROMPT_SYSTEM_V2';
const withFlag = (value) => {
  let saved;
  before(() => { saved = process.env[FLAG]; process.env[FLAG] = value; });
  after(() => { if (saved === undefined) delete process.env[FLAG]; else process.env[FLAG] = saved; });
};

const TRANSCRIPT = '[INTERVIEWER]: how would you handle rate limiting on a public api?\n[ME]: a token bucket per api key at the gateway.';
const MODES = ['general', 'looking-for-work', 'technical-interview', 'recruiting', 'sales', 'team-meet', 'lecture', 'seminar', 'call-center'];

const actionBlock = (prompt) => {
  const m = String(prompt).match(/<active_action name="follow_up_questions">([\s\S]*?)<\/active_action>/);
  assert.ok(m, 'the prompt carries the follow_up_questions action');
  return m[1];
};

describe('the action says who asks whom', () => {
  withFlag('1');

  for (const tier of ['cloud', 'local']) {
    for (const templateType of MODES) {
      test(`${tier} / ${templateType}: the user asks the other person, never the reverse`, () => {
        const v2 = require(dist('llm/promptSystemV2.js'));
        const block = actionBlock(v2.resolveV2SystemPrompt({ action: 'follow_up_questions', tier, activeMode: { templateType } }));
        assert.match(block, /for the user to ask the other person/i);
        assert.match(block, /never the questions the other person would (put to|ask) the user/i);
      });
    }
  }

  const contract = (templateType, tier = 'cloud') => {
    const v2 = require(dist('llm/promptSystemV2.js'));
    const m = String(v2.resolveV2SystemPrompt({ action: 'follow_up_questions', tier, activeMode: { templateType } })).match(/<voice_contract>([\s\S]*?)<\/voice_contract>/);
    assert.ok(m, 'the prompt carries a voice contract');
    return m[1];
  };

  for (const templateType of ['looking-for-work', 'technical-interview']) {
    test(`${templateType}: the user is the candidate, asks about the interviewer's side, and does not probe`, () => {
      const c = contract(templateType);
      assert.match(c, /The user is the one being interviewed/);
      assert.match(c, /back to the interviewer/);
      assert.match(c, /their own team/);
      assert.match(c, /Never a technical probe \("How would you handle X\?"\)/, 'the probe shape the report was about is named as wrong');
    });
  }

  test('general: an interview unless the conversation plainly is something else, and the typed case is named', () => {
    const c = contract('general');
    assert.match(c, /Unless the conversation is plainly something else \(a team meeting, a call the user leads, a class\), the user is the one being interviewed/);
    assert.match(c, /back to the interviewer/);
    assert.match(c, /Never a technical probe/);
    assert.match(c, /A question the user typed here and the assistant answered was the interviewer's/);
    assert.match(c, /never to the assistant/);
  });

  test('a custom mode gets the conditional rule too', () => {
    const v2 = require(dist('llm/promptSystemV2.js'));
    const prompt = String(v2.resolveV2SystemPrompt({ action: 'follow_up_questions', tier: 'cloud', activeMode: { isCustom: true } }));
    assert.match(prompt, /When the user is the one being interviewed or questioned/);
  });

  // Where the user leads or learns, the candidate rule would be wrong: it made
  // a student ask the lecturer about "your team".
  for (const templateType of ['recruiting', 'sales', 'lecture', 'team-meet', 'seminar', 'call-center']) {
    test(`${templateType}: no candidate rule`, () => {
      const v2 = require(dist('llm/promptSystemV2.js'));
      const prompt = String(v2.resolveV2SystemPrompt({ action: 'follow_up_questions', tier: 'cloud', activeMode: { templateType } }));
      assert.doesNotMatch(prompt, /back to the interviewer/);
      assert.doesNotMatch(prompt, /being interviewed/);
    });
  }

  test('no quotation marks are asked for, and "own voice" is not in the action', () => {
    const v2 = require(dist('llm/promptSystemV2.js'));
    const block = actionBlock(v2.resolveV2SystemPrompt({ action: 'follow_up_questions', tier: 'cloud', activeMode: { templateType: 'recruiting' } }));
    assert.match(block, /no quotation marks/i);
    assert.doesNotMatch(block, /own voice/i);
  });

  test('the shape is unchanged: exactly three, numbered', () => {
    const v2 = require(dist('llm/promptSystemV2.js'));
    const block = actionBlock(v2.resolveV2SystemPrompt({ action: 'follow_up_questions', tier: 'cloud', activeMode: { templateType: 'general' } }));
    assert.match(block, /exactly three/i);
    assert.match(block, /numbered list/i);
  });
});

describe('the request in the turn says it too', () => {
  withFlag('1');

  test('FollowUpQuestionsLLM asks for questions to put to the other person', async () => {
    const { FollowUpQuestionsLLM } = require(dist('llm/FollowUpQuestionsLLM.js'));
    const calls = [];
    const helper = { getPromptTier: () => 'full', fitContextForCurrentModel: (t) => t, async *streamChat(...args) { calls.push(args); yield 'tok'; } };
    for await (const _ of new FollowUpQuestionsLLM(helper).generateStream(TRANSCRIPT)) { /* drain */ }
    assert.equal(calls.length, 1);
    const task = String(calls[0][0]).match(/<task>([\s\S]*?)<\/task>/);
    assert.ok(task, 'the turn carries a task');
    assert.match(task[1], /follow-up questions I could ask the other person/i);
  });
});

describe('the small-model prompt says it too', () => {
  test('TINY_FOLLOW_UP_QUESTIONS_PROMPT names the other person as the one asked', () => {
    const { TINY_FOLLOW_UP_QUESTIONS_PROMPT } = require(dist('llm/tinyPrompts.js'));
    assert.match(TINY_FOLLOW_UP_QUESTIONS_PROMPT, /the user could ask the other person/i);
    assert.match(TINY_FOLLOW_UP_QUESTIONS_PROMPT, /never questions the other person would ask the user/i);
  });
});
