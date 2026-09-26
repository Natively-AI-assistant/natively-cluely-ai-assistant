// electron/llm/__tests__/ImpossibleStateGateEnforceForbiddenWiring2026_07_28.test.mjs
//
// Answer-pipeline-rebuild Phase 2 (docs/answer-pipeline-rebuild/
// 03_EVIDENCEPACK_DESIGN.md) — source-pinned tests for ipcHandlers.ts's
// Stage 1 ENFORCEMENT wiring (forbidden-direction only). Not independently
// unit-testable (ipcHandlers.ts's IPC wiring is not unit-testable in
// isolation — see ManualEvidenceRepairEnforcement2026_07_05.test.mjs's
// header). Mirrors ImpossibleStateGateShadowWiring2026_07_28.test.mjs's
// approach for Stage 0. Pins the safety invariants that make this the first
// safe REAL behavior change in the design's staged rollout:
//   1. gated behind the contextOsImpossibleStateGateEnforceForbidden flag,
//      requires turnContract non-null (same shape as _contractAllowsProfile,
//      the established precedent this mirrors)
//   2. can only NARROW sourceOwnershipAllowsProfile (ANDed in), never widen it
//   3. fails OPEN (returns true) on any internal error — a gate failure must
//      never break chat
//   4. required-direction is structurally excluded: the gate calls
//      checkImpossibleEvidenceState with answerPlan.profileContextPolicy,
//      and that function never flags a 'required' policy (verified in
//      EvidencePackValidation2026_07_28.test.mjs) — so this file only needs
//      to confirm the WIRING passes the real policy through unmodified, not
//      re-derive the exclusion itself.
//   5. code-review finding (2026-07-28): check #2
//      (allowed_policy_unrelated_profile_item) has a live, reproduced
//      false-refusal path (ordinary second-person skill/experience phrasing
//      like "familiar with graphql" misclassifies as unknown_answer/allowed
//      with requestedProperty left 'unknown', suppressing a legitimate
//      high-confidence résumé skill match) that Stage 0's shadow period
//      never observed a single allowed-policy turn to validate against.
//      Enforcement is therefore filtered to check #1
//      (forbidden_policy_profile_item_present) ONLY — check #2 stays
//      shadow-only (still logged by Stage 0's block, just never enforced
//      here) until it has real allowed-policy shadow observations.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcSrc = readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

describe('impossible-evidence-state gate Stage 1 (enforce forbidden) wiring safety invariants', () => {
  const blockStart = ipcSrc.indexOf('// IMPOSSIBLE-EVIDENCE-STATE GATE, Stage 1 enforcement');
  const blockEnd = ipcSrc.indexOf('const sourceOwnershipAllowsProfile', blockStart) + 'const sourceOwnershipAllowsProfile'.length;
  const block = ipcSrc.slice(blockStart, blockEnd);
  // The narrowing itself is on the line right after the block, so widen the
  // slice by a few hundred chars to include the actual assignment.
  const assignmentSlice = ipcSrc.slice(blockEnd, blockEnd + 400);

  test('the Stage 1 block exists and precedes sourceOwnershipAllowsProfile', () => {
    assert.ok(blockStart >= 0, 'expected the Stage 1 enforcement block to exist');
    assert.ok(blockEnd > blockStart, 'expected the block to precede the sourceOwnershipAllowsProfile assignment it feeds');
  });

  test('gated behind turnContract non-null AND the contextOsImpossibleStateGateEnforceForbidden flag', () => {
    assert.match(block, /if\s*\(!turnContract\s*\|\|\s*!isIntelligenceFlagEnabled\('contextOsImpossibleStateGateEnforceForbidden'\)\)\s*return true;/);
  });

  test('fails OPEN (returns true) on any internal error', () => {
    assert.match(block, /\}\s*catch\s*\{\s*return true;\s*\}/);
  });

  test('checkImpossibleEvidenceState is called with the REAL answerPlan.profileContextPolicy (required-direction exclusion lives in that function, not re-derived here)', () => {
    assert.match(block, /checkImpossibleEvidenceState\(gatePack, answerPlan\.profileContextPolicy\)/);
  });

  test('only forbidden_policy_profile_item_present (check #1) is enforced — check #2 violations are filtered out before the block decision', () => {
    assert.match(block, /const enforceableViolations = gateResult\.violations\.filter\(\s*\n\s*\(v\) => v\.code === 'forbidden_policy_profile_item_present',\s*\n\s*\);/);
    assert.doesNotMatch(
      block,
      /if\s*\(!gateResult\.ok\)/,
      'must not gate directly on gateResult.ok — check #2 violations would then be enforced too, reviving the reproduced false-refusal risk',
    );
  });

  test('a violation returns false (narrows), and false is only ever returned inside the enforceableViolations branch', () => {
    const violationBranchIdx = block.indexOf('if (enforceableViolations.length > 0)');
    const returnFalseIdx = block.indexOf('return false;');
    assert.ok(violationBranchIdx >= 0 && returnFalseIdx > violationBranchIdx, 'expected `return false` only inside the `if (enforceableViolations.length > 0)` branch');
    // No other unconditional `return false` outside that branch.
    const returnFalseCount = (block.match(/return false;/g) || []).length;
    assert.equal(returnFalseCount, 1, 'expected exactly one `return false` in the gate, inside the violation branch');
  });

  test('the gate result is ANDed into sourceOwnershipAllowsProfile — narrows, never replaces or widens the legacy decision', () => {
    assert.match(assignmentSlice, /&&\s*_contractAllowsProfile\s*&&\s*_impossibleStateGateAllowsProfile/);
  });

  test('a blocked injection is logged only under the trace flag (not unconditionally spammed)', () => {
    assert.match(block, /if\s*\(isIntelligenceFlagEnabled\('trace'\)\)\s*\{\s*\n\s*console\.warn\('\[IMPOSSIBLE-STATE-GATE-ENFORCE\] blocked profile injection/);
  });
});
