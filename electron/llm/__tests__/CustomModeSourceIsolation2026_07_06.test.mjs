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

// The GENERAL entity/property validator checks are gated behind the
// `customModeSourceEnforcement` flag (default OFF). Enable it for THIS suite so
// the v2 (blacklist-free) behavior is exercised. Set before requiring the
// compiled module so the flag read picks it up.
process.env.NATIVELY_CUSTOM_MODE_SOURCE_ENFORCEMENT = '1';

const cjsRequire = createRequire(import.meta.url);
const dgMod = cjsRequire(path.resolve(distDir, 'electron/llm/documentGroundedPrompt.js'));
const csiMod = cjsRequire(path.resolve(distDir, 'electron/llm/customModeExecutionContract.js'));
const soMod = cjsRequire(path.resolve(distDir, 'electron/llm/sourceOwnership.js'));

const { DOC_GROUNDED_ANSWER_TYPES, isDocGroundedAnswerType, deriveRetrievalHints, expandQueryWithHints } = dgMod;
const {
  buildCustomModeExecutionContract,
  validateAgainstSourceContract,
  extractCandidateEntities,
  unsupportedEntities,
  classifyRequestedProperty,
  validatePropertyAnswerability,
} = csiMod;
const { resolveSourceOwnership, isExplicitProfileAsk, buildSourceSwitchClarification } = soMod;

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

