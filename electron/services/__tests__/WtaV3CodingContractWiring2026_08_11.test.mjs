// electron/services/__tests__/WtaV3CodingContractWiring2026_08_11.test.mjs
//
// ROOT CAUSE of the live "O(?)" scaffold (natively-api, 2026-08-11).
//
// Chased backwards from the symptom: the delivered answer carried
// "Time Complexity: O(?) — state the actual time bound and why" and a generic
// dry-run line. Those are the repair's placeholders, emitted because the MODEL
// wrote no Complexity and no Dry Run section. Measured on the live answer:
// ZERO `##` headings, and it opened with a raw ```python fence.
//
// The model never disobeyed the contract — it never RECEIVED it:
//
//   * WhatToAnswerLLM builds a v2 system prompt with `codingTask` correctly set
//     from the router (WhatToAnswerLLM.ts ~:549), and that prompt carries
//     CODING_CONTRACT (the six mandatory headings, "Time Complexity: O(...),
//     because ...", the dry-run walkthrough).
//   * But when Context Intelligence V3 owns the turn, `_v3p.system` REPLACES
//     that prompt wholesale (WhatToAnswerLLM.ts:813) — and the V3 composer has
//     no coding contract of its own.
//
// So on any V3-owned coding turn the six-section instructions silently vanish,
// the model answers code-first prose, and the downstream repair paints
// placeholders into the sections the model was never asked for.
//
// The bridge already anticipated exactly this: `BridgeInput.personaBase` is a
// `(ctx: { codingTask: boolean }) => string | null` hook, documented as "the
// same semantic-activation contract Prompt System v2 uses everywhere else",
// and the manual-chat path in ipcHandlers already supplies it. The WTA path
// simply never did.
//
// These tests pin the wiring, so a V3-owned coding turn cannot lose the
// contract again.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(__dirname, '../../IntelligenceEngine.ts');
const BRIDGE = path.resolve(__dirname, '../../context-intelligence/orchestration/engine-bridge.ts');
const IPC = path.resolve(__dirname, '../../ipcHandlers.ts');

const engineSrc = fs.readFileSync(ENGINE, 'utf8');
const bridgeSrc = fs.readFileSync(BRIDGE, 'utf8');
const ipcSrc = fs.readFileSync(IPC, 'utf8');

describe('the V3 bridge still offers the coding-contract hook', () => {
  test('BridgeInput exposes personaBase({ codingTask })', () => {
    assert.match(
      bridgeSrc,
      /personaBase\?:\s*\(ctx:\s*\{\s*codingTask:\s*boolean\s*\}\)\s*=>\s*string\s*\|\s*null/,
      'the bridge hook this fix depends on was removed or renamed',
    );
  });

  test('the bridge prefers the caller\'s routed codingTask over its keyword check', () => {
    // Superseded by CodingTaskFromRouter2026_08_11: this originally asserted the
    // questionTypes/CODING_TASK derivation. Dumping the composed prompt proved
    // that keyword list misses ordinary questions ("Write a BFS shortest-path
    // function…"), silently dropping the coding contract. The routed verdict now
    // wins, with the regex kept only as the fallback for callers that pass none.
    assert.match(
      bridgeSrc,
      /codingTask:\s*input\.codingTask\s*\?\?[\s\S]{0,160}?CODING_TASK/,
      'the bridge must prefer input.codingTask, falling back to the keyword check',
    );
  });

  test('the manual-chat path supplies personaBase (the precedent)', () => {
    assert.match(ipcSrc, /personaBase:\s*\(\{\s*codingTask\s*\}/, 'manual chat should still pass personaBase');
  });
});

describe('the WTA path supplies the coding contract to V3', () => {
  // The WTA buildV3Prompt call site. Without personaBase, a V3-owned coding
  // turn ships a system prompt with no six-section contract at all.
  // Bound the slice by the NEXT statement rather than a fixed character count —
  // the call is long (evidence wiring, retrieval port, conversation window) and
  // a fixed window silently truncated it before `personaBase`.
  const callStart = engineSrc.indexOf('const wtaV3Prompt = await');
  const callEnd = engineSrc.indexOf('const requestSnapshot', callStart);
  assert.ok(callStart > 0 && callEnd > callStart, 'could not locate the WTA buildV3Prompt call site');
  const wtaCall = engineSrc.slice(callStart, callEnd);

  test('WTA passes personaBase into buildV3Prompt', () => {
    assert.ok(
      /personaBase\s*:/.test(wtaCall),
      'WTA\'s buildV3Prompt call must pass personaBase so a V3-owned coding turn keeps the contract',
    );
  });

  test('the persona it supplies is coding-aware', () => {
    assert.ok(
      /codingTask/.test(wtaCall),
      'the persona closure must branch on codingTask — that is what attaches the contract',
    );
  });

  test('it resolves through the shared v2 prompt system, not a hand-rolled string', () => {
    // resolveV2SystemPrompt is the single source that injects CODING_CONTRACT;
    // duplicating the contract text here would let the two drift apart.
    assert.ok(
      /resolveV2SystemPrompt/.test(wtaCall),
      'the contract must come from resolveV2SystemPrompt, never a copied literal',
    );
  });
});
