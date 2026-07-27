// electron/llm/__tests__/ModePolicyShadowWiring2026_07_26.test.mjs
//
// Phase 6 Slice 7 follow-up (context-rebuild, 2026-07-26) — SOURCE-PINNED
// proof that ipcHandlers.ts's ModePolicy shadow-observation block (added
// right after the existing contextRouterV2 shadow block, ~line 1519) is
// wired correctly: flag-gated, guarded against a null sourceContract,
// wrapped in its own try/catch, and constructs resolveModePolicy's mode
// argument from the exact ActiveModeInfo fields it should. Mirrors
// ContextRouterShadowWiring.test.mjs's own established convention for
// pinning an ipcHandlers.ts shadow block's source shape, since ipcHandlers.ts
// itself is not independently unit-testable (established convention
// throughout this suite).
//
// This is a STRUCTURAL check, not a behavioral one — ModePolicyShadowDivergence
//2026_07_26.test.mjs already proves resolveModePolicy's real behavior against
// realistic ActiveModeInfo shapes. This file proves ipcHandlers.ts actually
// calls it the way that other file assumes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const src = readFileSync(path.resolve(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');

function blockBody() {
  const start = src.indexOf('// MODE POLICY shadow observation (Phase 6 Slice 7 follow-up,');
  assert.ok(start >= 0, 'the ModePolicy shadow-observation block must exist');
  const end = src.indexOf('\n        }\n', src.indexOf('modePolicyShadowErr'));
  assert.ok(end > start, 'must find the end of the block');
  return src.slice(start, end);
}

describe('ipcHandlers.ts ModePolicy shadow-observation block — structural wiring', () => {
  test('gated on isIntelligenceFlagEnabled(\'modePolicyShadowObservation\') AND a truthy manualActiveMode.sourceContract', () => {
    const body = blockBody();
    assert.match(body, /isIntelligenceFlagEnabled\('modePolicyShadowObservation'\)\s*&&\s*manualActiveMode\?\.sourceContract/);
  });

  test('requires ./services/modePolicy and calls resolveModePolicy — not a hand-rolled reimplementation', () => {
    const body = blockBody();
    assert.match(body, /require\('\.\/services\/modePolicy'\)/);
    assert.match(body, /resolveModePolicy\(manualActiveMode\.sourceContract,/);
  });

  test('the mode argument maps exactly the 5 ActiveModeInfo fields resolveModePolicy\'s ResolveModePolicyModeInput expects (id/name/isCustom/hasReferenceFiles/templateType)', () => {
    const body = blockBody();
    for (const field of ['id: manualActiveMode.id', 'name: manualActiveMode.name', 'isCustom: manualActiveMode.isCustom', 'hasReferenceFiles: manualActiveMode.hasReferenceFiles', 'templateType: manualActiveMode.templateType']) {
      assert.ok(body.includes(field), `expected the mode object literal to include \`${field}\``);
    }
  });

  test('compares against the LIVE manualActiveMode.documentGroundedCustomModeActive field — not a value it invents', () => {
    const body = blockBody();
    assert.match(body, /manualActiveMode\.documentGroundedCustomModeActive === true/);
  });

  test('is a pure side-channel: no assignment back into context/answerPlan/manualActiveMode/manualSourceContract/manualTurnSourceDecision, only console.warn/console.log calls and a local payload object', () => {
    const body = blockBody();
    // The only "=" assignments in this block should be to local consts
    // (modePolicy, legacyDocumentGrounded, payload) — never to any of the
    // outer-scope variables the rest of the handler reads to decide behavior.
    for (const forbidden of ['context =', 'answerPlan =', 'manualActiveMode =', 'manualSourceContract =', 'manualTurnSourceDecision =']) {
      assert.ok(!body.includes(forbidden), `the shadow block must never assign to \`${forbidden.trim().replace(/ =$/, '')}\` — that would make it a real gate, not shadow-only`);
    }
    assert.match(body, /console\.warn\('\[ModePolicyShadow\] divergence/);
    assert.match(body, /console\.log\('\[ModePolicyShadow\] agreement/);
  });

  test('wrapped in its own try/catch with a non-fatal skip log, mirroring the contextRouterV2 shadow block immediately above it', () => {
    const body = blockBody();
    assert.match(body, /catch \(modePolicyShadowErr: any\) \{/);
    assert.match(body, /shadow call skipped \(non-fatal\)/);
  });

  test('the block appears AFTER the existing contextRouterV2 shadow block\'s own catch, not interleaved with it', () => {
    const contextRouterCatchIdx = src.indexOf('/* shadow routing is observe-only; never affects the answer */');
    const modePolicyBlockIdx = src.indexOf('// MODE POLICY shadow observation');
    assert.ok(contextRouterCatchIdx >= 0 && modePolicyBlockIdx > contextRouterCatchIdx, 'the new block must be appended after the existing shadow block completes, not spliced inside it');
  });
});