test('DOC_GROUNDED_ANSWER_TYPES contains the seven doc-grounded shapes', () => {
  assert.equal(DOC_GROUNDED_ANSWER_TYPES.size, 7, `expected 7 shapes, got ${DOC_GROUNDED_ANSWER_TYPES.size}`);
  for (const t of [
    'lecture_answer',
    'definitional_answer',
    'list_answer',
    'exact_numeric_answer',
    'document_followup_answer',
    // document_structure_answer added by the structural/ToC hardening
    // (commit 9abc9a6) so "what's in section N" / ToC questions also fire
    // the post-stream document-grounded validator.
    'document_structure_answer',
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

// ── Test 8: REGRESSION B — property-aware answerability (GENERAL, no entity
//    constants). The controller/processor case is now proven through the
//    generic classifyRequestedProperty + validatePropertyAnswerability path —
//    the entity name "Mercury X1" lives only in the test fixture, never in
//    product code. The SAME mechanism covers cost/funding/participants below.

test('REGRESSION B: property classifier recognizes a controller/processor question generically', () => {
  assert.equal(classifyRequestedProperty('What processor controls the Mercury X1?'), 'processor_or_controller');
  assert.equal(classifyRequestedProperty('What are the key specifications of the Mercury X1?'), 'unknown');
  // Generalizes to any entity — no hardcoded name.
  assert.equal(classifyRequestedProperty('Which controller runs the Falcon R2 arm?'), 'processor_or_controller');
});

test('REGRESSION B: controller answer rejected when evidence lacks entity+controller support', () => {
  const contract = contractFor({ ...DOC_GROUNDED_INPUT, answerType: 'exact_numeric_answer' });
  // Evidence mentions the entity ONLY in a non-controller (motor-subsystem)
  // sentence — the property is not supported for that entity.
  const blockNoController = `
[Section 4.2.1 | p55] The Falcon R2 communicates with the motor control subsystem via generic boards at 50 Hz.
`;
  const result = validateAgainstSourceContract({
    contract,
    question: 'What processor controls the Falcon R2?',
    answer: 'The Falcon R2 is controlled by a high-performance AI controller.',
    retrievedBlock: blockNoController,
  });
  assert.equal(result.ok, false, `expected property-evidence-missing rejection, got ok=true`);
  assert.ok(
    result.answerabilityViolations.some(v => v.startsWith('property_evidence_missing:processor_or_controller')),
    `expected processor_or_controller violation, got: ${JSON.stringify(result.answerabilityViolations)}`,
  );
});

test('REGRESSION B: controller answer accepted when evidence supports entity+controller', () => {
  const contract = contractFor({ ...DOC_GROUNDED_INPUT, answerType: 'exact_numeric_answer' });
  // THESIS_BLOCK has "Mercury X1 is controlled by the NVIDIA Jetson Xavier main
  // controller…" — entity + property co-occur, so a grounded answer ships.
  const goodAnswer = 'The Mercury X1 is controlled by the NVIDIA Jetson Xavier main controller with a Jetson Nano auxiliary controller.';
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

// ══════════════════════════════════════════════════════════════════════════
// SOURCE-OWNERSHIP RESOLVER — the general disambiguation authority.
// Proves ambiguous-noun ownership resolves by MODE source authority, not by
// per-entity/per-question keyword lists. No document term, project name, or
// specific question string is asserted as product logic here.
// ══════════════════════════════════════════════════════════════════════════

function ownershipFor(question, authority, profilePolicy = 'forbidden', hasProfileFacts = true) {
  return resolveSourceOwnership({
    question,
    contract: { sourceAuthority: authority },
    profileContextPolicy: profilePolicy,
    answerType: 'x',
    hasProfileFacts,
  });
}

// ── Doc-grounded: the reported leak ────────────────────────────────────────

test('OWNERSHIP: doc-grounded "four main phases of the project?" → reference_files, profile NOT allowed', () => {
  const d = ownershipFor('What are the four main phases of the project?', 'reference_files_only');
  assert.equal(d.owner, 'reference_files');
  assert.equal(d.profileAllowed, false, 'the profile fast-path must NOT run — this is the reported leak');
  assert.equal(d.shouldClarifyInsteadOfProfile, false, 'a normal doc question does not clarify');
});

test('OWNERSHIP: doc-grounded "main stages of the pipeline?" (definitional) → profile NOT allowed', () => {
  const d = ownershipFor('What are the main stages of the pipeline?', 'reference_files_only');
  assert.equal(d.profileAllowed, false);
});

test('OWNERSHIP: doc-grounded "List the four objectives." (list) → profile NOT allowed', () => {
  const d = ownershipFor('List the four objectives of the study.', 'reference_files_only');
  assert.equal(d.profileAllowed, false);
});

// ── Doc-grounded + explicit profile ask → clarify / offer to switch ────────

test('OWNERSHIP: doc-grounded EXPLICIT "what is my project X?" → clarify, no profile leak', () => {
  const d = ownershipFor('What is my project Natively?', 'reference_files_only');
  assert.equal(d.profileAllowed, false, 'never leak the profile');
  assert.equal(d.explicitProfileAsk, true, 'possessive "my project" is detected generically');
  assert.equal(d.shouldClarifyInsteadOfProfile, true, 'explicit profile ask in a doc mode → clarify');
  // The clarify line is source-honest and names no specific document/project.
  const line = buildSourceSwitchClarification(d.owner);
  assert.match(line, /uploaded material/i);
  assert.doesNotMatch(line, /Natively/i);
});

test('OWNERSHIP: explicit-profile shape detector is generic (not an entity list)', () => {
  assert.equal(isExplicitProfileAsk('what is my project Natively?'), true);
  assert.equal(isExplicitProfileAsk('tell me about my resume'), true);
  assert.equal(isExplicitProfileAsk('from my background, what fits?'), true);
  assert.equal(isExplicitProfileAsk('your skills for this role'), true);
  // A plain document question is NOT an explicit profile ask.
  assert.equal(isExplicitProfileAsk('what are the four main phases of the project?'), false);
  assert.equal(isExplicitProfileAsk('what does the paper conclude?'), false);
});

// ── Profile mode: profile IS the owner ─────────────────────────────────────

test('OWNERSHIP: profile mode "what are my best projects?" → profile allowed', () => {
  const d = ownershipFor('What are my best projects?', 'profile_only', 'required');
  assert.equal(d.owner, 'profile');
  assert.equal(d.profileAllowed, true);
  assert.equal(d.shouldClarifyInsteadOfProfile, false);
});

// ── Transcript mode: transcript owns "project" ─────────────────────────────

test('OWNERSHIP: transcript mode "what project did we discuss?" → transcript, profile NOT allowed', () => {
  const d = ownershipFor('What project did we discuss in the meeting?', 'transcript_only');
  assert.equal(d.owner, 'transcript');
  assert.equal(d.profileAllowed, false);
});

// ── General/built-in mode: ZERO regression — defer to AnswerPlan policy ─────

test('OWNERSHIP: general_mixed defers to the AnswerPlan policy (profile question → profile)', () => {
  const allowed = ownershipFor('What are my best projects?', 'general_mixed', 'required', true);
  assert.equal(allowed.profileAllowed, true, 'built-in mode profile question still routes to profile');
  const forbidden = ownershipFor('reverse a linked list', 'general_mixed', 'forbidden', true);
  assert.equal(forbidden.profileAllowed, false, 'a coding question keeps profile forbidden');
});

test('OWNERSHIP: general_mixed with no profile facts → profile not allowed (no false grounding)', () => {
  const d = ownershipFor('What are my best projects?', 'general_mixed', 'required', false);
  assert.equal(d.profileAllowed, false);
});

// ══════════════════════════════════════════════════════════════════════════
// GENERAL ENTITY / PROPERTY VALIDATOR — blacklist-free proofs.
// ══════════════════════════════════════════════════════════════════════════

test('ENTITY: extractCandidateEntities finds proper nouns + product tokens generically', () => {
  const ents = extractCandidateEntities('The Falcon R2 uses a Jetson Xavier and an ESP32 board.');
  const norm = ents.map(e => e.toLowerCase());
  assert.ok(norm.some(e => e.includes('falcon')), `expected Falcon, got ${JSON.stringify(ents)}`);
  assert.ok(norm.some(e => e.includes('jetson')), `expected Jetson, got ${JSON.stringify(ents)}`);
  assert.ok(ents.includes('ESP32') || ents.includes('R2'), `expected a product token, got ${JSON.stringify(ents)}`);
});

test('ENTITY: unsupportedEntities flags any answer entity absent from evidence — no hardcoded names', () => {
  // "Natively" is absent from the thesis block → flagged.
  const leaks = unsupportedEntities('My project Natively uses Electron and Rust.', THESIS_BLOCK);
  assert.ok(leaks.includes('Natively'), `expected Natively flagged, got ${JSON.stringify(leaks)}`);
  // A brand-new invented entity is ALSO flagged with zero code changes.
  const leaks2 = unsupportedEntities('The system runs on QuantumForge9000.', THESIS_BLOCK);
  assert.ok(leaks2.includes('QuantumForge9000'), `expected the invented entity flagged, got ${JSON.stringify(leaks2)}`);
});

test('ENTITY: an entity present in the evidence is NOT flagged', () => {
  const leaks = unsupportedEntities('Mercury X1 uses the Jetson Xavier controller.', THESIS_BLOCK);
  assert.equal(leaks.length, 0, `expected no leaks (all in evidence), got ${JSON.stringify(leaks)}`);
});

test('PROPERTY: cost question requires cost/price evidence (general)', () => {
  assert.equal(classifyRequestedProperty('What was the total cost of building the teleoperation system?'), 'cost_or_price');
  const violations = validatePropertyAnswerability({
    question: 'What was the total cost of building the teleoperation system?',
    answer: 'It cost $50,000.',
    retrievedBlock: THESIS_BLOCK, // no cost figure present
  });
  assert.ok(violations.some(v => v.startsWith('property_evidence_missing:cost_or_price')), `got ${JSON.stringify(violations)}`);
});

test('PROPERTY: funding question requires sponsor/grant evidence (general)', () => {
  assert.equal(classifyRequestedProperty('Who funded this research?'), 'funding_source');
  const violations = validatePropertyAnswerability({
    question: 'Who funded this research?',
    answer: 'It was funded by a private grant.',
    retrievedBlock: THESIS_BLOCK, // only a collaboration mention, no funding
  });
  assert.ok(violations.some(v => v.startsWith('property_evidence_missing:funding_source')), `got ${JSON.stringify(violations)}`);
});

test('PROPERTY: participants question requires participant evidence (general)', () => {
  assert.equal(classifyRequestedProperty('How many participants took part?'), 'human_participants');
  const violations = validatePropertyAnswerability({
    question: 'How many participants took part in the study?',
    answer: 'There were 40 participants.',
    retrievedBlock: THESIS_BLOCK,
  });
  assert.ok(violations.some(v => v.startsWith('property_evidence_missing:human_participants')), `got ${JSON.stringify(violations)}`);
});

// ══════════════════════════════════════════════════════════════════════════
// SOURCE-AWARE RETRIEVAL HINTS — generic synonym expansion, no doc terms.
// ══════════════════════════════════════════════════════════════════════════

test('HINTS: "phases" expands to generic stage/objective synonyms', () => {
  const h = deriveRetrievalHints('What are the four main phases of the project?');
  assert.ok(h.sectionHints.includes('objective'), `expected objective synonym, got ${JSON.stringify(h.sectionHints)}`);
  assert.ok(h.sectionHints.includes('milestone'));
  const expanded = expandQueryWithHints('What are the four main phases of the project?');
  assert.match(expanded, /objective/);
  assert.match(expanded, /milestone/);
});

test('HINTS: a question with no ambiguous concept nouns returns the raw query', () => {
  const expanded = expandQueryWithHints('hello there');
  assert.equal(expanded, 'hello there');
});