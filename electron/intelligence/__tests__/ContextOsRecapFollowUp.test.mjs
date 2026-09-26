// Context OS Phase 11 — recap + follow-up mode integration.
//
// Run with: npm run build:electron && node --test electron/intelligence/__tests__/ContextOsRecapFollowUp.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);
const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));

// ── Contract rules ──────────────────────────────────────────────────────────

test('recap rule: transcript-only summary, no profile/document/memory facts', () => {
  const rule = co.buildRecapContractRule({ sourceOwner: 'transcript', forbiddenSources: [] });
  assert.match(rule, /Summarize ONLY what was actually said/);
  assert.match(rule, /no resume\/profile facts/);
});

test('recap rule in doc-grounded mode: recap still summarizes the CONVERSATION, not the document', () => {
  const rule = co.buildRecapContractRule({ sourceOwner: 'reference_files', forbiddenSources: [] });
  assert.match(rule, /document-grounded mode/);
  assert.match(rule, /Do not answer document questions inside the recap/);
});

test('follow-up rule: refinement inherits ownership, no new facts', () => {
  const rule = co.buildFollowUpContractRule({ sourceOwner: 'reference_files', forbiddenSources: [] });
  assert.match(rule, /EDITING the previous answer/);
  assert.match(rule, /Do not introduce ANY new factual claim/);
  assert.match(rule, /Do not add resume\/profile facts/);
});

test('follow-up rule for a profile-owned answer forbids document facts', () => {
  const rule = co.buildFollowUpContractRule({ sourceOwner: 'profile', forbiddenSources: [] });
  assert.match(rule, /grounded in the candidate profile/);
  assert.match(rule, /Do not add uploaded-document facts/);
});

// ── Source-switch detection ─────────────────────────────────────────────────

test('detectFollowUpSourceSwitch catches explicit switches, ignores plain refinements', () => {
  assert.equal(co.detectFollowUpSourceSwitch('answer from my resume instead'), 'profile');
  assert.equal(co.detectFollowUpSourceSwitch('use the uploaded document for this'), 'reference_files');
  assert.equal(co.detectFollowUpSourceSwitch('answer from the meeting transcript'), 'transcript');
  assert.equal(co.detectFollowUpSourceSwitch('make it shorter'), null);
  assert.equal(co.detectFollowUpSourceSwitch('more confident please'), null);
  assert.equal(co.detectFollowUpSourceSwitch(''), null);
});

// ── LLM prompt append points ────────────────────────────────────────────────

const recapSource = fs.readFileSync(path.resolve(repoRoot, 'electron/llm/RecapLLM.ts'), 'utf8');
const followUpSource = fs.readFileSync(path.resolve(repoRoot, 'electron/llm/FollowUpLLM.ts'), 'utf8');
const engineSource = fs.readFileSync(path.resolve(repoRoot, 'electron/IntelligenceEngine.ts'), 'utf8');

test('WIRING: RecapLLM.generateStream accepts + appends the contract rule', () => {
  assert.match(recapSource, /options\?: \{ contractRule\?: string \}/);
  assert.match(recapSource, /promptOverride = `\$\{promptOverride\}\\n\\n\$\{options\.contractRule\}`/);
});

test('WIRING: FollowUpLLM.generateStream accepts + appends the contract rule', () => {
  assert.match(followUpSource, /options\?: \{ contractRule\?: string \}/);
  assert.match(followUpSource, /prompt = `\$\{prompt\}\\n\\n\$\{options\.contractRule\}`/);
});

test('WIRING: engine builds the recap/follow-up contract from the active mode authority', () => {
  assert.ok(engineSource.includes('buildRecapFollowUpContract'), 'contract builder missing');
  assert.ok(engineSource.includes('buildRecapContractRule(recapContract)'), 'recap rule not wired');
  assert.ok(engineSource.includes('buildFollowUpContractRule(fuContract)'), 'follow-up rule not wired');
  assert.ok(engineSource.includes('detectFollowUpSourceSwitch'), 'source-switch detection not wired');
});

test('WIRING: follow-up source switch emits a source-honest line instead of silently switching', () => {
  assert.match(engineSource, /Switching sources needs a fresh question/);
});

// ── Contract behavior on the recap/follow-up surface ────────────────────────

process.env.NATIVELY_CONTEXT_OS = '1';
process.env.NATIVELY_CONTEXT_OS_RECAP_FOLLOWUP = '1';

test('recap surface contract builds under the recapFollowup flag', () => {
  const c = co.buildTurnContractIfEnabled({
    surface: 'recap',
    question: 'Recap the conversation so far',
    activeModeId: 'm1',
    sourceAuthority: 'reference_files_only',
    answerType: 'follow_up_answer',
    plannerVoicePerspective: 'assistant_explanation',
    hasReferenceFiles: true,
    hasProfileFacts: true,
    hasLiveTranscript: true,
  });
  assert.ok(c);
  assert.equal(c.sourceOwner, 'reference_files');
  assert.ok(c.forbiddenSources.includes('profile_resume'));
});

test('recap/follow-up surface flag off → null (legacy mode-blind behavior)', () => {
  process.env.NATIVELY_CONTEXT_OS_RECAP_FOLLOWUP = '0';
  try {
    const c = co.buildTurnContractIfEnabled({
      surface: 'follow_up',
      question: 'make it shorter',
      activeModeId: 'm1',
      sourceAuthority: 'reference_files_only',
      answerType: 'follow_up_answer',
      plannerVoicePerspective: 'assistant_explanation',
      hasReferenceFiles: true,
      hasProfileFacts: true,
      hasLiveTranscript: true,
    });
    assert.equal(c, null);
  } finally {
    process.env.NATIVELY_CONTEXT_OS_RECAP_FOLLOWUP = '1';
  }
});
