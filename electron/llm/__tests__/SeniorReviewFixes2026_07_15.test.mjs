// Senior-review regression tests (2026-07-15).
//
// Run with: npm run build:electron && node --test electron/llm/__tests__/SeniorReviewFixes2026_07_15.test.mjs
//
// Closes the two CRITICAL wiring gaps the senior review caught:
//   1. buildManualProfileEvidenceRoute must accept allowedSourceKinds and
//      drop items whose sourceKind is not in the set.
//   2. validateFinalPromptEvidence must enforce forbidden_evidence_family_rendered
//      when a decision is supplied (verifies that ContextOsGenerationContext now
//      carries turnSourceDecision from ipcHandlers.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');

const { buildManualProfileEvidenceRoute } = await import(
  pathToFileURL(path.join(distDir, 'llm/profileAnswerBackend.js')).href
);
const { resolveTurnSourceDecision } = await import(
  pathToFileURL(path.join(distDir, 'llm/turnSourceDecision.js')).href
);
const { buildCustomModeExecutionContract } = await import(
  pathToFileURL(path.join(distDir, 'llm/customModeExecutionContract.js')).href
);
const cjsRequire = (await import('node:module')).createRequire(import.meta.url);
const { validateFinalPromptEvidence } = cjsRequire(
  path.resolve(distDir, 'intelligence/context-os/index.js'),
);

const PROFILE = {
  identity: { name: 'Evin John', email: 'evin@example.com' },
  name: 'Evin John',
  experience: [
    { company: 'Aetherbot AI', role: 'Software Engineer Intern', start_date: '2024-12', end_date: '2025-03' },
  ],
  projects: [
    { name: 'Natively', description: 'Desktop AI meeting assistant with local RAG.', technologies: ['Electron', 'TypeScript'] },
  ],
  skills: ['TypeScript', 'Electron', 'Python'],
  education: [{ school: 'IIT', degree: 'B.Tech', endDate: '2016' }],
};

const JD = {
  title: 'Staff Engineer', company: 'TargetCo',
  requirements: ['5 years of Kubernetes', 'Strong Python'],
  responsibilities: ['Own the ML platform'],
};

const orchestrator = {
  activeResume: { structured_data: PROFILE },
  activeJD: { structured_data: JD },
};

const fullAvailability = {
  hasReferenceFiles: true,
  hasProfileFacts: true,
  hasJobDescription: true,
  hasLiveTranscript: false,
  hasMeetingRag: false,
};

// ── CRITICAL #1 — allowedSourceKinds filter ─────────────────────────────────

test('CRITICAL #1: a JD-only allowedSourceKinds set drops résumé evidence items', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['job_description'],
    },
    explicitRequest: 'job_description',
    availability: fullAvailability,
  });
  const allowedSourceKinds = decision.allowedEvidenceKinds.filter(
    (k) => k === 'profile_resume' || k === 'profile_jd' || k === 'projects',
  );
  const result = buildManualProfileEvidenceRoute({
    question: 'According to the JD, what is the role?',
    orchestrator,
    source: 'manual_input',
    answerType: 'jd_requirements_answer',
    allowedSourceKinds,
  });
  assert.ok(result.route, 'route must still succeed');
  const kinds = result.route.items.map((item) => item.sourceKind);
  assert.equal(kinds.includes('profile_resume'), false,
    `route leaked résumé items: ${JSON.stringify(kinds)}`);
  assert.equal(kinds.includes('projects'), false,
    `route leaked project items: ${JSON.stringify(kinds)}`);
  assert.equal(kinds.includes('profile_jd'), true, 'route dropped JD items unexpectedly');
});

test('CRITICAL #1: a résumé-only allowedSourceKinds set drops JD items', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['profile'],
    },
    explicitRequest: 'profile',
    availability: fullAvailability,
  });
  const allowedSourceKinds = decision.allowedEvidenceKinds.filter(
    (k) => k === 'profile_resume' || k === 'profile_jd' || k === 'projects',
  );
  const result = buildManualProfileEvidenceRoute({
    question: 'According to my résumé, what is my strongest project?',
    orchestrator,
    source: 'manual_input',
    answerType: 'project_answer',
    allowedSourceKinds,
  });
  assert.ok(result.route, 'route must still succeed');
  const kinds = result.route.items.map((item) => item.sourceKind);
  assert.equal(kinds.includes('profile_jd'), false,
    `route leaked JD items: ${JSON.stringify(kinds)}`);
  const hasResumeOrProjects = kinds.some((k) => k === 'profile_resume' || k === 'projects');
  assert.equal(hasResumeOrProjects, true, 'route dropped résumé/project items unexpectedly');
});

test('CRITICAL #1: undefined allowedSourceKinds preserves legacy behavior', () => {
  const result = buildManualProfileEvidenceRoute({
    question: 'What are my strongest projects and how do they fit the JD?',
    orchestrator,
    source: 'manual_input',
    answerType: 'resume_jd_fit_answer',
  });
  assert.ok(result.route);
  const kinds = result.route.items.map((item) => item.sourceKind);
  assert.equal(kinds.includes('profile_resume') || kinds.includes('projects'), true,
    'legacy route dropped résumé evidence');
  assert.equal(kinds.includes('profile_jd'), true, 'legacy route dropped JD evidence');
});

// ── CRITICAL #2 — ContextOsGenerationContext turnSourceDecision propagation ─

