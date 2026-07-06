// Custom-Mode Source Isolation (2026-07-06, hardening/v2.7.0)
//
// Test matrix for the SourceArbiter + SourceContractValidator + widened
// doc-grounded validator gate. Five custom-mode archetypes, each with a
// canonical regression question proving the right source policy.
//
// Run with: `ELECTRON_RUN_AS_NODE=1 electron --test electron/llm/__tests__/CustomModeSourceIsolation2026_07_06.test.mjs`
// or via `npm test` (the existing test runner picks up *.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// Compiled ESM/CJS from the bundled dist, or an isolated tsc tree.
const distDir = (() => {
  const bundled = path.resolve(repoRoot, 'dist-electron/electron/llm/documentGroundedPrompt.js');
  if (fs.existsSync(bundled)) return path.resolve(repoRoot, 'dist-electron');
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'csi-dist-'));
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(target, 'node_modules'), 'dir');
  try { execSync(`node node_modules/.bin/tsc -p electron/tsconfig.json --outDir ${target}`, { cwd: repoRoot, stdio: 'pipe' }); } catch { /* expected partial */ }
  return target;
})();

const cjsRequire = createRequire(import.meta.url);
const dgMod = cjsRequire(path.resolve(distDir, 'electron/llm/documentGroundedPrompt.js'));
const csiMod = cjsRequire(path.resolve(distDir, 'electron/llm/customModeExecutionContract.js'));

const { DOC_GROUNDED_ANSWER_TYPES, isDocGroundedAnswerType } = dgMod;
const {
  buildCustomModeExecutionContract,
  validateAgainstSourceContract,
  isMercuryControllerQuestion,
  SourceAuthority,
} = csiMod;

// ── Helpers ────────────────────────────────────────────────────────────────

function contractFor(input) {
  return buildCustomModeExecutionContract(input);
}

const DOC_GROUNDED_INPUT = {
  question: 'What are the four main phases of the project?',
  streamRoute: 'manual_chat_stream',
  modeId: 'mode-seminar-123',
  modeUniqueId: 'mode-seminar-123',
  answerType: 'list_answer',
  isCustomMode: true,
  isDocGroundedCustomModeActive: true,
  hasReferenceFiles: true,
  hasCustomPrompt: true,
  hasLiveTranscript: false,
  hasProfileFacts: true,         // profile is loaded but doc-grounded forbids it
  hasMeetingRag: false,
  hasLongTermMemory: true,
};

const PROFILE_INPUT = {
  question: 'What are my best projects?',
  streamRoute: 'manual_chat_stream',
  modeId: 'mode-profile-123',
  modeUniqueId: 'mode-profile-123',
  answerType: 'project_answer',
  isCustomMode: true,
  isDocGroundedCustomModeActive: false,
  hasReferenceFiles: false,
  hasCustomPrompt: true,
  hasLiveTranscript: false,
  hasProfileFacts: true,
  hasMeetingRag: false,
  hasLongTermMemory: true,
};

const MEETING_INPUT = {
  question: 'What did the speaker say about the document?',
  streamRoute: 'manual_chat_stream',
  modeId: 'mode-meeting-123',
  modeUniqueId: 'mode-meeting-123',
  answerType: 'document_followup_answer',
  isCustomMode: true,
  isDocGroundedCustomModeActive: false,
  hasReferenceFiles: false,
  hasCustomPrompt: true,
  hasLiveTranscript: true,
  hasProfileFacts: false,
  hasMeetingRag: true,
  hasLongTermMemory: true,
};

const MIXED_INPUT = {
  question: 'What did the speaker say about the document?',
  streamRoute: 'manual_chat_stream',
  modeId: 'mode-mixed-123',
  modeUniqueId: 'mode-mixed-123',
  answerType: 'document_followup_answer',
  isCustomMode: true,
  isDocGroundedCustomModeActive: true,
  hasReferenceFiles: true,
  hasCustomPrompt: true,
  hasLiveTranscript: true,
  hasProfileFacts: true,
  hasMeetingRag: true,
  hasLongTermMemory: true,
  userExplicitSource: 'transcript',
};

