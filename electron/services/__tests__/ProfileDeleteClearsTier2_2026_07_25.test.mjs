// electron/services/__tests__/ProfileDeleteClearsTier2_2026_07_25.test.mjs
//
// Phase 6 Slice 0, item 4 (RC6, docs/context-rebuild/02_INGESTION_AND_STORAGE_AUDIT.md
// §A.6.2): `profile:delete`/`profile:delete-jd` previously cleared only Tier 1
// (premium context_nodes via orchestrator.deleteDocumentsByType), leaving
// Tier 2's PII-bearing knowledge_cards rows for the deleted kind indefinitely.
// The original interim fix (this file, at HEAD before Slice 5) made both
// handlers ALSO call ProfilePackBuilder.getInstance().deleteProfilePack(kind)
// as a second, separate call — clearing the orphan but not atomically (a
// Tier 2 failure was warned-and-swallowed, still returning success:true).
//
// UPGRADED by Phase 6 Slice 5 item 4 (context-rebuild, 2026-07-25): both
// handlers now delegate to deleteProfileTransactional(), which wraps both
// tiers' deletes in one DatabaseManager.runInTransaction() — a real
// cross-tier transaction (see deleteProfileTransactional.ts's header for why
// this is possible: Tier 1 and Tier 2 share one sqlite connection). This
// file's assertions are updated to match; the fuller structural + call-order
// coverage lives in
// electron/services/knowledge/__tests__/DeleteProfileTransactional2026_07_25.test.mjs.
//
// Source-pin tests only — ipcHandlers.ts's IPC handlers are not unit-testable
// in isolation (established convention in this exact file, see
// ManualEvidenceRepairEnforcement2026_07_05.test.mjs's header).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcSrc = readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

describe('profile:delete clears both tiers via the transactional entrypoint', () => {
  const handlerStart = ipcSrc.indexOf("safeHandle('profile:delete', async () => {");
  const handlerEnd = ipcSrc.indexOf("safeHandle('profile:get-profile'", handlerStart);
  const handlerSrc = ipcSrc.slice(handlerStart, handlerEnd);

  test('the handler exists and is isolated correctly', () => {
    assert.ok(handlerStart >= 0, "profile:delete handler should exist");
    assert.ok(handlerEnd > handlerStart, 'handler source should be isolated');
  });

  test('the handler delegates to deleteProfileTransactional for resume, covering both tiers in one transaction', () => {
    assert.match(handlerSrc, /require\(['"]\.\/services\/knowledge\/deleteProfileTransactional['"]\)/);
    assert.match(handlerSrc, /deleteProfileTransactional\(orchestrator, DocType\.RESUME, 'resume'\)/);
  });
});

describe('profile:delete-jd clears both tiers via the transactional entrypoint', () => {
  const handlerStart = ipcSrc.indexOf("safeHandle('profile:delete-jd', async () => {");
  const handlerEnd = ipcSrc.indexOf('});', ipcSrc.indexOf("deleteProfileTransactional(orchestrator, DocType.JD", handlerStart)) + 3;
  const handlerSrc = ipcSrc.slice(handlerStart, handlerEnd);

  test('the handler exists and is isolated correctly', () => {
    assert.ok(handlerStart >= 0, "profile:delete-jd handler should exist");
    assert.ok(handlerEnd > handlerStart, 'handler source should be isolated');
  });

  test('the handler delegates to deleteProfileTransactional for jd, covering both tiers in one transaction', () => {
    assert.match(handlerSrc, /require\(['"]\.\/services\/knowledge\/deleteProfileTransactional['"]\)/);
    assert.match(handlerSrc, /deleteProfileTransactional\(orchestrator, DocType\.JD, 'jd'\)/);
  });
});
