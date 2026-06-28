// electron/llm/__tests__/ManualTranscriptContextPolicy.test.mjs
//
// Issue #333: manual chat must not silently attach unrelated rolling transcript
// context to standalone typed questions. Fixtures are synthetic/public issue
// shapes only.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron');

const { planAnswer } = await import(pathToFileURL(path.join(distRoot, 'llm/AnswerPlanner.js')).href);
const { isTranscriptBoundManualQuestion, shouldAutoAttachManualTranscriptContext } = await import(
  pathToFileURL(path.join(distRoot, 'llm/manualTranscriptContextPolicy.js')).href
);

const plan = (question, activeMode = null) =>
  planAnswer({ question, source: 'manual_input', speakerPerspective: 'user', activeMode });
const attaches = (question, activeMode = null) =>
  shouldAutoAttachManualTranscriptContext(question, plan(question, activeMode));

describe('manual transcript context policy', () => {
  test('standalone issue-shaped questions do not inherit unrelated transcript context', () => {
    assert.equal(attaches('what is UI policy?'), false);
    assert.equal(attaches('how does client state run before UI policy?'), false);
    assert.equal(attaches('how do I schedule a meeting?'), false);
    assert.equal(attaches('what is a transcript?'), false);
    assert.equal(attaches('what is a call stack?'), false);
    assert.equal(attaches('explain class in JavaScript'), false);
    assert.equal(attaches('how do I design a meeting scheduler?'), false);
  });

  test('standalone technical explanations do not pull meeting transcript by default', () => {
    assert.equal(attaches('what is BFS?'), false);
    assert.equal(attaches('explain BFS'), false);
  });

  test('explicit meeting and lecture questions keep transcript context', () => {
    assert.equal(attaches('what did we decide about UI policy?'), true);
    assert.equal(attaches('summarize the meeting'), true);
    assert.equal(isTranscriptBoundManualQuestion('summarize the meeting'), true);
    assert.equal(isTranscriptBoundManualQuestion('summarize it'), true);
    assert.equal(isTranscriptBoundManualQuestion('summarize this'), true);
    assert.equal(isTranscriptBoundManualQuestion('summarize that'), true);
    assert.equal(isTranscriptBoundManualQuestion('summarise the call'), true);
    assert.equal(attaches('what did they say about client state?'), true);
    assert.equal(attaches('what did the professor mean by this slide?'), true);
    assert.equal(attaches('from the transcript, what did Alex say?'), true);
    assert.equal(attaches('in the meeting, what did we decide?'), true);
    assert.equal(attaches('recap the call'), true);
  });

  test('bare live follow-ups keep transcript context', () => {
    assert.equal(attaches('why?'), true);
    assert.equal(attaches('explain'), true);
    assert.equal(attaches('what should I say?'), true);
    assert.equal(attaches('what about client state?'), true);
    assert.equal(attaches('and pricing?'), true);
    assert.equal(attaches('can you explain that?'), true);
  });

  test('answer-editing refinements do not borrow unrelated transcript context', () => {
    assert.equal(attaches('make that shorter'), false);
    assert.equal(attaches('make it more confident'), false);
    assert.equal(attaches('remove the exaggeration'), false);
    assert.equal(attaches('shorter please'), false);
    assert.equal(attaches('give me the final version'), false);
    assert.equal(isTranscriptBoundManualQuestion('summarize BFS'), false);
  });

  test('mode-scoped sales prompts do not receive transcript context by default', () => {
    const salesMode = { id: 'm', templateType: 'sales', name: 'Sales', isCustom: false };
    assert.equal(attaches('how do you compare with Cluely?', salesMode), false);
  });
});

describe('manual transcript context policy wiring', () => {
  const ipcSrc = readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

  test('desktop manual chat gates autoContextSnapshot through the policy helper', () => {
    assert.match(
      ipcSrc,
      /else if \(!context && autoContextSnapshot && shouldAutoAttachManualTranscriptContext\(message, answerPlan\)\) \{[\s\S]*let snapshotForContext = autoContextSnapshot;[\s\S]*stripPriorAssistantTurns\(autoContextSnapshot\);[\s\S]*context = snapshotForContext;/,
    );
    assert.match(ipcSrc, /Skipped 100s transcript context for standalone manual chat/);
  });

  test('phone chat uses the same policy before attaching rolling transcript', () => {
    assert.match(ipcSrc, /let phoneActiveMode: import\('\.\/llm\/modeProfiles'\)\.ActiveModeInfo \| null = null;/);
    assert.match(ipcSrc, /const phoneAnswerPlan = planAnswer\(/);
    assert.match(ipcSrc, /activeMode: phoneActiveMode/);
    assert.match(ipcSrc, /shouldAutoAttachManualTranscriptContext\(message, phoneAnswerPlan\)/);
    assert.match(ipcSrc, /\[PhoneMirror\] Skipped 100s transcript context for standalone manual chat/);
  });
});
