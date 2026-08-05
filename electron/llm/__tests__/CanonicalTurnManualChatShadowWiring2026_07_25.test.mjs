// electron/llm/__tests__/CanonicalTurnManualChatShadowWiring2026_07_25.test.mjs
//
// Phase 6 Slice 3 (context-rebuild, "riskiest slice"): source-pinned tests
// for ipcHandlers.ts's SHADOW-ONLY resolveCanonicalTurn wiring on manual
// chat. Not independently unit-testable (ipcHandlers.ts's IPC wiring is not
// unit-testable in isolation, established convention — see
// ManualEvidenceRepairEnforcement2026_07_05.test.mjs's header). This file
// pins the SAFETY invariants that make this wiring low-risk despite being
// the plan's own named "riskiest slice":
//   1. gated behind the canonicalTurnManualChat flag (dev/test-only default)
//   2. wrapped in try/catch (a failure cannot break the real chat path)
//   3. the shadow call's result is used ONLY for divergence logging — never
//      assigned to answerPlan/manualSourceContract/manualTurnSourceDecision,
//      the fields the real generation path actually consumes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcSrc = readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

describe('CanonicalTurn manual-chat shadow wiring safety invariants', () => {
  const blockStart = ipcSrc.indexOf('// ── CANONICAL TURN on manual chat (Phase 6 Slice 3');
  const blockEnd = ipcSrc.indexOf('// ── CONTEXT OS (Phase 7, 2026-07-10)', blockStart);
  const block = ipcSrc.slice(blockStart, blockEnd);

  test('the shadow block exists and is isolated correctly', () => {
    assert.ok(blockStart >= 0, 'expected the CanonicalTurn shadow-wiring block to exist');
    assert.ok(blockEnd > blockStart, 'expected the block to be isolated before the Context OS block');
  });

  test('the shadow call is gated behind the canonicalTurnManualChat flag', () => {
    assert.match(block, /if\s*\(isIntelligenceFlagEnabled\('canonicalTurnManualChat'\)\)\s*\{/);
  });

  test('the shadow call is wrapped in try/catch, and the catch never rethrows', () => {
    const tryIdx = block.indexOf('try {');
    const catchIdx = block.indexOf('} catch (canonicalTurnErr');
    assert.ok(tryIdx >= 0 && catchIdx > tryIdx, 'expected a try block containing resolveCanonicalTurn, followed by a catch');
    const catchBody = block.slice(catchIdx, block.indexOf('\n        }', catchIdx));
    assert.doesNotMatch(catchBody, /throw\s/, 'the catch block must not rethrow — a shadow-call failure must never break the real chat path');
  });

  test('resolveCanonicalTurn and deriveQuestionNeed are called inside the guarded block', () => {
    assert.match(block, /resolveCanonicalTurn\(\{/);
    assert.match(block, /deriveQuestionNeed\(canonicalTurn\)/);
  });

  test('the shadow result is used ONLY for divergence logging — never assigned to the real generation-path variables', () => {
    // The real path's variables are `answerPlan`, `manualSourceContract`,
    // `manualTurnSourceDecision` — none of these may be reassigned inside
    // this block (only READ, for the divergence comparison).
    assert.doesNotMatch(block, /\banswerPlan\s*=(?!=)/, 'answerPlan must never be reassigned in the shadow block');
    assert.doesNotMatch(block, /\bmanualSourceContract\s*=(?!=)/, 'manualSourceContract must never be reassigned in the shadow block');
    assert.doesNotMatch(block, /\bmanualTurnSourceDecision\s*=(?!=)/, 'manualTurnSourceDecision must never be reassigned in the shadow block');
    // It DOES read them for comparison.
    assert.match(block, /canonicalTurn\.answerPlan\.answerType\s*!==\s*answerPlan\.answerType/);
  });

  test('a divergence is logged via console.warn, never thrown or surfaced to the user', () => {
    assert.match(block, /console\.warn\('\[CanonicalTurnV2\] shadow divergence/);
  });
});