const GENERAL_INPUT = {
  question: 'What project are we talking about?',
  streamRoute: 'manual_chat_stream',
  modeId: null,
  modeUniqueId: null,
  answerType: 'unknown_answer',
  isCustomMode: false,
  isDocGroundedCustomModeActive: false,
  hasReferenceFiles: false,
  hasCustomPrompt: false,
  hasLiveTranscript: false,
  hasProfileFacts: false,
  hasMeetingRag: false,
  hasLongTermMemory: false,
};

// Sample retrieved-block contents used by the regression tests.
const THESIS_BLOCK = `
[Section 1.4 Thesis Organization | p5]
Chapter 1: Introduction
Chapter 2: Background
Chapter 3: Methodology
Chapter 4: Results and Discussion

[Section 3.5.1 | p42] Mercury X1 is controlled by the NVIDIA Jetson Xavier main controller with a Jetson Nano auxiliary controller.

[Section 4.2.1 | p55] Mercury X1 communicates with the motor control subsystem via ESP32 boards at 50 Hz.
`;

const PROFILE_BLOCK = `
[Project: Natively — privacy-first AI meeting assistant, 2024-2025]
[Project: TalentScope — talent matching platform]
[Project: agenticVLA — Vision-Language-Action agent]
`;

const TRANSCRIPT_BLOCK = `
[ME]: So what did the speaker say about the document?
[SPEAKER 1]: They mentioned Mercury X1 hardware.
`;

// ── Test 1: DOC_GROUNDED_ANSWER_TYPES set completeness ─────────────────────

test('DOC_GROUNDED_ANSWER_TYPES contains the six doc-grounded shapes', () => {
  assert.equal(DOC_GROUNDED_ANSWER_TYPES.size, 6, `expected 6 shapes, got ${DOC_GROUNDED_ANSWER_TYPES.size}`);
  for (const t of [
    'lecture_answer',
    'definitional_answer',
    'list_answer',
    'exact_numeric_answer',
    'document_followup_answer',
    'document_absent_fact_refusal',
  ]) {
    assert.equal(DOC_GROUNDED_ANSWER_TYPES.has(t), true, `missing shape: ${t}`);
  }
});

test('isDocGroundedAnswerType widens beyond lecture_answer', () => {
  // The fix: lecture_answer was the ONLY shape the old gate allowed.
  assert.equal(isDocGroundedAnswerType('lecture_answer'), true);
  assert.equal(isDocGroundedAnswerType('list_answer'), true);
  assert.equal(isDocGroundedAnswerType('exact_numeric_answer'), true);
  assert.equal(isDocGroundedAnswerType('definitional_answer'), true);
  assert.equal(isDocGroundedAnswerType('document_followup_answer'), true);
  assert.equal(isDocGroundedAnswerType('document_absent_fact_refusal'), true);
  // Non-doc-grounded types stay false.
  assert.equal(isDocGroundedAnswerType('project_answer'), false);
  assert.equal(isDocGroundedAnswerType('identity_answer'), false);
  assert.equal(isDocGroundedAnswerType(null), false);
  assert.equal(isDocGroundedAnswerType(undefined), false);
});

// ── Test 2: SourceArbiter contract — document-grounded custom mode ────────

test('SourceArbiter: doc-grounded custom mode → reference_files_only', () => {
  const c = contractFor(DOC_GROUNDED_INPUT);
  assert.equal(c.sourceAuthority, 'reference_files_only');
  assert.ok(c.allowedSources.includes('reference_files'));
  assert.ok(c.allowedSources.includes('custom_context'));
  // Profile / projects / persona / Hindsight / meeting_rag / prior assistant
  // facts are ALL forbidden.
  for (const s of ['profile_resume', 'profile_jd', 'projects', 'persona', 'long_term_memory', 'meeting_rag', 'prior_assistant_facts']) {
    assert.ok(c.forbiddenSources.includes(s), `expected ${s} forbidden, got: ${JSON.stringify(c.forbiddenSources)}`);
  }
  // evidenceRequired true for evidence-grounded answers
  assert.equal(c.evidenceRequired, true);
  assert.equal(c.evidenceNamespace, 'reference_files');
  assert.equal(c.repairable, true);
});

