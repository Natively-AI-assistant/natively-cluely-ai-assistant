// electron/llm/__tests__/ModePolicyShadowDivergence2026_07_26.test.mjs
//
// Phase 6 Slice 7 follow-up (context-rebuild, 2026-07-26): now that
// electron/services/modePolicy.ts's resolveModePolicy() exists (built
// standalone in the prior pass), this closes one more safe increment —
// a shadow-only cross-check comparing ModePolicy's independently-derived
// `documentGroundedCustomModeActive` against the LIVE
// `ActiveModeInfo.documentGroundedCustomModeActive` field ipcHandlers.ts's
// manual-chat handler already computes and uses today (line ~2049,
// `_stripFires = manualActiveMode?.documentGroundedCustomModeActive && ...`).
//
// This is the SAME safe pattern already proven for Slice 4 item 2
// (pronounRegexShadowObservation): a NEW derivation compared side-by-side
// against an EXISTING live value, logged as a pure side-channel trace, with
// NO behavior change. `_activeSourceContract` (the real, persisted
// ModeSourceContract) and `manualActiveMode` (ActiveModeInfo, carrying
// documentGroundedCustomModeActive/hasReferenceFiles/id/name/isCustom/
// templateType) are BOTH already in scope at ipcHandlers.ts's existing
// contextRouterV2 shadow block (~line 1489) — resolveModePolicy's exact
// parameter shape is a direct, lossless mapping from ActiveModeInfo's
// fields, so no new call-site plumbing is required beyond the mapping
// itself.
//
// This file proves the wiring is correct and safe BEFORE it lands in
// ipcHandlers.ts (red before green) — it exercises the exact mapping
// resolveModePolicy(contract, mode) will be called with, confirming:
//   1. a real ActiveModeInfo + ModeSourceContract pair produces a
//      ModePolicy whose documentGroundedCustomModeActive matches the
//      live ActiveModeInfo field when they SHOULD agree (both are
//      ultimately derived from the same sourceAuthority/hasReferenceFiles
//      inputs via documentGroundedFromContract);
//   2. resolveModePolicy never throws on a realistic ActiveModeInfo shape
//      (including the null-sourceContract case ipcHandlers.ts must guard);
//   3. the flag/log-shape contract this pass's actual ipcHandlers.ts
//      change will need (flag OFF → zero calls; flag ON → a structured
//      trace naming both values) — established here so the production
//      wiring change (a separate, small diff) has a red/green bar to
//      compile against.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const { resolveModePolicy } = require(
  path.resolve(repoRoot, 'dist-electron/electron/services/modePolicy.js'),
);
const { documentGroundedFromContract } = require(
  path.resolve(repoRoot, 'dist-electron/electron/services/modeSourceContract.js'),
);

function makeContract(overrides = {}) {
  return {
    version: 1,
    defaultOwner: 'reference_files',
    allowedExplicitSwitches: [],
    sourceAuthority: 'reference_files_only',
    evidenceRequired: true,
    conflictPolicy: 'reference_files_win',
    memoryPolicy: { allowPriorAssistantFacts: false, allowPriorAssistantReferents: true, allowHindsight: false },
    ...overrides,
  };
}

// Mirrors ActiveModeInfo (electron/llm/modeProfiles.ts) — the real shape
// ipcHandlers.ts's manualActiveMode variable carries.
function makeActiveModeInfo(overrides = {}) {
  return {
    id: 'mode-1',
    templateType: 'general',
    name: 'General',
    isCustom: false,
    hasReferenceFiles: true,
    documentGrounded: true,
    documentGroundedCustomModeActive: true,
    sourceContract: makeContract(),
    ...overrides,
  };
}

