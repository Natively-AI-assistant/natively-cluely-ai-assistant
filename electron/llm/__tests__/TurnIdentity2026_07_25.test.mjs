// electron/llm/__tests__/TurnIdentity2026_07_25.test.mjs
//
// Phase 6 Slice 1 (context-rebuild): behavioral tests for
// electron/llm/turnIdentity.ts — the formal (TurnId, AttemptId) identity
// introduced to replace the ad hoc per-sender streamId supersession check.
// mintTurnId and isCurrentAttempt are genuinely exported, pure functions, so
// they are tested directly here (not source-pinned) — the ipcHandlers.ts
// wiring that CONSUMES them (the `_isCurrentStream` shared predicate at 13
// guard sites) is covered separately in
// GuardSiteAttemptParity2026_07_25.test.mjs, since ipcHandlers.ts's own
// local helper is not independently importable (established convention,
// see ManualEvidenceRepairEnforcement2026_07_05.test.mjs's header).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mintTurnId, isCurrentAttempt } from '../../../dist-electron/electron/llm/turnIdentity.js';

describe('mintTurnId', () => {
  test('returns a non-empty string', () => {
    const id = mintTurnId();
    assert.equal(typeof id, 'string');
    assert.ok(id.length > 0);
  });

  test('two mints are never equal', () => {
    assert.notEqual(mintTurnId(), mintTurnId());
  });
});

describe('isCurrentAttempt', () => {
  test('true when currentAttemptId strictly equals attemptId', () => {
    assert.equal(isCurrentAttempt(5, 5), true);
  });

  test('false when currentAttemptId is a DIFFERENT (superseding) value', () => {
    assert.equal(isCurrentAttempt(6, 5), false);
    assert.equal(isCurrentAttempt(4, 5), false);
  });

  test('false when currentAttemptId is null or undefined (no attempt registered yet)', () => {
    assert.equal(isCurrentAttempt(null, 1), false);
    assert.equal(isCurrentAttempt(undefined, 1), false);
  });
});
