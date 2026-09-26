// electron/services/__tests__/ModePinnedResolution.test.mjs
//
// Audit finding #6 — ModesManager.resolveMode(pinnedModeId) is the pin that lets
// the live answer path read the SAME mode the answer was planned from (the
// WhatToAnswerRequestSnapshot's modeUniqueId), even if `modes:set-active` flips
// the active mode while the request is parked at an await. This proves:
//   - a pinned id wins over the (possibly switched) live active mode,
//   - a deleted pinned id falls back to the active mode,
//   - no pin → live active mode (every existing caller, behavior unchanged),
//   - the prompt-suffix / pinned-instructions builders forward the pinned id.
//
// resolveMode references only this.getModes()/this.getActiveMode(), so we test it
// on a hand-built `this` via prototype-apply (the class ctor needs Electron's DB).
// Run under the Electron ABI so the import graph resolves like production:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/services/ModesManager.js');
const { ModesManager } = await import(pathToFileURL(modPath).href);

const TI = { id: 'mode_ti', templateType: 'technical-interview', name: 'TI', customContext: '', isActive: true, createdAt: '' };
const SALES = { id: 'mode_sales', templateType: 'general', name: 'Sales', customContext: 'Pitch hard.', isActive: false, createdAt: '' };

function ctxWith(activeMode, modes) {
  return {
    getActiveMode: () => activeMode,
    getModes: () => modes,
  };
}

describe('ModesManager.resolveMode (audit finding #6)', () => {
  test('no pinned id → returns the live active mode (unchanged behavior)', () => {
    const ctx = ctxWith(TI, [TI, SALES]);
    const mode = ModesManager.prototype.resolveMode.call(ctx, undefined);
    assert.equal(mode.id, 'mode_ti');
  });

  test('pinned id wins over the live active mode (the mid-request-switch guard)', () => {
    // Live active mode is SALES (a switch happened mid-request), but the request
    // was planned with TI pinned → resolveMode must return TI.
    const ctx = ctxWith(SALES, [TI, SALES]);
    const mode = ModesManager.prototype.resolveMode.call(ctx, 'mode_ti');
    assert.equal(mode.id, 'mode_ti', 'pinned mode must win over the switched-to active mode');
  });

  test('pinned id that no longer exists (deleted mid-request) falls back to active', () => {
    const ctx = ctxWith(SALES, [SALES]);
    const mode = ModesManager.prototype.resolveMode.call(ctx, 'mode_ti_deleted');
    assert.equal(mode.id, 'mode_sales', 'deleted pinned mode → fall back to active');
  });

  test('no active mode and no pin → null', () => {
    const ctx = ctxWith(null, []);
    const mode = ModesManager.prototype.resolveMode.call(ctx, undefined);
    assert.equal(mode, null);
  });
});

describe('the prompt builders forward the pinned id to resolveMode (source guard)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../ModesManager.ts'), 'utf8');

  test('suffix / pinned-instructions / retrieval (sync + hybrid) all take + use pinnedModeId', () => {
    assert.match(src, /getActiveModeSystemPromptSuffix\(pinnedModeId\?: string\)/);
    assert.match(src, /getActiveModePinnedInstructions\(answerType\?: AnswerType, pinnedModeId\?: string\)/);
    // pinnedModeId is present; trailing params (retrievalOptions?:
    // ModeRetrievalOptions — round-6) may follow it, so don't require it to be
    // the LAST param.
    assert.match(src, /buildRetrievedActiveModeContextBlock\([^)]*pinnedModeId\?: string(,\s*\w+\?:[^)]*)?\)/);
    // Hybrid takes pinnedModeId; trailing `allowRerank?: boolean` (Phase 1
    // smart-retrieval) and/or other params may follow it.
    assert.match(src, /buildRetrievedActiveModeContextBlockHybrid\([^)]*pinnedModeId\?: string(,\s*[^)]*)?\)/);
    // Each must resolve via the pin, not a bare getActiveMode().
    const suffix = src.slice(src.indexOf('getActiveModeSystemPromptSuffix(pinnedModeId'));
    assert.match(suffix.slice(0, 200), /this\.resolveMode\(pinnedModeId\)/);
  });

  test('the hybrid lexical fallback forwards the same pinned id', () => {
    // Inside buildRetrievedActiveModeContextBlockHybrid, the lexical fallback must
    // pass pinnedModeId through so the fallback path pins the same mode.
    // The fallback forwards pinnedModeId; a trailing retrievalOptions arg
    // (round-6) may follow it.
    assert.match(src, /buildRetrievedActiveModeContextBlock\(\s*query, transcript, tokenBudget, answerType, excludeCustomContext, pinnedModeId(, retrievalOptions)?\s*\)/);
  });
});
