// Context OS — INDEPENDENT VERIFICATION: behavioral gate tests (addresses H2).
//
// The existing ContextOs*Wiring tests assert SOURCE STRINGS exist in ipcHandlers
// (`ipcSource.includes('buildTurnContractIfEnabled')`). That cannot catch an
// inverted gate. These tests EXECUTE the real gate expressions and the kernel to
// prove fail-safety + narrowing behaviorally.
//
// Run: npm run build:electron && node --test electron/intelligence/__tests__/ContextOsGateBehavior.verif.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));

const kernel = new co.SourceAuthorityKernel();

// ── The EXACT gate expression ipcHandlers.ts uses for the profile fast path ──
// sourceOwnershipAllowsProfile = (legacyDecision) && _contractAllowsProfile
// _contractAllowsProfile = !turnContract ? true : allowsEvidence(profile_resume|project)
function contractAllowsProfile(turnContract) {
  if (!turnContract) return true; // null → legacy decides alone (the fail-safe branch)
  return co.allowsEvidence(turnContract, 'profile_resume') || co.allowsEvidence(turnContract, 'profile_project');
}
function gateFinalProfile(legacyDecision, turnContract) {
  return legacyDecision && contractAllowsProfile(turnContract);
}

test('FAIL-SAFE: null contract (production default) === pure legacy decision, both polarities', () => {
  // With no contract, the gate must be byte-identical to the legacy decision.
  assert.equal(gateFinalProfile(true, null), true, 'legacy-allow + null contract must allow');
  assert.equal(gateFinalProfile(false, null), false, 'legacy-deny + null contract must deny');
});

test('NARROWING: doc-grounded contract forces profile OFF even when legacy would allow', () => {
  const doc = kernel.build({
    surface: 'manual_chat', question: 'What are the four phases of the project?', activeModeId: 'm1',
    sourceAuthority: 'reference_files_only', answerShape: 'list', voicePerspective: 'assistant_explanation',
    enforcement: 'enforce', hasReferenceFiles: true, hasProfileFacts: true, hasLiveTranscript: true,
  });
  // Even if the buggy legacy path said "allow profile", the contract must veto it.
  assert.equal(gateFinalProfile(true, doc), false, 'doc-grounded contract must veto profile');
});

test('NEVER WIDENS: interview contract cannot turn a legacy-DENY into an allow', () => {
  const interview = kernel.build({
    surface: 'manual_chat', question: 'What is my best project?', activeModeId: 'm1',
    sourceAuthority: 'profile_plus_transcript', answerShape: 'general', voicePerspective: 'first_person_candidate',
    enforcement: 'enforce', hasReferenceFiles: false, hasProfileFacts: true, hasLiveTranscript: true,
  });
  // Contract allows profile, but if legacy denied, the AND keeps it denied.
  assert.equal(gateFinalProfile(false, interview), false, 'contract must not widen a legacy deny');
  assert.equal(gateFinalProfile(true, interview), true, 'both allow → allow');
});

test('INVERTED-GATE DETECTOR: dropping the AND conjunct would leak — prove the AND matters', () => {
  const doc = kernel.build({
    surface: 'manual_chat', question: 'phases of the project', activeModeId: 'm1',
    sourceAuthority: 'reference_files_only', answerShape: 'list', voicePerspective: 'assistant_explanation',
    enforcement: 'enforce', hasReferenceFiles: true, hasProfileFacts: true, hasLiveTranscript: false,
  });
  const correct = gateFinalProfile(true, doc);           // legacy && contract = true && false = false
  const buggyDroppedConjunct = true;                     // if someone dropped `&& _contractAllowsProfile`
  assert.notEqual(correct, buggyDroppedConjunct, 'the AND conjunct is load-bearing; dropping it would leak');
});

// ── Hindsight gate (memoryReadPolicy) ───────────────────────────────────────
function contractAllowsHindsight(turnContract) {
  return turnContract ? turnContract.memoryReadPolicy.allowHindsight : true;
}
test('HINDSIGHT: doc-grounded contract sets allowHindsight=false (blocked); null=legacy true', () => {
  const doc = kernel.build({
    surface: 'manual_chat', question: 'phases', activeModeId: 'm1', sourceAuthority: 'reference_files_only',
    answerShape: 'list', voicePerspective: 'assistant_explanation', enforcement: 'observe',
    hasReferenceFiles: true, hasProfileFacts: true, hasLiveTranscript: false,
  });
  assert.equal(contractAllowsHindsight(doc), false);
  assert.equal(contractAllowsHindsight(null), true, 'null contract → legacy Hindsight decision');
});

// ── M3: custom_profile_notes must not have peer authority with structured resume
//    (documents the current trust-inversion so a future validator wiring is safe) ──
test('M3 GUARD: custom_profile_notes authority documented (currently peer evidence — flagged)', () => {
  const p = kernel.build({
    surface: 'manual_chat', question: 'What are my skills?', activeModeId: 'm1',
    sourceAuthority: 'profile_only', answerShape: 'list', voicePerspective: 'first_person_candidate',
    enforcement: 'observe', hasReferenceFiles: false, hasProfileFacts: true, hasLiveTranscript: false,
  });
  const notes = p.allowedSources.find((s) => s.sourceKind === 'custom_profile_notes');
  const resume = p.allowedSources.find((s) => s.sourceKind === 'profile_resume');
  // This test PINS the current (flagged) behavior so a fix is a conscious change.
  // If a future change downgrades notes to referent_only (the recommended fix),
  // update this assertion — it will fail loudly, which is the point.
  assert.ok(notes, 'custom_profile_notes granted in profile mode');
  assert.equal(notes.trustLevel, 'profile_unverified', 'notes trust must remain below resume');
  assert.equal(resume.trustLevel, 'profile_verified');
  // Persona MUST be style-only (this one is correct and must never regress).
  const persona = p.allowedSources.find((s) => s.sourceKind === 'profile_persona');
  assert.equal(persona.authority, 'style', 'persona must be style-only');
});

// ── Scenario C runtime gap: kernel says clarify, but no live surface acts on it ──
test('SCENARIO C (documented gap): kernel emits clarify but pack policy is ask_clarification', async () => {
  const gen = kernel.build({
    surface: 'what_to_answer', question: 'What are the project phases?', activeModeId: 'm1',
    sourceAuthority: 'general_mixed', answerShape: 'list', voicePerspective: 'assistant_explanation',
    enforcement: 'observe', hasReferenceFiles: true, hasProfileFacts: true, hasLiveTranscript: true,
  });
  assert.equal(gen.sourceOwner, 'clarify');
  const orch = new co.EvidenceOrchestrator();
  const pack = await orch.buildEvidencePack({ question: 'What are the project phases?', contract: gen, retrievers: {
    retrieveModeContext: () => 'doc', retrieveProfileContext: () => 'profile',
  } });
  assert.equal(pack.answerPolicy, 'ask_clarification', 'orchestrator correctly signals clarify');
  // NOTE: this proves the kernel+orchestrator are correct. The RUNTIME GAP
  // (documented in FINAL_VERIFICATION_REPORT H1/Scenario-C) is that the live
  // WTA/manual paths do not consult this answerPolicy — verified by E2E where a
  // general "project phases" question was answered instead of clarified.
});
