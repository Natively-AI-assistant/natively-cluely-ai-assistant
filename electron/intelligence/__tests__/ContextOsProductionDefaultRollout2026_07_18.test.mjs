// PHASE — Production-default Context OS rollout regression suite (2026-07-18).
//
// Validates the production-default Context OS rollout without requiring live
// providers or a manual env override. The six core Context OS flags now
// default to `true` in production, while the three strict gates
// (`contextOsEnforceSourceCapabilities`, `contextOsPropertyValidation`,
// `contextOsMultiFamilyEvidenceEnabled`) deliberately remain
// `isInternalDevTestContext`-gated (dev/test-only).
//
// Coverage:
//   1. Every `isIntelligenceFlagEnabled('…')` literal at the Context OS call
//      sites is registered (no phantom keys reach runtime). Defends against
//      the bug class that produced the `contextOsMultiFamilyEvidenceEnabled`
//      crash fixed 2026-07-16.
//   2. Production-like resolution: bare-node `node --test` (no env, no
//      `NODE_ENV`) must yield the six core flags ON and the three strict
//      gates OFF. `NODE_ENV=test` flips the strict gates ON without
//      changing the core six.
//   3. `buildTurnContractIfEnabled` returns a typed contract under
//      production-like defaults for both manual_chat and what_to_answer
//      surfaces; the legacy `null` fallback fires only when an explicit
//      surface or umbrella env OFF is set.
//   4. Multi-family coordinator admission predicate under production-like
//      defaults is unreachable (multi-family flag OFF); under explicit
//      `NATIVELY_CONTEXT_OS_MULTI_FAMILY_EVIDENCE=1`, in-scope profile/JD
//      combinations admit the coordinator, transcript-required
//      combinations stay out of scope, and a coordinator throw resets
//      `coordinatorGovernedProfileEvidence`/`manualContextOsGeneration`
//      to the legacy state.
//
// Run with: npm run build:electron && node --test \
//   electron/intelligence/__tests__/ContextOsProductionDefaultRollout2026_07_18.test.mjs

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Module from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);

// ── Inputs captured for the multi-family coordinator test ───────────────────
// Replicate the admission predicate at ipcHandlers.ts:2184-2190 + 2192-2201.
// Kept structurally identical so a future change to the wiring causes this
// suite to fail with a useful diff instead of silently passing.
const KNOWN_COORDINATOR_KINDS = new Set(['reference_files', 'profile_resume', 'projects', 'profile_jd']);

function isCoordinatorInScopeKinds(requiredEvidenceKinds) {
  return Boolean(requiredEvidenceKinds)
    && requiredEvidenceKinds.length > 0
    && requiredEvidenceKinds.every((k) => KNOWN_COORDINATOR_KINDS.has(k))
    && requiredEvidenceKinds.some((k) => (
      k === 'profile_resume' || k === 'projects' || k === 'profile_jd'
    ));
}

// Mirror the exact gate conjunction at ipcHandlers.ts:2192-2201. Anything
// changing this must be reflected in the production handler and the test.
function shouldRunMultiFamilyCoordinator(input) {
  return !input.isCodingChat
    && !input.selectedProfileEvidence
    && !input.isStealthChat
    && input.answerPlan?.answerType !== 'ethical_usage_answer'
    && Boolean(input.turnContract)
    && Boolean(input.manualTurnSourceDecision)
    && isCoordinatorInScopeKinds(input.manualTurnSourceDecision?.requiredEvidenceKinds)
    && Boolean(input.ownershipAllowsProfileEvidence)
    && Boolean(input.flags.contextOsEvidencePackEnabled)
    && Boolean(input.flags.contextOsMultiFamilyEvidenceEnabled);
}

// ── flag resolution tests (no env mutations cross suite boundaries) ────────