// ── Test 3: SourceArbiter contract — profile custom mode ───────────────────

test('SourceArbiter: profile custom mode → profile_only', () => {
  const c = contractFor(PROFILE_INPUT);
  assert.equal(c.sourceAuthority, 'profile_only');
  assert.ok(c.allowedSources.includes('profile_resume'));
  assert.ok(c.allowedSources.includes('profile_jd'));
  assert.ok(c.allowedSources.includes('projects'));
  // Reference files / Hindsight are forbidden.
  assert.ok(c.forbiddenSources.includes('long_term_memory'));
  // profile mode does NOT require evidence (the answer is sourced from profile).
  assert.equal(c.evidenceRequired, false);
});

// ── Test 4: SourceArbiter contract — meeting custom mode ───────────────────

test('SourceArbiter: meeting custom mode → transcript_only', () => {
  const c = contractFor(MEETING_INPUT);
  assert.equal(c.sourceAuthority, 'transcript_only');
  assert.ok(c.allowedSources.includes('live_transcript'));
  assert.ok(c.allowedSources.includes('meeting_rag'));
  for (const s of ['profile_resume', 'profile_jd', 'projects', 'reference_files']) {
    assert.ok(c.forbiddenSources.includes(s), `expected ${s} forbidden, got: ${JSON.stringify(c.forbiddenSources)}`);
  }
});

// ── Test 5: SourceArbiter contract — mixed doc+transcript mode ─────────────

test('SourceArbiter: mixed mode with explicit transcript opt-in → reference_files_plus_transcript', () => {
  const c = contractFor(MIXED_INPUT);
  assert.equal(c.sourceAuthority, 'reference_files_plus_transcript');
  assert.ok(c.allowedSources.includes('reference_files'));
  assert.ok(c.allowedSources.includes('live_transcript'));
  for (const s of ['profile_resume', 'profile_jd', 'projects']) {
    assert.ok(c.forbiddenSources.includes(s), `expected ${s} forbidden in mixed, got: ${JSON.stringify(c.forbiddenSources)}`);
  }
});

// ── Test 6: SourceArbiter contract — general / no-mode → ask_if_ambiguous ──

test('SourceArbiter: general no-mode → ask_if_ambiguous', () => {
  const c = contractFor(GENERAL_INPUT);
  assert.equal(c.sourceAuthority, 'ask_if_ambiguous');
  assert.equal(c.evidenceRequired, false);
});

// ── Test 7: REGRESSION A — "four main phases" Natively leak ────────────────

test('REGRESSION A: list_answer with "Natively" leak is rejected by contract validator', () => {
  const contract = contractFor(DOC_GROUNDED_INPUT);
  const wrongAnswer = 'My project Natively is a privacy-first AI meeting assistant. Phase 1: Requirements, Phase 2: Design, Phase 3: Implementation, Phase 4: Testing.';
  const result = validateAgainstSourceContract({
    contract,
    question: 'What are the four main phases of the project?',
    answer: wrongAnswer,
    retrievedBlock: THESIS_BLOCK,
  });
  assert.equal(result.ok, false, `expected rejection, got ok=true: ${result.reason}`);
  assert.ok(result.entityLeaks.includes('Natively'), `expected Natively in entityLeaks, got: ${JSON.stringify(result.entityLeaks)}`);
  assert.equal(result.action, 'retry', `expected retry (contract.repairable=true), got: ${result.action}`);
});

test('REGRESSION A: same question with on-topic answer is accepted', () => {
  const contract = contractFor(DOC_GROUNDED_INPUT);
  const goodAnswer = 'The four phases of the project are: (1) Introduction, (2) Background, (3) Methodology, (4) Results and Discussion.';
  const result = validateAgainstSourceContract({
    contract,
    question: 'What are the four main phases of the project?',
    answer: goodAnswer,
    retrievedBlock: THESIS_BLOCK,
  });
  assert.equal(result.ok, true, `expected ok, got: ${result.reason}`);
  assert.equal(result.action, 'ship');
});

// ── Test 8: REGRESSION B — Mercury processor ESP32 leak ────────────────────

