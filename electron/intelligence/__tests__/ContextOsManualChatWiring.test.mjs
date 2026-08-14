// Context OS Phase 7 — manual chat wiring.
//
// Two layers of proof:
//   1. Behavior: buildTurnContractIfEnabled respects the flag ladder, and the
//      contract it returns denies profile evidence for doc-grounded turns
//      (the gate expression ipcHandlers joins into sourceOwnershipAllowsProfile).
//   2. Wiring: the gemini-chat-stream handler actually consults the contract
//      at the three gates (profile fast path, Hindsight, OKF profile cards)
//      — asserted structurally against the source, following the repo's
//      existing grep-test practice, so a refactor that silently drops a gate
//      fails CI.
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/ContextOsManualChatWiring.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);

// Flags: force the Context OS surface ON for this suite (env override wins).
process.env.NATIVELY_CONTEXT_OS = '1';
process.env.NATIVELY_CONTEXT_OS_MANUAL_CHAT = '1';

const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));

const DOC_INPUT = {
  surface: 'manual_chat',
  question: 'What are the four main phases of the project?',
  activeModeId: 'mode-1',
  sourceAuthority: 'reference_files_only',
  answerType: 'list_answer',
  plannerVoicePerspective: 'assistant_explanation',
  hasReferenceFiles: true,
  hasProfileFacts: true,
  hasLiveTranscript: true,
};

// ── 1. Flag ladder ───────────────────────────────────────────────────────────

test('contract builds when umbrella + surface flags are on', () => {
  const c = co.buildTurnContractIfEnabled(DOC_INPUT);
  assert.ok(c, 'expected a contract');
  assert.equal(c.sourceOwner, 'reference_files');
});

test('umbrella off → null (legacy path untouched)', () => {
  process.env.NATIVELY_CONTEXT_OS = '0';
  try {
    assert.equal(co.buildTurnContractIfEnabled(DOC_INPUT), null);
  } finally {
    process.env.NATIVELY_CONTEXT_OS = '1';
  }
});

test('surface flag off → null even with umbrella on', () => {
  process.env.NATIVELY_CONTEXT_OS_MANUAL_CHAT = '0';
  try {
    assert.equal(co.buildTurnContractIfEnabled(DOC_INPUT), null);
  } finally {
    process.env.NATIVELY_CONTEXT_OS_MANUAL_CHAT = '1';
  }
});

test('enforcement mode follows contextOsEnforceSourceCapabilities', () => {
  assert.equal(co.contextOsEnforcementMode(), 'observe');
  process.env.NATIVELY_CONTEXT_OS_ENFORCE_CAPABILITIES = '1';
  try {
    assert.equal(co.contextOsEnforcementMode(), 'enforce');
  } finally {
    delete process.env.NATIVELY_CONTEXT_OS_ENFORCE_CAPABILITIES;
  }
});

// ── 2. The gate expressions the handler joins ───────────────────────────────

test('doc-grounded contract denies the profile fast-path gate expression', () => {
  const c = co.buildTurnContractIfEnabled(DOC_INPUT);
  const contractAllowsProfile = co.allowsEvidence(c, 'profile_resume') || co.allowsEvidence(c, 'profile_project');
  assert.equal(contractAllowsProfile, false, 'doc-grounded turn must deny profile evidence');
  assert.equal(c.memoryReadPolicy.allowHindsight, false, 'doc-grounded turn must deny Hindsight');
});

test('interview contract permits the profile fast-path gate expression', () => {
  const c = co.buildTurnContractIfEnabled({
    ...DOC_INPUT,
    question: 'What is my best project?',
    sourceAuthority: 'profile_plus_transcript',
    answerType: 'project_answer',
  });
  const contractAllowsProfile = co.allowsEvidence(c, 'profile_resume') || co.allowsEvidence(c, 'profile_project');
  assert.equal(contractAllowsProfile, true);
});

test('answerShape mapping: list/definition/numeric/refusal split from AnswerType', () => {
  assert.equal(co.mapAnswerTypeToAnswerShape('list_answer'), 'list');
  assert.equal(co.mapAnswerTypeToAnswerShape('definitional_answer'), 'definition');
  assert.equal(co.mapAnswerTypeToAnswerShape('exact_numeric_answer'), 'numeric');
  assert.equal(co.mapAnswerTypeToAnswerShape('document_absent_fact_refusal'), 'refusal');
  assert.equal(co.mapAnswerTypeToAnswerShape('follow_up_answer'), 'follow_up');
  assert.equal(co.mapAnswerTypeToAnswerShape('unknown_answer'), 'general');
  assert.equal(co.mapAnswerTypeToAnswerShape(null), 'general');
});

// ── 3. Structural wiring assertions against ipcHandlers.ts ─────────────────

const ipcSource = fs.readFileSync(path.resolve(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');

test('WIRING: gemini-chat-stream builds the TurnContextContract from the arbiter authority', () => {
  assert.ok(ipcSource.includes('buildTurnContractIfEnabled'), 'contract builder not wired');
  assert.ok(ipcSource.includes("surface: 'manual_chat'"), 'manual_chat surface missing');
  assert.ok(ipcSource.includes('manualSourceContract.sourceAuthority'), 'kernel must consume the SAME sourceAuthority as the legacy arbiter');
});

test('WIRING: profile fast-path gate joins the contract capability check', () => {
  assert.ok(ipcSource.includes('_contractAllowsProfile'), 'contract capability check missing');
  assert.match(ipcSource, /sourceOwnershipAllowsProfile\s*=\s*\(\(manualOwnership[\s\S]{0,200}&&\s*_contractAllowsProfile/, 'fast-path gate must AND the contract check (narrowing only)');
});

test('WIRING: Hindsight gate consults memoryReadPolicy.allowHindsight', () => {
  assert.ok(ipcSource.includes('turnContract.memoryReadPolicy.allowHindsight'), 'Hindsight contract gate missing');
  assert.match(ipcSource, /&&\s*_contractAllowsHindsight/, 'Hindsight recall must AND the contract policy');
});

test('WIRING: OKF profile-cards gate joins the contract capability check', () => {
  assert.match(ipcSource, /ownershipAllowsProfileEvidence\s*=\s*\(manualOwnership[\s\S]{0,120}&&\s*_contractAllowsProfile/, 'OKF profile gate must AND the contract check');
});

test('WIRING: property-aware validation hooks the doc-grounded post-stream validator', () => {
  assert.ok(ipcSource.includes('contextOsPropertyValidation'), 'property validation flag not consulted');
  assert.ok(ipcSource.includes('textCanProveProperty(docContextBlock'), 'evidence-vocabulary check missing');
  assert.ok(ipcSource.includes('buildInsufficientPropertyAnswer'), 'honest property refusal missing');
  // The refusal must be blocked from SessionTracker (memory safety).
  assert.match(ipcSource, /propertyUnsupported && propertyRefusalLine[\s\S]{0,400}blockedFromSessionTracker = true/, 'property refusal must not enter SessionTracker');
});

test('WIRING: contract failure is non-fatal (try/catch around the kernel)', () => {
  assert.match(ipcSource, /\[CONTEXT-OS\] contract build skipped \(non-fatal\)/, 'kernel errors must never break chat');
});