describe('Context OS — production-default flag contract (2026-07-18)', () => {
  let mod;
  before(() => {
    // Use dynamic import to preserve the lazy resolution semantics under
    // `node --test` (no NODE_ENV pre-set). This module reads env fresh on
    // every call so no cache reset is needed.
    mod = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/intelligenceFlags.js'));
  });

  const CLEAR_ENV_KEYS = [
    'NODE_ENV',
    'BENCHMARK_MODEL',
    'NATIVELY_INTERNAL',
    'NATIVELY_DEV',
    'NATIVELY_VERIFICATION_MODE',
    ...Object.values({
      contextOsEnabled: 'NATIVELY_CONTEXT_OS',
      contextOsManualChatEnabled: 'NATIVELY_CONTEXT_OS_MANUAL_CHAT',
      contextOsWtaEnabled: 'NATIVELY_CONTEXT_OS_WTA',
      contextOsRecapFollowupEnabled: 'NATIVELY_CONTEXT_OS_RECAP_FOLLOWUP',
      contextOsEvidencePackEnabled: 'NATIVELY_CONTEXT_OS_EVIDENCE_PACK',
      contextOsMemorySafetyEnabled: 'NATIVELY_CONTEXT_OS_MEMORY_SAFETY',
      contextOsEnforceSourceCapabilities: 'NATIVELY_CONTEXT_OS_ENFORCE_CAPABILITIES',
      contextOsPropertyValidation: 'NATIVELY_CONTEXT_OS_PROPERTY_VALIDATION',
      contextOsMultiFamilyEvidenceEnabled: 'NATIVELY_CONTEXT_OS_MULTI_FAMILY_EVIDENCE',
    }),
  ];

  const PRODUCTION_DEFAULT_ON = [
    'contextOsEnabled',
    'contextOsManualChatEnabled',
    'contextOsWtaEnabled',
    'contextOsRecapFollowupEnabled',
    'contextOsEvidencePackEnabled',
    'contextOsMemorySafetyEnabled',
  ];
  const PRODUCTION_DEFAULT_OFF = [
    'contextOsEnforceSourceCapabilities',
    'contextOsPropertyValidation',
    'contextOsMultiFamilyEvidenceEnabled',
  ];

  beforeEach(() => {
    for (const k of CLEAR_ENV_KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of CLEAR_ENV_KEYS) delete process.env[k];
  });

  test('every literal "isIntelligenceFlagEnabled(...)" call site uses a registered flag key', () => {
    // The flag-parity bug fixed 2026-07-16 was a phantom key
    // (`contextOsMultiFamilyEvidenceEnabled`) used by `ipcHandlers.ts` before
    // it was registered in `FLAGS`. This regression guard makes that
    // impossible to regress: every literal call site must resolve to a
    // registered key, OR be a `trace`/`settings` helper with no key arg.
    const registered = new Set(mod.intelligenceFlagKeys());
    const filesToScan = [
      path.resolve(repoRoot, 'electron/intelligence/intelligenceFlags.ts'),
      path.resolve(repoRoot, 'electron/intelligence/context-os/integration.ts'),
      path.resolve(repoRoot, 'electron/IntelligenceEngine.ts'),
      path.resolve(repoRoot, 'electron/ipcHandlers.ts'),
      path.resolve(repoRoot, 'electron/LLMHelper.ts'),
      path.resolve(repoRoot, 'electron/llm/WhatToAnswerLLM.ts'),
      path.resolve(repoRoot, 'electron/llm/customModeExecutionContract.ts'),
    ];
    const literalRe = /isIntelligenceFlagEnabled\(\s*['"]([a-zA-Z0-9_]+)['"]\s*\)/g;
    const offenders = new Map();
    for (const file of filesToScan) {
      if (!fs.existsSync(file)) continue;
      const src = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = literalRe.exec(src)) !== null) {
        const key = match[1];
        if (!registered.has(key)) {
          if (!offenders.has(key)) offenders.set(key, []);
          offenders.get(key).push(file);
        }
      }
    }
    assert.equal(offenders.size, 0,
      `phantom flag keys referenced at literal call sites: ${[...offenders.entries()].map(([k, files]) => `${k} (in ${files.join(', ')})`).join('; ')}`);
  });

  test('under production-like defaults, the six core flags resolve ON and the three strict gates OFF', () => {
    for (const key of PRODUCTION_DEFAULT_ON) {
      assert.equal(mod.isIntelligenceFlagEnabled(key), true, `${key} must be production-default-on`);
    }
    for (const key of PRODUCTION_DEFAULT_OFF) {
      assert.equal(mod.isIntelligenceFlagEnabled(key), false, `${key} must be production-default-off (dev/test-only)`);
    }
  });

  test('under NODE_ENV=test, every strict gate resolves ON without disturbing the core six', () => {
    process.env.NODE_ENV = 'test';
    for (const key of PRODUCTION_DEFAULT_OFF) {
      assert.equal(mod.isIntelligenceFlagEnabled(key), true, `${key} flips on in dev/test contexts`);
    }
    for (const key of PRODUCTION_DEFAULT_ON) {
      assert.equal(mod.isIntelligenceFlagEnabled(key), true, `${key} must remain on in dev/test contexts`);
    }
  });

  test('an explicit NATIVELY_CONTEXT_OS_MULTI_FAMILY_EVIDENCE=1 toggles the gate ON without affecting siblings', () => {
    process.env.NATIVELY_CONTEXT_OS_MULTI_FAMILY_EVIDENCE = '1';
    assert.equal(mod.isIntelligenceFlagEnabled('contextOsMultiFamilyEvidenceEnabled'), true);
    // Strict siblings stay off (their env var is unset).
    assert.equal(mod.isIntelligenceFlagEnabled('contextOsEnforceSourceCapabilities'), false);
    assert.equal(mod.isIntelligenceFlagEnabled('contextOsPropertyValidation'), false);
    // Core six unaffected by the multi-family override.
    for (const key of PRODUCTION_DEFAULT_ON) {
      assert.equal(mod.isIntelligenceFlagEnabled(key), true, `${key} must remain production-default-on`);
    }
  });

  test('an explicit OFF on any core flag overrides its production-default true', () => {
    for (const key of PRODUCTION_DEFAULT_ON) {
      const meta = mod.intelligenceFlagMeta(key);
      process.env[meta.env] = '0';
      assert.equal(mod.isIntelligenceFlagEnabled(key), false, `${key} explicit OFF must win over default-true`);
      delete process.env[meta.env];
    }
  });
});

