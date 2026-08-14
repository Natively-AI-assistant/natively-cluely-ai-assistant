// electron/llm/__tests__/StripPriorAssistantTurnsDedup2026_07_26.test.mjs
//
// Phase 6 Slice 2 follow-up (context-rebuild, 2026-07-26): Part 5 of Slice
// 2's STATUS note recorded that `stripPriorAssistantTurns` was moved from
// `ipcHandlers.ts` into the new `conversationHistoryPolicy.ts`, but its two
// call sites in `ipcHandlers.ts` were "not yet repointed" — leaving a
// byte-for-byte duplicate local function definition alongside the real one.
// Confirmed via diff before this change: the two function bodies were
// IDENTICAL except for the `export` keyword — this is a pure, zero-risk
// deduplication (delete dead-identical code, import the canonical copy),
// not a new decision or behavior change, unlike every other "what's left"
// item in this plan that requires a live-trace campaign.
//
// This is a SOURCE-PINNED structural test (ipcHandlers.ts is not
// independently unit-testable, established convention throughout this
// suite) proving: the local duplicate definition is gone, both call sites
// now reference the imported function, and the import itself is a real
// static import from conversationHistoryPolicy.ts (not a re-implementation
// under a different name).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const src = readFileSync(path.resolve(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');

describe('ipcHandlers.ts no longer defines its own stripPriorAssistantTurns — imports the canonical copy', () => {
  test('no local `function stripPriorAssistantTurns` definition remains', () => {
    assert.doesNotMatch(src, /function stripPriorAssistantTurns\(/, 'the local duplicate must be deleted, not left alongside the import');
  });

  test('imports stripPriorAssistantTurns from ./llm/conversationHistoryPolicy', () => {
    assert.match(src, /import\s*\{[^}]*\bstripPriorAssistantTurns\b[^}]*\}\s*from\s*'\.\/llm\/conversationHistoryPolicy'/);
  });

  test('both call sites still reference stripPriorAssistantTurns(...) by name (the two known sites: snapshotForContext and the phone-mirror doc-grounded context assignment)', () => {
    const callSites = [...src.matchAll(/stripPriorAssistantTurns\(/g)];
    // 1 in the import statement's destructure is NOT a call (no matching
    // regex capture there since the import uses `{ stripPriorAssistantTurns }`,
    // not `stripPriorAssistantTurns(`), so every match here is a real call.
    assert.ok(callSites.length >= 2, `expected at least the 2 known call sites, found ${callSites.length}`);
  });
});
