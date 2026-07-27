// electron/llm/__tests__/ImpossibleStateGateShadowWiring2026_07_28.test.mjs
//
// Answer-pipeline-rebuild Phase 2 (docs/answer-pipeline-rebuild/
// 03_EVIDENCEPACK_DESIGN.md) — source-pinned tests for ipcHandlers.ts's
// SHADOW-ONLY impossible-evidence-state gate wiring on manual chat. Not
// independently unit-testable (ipcHandlers.ts's IPC wiring is not
// unit-testable in isolation, established convention — see
// ManualEvidenceRepairEnforcement2026_07_05.test.mjs's header, and mirrors
// CanonicalTurnManualChatShadowWiring2026_07_25.test.mjs's approach for the
// same class of shadow-only wiring). Pins the safety invariants that make
// this wiring low-risk:
//   1. gated behind the contextOsImpossibleStateGateShadow flag (dev/test-
//      only default) AND requires turnContract to already be non-null
//   2. wrapped in its own try/catch (a failure cannot break the real chat
//      path, nor the turnContract build it sits right after)
//   3. the shadow check's result is used ONLY for divergence logging — never
//      assigned to context/turnContract/answerPlan, the variables the real
//      generation path actually consumes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcSrc = readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

describe('impossible-evidence-state gate shadow wiring safety invariants', () => {
  const blockStart = ipcSrc.indexOf('// IMPOSSIBLE-EVIDENCE-STATE GATE, Stage 0');
  const blockEnd = ipcSrc.indexOf('// Real-custom-mode-repair (2026-07-11), Phase 4/7', blockStart);
  const block = ipcSrc.slice(blockStart, blockEnd);

  test('the shadow block exists and is isolated correctly', () => {
    assert.ok(blockStart >= 0, 'expected the impossible-evidence-state shadow block to exist');
    assert.ok(blockEnd > blockStart, 'expected the block to be isolated before the pre-existing trace comment that follows it');
  });

  test('the shadow call is gated behind turnContract being non-null AND the contextOsImpossibleStateGateShadow flag', () => {
    assert.match(block, /if\s*\(turnContract\s*&&\s*isIntelligenceFlagEnabled\('contextOsImpossibleStateGateShadow'\)\)\s*\{/);
  });

  test('the shadow call is wrapped in its own try/catch, and the catch never rethrows', () => {
    const tryIdx = block.indexOf('try {');
    const catchIdx = block.indexOf('} catch (shadowGateErr');
    assert.ok(tryIdx >= 0 && catchIdx > tryIdx, 'expected a try block containing the shadow check, followed by a catch');
    const catchBody = block.slice(catchIdx, block.indexOf('\n            }', catchIdx));
    assert.doesNotMatch(catchBody, /throw\s/, 'the catch block must not rethrow — a shadow-check failure must never break the real chat path');
  });

  test('ProfileEvidenceService.retrieveEvidence and checkImpossibleEvidenceState are called inside the guarded block', () => {
    assert.match(block, /new ProfileEvidenceService\(\)\.retrieveEvidence\(\{/);
    assert.match(block, /checkImpossibleEvidenceState\(shadowPack, answerPlan\.profileContextPolicy\)/);
  });

  test('the shadow result is used ONLY for divergence logging — never assigned to the real generation-path variables', () => {
    // The real path's variables are `context` (the assembled prompt),
    // `turnContract`, and `answerPlan` — none of these may be reassigned
    // inside this block (only READ, to build the shadow pack / compare).
    assert.doesNotMatch(block, /\bcontext\s*=(?!=)/, 'context (the real prompt) must never be reassigned in the shadow block');
    assert.doesNotMatch(block, /\bturnContract\s*=(?!=)/, 'turnContract must never be reassigned in the shadow block');
    assert.doesNotMatch(block, /\banswerPlan\s*=(?!=)/, 'answerPlan must never be reassigned in the shadow block');
  });

  test('a violation is logged via console.warn, never thrown or surfaced to the user', () => {
    assert.match(block, /console\.warn\('\[IMPOSSIBLE-STATE-GATE-SHADOW\] violation/);
  });

  test('violation and agreement logs both carry turnId/packId for post-hoc ground-truth correlation', () => {
    assert.match(block, /turnId:\s*shadowPack\.turnId/);
    assert.match(block, /packId:\s*shadowPack\.packId/);
  });

  test('an agreement is logged only under the separate trace flag, not unconditionally (avoid log spam)', () => {
    assert.match(block, /else if\s*\(isIntelligenceFlagEnabled\('trace'\)\)\s*\{\s*\n\s*console\.log\('\[IMPOSSIBLE-STATE-GATE-SHADOW\] agreement/);
  });
});
