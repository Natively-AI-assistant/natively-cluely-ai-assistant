// electron/services/knowledge/__tests__/DeleteProfileTransactional2026_07_25.test.mjs
//
// Phase 6 Slice 5 (context-rebuild, 05_MIGRATION_PLAN.md Slice 5 item 4):
// "UnifiedKnowledgeStore.deleteProfile(kind) becomes the only delete
// entrypoint, calling both tiers in one transaction" — upgrading the
// 2026-07-25 RC6 two-call fix (profile:delete / profile:delete-jd), which
// warned-and-swallowed a Tier 2 failure leaving Tier 1 deleted and Tier 2
// orphaned, to a real cross-tier transaction.
//
// Source-pinned only: better-sqlite3 is ABI-mismatched in this dev
// environment (ESTABLISHED baseline this session — every DB-touching test
// fails at require() time regardless of code correctness), so no live
// Database instance (in-memory or otherwise) can be constructed here to
// drive a genuine rollback-on-throw behavioral test. These tests instead pin
// the exact structural properties that make deleteProfileTransactional a
// real transaction rather than sequencing: both deletes happen INSIDE one
// DatabaseManager.runInTransaction() call, and the old warn-and-swallow
// try/catch around the Tier 2 delete is gone from both IPC handlers.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');

const deleteModuleSrc = readFileSync(
  path.resolve(__dirname, '../deleteProfileTransactional.ts'),
  'utf8',
);
const ipcSrc = readFileSync(path.resolve(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');

describe('deleteProfileTransactional.ts wraps both tiers in one real transaction', () => {
  test('both deletes are called INSIDE a single DatabaseManager.getInstance().runInTransaction(...) closure', () => {
    const fnStart = deleteModuleSrc.indexOf('export function deleteProfileTransactional');
    assert.ok(fnStart >= 0, 'deleteProfileTransactional must be exported');
    const fnBody = deleteModuleSrc.slice(fnStart);
    const txStart = fnBody.indexOf('runInTransaction(() => {');
    assert.ok(txStart >= 0, 'must call DatabaseManager.getInstance().runInTransaction with a closure');
    const txBody = fnBody.slice(txStart, fnBody.indexOf('});', txStart));
    assert.match(txBody, /orchestrator\.deleteDocumentsByType\(docType\)/, 'Tier 1 delete must be inside the transaction closure');
    assert.match(txBody, /ProfilePackBuilder\.getInstance\(\)\.deleteProfilePack\(kind\)/, 'Tier 2 delete must be inside the transaction closure');
  });

  test('imports the real DatabaseManager and ProfilePackBuilder singletons (not a mock/stub)', () => {
    assert.match(deleteModuleSrc, /import \{ DatabaseManager \} from '\.\.\/\.\.\/db\/DatabaseManager'/);
    assert.match(deleteModuleSrc, /import \{ ProfilePackBuilder \} from '\.\/ProfilePackBuilder'/);
  });
});

describe('profile:delete / profile:delete-jd IPC handlers use the transactional entrypoint, not the old warn-and-swallow two-call pattern', () => {
  function handlerBody(routeName) {
    const start = ipcSrc.indexOf(`safeHandle('${routeName}'`);
    assert.ok(start >= 0, `${routeName} handler must exist`);
    const end = ipcSrc.indexOf("\n  });", start);
    return ipcSrc.slice(start, end);
  }

  test('profile:delete calls deleteProfileTransactional and no longer has a try/catch that swallows a Tier 2 failure', () => {
    const body = handlerBody('profile:delete');
    assert.match(body, /deleteProfileTransactional\(orchestrator, DocType\.RESUME, 'resume'\)/);
    assert.doesNotMatch(body, /failed to clear Tier 2 resume pack/, 'the old warn-only swallow must be removed, not left alongside the new call');
  });

  test('profile:delete-jd calls deleteProfileTransactional and no longer has a try/catch that swallows a Tier 2 failure', () => {
    const body = handlerBody('profile:delete-jd');
    assert.match(body, /deleteProfileTransactional\(orchestrator, DocType\.JD, 'jd'\)/);
    assert.doesNotMatch(body, /failed to clear Tier 2 JD pack/, 'the old warn-only swallow must be removed, not left alongside the new call');
  });

  test('characterization: a Tier 2 delete failure now propagates to the handler catch (success:false) instead of being swallowed', () => {
    // This documents the BEHAVIORAL consequence of the structural change above:
    // since both deletes run inside one runInTransaction() closure with no
    // inner try/catch, a throw from ProfilePackBuilder.deleteProfilePack (Tier 2)
    // is no longer caught-and-warned at the call site — it propagates out of
    // deleteProfileTransactional, is NOT caught until the handler's own outer
    // try/catch, and the handler now returns {success:false, error} instead of
    // {success:true} with an orphaned Tier 2 row. Verified by absence of any
    // inner catch between the transaction call and the handler's outer catch.
    for (const routeName of ['profile:delete', 'profile:delete-jd']) {
      const body = handlerBody(routeName);
      const txCallIdx = body.indexOf('deleteProfileTransactional(');
      const afterCall = body.slice(txCallIdx);
      const nextCatchIdx = afterCall.indexOf('} catch');
      const returnSuccessIdx = afterCall.indexOf('return { success: true }');
      assert.ok(
        returnSuccessIdx >= 0 && returnSuccessIdx < nextCatchIdx,
        `${routeName}: no inner catch must sit between the transactional delete and the success return`,
      );
    }
  });
});