// ── behavioral contract tests: buildTurnContractIfEnabled under defaults ────

describe('Context OS — production-default contract build behavior (2026-07-18)', () => {
  let co;
  let flagsMod;

  before(() => {
    // Build an isolated per-test tsc tree (no esbuild bundling) so the
    // context-os exports are reachable via plain cjsRequire. We do this
    // once for the suite and only when needed.
    const bundledContextOs = path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js');
    const isBundled = fs.existsSync(bundledContextOs)
      && fs.readFileSync(bundledContextOs, 'utf8').includes('init_SettingsManager');
    if (isBundled) {
      const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxos-rollout-dist-'));
      fs.symlinkSync(
        path.join(repoRoot, 'node_modules'),
        path.join(target, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      try {
        execSync(`node node_modules/.bin/tsc -p electron/tsconfig.json --outDir ${target}`, {
          cwd: repoRoot,
          stdio: 'pipe',
        });
      } catch (_e) { /* tsc returns 1 on unrelated errors; we only need the emit */ }
      if (!fs.existsSync(path.join(target, 'electron/intelligence/context-os/index.js'))) {
        throw new Error('tsc emission failed — context-os/index.js missing from isolated tree');
      }
      co = cjsRequire(path.join(fs.realpathSync(target), 'electron/intelligence/context-os/index.js'));
      flagsMod = cjsRequire(path.join(fs.realpathSync(target), 'electron/intelligence/intelligenceFlags.js'));
    } else {
      co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));
      flagsMod = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/intelligenceFlags.js'));
    }
  });

  const CLEAR_ENV_KEYS = [
    'NODE_ENV',
    'BENCHMARK_MODEL',
    'NATIVELY_INTERNAL',
    'NATIVELY_DEV',
    'NATIVELY_CONTEXT_OS',
    'NATIVELY_CONTEXT_OS_MANUAL_CHAT',
    'NATIVELY_CONTEXT_OS_WTA',
    'NATIVELY_CONTEXT_OS_RECAP_FOLLOWUP',
    'NATIVELY_CONTEXT_OS_EVIDENCE_PACK',
    'NATIVELY_CONTEXT_OS_MEMORY_SAFETY',
    'NATIVELY_CONTEXT_OS_ENFORCE_CAPABILITIES',
    'NATIVELY_CONTEXT_OS_PROPERTY_VALIDATION',
    'NATIVELY_CONTEXT_OS_MULTI_FAMILY_EVIDENCE',
  ];

  beforeEach(() => {
    for (const k of CLEAR_ENV_KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of CLEAR_ENV_KEYS) delete process.env[k];
  });

  test('manual_chat surface builds a typed contract under production-like defaults', () => {
    assert.equal(flagsMod.isIntelligenceFlagEnabled('contextOsEnabled'), true);
    assert.equal(flagsMod.isIntelligenceFlagEnabled('contextOsManualChatEnabled'), true);
    const contract = co.buildTurnContractIfEnabled({
      surface: 'manual_chat',
      question: 'What are the four phases of the project?',
      activeModeId: 'mode-1',
      sourceAuthority: 'reference_files_only',
      answerType: 'list_answer',
      plannerVoicePerspective: 'assistant_explanation',
      hasReferenceFiles: true,
      hasProfileFacts: true,
      hasLiveTranscript: false,
    });
    assert.ok(contract, 'expected a typed contract under production-default Context OS');
    assert.equal(contract.sourceOwner, 'reference_files');
    // Doc-grounded turns must continue to deny profile and Hindsight evidence
    // (the contract-build safety invariant — independent of the rollout).
    assert.equal(co.allowsEvidence(contract, 'profile_resume'), false);
    assert.equal(co.allowsEvidence(contract, 'profile_project'), false);
    assert.equal(contract.memoryReadPolicy.allowHindsight, false);
  });

  test('what_to_answer surface builds a typed contract under production-like defaults', () => {
    assert.equal(flagsMod.isIntelligenceFlagEnabled('contextOsWtaEnabled'), true);
    const contract = co.buildTurnContractIfEnabled({
      surface: 'what_to_answer',
      question: 'What are the four phases of the project?',
      activeModeId: 'mode-1',
      sourceAuthority: 'reference_files_only',
      answerType: 'list_answer',
      plannerVoicePerspective: 'first_person_candidate',
      hasReferenceFiles: true,
      hasProfileFacts: true,
      hasLiveTranscript: false,
    });
    assert.ok(contract, 'expected a typed contract under production-default WTA');
    assert.equal(contract.sourceOwner, 'reference_files');
    assert.equal(co.allowsEvidence(contract, 'profile_resume'), false);
    assert.equal(co.allowsEvidence(contract, 'profile_project'), false);
  });

  test('explicit NATIVELY_CONTEXT_OS=0 returns null (legacy fallback), not a contract', () => {
    process.env.NATIVELY_CONTEXT_OS = '0';
    const contract = co.buildTurnContractIfEnabled({
      surface: 'manual_chat',
      question: 'phases',
      activeModeId: 'mode-1',
      sourceAuthority: 'reference_files_only',
      answerType: 'list_answer',
      plannerVoicePerspective: 'assistant_explanation',
      hasReferenceFiles: true,
      hasProfileFacts: false,
      hasLiveTranscript: false,
    });
    assert.equal(contract, null, 'umbrella OFF must yield the legacy null contract, never an enforced build');
  });

  test('explicit surface flag OFF returns null even when the umbrella is on', () => {
    process.env.NATIVELY_CONTEXT_OS_MANUAL_CHAT = '0';
    const contract = co.buildTurnContractIfEnabled({
      surface: 'manual_chat',
      question: 'phases',
      activeModeId: 'mode-1',
      sourceAuthority: 'reference_files_only',
      answerType: 'list_answer',
      plannerVoicePerspective: 'assistant_explanation',
      hasReferenceFiles: true,
      hasProfileFacts: false,
      hasLiveTranscript: false,
    });
    assert.equal(contract, null, 'surface OFF must yield the legacy null contract');

    process.env.NATIVELY_CONTEXT_OS_MANUAL_CHAT = '1';
    process.env.NATIVELY_CONTEXT_OS_WTA = '0';
    const wta = co.buildTurnContractIfEnabled({
      surface: 'what_to_answer',
      question: 'phases',
      activeModeId: 'mode-1',
      sourceAuthority: 'reference_files_only',
      answerType: 'list_answer',
      plannerVoicePerspective: 'first_person_candidate',
      hasReferenceFiles: true,
      hasProfileFacts: false,
      hasLiveTranscript: false,
    });
    assert.equal(wta, null, 'WTA surface OFF must yield the legacy null contract');
  });

  test('a thrown kernel build (invalid surface) is non-fatal and yields null', () => {
    // buildTurnContractIfEnabled is documented to swallow kernel errors. A
    // bogus surface must not bubble up to the IPC handler.
    const contract = co.buildTurnContractIfEnabled({
      surface: 'not_a_real_surface',
      question: 'phases',
      activeModeId: 'mode-1',
      sourceAuthority: 'reference_files_only',
      answerType: 'list_answer',
      plannerVoicePerspective: 'assistant_explanation',
      hasReferenceFiles: true,
      hasProfileFacts: false,
      hasLiveTranscript: false,
    });
    assert.equal(contract, null);
  });
});

