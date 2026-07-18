// Real-custom-mode-repair (2026-07-11) — Phase 11: explicit source switching
// for a `reference_files_primary` mode (the seminar-mode migration target).
// Proves the mode is "reference-file-PRIMARY, not reference-files-PRISON":
// document questions default to the file; an explicit "answer from my
// résumé/JD instead" ask is GRANTED for that turn; a later plain question
// naturally reverts to the document (no special-case "return to thesis"
// logic needed — that's just the mode's default owner).
//
// Requires: npm run build:electron.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');

const { buildCustomModeExecutionContract } = await import(pathToFileURL(path.join(distDir, 'llm/customModeExecutionContract.js')).href);
const { resolveSourceOwnership, isExplicitProfileAsk } = await import(pathToFileURL(path.join(distDir, 'llm/sourceOwnership.js')).href);

function contractFor(question) {
  return buildCustomModeExecutionContract({
    question,
    streamRoute: 'manual_chat_stream',
    modeId: 'mode_test_seminar',
    answerType: 'list_answer',
    isCustomMode: true,
    isDocGroundedCustomModeActive: true,
    hasReferenceFiles: true,
    hasCustomPrompt: true,
    hasLiveTranscript: false,
    hasProfileFacts: true,
    hasMeetingRag: false,
    hasLongTermMemory: false,
    persistedSourceAuthority: 'reference_files_primary',
  });
}

function ownershipFor(question) {
  const contract = contractFor(question);
  return resolveSourceOwnership({
    question,
    contract,
    profileContextPolicy: 'allowed',
    answerType: 'list_answer',
    hasProfileFacts: true,
  });
}

describe('reference_files_primary: document questions default to reference_files, profile forbidden', () => {
  const docQuestions = [
    'What are the four main phases of the project?',
    'What robot was used?',
    'Which company developed Mercury X1?',
    'What fine-tuning method was used?',
  ];
  for (const q of docQuestions) {
    test(`"${q}" -> reference_files owner, profile not allowed`, () => {
      const d = ownershipFor(q);
      assert.equal(d.owner, 'reference_files');
      assert.equal(d.profileAllowed, false);
      assert.equal(d.shouldClarifyInsteadOfProfile, false);
    });
  }
});

describe('reference_files_primary: explicit résumé switch is GRANTED for that turn', () => {
  test('"Answer from my résumé instead: what is my main project?" -> profile owner, granted', () => {
    const d = ownershipFor('Answer from my résumé instead: what is my main project?');
    assert.equal(d.owner, 'profile');
    assert.equal(d.profileAllowed, true);
    assert.equal(d.explicitProfileAsk, true);
    assert.equal(d.shouldClarifyInsteadOfProfile, false);
    assert.match(d.reason, /explicit_profile_switch_granted/);
  });
});

describe('reference_files_primary: a later plain question naturally reverts to the document', () => {
  test('"Now return to the uploaded thesis. What are its four phases?" -> reference_files (default owner, no special-case needed)', () => {
    const d = ownershipFor('Now return to the uploaded thesis. What are its four phases?');
    assert.equal(d.owner, 'reference_files');
    assert.equal(d.profileAllowed, false);
  });
});

describe('INCIDENT GAP FIX: non-possessive JD references trigger an explicit switch', () => {
  const jdQuestions = [
    'According to the JD, what are the main responsibilities?',
    'Does the JD require AWS?',
    'Does the JD require Kubernetes?',
    'Based on my résumé and this JD, what are my main gaps?',
  ];
  for (const q of jdQuestions) {
    test(`isExplicitProfileAsk("${q}") === true`, () => {
      assert.equal(isExplicitProfileAsk(q), true);
    });
  }

  test('a plain document question is still NOT an explicit switch (regression guard)', () => {
    assert.equal(isExplicitProfileAsk('What are the four main phases of the project?'), false);
    assert.equal(isExplicitProfileAsk('What does the paper conclude?'), false);
  });
});

describe('reference_files_only (strict, no switches allowed) still clarifies on an explicit profile ask', () => {
  test('an explicit résumé ask in reference_files_only must clarify, never silently grant', () => {
    const contract = buildCustomModeExecutionContract({
      question: 'Answer from my résumé instead: what is my main project?',
      streamRoute: 'manual_chat_stream',
      modeId: 'mode_test_strict',
      answerType: 'list_answer',
      isCustomMode: true,
      isDocGroundedCustomModeActive: true,
      hasReferenceFiles: true,
      hasCustomPrompt: true,
      hasLiveTranscript: false,
      hasProfileFacts: true,
      hasMeetingRag: false,
      hasLongTermMemory: false,
      persistedSourceAuthority: 'reference_files_only',
    });
    const d = resolveSourceOwnership({
      question: 'Answer from my résumé instead: what is my main project?',
      contract,
      profileContextPolicy: 'allowed',
      answerType: 'list_answer',
      hasProfileFacts: true,
    });
    assert.equal(d.owner, 'reference_files');
    assert.equal(d.profileAllowed, false);
    assert.equal(d.shouldClarifyInsteadOfProfile, true);
  });
});
