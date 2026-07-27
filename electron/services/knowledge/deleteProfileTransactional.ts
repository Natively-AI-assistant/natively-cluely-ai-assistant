// electron/services/knowledge/deleteProfileTransactional.ts
//
// Phase 6 Slice 5 (context-rebuild, 2026-07-25) item 4: profile:delete /
// profile:delete-jd previously ran Tier 1's deleteDocumentsByType then Tier
// 2's deleteProfilePack as two separate calls, with the second wrapped in a
// try/catch that only WARNS on failure — a Tier 2 error left Tier 1 deleted
// and Tier 2's PII-bearing knowledge_cards orphaned (partial delete, not
// atomic). Tier 1 (premium KnowledgeDatabaseManager) and Tier 2 (this
// repo's DatabaseManager) are constructed from the SAME underlying
// better-sqlite3 connection (both wrap `DatabaseManager.getInstance().getDb()`
// — see electron/main.ts's Knowledge Orchestrator init), so a single
// DatabaseManager.runInTransaction() is a genuine cross-tier transaction,
// not just call sequencing: a throw from either delete rolls both back.

import { DatabaseManager } from '../../db/DatabaseManager';
import { ProfilePackBuilder } from './ProfilePackBuilder';
import type { ProfileDocKind } from './ProfilePackBuilder';

export interface Tier1ProfileDeleter {
  deleteDocumentsByType(docType: unknown): void;
}

/**
 * The single delete entrypoint for a profile doc kind, transactional across
 * both tiers. `docType` is the premium DocType.RESUME/DocType.JD enum value —
 * passed in (rather than imported here) so this main-repo module has no
 * static dependency on the premium submodule.
 */
export function deleteProfileTransactional(
  orchestrator: Tier1ProfileDeleter,
  docType: unknown,
  kind: ProfileDocKind,
): void {
  DatabaseManager.getInstance().runInTransaction(() => {
    orchestrator.deleteDocumentsByType(docType);
    ProfilePackBuilder.getInstance().deleteProfilePack(kind);
  });
}