test('REGRESSION B: Mercury processor question rejects ESP32 / Xavier NX unless controller evidence supports them', () => {
  const contract = contractFor({ ...DOC_GROUNDED_INPUT, answerType: 'exact_numeric_answer' });
  const wrongAnswer = 'The Mercury X1 is controlled by the NVIDIA Jetson Xavier NX AI controller and ESP32 motor control boards.';
  // Add "Jetson Xavier NX" to the block to simulate the model echoing evidence,
  // while keeping it outside the Mercury controller property. ESP32 appears only
  // as low-level motor-control evidence, not as the processor/controller.
  const blockWithNx = THESIS_BLOCK + '\n[Section 4.2.2 | p57] The Jetson Xavier NX variant provides additional inference acceleration.';
  const result = validateAgainstSourceContract({
    contract,
    question: 'What processor controls the Mercury X1?',
    answer: wrongAnswer,
    retrievedBlock: blockWithNx,
  });
  assert.equal(result.ok, false, `expected controller answerability rejection, got ok=true`);
  assert.ok(result.answerabilityViolations.includes('mercury_controller_esp32_only_low_level_motor_control'));
  assert.ok(result.answerabilityViolations.includes('mercury_controller_unsupported_xavier_nx'));
  assert.equal(result.action, 'retry');
});


test('REGRESSION B: Mercury controller question is detected as property-specific', () => {
  assert.equal(isMercuryControllerQuestion('What processor controls the Mercury X1?'), true);
  assert.equal(isMercuryControllerQuestion('What are the key specifications of the Mercury X1?'), false);
});

test('REGRESSION B: correct Mercury controller evidence is preferred and accepted', () => {
  const contract = contractFor({ ...DOC_GROUNDED_INPUT, answerType: 'exact_numeric_answer' });
  const expected = 'The Mercury X1 uses an NVIDIA Jetson Xavier as the main controller and a Jetson Nano as the auxiliary controller.';
  const result = validateAgainstSourceContract({
    contract,
    question: 'What processor controls the Mercury X1?',
    answer: expected,
    retrievedBlock: THESIS_BLOCK,
  });
  assert.equal(result.ok, true, `expected accepted controller answer, got: ${result.reason}`);
  assert.equal(result.action, 'ship');
});

test('REGRESSION B: correct Mercury answer names BOTH controllers', () => {
  const contract = contractFor({ ...DOC_GROUNDED_INPUT, answerType: 'exact_numeric_answer' });
  const goodAnswer = 'The Mercury X1 is controlled by the NVIDIA Jetson Xavier main controller with a Jetson Nano auxiliary controller. The motor subsystem uses ESP32 boards but the primary control is the Jetson Xavier.';
  const result = validateAgainstSourceContract({
    contract,
    question: 'What processor controls the Mercury X1?',
    answer: goodAnswer,
    retrievedBlock: THESIS_BLOCK,
  });
  assert.equal(result.ok, true, `expected ok, got: ${result.reason}`);
});

// ── Test 9: REGRESSION C — total cost absent-fact ─────────────────────────

test('REGRESSION C: "What was the total cost of building the teleoperation system?" triggers absent-fact refusal', () => {
  const contract = contractFor({ ...DOC_GROUNDED_INPUT, answerType: 'document_absent_fact_refusal' });
  // The question asks about total cost; the doc has no cost figure.
  const honestRefusal = "I could not find that in the retrieved sections of the document.";
  const result = validateAgainstSourceContract({
    contract,
    question: 'What was the total cost of building the teleoperation system?',
    answer: honestRefusal,
    retrievedBlock: THESIS_BLOCK,
  });
  assert.equal(result.ok, true, `expected honest refusal to ship, got: ${result.reason}`);
  assert.equal(result.action, 'ship');
});

test('REGRESSION C: fabricated cost answer is rejected', () => {
  const contract = contractFor({ ...DOC_GROUNDED_INPUT, answerType: 'document_absent_fact_refusal' });
  const fabricated = 'The total cost was $50,000 and 6 months of development time.';
  const result = validateAgainstSourceContract({
    contract,
    question: 'What was the total cost of building the teleoperation system?',
    answer: fabricated,
    retrievedBlock: THESIS_BLOCK,
  });
  assert.equal(result.ok, false, `expected rejection of fabricated cost, got ok=true`);
});

