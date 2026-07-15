// electron/llm/__tests__/ImmediateContextPriority.test.mjs
//
// Regression: questions that reference the IMMEDIATE conversation ("qual é o
// codinome interno que acabei de informar?") or an ATTACHED screenshot ("na
// captura anexada, qual configuração aparece como desligada?") must route to
// the neutral conversation-scoped shape — never to a candidate/profile answer
// that ignores the chat history and the image.
// Also proves the LLMHelper interview-context injection consults the same cues
// (source-contract guard) so the 24k-char local interview block can never
// drown an immediate-context question.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/ImmediateContextPriority.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const plannerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerPlanner.js');
const { planAnswer, referencesImmediateConversation, referencesAttachedMedia } =
  await import(pathToFileURL(plannerPath).href);

const planManual = (question) => planAnswer({
  question,
  source: 'manual_input',
  speakerPerspective: 'user',
  hasCandidateProfile: true,
});

const PROFILE_TYPES = new Set([
  'identity_answer', 'profile_fact_answer', 'experience_answer', 'project_answer',
  'project_followup_answer', 'skills_answer', 'skill_experience_answer',
  'jd_fit_answer', 'gap_analysis_answer', 'behavioral_interview_answer',
  'resume_jd_fit_answer', 'resume_jd_gap_answer', 'resume_jd_intro_answer',
  'jd_summary_answer', 'jd_requirements_answer', 'jd_fact_answer',
]);

describe('immediate-conversation recall routing (PT-BR + EN)', () => {
  const recallQuestions = [
    'Qual é o codinome interno que acabei de informar?',
    'Qual valor eu acabei de te passar?',
    'What is the codename I just told you?',
    'What did I just say about the deadline?',
    'Qual foi a minha pergunta anterior?',
  ];
  for (const q of recallQuestions) {
    test(`recall → general_meeting_answer: ${q}`, () => {
      const plan = planManual(q);
      assert.equal(plan.answerType, 'general_meeting_answer', `got ${plan.answerType}`);
      assert.ok(!PROFILE_TYPES.has(plan.answerType), 'must never become a profile/candidate answer');
    });
  }

  test('cue helper matches the live bug phrasing', () => {
    assert.equal(referencesImmediateConversation('Qual é o codinome interno que acabei de informar?'), true);
    assert.equal(referencesImmediateConversation('Nesta conversa, o codinome interno do projeto é JACARANDÁ-7319.'), true);
    assert.equal(referencesImmediateConversation('What is the codename I just told you?'), true);
  });

  test('cue helper does NOT fire on ordinary profile/technical questions', () => {
    assert.equal(referencesImmediateConversation('Tell me about your projects.'), false);
    assert.equal(referencesImmediateConversation('Could you explain why you used a deterministic evidence gate in the Atlas Verify project?'), false);
    assert.equal(referencesImmediateConversation('Why should we hire you?'), false);
  });
});

describe('attached-media routing (PT-BR + EN)', () => {
  const mediaQuestions = [
    'Na captura anexada, qual configuração aparece como desligada?',
    'O que aparece na imagem que enviei?',
    'In the attached screenshot, which setting is disabled?',
    'What does this screenshot show?',
  ];
  for (const q of mediaQuestions) {
    test(`media → general_meeting_answer: ${q}`, () => {
      const plan = planManual(q);
      assert.equal(plan.answerType, 'general_meeting_answer', `got ${plan.answerType}`);
    });
  }

  test('cue helper matches the live bug phrasing', () => {
    assert.equal(referencesAttachedMedia('Na captura anexada, qual configuração aparece como desligada?'), true);
    assert.equal(referencesAttachedMedia('In the attached screenshot, which setting is disabled?'), true);
  });

  test('write-code verb keeps coding routing even with a screenshot cue', () => {
    const plan = planManual('Solve the problem in the attached screenshot.');
    assert.notEqual(plan.answerType, 'general_meeting_answer', 'coding must not be stolen by the media cue');
  });

  test('cue helper does NOT fire on bare "tela"/"screen" chatter', () => {
    assert.equal(referencesAttachedMedia('Como eu compartilho a tela no Meet?'), false);
    assert.equal(referencesAttachedMedia('My screen is lagging during the call.'), false);
  });
});

describe('interview-context injection consults the same cues (source contract)', () => {
  const llmHelperSrc = fs.readFileSync(path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js'), 'utf8');

  test('applyLocalInterviewContext gates on attached images and immediate-context cues', () => {
    assert.match(llmHelperSrc, /referencesImmediateConversation/, 'LLMHelper must consult the conversation-recall cue');
    assert.match(llmHelperSrc, /referencesAttachedMedia/, 'LLMHelper must consult the attached-media cue');
    assert.match(llmHelperSrc, /hasAttachedImages/, 'LLMHelper must skip interview-context injection when images are attached');
  });

  test('interview-context system instruction declares current-question priority', () => {
    const promptSrc = fs.readFileSync(path.resolve(__dirname, '../../../dist-electron/electron/services/interviewContextPrompt.js'), 'utf8');
    assert.match(promptSrc, /CURRENT question always has priority/i);
    assert.match(promptSrc, /Never volunteer a candidate introduction/i);
  });
});

describe('manual chat memory window (source contract)', () => {
  test('gemini-chat-stream snapshot uses the 900s chat window, not the live 100s window', () => {
    const ipcSrc = fs.readFileSync(path.resolve(__dirname, '../../../dist-electron/electron/ipcHandlers.js'), 'utf8');
    assert.match(
      ipcSrc,
      /getFormattedContext\(900,\s*["']manual_chat["']\)/,
      'manual chat must keep a 900s recall window scoped to its own assistant surface',
    );
  });
});