const baseContract = {
  turnId: 'turn-fix-verify', surface: 'manual_chat',
  activeModeId: 'mode-fix-verify', activeModeName: 'Fix Verify',
  answerShape: 'general', sourceOwner: 'mixed',
  requestedProperty: 'unknown', voicePerspective: 'first_person_candidate',
  allowedSources: [], forbiddenSources: [], referentOnlySources: [],
  conflictPolicy: 'ask_clarification',
  memoryReadPolicy: { allowHindsight: false, allowPriorAssistantFacts: false, allowPriorAssistantReferents: true },
  memoryWritePolicy: { allowAssistantMessage: true, allowVerifiedClaims: true, allowUnverifiedClaims: false },
  enforcement: 'observe', reason: 'test',
};

const resume = { evidenceId: 'resume:cedar-falcon', sourceKind: 'profile_resume', sourceId: 'cedar-falcon',
  sourceOwner: 'profile', authority: 'evidence', trustLevel: 'profile_verified',
  text: 'Evin led the Natively assistant platform.', supports: { property: 'unknown' }, score: { final: 1 }, reasonIncluded: 'test' };

const jd = { evidenceId: 'jd:session-recovery', sourceKind: 'profile_jd', sourceId: 'session-recovery',
  sourceOwner: 'profile', authority: 'evidence', trustLevel: 'profile_verified',
  text: 'The role requires 5 years Kubernetes.', supports: { property: 'role_requirement' }, score: { final: 1 }, reasonIncluded: 'test' };

function pack(items, answerPolicy = 'answer') {
  return {
    turnId: 'turn-fix-verify', sourceOwner: 'mixed', requestedProperty: 'unknown', items, rejected: [],
    coverage: { hasDirectEvidence: true, propertySatisfied: true, entityMatched: true, sourceOwnerSatisfied: true, confidence: 1 },
    conflicts: [], answerPolicy,
  };
}

test('CRITICAL #2: validateFinalPromptEvidence catches a JD grant when only JD items render', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['job_description'],
    },
    explicitRequest: 'job_description',
    availability: fullAvailability,
  });
  const p = pack([jd]);
  const rendered = '<evidence id="jd:session-recovery" />';
  const result = validateFinalPromptEvidence({
    decision, contract: baseContract, pack: p, finalUserPrompt: rendered,
  });
  assert.equal(result.ok, true, `JD-only grant must pass; got reason: ${result.reason}`);
  assert.deepEqual(result.requiredFamilies, ['job_description']);
});

test('CRITICAL #2: validateFinalPromptEvidence forbids a résumé leak into a JD-only decision', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['job_description'],
    },
    explicitRequest: 'job_description',
    availability: fullAvailability,
  });
  const p = pack([jd, resume]);
  const rendered = '<evidence id="jd:session-recovery" /><evidence id="resume:cedar-falcon" />';
  const result = validateFinalPromptEvidence({
    decision, contract: baseContract, pack: p, finalUserPrompt: rendered,
  });
  assert.equal(result.ok, false, 'résumé must NOT render in a JD-only decision');
  assert.equal(result.reason, 'forbidden_evidence_family_rendered:resume');
});

test('CRITICAL #2: validateFinalPromptEvidence without decision is permissive (production default fail-open)', () => {
  const p = pack([jd, resume]);
  const rendered = '<evidence id="jd:session-recovery" /><evidence id="resume:cedar-falcon" />';
  const result = validateFinalPromptEvidence({
    decision: null, contract: baseContract, pack: p, finalUserPrompt: rendered,
  });
  assert.equal(result.forbiddenFamilies.length, 0, 'no decision ⇒ no forbidden families detected');
  assert.equal(result.ok, true, 'without a decision, validator cannot catch a forbidden leak');
});

// ── HIGH — phone-mirror integration smoke (deterministic) ──────────────────

test('HIGH: buildCustomModeExecutionContract honors a JD-only turnSourceDecision on phone_mirror', () => {
  const decision = resolveTurnSourceDecision({
    sourceContract: {
      defaultOwner: 'reference_files',
      sourceAuthority: 'reference_files_primary',
      allowedExplicitSwitches: ['job_description'],
    },
    explicitRequest: 'job_description',
    availability: fullAvailability,
  });
  const contract = buildCustomModeExecutionContract({
    question: 'According to the JD, what is the role?',
    streamRoute: 'phone_mirror',
    modeId: 'mode-pm', modeUniqueId: 'mode-pm',
    answerType: 'jd_requirements_answer',
    isCustomMode: true,
    isDocGroundedCustomModeActive: false,
    hasReferenceFiles: true,
    hasCustomPrompt: true,
    hasLiveTranscript: false,
    hasProfileFacts: true,
    hasMeetingRag: false,
    hasLongTermMemory: false,
    persistedSourceAuthority: 'reference_files_primary',
    userExplicitSource: 'profile',
    turnSourceDecision: decision,
  });
  assert.equal(contract.allowedSources.includes('profile_jd'), true);
  assert.equal(contract.allowedSources.includes('profile_resume'), false,
    'JD-only decision must NOT allow profile_resume');
  assert.equal(contract.allowedSources.includes('projects'), false,
    'JD-only decision must NOT allow projects');
  assert.equal(contract.allowedSources.includes('reference_files'), false,
    'JD-only decision must NOT allow reference_files');
});