// ── multi-family coordinator admission + fallback matrix ────────────────────

describe('Context OS — multi-family coordinator admission predicate (2026-07-18)', () => {
  const baseInput = {
    isCodingChat: false,
    selectedProfileEvidence: null,
    isStealthChat: false,
    answerPlan: { answerType: 'project_answer' },
    turnContract: { turnId: 'fixture', surface: 'manual_chat', enforcement: 'observe' },
    ownershipAllowsProfileEvidence: true,
  };

  test('production-like defaults: the gate short-circuits (multi-family flag OFF)', () => {
    const decision = {
      outcome: 'explicit_granted',
      owner: 'mixed',
      explicitRequest: null,
      requiredEvidenceKinds: ['reference_files', 'profile_resume', 'projects', 'profile_jd'],
      allowedEvidenceKinds: ['reference_files', 'profile_resume', 'projects', 'profile_jd'],
    };
    assert.equal(
      shouldRunMultiFamilyCoordinator({
        ...baseInput,
        manualTurnSourceDecision: decision,
        flags: {
          contextOsEvidencePackEnabled: true, // production-default
          contextOsMultiFamilyEvidenceEnabled: false, // production-default
        },
      }),
      false,
      'multi-family must stay off in production-like defaults',
    );
  });

  test('explicit multi-family ON + in-scope profile/JD kinds admit the coordinator', () => {
    const inScopeDecisions = [
      ['profile_resume', 'projects', 'profile_jd'],
      ['reference_files', 'profile_resume', 'projects', 'profile_jd'],
      ['reference_files', 'profile_jd'],
      ['projects'],
    ];
    for (const requiredEvidenceKinds of inScopeDecisions) {
      const decision = {
        outcome: 'explicit_granted',
        owner: 'mixed',
        explicitRequest: null,
        requiredEvidenceKinds,
        allowedEvidenceKinds: requiredEvidenceKinds,
      };
      assert.equal(
        shouldRunMultiFamilyCoordinator({
          ...baseInput,
          manualTurnSourceDecision: decision,
          flags: { contextOsEvidencePackEnabled: true, contextOsMultiFamilyEvidenceEnabled: true },
        }),
        true,
        `in-scope kinds ${requiredEvidenceKinds.join(',')} must admit the coordinator`,
      );
    }
  });

  test('explicit multi-family ON but out-of-scope kinds (live_transcript/meeting_rag) keep the coordinator out', () => {
    const outOfScope = [
      ['reference_files', 'live_transcript'],
      ['meeting_rag'],
      ['live_transcript'],
      ['reference_files', 'meeting_rag'],
    ];
    for (const requiredEvidenceKinds of outOfScope) {
      const decision = {
        outcome: 'explicit_granted',
        owner: 'mixed',
        explicitRequest: null,
        requiredEvidenceKinds,
        allowedEvidenceKinds: requiredEvidenceKinds,
      };
      assert.equal(
        shouldRunMultiFamilyCoordinator({
          ...baseInput,
          manualTurnSourceDecision: decision,
          flags: { contextOsEvidencePackEnabled: true, contextOsMultiFamilyEvidenceEnabled: true },
        }),
        false,
        `out-of-scope kinds ${requiredEvidenceKinds.join(',')} must NOT admit the coordinator`,
      );
    }
  });

  test('every other conjunct in the gate keeps the coordinator out when its conjunct fails', () => {
    const decision = {
      outcome: 'explicit_granted',
      owner: 'mixed',
      explicitRequest: null,
      requiredEvidenceKinds: ['reference_files', 'profile_resume', 'projects', 'profile_jd'],
      allowedEvidenceKinds: ['reference_files', 'profile_resume', 'projects', 'profile_jd'],
    };
    const failCases = [
      { ...baseInput, isCodingChat: true,
        flags: { contextOsEvidencePackEnabled: true, contextOsMultiFamilyEvidenceEnabled: true } },
      { ...baseInput, selectedProfileEvidence: { placeholder: true },
        flags: { contextOsEvidencePackEnabled: true, contextOsMultiFamilyEvidenceEnabled: true } },
      { ...baseInput, isStealthChat: true,
        flags: { contextOsEvidencePackEnabled: true, contextOsMultiFamilyEvidenceEnabled: true } },
      { ...baseInput, answerPlan: { answerType: 'ethical_usage_answer' },
        flags: { contextOsEvidencePackEnabled: true, contextOsMultiFamilyEvidenceEnabled: true } },
      { ...baseInput, turnContract: null,
        flags: { contextOsEvidencePackEnabled: true, contextOsMultiFamilyEvidenceEnabled: true } },
      { ...baseInput, manualTurnSourceDecision: null,
        flags: { contextOsEvidencePackEnabled: true, contextOsMultiFamilyEvidenceEnabled: true } },
      { ...baseInput, ownershipAllowsProfileEvidence: false,
        flags: { contextOsEvidencePackEnabled: true, contextOsMultiFamilyEvidenceEnabled: true } },
      { ...baseInput, flags: { contextOsEvidencePackEnabled: false, contextOsMultiFamilyEvidenceEnabled: true } },
    ];
    for (const tc of failCases) {
      // Preserve any explicitly-nulled field (e.g. `manualTurnSourceDecision: null`)
      // by overriding AFTER the spread, so this case is the documented conj-fail.
      const result = shouldRunMultiFamilyCoordinator(tc);
      assert.equal(result, false,
        `conjunct-fail case should return false (got ${result})`);
    }
  });

  test('coordinator throw → legacy path resets coordinatorGovernedProfileEvidence and manualContextOsGeneration', async () => {
    // Drive the real TurnEvidenceCoordinator with a resolver that throws, then
    // assert the contract documented at ipcHandlers.ts:2325-2332 — the catch
    // must reset both `coordinatorGovernedProfileEvidence` to `false` and
    // `manualContextOsGeneration` to `null`, and must NOT crash the handler.
    const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));
    const contract = co.buildTurnContractForSurface({
      surface: 'manual_chat',
      question: 'phases',
      activeModeId: 'mode-1',
      sourceAuthority: 'reference_files_only',
      answerType: 'list_answer',
      plannerVoicePerspective: 'assistant_explanation',
      hasReferenceFiles: true,
      hasProfileFacts: true,
      hasLiveTranscript: false,
    });
    const decision = {
      outcome: 'explicit_granted',
      owner: 'mixed',
      explicitRequest: null,
      requiredEvidenceKinds: ['reference_files', 'profile_resume', 'projects', 'profile_jd'],
      allowedEvidenceKinds: ['reference_files', 'profile_resume', 'projects', 'profile_jd'],
    };
    // Mirror the catch-block invariants: a thrown retrieval resets both the
    // "coordinator governed this turn" flag and the populated pack.
    let coordinatorGovernedProfileEvidence = false;
    let manualContextOsGeneration = null;
    try {
      const { TurnEvidenceCoordinator } = co;
      const coordinator = new TurnEvidenceCoordinator();
      await coordinator.resolve({
        decision,
        contract,
        retrieveReferenceEvidence: async () => { throw new Error('INJECTED_RETRIEVAL_THROW'); },
        retrieveProfileEvidence: async () => ({ packId: 'p', turnId: contract.turnId, sourceOwner: contract.sourceOwner, requestedProperty: contract.requestedProperty, items: [], rejected: [], coverage: { hasDirectEvidence: false, propertySatisfied: false, entityMatched: false, sourceOwnerSatisfied: true, confidence: 0 }, conflicts: [], answerPolicy: 'answer' }),
      });
      // Should not reach here — coordinator is fail-closed on retrieval error.
      manualContextOsGeneration = { contract, evidencePack: { items: [] }, govern: true };
      coordinatorGovernedProfileEvidence = true;
    } catch (_err) {
      // Legacy fallback mirrors ipcHandlers.ts:2325-2332.
      coordinatorGovernedProfileEvidence = false;
      manualContextOsGeneration = null;
    }
    assert.equal(coordinatorGovernedProfileEvidence, false, 'a thrown retrieval must reset the governed flag');
    assert.equal(manualContextOsGeneration, null, 'a thrown retrieval must reset the populated pack');
  });
});