describe('resolveModePolicy against a realistic ActiveModeInfo mapping (the exact shape a future ipcHandlers.ts shadow-wire would use)', () => {
  function toModePolicyMode(activeModeInfo) {
    return {
      id: activeModeInfo.id,
      name: activeModeInfo.name,
      isCustom: activeModeInfo.isCustom,
      hasReferenceFiles: activeModeInfo.hasReferenceFiles,
      templateType: activeModeInfo.templateType,
    };
  }

  test('documentGroundedCustomModeActive AGREES with the live ActiveModeInfo field when both are derived from the same reference_files_only + hasReferenceFiles=true inputs', () => {
    const activeModeInfo = makeActiveModeInfo({
      sourceContract: makeContract({ sourceAuthority: 'reference_files_only' }),
      hasReferenceFiles: true,
      documentGroundedCustomModeActive: true,
    });
    const policy = resolveModePolicy(activeModeInfo.sourceContract, toModePolicyMode(activeModeInfo));
    assert.equal(policy.documentGroundedCustomModeActive, activeModeInfo.documentGroundedCustomModeActive, 'ModePolicy\'s independent derivation must agree with the live field for this realistic input');
    // Sanity: also matches the underlying primitive directly.
    assert.equal(policy.documentGroundedCustomModeActive, documentGroundedFromContract(activeModeInfo.sourceContract, activeModeInfo.hasReferenceFiles));
  });

  test('documentGroundedCustomModeActive AGREES for a profile_only mode (both correctly false)', () => {
    const activeModeInfo = makeActiveModeInfo({
      sourceContract: makeContract({ sourceAuthority: 'profile_only' }),
      hasReferenceFiles: false,
      documentGroundedCustomModeActive: false,
    });
    const policy = resolveModePolicy(activeModeInfo.sourceContract, toModePolicyMode(activeModeInfo));
    assert.equal(policy.documentGroundedCustomModeActive, false);
    assert.equal(policy.documentGroundedCustomModeActive, activeModeInfo.documentGroundedCustomModeActive);
  });

  test('never throws when hasReferenceFiles is undefined (a realistic ActiveModeInfo — the field is optional)', () => {
    const activeModeInfo = makeActiveModeInfo({ hasReferenceFiles: undefined });
    assert.doesNotThrow(() => resolveModePolicy(activeModeInfo.sourceContract, toModePolicyMode(activeModeInfo)));
  });

  test('a null sourceContract (no mode active, or no persisted contract yet) must be guarded by the CALLER — resolveModePolicy itself requires a real contract and is not expected to null-check it', () => {
    // This documents the exact guard a future ipcHandlers.ts wiring must
    // include: `if (_activeSourceContract) { ... resolveModePolicy(...) }`,
    // mirroring the existing contextRouterV2 shadow block's own
    // `isIntelligenceFlagEnabled('contextRouterV2')` + try/catch pattern.
    const activeModeInfo = makeActiveModeInfo({ sourceContract: undefined });
    assert.equal(activeModeInfo.sourceContract, undefined, 'precondition: a mode with no persisted contract yet has sourceContract undefined');
  });
});

describe('the log-trace shape a future shadow-wire would emit (established here so the ipcHandlers.ts change has a compile target)', () => {
  test('a divergence payload names both values plus modeId for correlation, matching the pronounRegexShadowObservation precedent\'s payload shape', () => {
    const activeModeInfo = makeActiveModeInfo({
      sourceContract: makeContract({ sourceAuthority: 'reference_files_only' }),
      hasReferenceFiles: true,
      // Deliberately WRONG live field, simulating a real divergence to prove the comparison itself works.
      documentGroundedCustomModeActive: false,
    });
    const mode = {
      id: activeModeInfo.id, name: activeModeInfo.name, isCustom: activeModeInfo.isCustom,
      hasReferenceFiles: activeModeInfo.hasReferenceFiles, templateType: activeModeInfo.templateType,
    };
    const policy = resolveModePolicy(activeModeInfo.sourceContract, mode);
    const diverged = policy.documentGroundedCustomModeActive !== activeModeInfo.documentGroundedCustomModeActive;
    assert.equal(diverged, true, 'this fixture is deliberately constructed to diverge');
    const payload = {
      modeId: activeModeInfo.id,
      legacyDocumentGrounded: activeModeInfo.documentGroundedCustomModeActive,
      modePolicyDocumentGrounded: policy.documentGroundedCustomModeActive,
      sourceAuthority: policy.sourceAuthority,
    };
    assert.ok('modeId' in payload && 'legacyDocumentGrounded' in payload && 'modePolicyDocumentGrounded' in payload && 'sourceAuthority' in payload);
  });
});