// ── Test 10: REGRESSION D — explicit "what is my project Natively?" ────────

test('REGRESSION D: profile-question slipped into doc-grounded mode is rejected', () => {
  const contract = contractFor(DOC_GROUNDED_INPUT);
  const wrongAnswer = 'My project Natively is a privacy-first AI meeting assistant.';
  const result = validateAgainstSourceContract({
    contract,
    question: 'What is my project Natively?',
    answer: wrongAnswer,
    retrievedBlock: THESIS_BLOCK,
  });
  assert.equal(result.ok, false, `expected rejection of profile leak, got ok=true`);
  assert.ok(result.entityLeaks.includes('Natively'), `expected Natively in entityLeaks`);
});

// ── Test 11: REGRESSION E — profile mode accepts profile content ──────────

test('REGRESSION E: profile mode accepts Natively project answer', () => {
  const contract = contractFor(PROFILE_INPUT);
  const goodAnswer = 'Your best projects include Natively, TalentScope, and agenticVLA.';
  const result = validateAgainstSourceContract({
    contract,
    question: 'What are my best projects?',
    answer: goodAnswer,
    retrievedBlock: PROFILE_BLOCK,
  });
  assert.equal(result.ok, true, `profile mode should accept profile answer, got: ${result.reason}`);
});

// ── Test 12: REGRESSION F — follow-up referent preservation ────────────────

test('REGRESSION F: document_followup_answer uses referent hint', () => {
  const contract = contractFor({ ...DOC_GROUNDED_INPUT, answerType: 'document_followup_answer' });
  const goodFollowup = 'OpenVLA-OFT is the Open Vision-Language-Action model with online fine-tuning.';
  const result = validateAgainstSourceContract({
    contract,
    question: 'What throughput improvement does that give?',
    answer: 'OpenVLA-OFT achieves a 43x throughput improvement.',
    retrievedBlock: `[Section 4.3.1 | p58] OpenVLA-OFT achieves a 43x throughput improvement over the baseline through online fine-tuning. The OpenVLA-OFT model combines Vision-Language-Action with online fine-tuning (OFT) to reduce inference latency.`,
  });
  assert.equal(result.ok, true, `follow-up answer should ship, got: ${result.reason}`);
});

// ── Test 13: validator gating (the IPC handler fix) ────────────────────────

test('isDocGroundedAnswerType — answer-type gate now allows list_answer (the fix)', () => {
  // BEFORE the fix: only `lecture_answer` was gated through.
  // AFTER the fix: all six shapes are gated.
  // This test documents the BEHAVIORAL change so any future narrowing regression is caught.
  assert.equal(isDocGroundedAnswerType('list_answer'), true, 'list_answer must trigger doc-grounded validator');
  assert.equal(isDocGroundedAnswerType('exact_numeric_answer'), true, 'exact_numeric_answer must trigger doc-grounded validator');
  assert.equal(isDocGroundedAnswerType('definitional_answer'), true, 'definitional_answer must trigger doc-grounded validator');
  assert.equal(isDocGroundedAnswerType('document_followup_answer'), true, 'document_followup_answer must trigger doc-grounded validator');
  assert.equal(isDocGroundedAnswerType('document_absent_fact_refusal'), true, 'document_absent_fact_refusal must trigger doc-grounded validator');
});

// ── Test 14: contract hash stability ───────────────────────────────────────

test('buildCustomModeExecutionContract: produces stable contractHash for same input', () => {
  const a = contractFor(DOC_GROUNDED_INPUT);
  const b = contractFor(DOC_GROUNDED_INPUT);
  assert.equal(a.contractHash, b.contractHash, `hash should be stable; a=${a.contractHash} b=${b.contractHash}`);
});

test('buildCustomModeExecutionContract: different input → different hash', () => {
  const a = contractFor(DOC_GROUNDED_INPUT);
  const b = contractFor(PROFILE_INPUT);
  assert.notEqual(a.contractHash, b.contractHash);
});