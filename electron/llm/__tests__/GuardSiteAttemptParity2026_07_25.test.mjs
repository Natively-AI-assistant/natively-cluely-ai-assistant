// electron/llm/__tests__/GuardSiteAttemptParity2026_07_25.test.mjs
//
// Phase 6 Slice 1 (context-rebuild, docs/context-rebuild/05_MIGRATION_PLAN.md
// "Slice 1"): the 13 `_chatStreamsBySender.get(senderId)?.streamId
// !==/=== myStreamId` guard sites in ipcHandlers.ts's manual-chat streaming
// handler now all call ONE shared local predicate, `_isCurrentStream`,
// instead of repeating the raw comparison — "one shared predicate called at
// 13 distinct sites," per the migration plan's own (reviewer-corrected)
// framing, not a single chokepoint the 13 sites collapse into.
//
// `_isCurrentStream` is a function-local helper inside ipcHandlers.ts's main
// setup function — not independently importable (established convention:
// ipcHandlers.ts's IPC wiring is not unit-testable in isolation, see
// ManualEvidenceRepairEnforcement2026_07_05.test.mjs's header). This file is
// therefore source-pinned:
//   1. asserts `_isCurrentStream`'s body still returns the LEGACY streamId
//      comparison as production behavior (so this refactor is provably
//      behavior-preserving), and additionally consults the new
//      isCurrentAttempt/turnIdentityV2 parity check without gating the
//      return value on it;
//   2. asserts the map value type carries `attemptId` alongside `streamId`,
//      and the `.set()` call actually populates it;
//   3. asserts ALL 13 known guard sites now call `_isCurrentStream(...)`,
//      AND that ZERO raw `_chatStreamsBySender.get(senderId)?.streamId`
//      comparisons remain anywhere in the file — this second assertion is
//      what gives per-site coverage equivalent to the migration plan's
//      "one supersede + one current case per site" (26 assertions): a
//      missed or reverted site would leave a raw comparison behind, and
//      this regex catches it directly rather than by sampling.
//
// The per-VALUE behavior of the check itself (both polarities, null map
// entry) is covered behaviorally in TurnIdentity2026_07_25.test.mjs against
// the real, independently-exported `isCurrentAttempt` — this file only pins
// that ipcHandlers.ts's 13 sites and the map's shape are wired to use it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcSrc = readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

describe('_chatStreamsBySender map carries attemptId alongside streamId', () => {
  test('the map value type declares both streamId and attemptId', () => {
    assert.match(
      ipcSrc,
      /const _chatStreamsBySender = new Map<number, \{ streamId: number; attemptId: AttemptId; controller: AbortController \}>\(\);/,
    );
  });

  test('the .set() call populates attemptId (from the same counter as streamId)', () => {
    assert.match(ipcSrc, /const myAttemptId: AttemptId = myStreamId;/);
    assert.match(
      ipcSrc,
      /_chatStreamsBySender\.set\(senderId, \{ streamId: myStreamId, attemptId: myAttemptId, controller: myController \}\);/,
    );
  });
});

describe('_isCurrentStream is the one shared predicate, and preserves legacy behavior', () => {
  const fnStart = ipcSrc.indexOf('function _isCurrentStream(');
  const fnEnd = ipcSrc.indexOf('\n  }', fnStart) + 4;
  const fnBody = ipcSrc.slice(fnStart, fnEnd);

  test('the helper exists and is isolated correctly', () => {
    assert.ok(fnStart >= 0, '_isCurrentStream should exist');
    assert.ok(fnEnd > fnStart, '_isCurrentStream body should be isolated');
  });

  test('the returned value is the LEGACY streamId comparison — production behavior is unchanged', () => {
    assert.match(fnBody, /const legacyResult = entry\?\.streamId === myStreamId;/);
    assert.match(fnBody, /return legacyResult;/);
  });

  test('the new isCurrentAttempt/turnIdentityV2 check runs in PARALLEL (dev/test warn-only), never gating the return value', () => {
    assert.match(fnBody, /isIntelligenceFlagEnabled\('turnIdentityV2'\)/);
    assert.match(fnBody, /isCurrentAttempt\(entry\?\.attemptId, myAttemptId\)/);
    assert.match(fnBody, /console\.warn\(/);
    // The only `return` in the body must be the legacy one asserted above —
    // confirms the parity check cannot influence the accept/reject decision.
    const returnCount = (fnBody.match(/\breturn\b/g) || []).length;
    assert.equal(returnCount, 1, '_isCurrentStream must have exactly one return statement (the legacy result)');
  });
});

describe('all 13 known guard sites call _isCurrentStream; zero raw comparisons remain', () => {
  test('exactly 13 call sites use _isCurrentStream(senderId, myStreamId, myAttemptId)', () => {
    const matches = ipcSrc.match(/_isCurrentStream\(senderId, myStreamId, myAttemptId\)/g) || [];
    // 13 guard sites + 1 inside _isCurrentStream's own name in the function
    // declaration is NOT matched by this call-shape regex (the declaration
    // is `function _isCurrentStream(senderId: number, ...)`, a different
    // shape), so this count should be exactly the 13 call sites.
    assert.equal(matches.length, 13, `expected exactly 13 call sites, found ${matches.length}`);
  });

  test('zero raw _chatStreamsBySender.get(senderId)?.streamId comparisons remain anywhere in the file', () => {
    assert.doesNotMatch(
      ipcSrc,
      /_chatStreamsBySender\.get\(senderId\)\?\.streamId\s*(?:!==|===)\s*myStreamId/,
      'every raw comparison must have been replaced by a call to the shared _isCurrentStream predicate',
    );
  });
});
