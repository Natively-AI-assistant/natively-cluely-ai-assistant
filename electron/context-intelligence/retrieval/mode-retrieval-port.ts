// electron/context-intelligence/retrieval/mode-retrieval-port.ts
//
// THE factory for a RetrievalPort over the live mode-reference store.
//
// Before this existed, the construction lived inline in ipcHandlers (manual
// chat), and the second adopting surface (WTA) would have copied it — a
// declared registry, the fail-closed defaults, the retrieveHybridRaw call shape.
// Two copies of a security-relevant construction is how the two tokenizer
// copies drifted, and this one decides what evidence a turn may see.
//
// Everything is injected structurally: no import of ModesManager or the legacy
// stack, so the module stays testable without Electron, a DB, or an embedding
// model — the same rule the rest of this directory follows.

import type { EvidenceScope, SourceType } from '../contracts/types';
import type { RetrievalPort } from '../orchestration/orchestrator';
import { createLegacyRetrievalPort } from './legacy-retrieval-port';

/** The slice of ModesManager this factory actually uses. Structural on purpose. */
export interface ModeRetrieverLike {
  retrieveHybridRaw?: (modeInfo: unknown, files: unknown[], opts: {
    query: string; topK: number; tokenBudget: number; allowRerank: boolean;
  }) => Promise<{ chunks?: Array<Record<string, unknown>> } | null | undefined>;
}

export interface ModeFileLike { id: string }

export interface ModePortInput {
  modesManager: ModeRetrieverLike;
  modeInfo: unknown;
  files: ModeFileLike[];
  /** Evidence token budget from the mode policy (policy.contextBudget.evidenceTokens). */
  tokenBudget: number;
  /** MUST match the userId the caller puts on the turn's scope, or containment
   *  rejects every source. Callers pass one constant to both. */
  userId: string;
}

/**
 * A fail-closed RetrievalPort over the active mode's reference files.
 *
 * Every source this port can retrieve from gets a DECLARED type, version and
 * scope — no `assume*` opt-ins — so the adopting surface runs the same
 * comparison the benchmarks measure, with a registry that is merely degenerate
 * (one synthetic version, user scope) until ingestion carries real versions and
 * meeting ids. A chunk whose sourceId is outside the declared file set fails
 * closed as UNKNOWN_SOURCE_TYPE rather than riding in on a stale index row.
 */
export function createModeRetrievalPort(input: ModePortInput): RetrievalPort {
  const sourceTypes = new Map<string, SourceType>();
  const activeVersions = new Map<string, string>();
  const chunkVersions = new Map<string, string>();
  const sourceScopes = new Map<string, EvidenceScope>();
  for (const f of input.files) {
    sourceTypes.set(f.id, 'REFERENCE_FILE');
    activeVersions.set(f.id, 'legacy');
    chunkVersions.set(f.id, 'legacy');
    sourceScopes.set(f.id, { userId: input.userId });
  }

  return createLegacyRetrievalPort({
    registry: { sourceTypes, activeVersions, chunkVersions, sourceScopes },
    retrieve: async (query: string, opts: { topK: number }) => {
      if (!input.modeInfo || !input.files.length || !input.modesManager.retrieveHybridRaw) return [];
      const res = await input.modesManager.retrieveHybridRaw(input.modeInfo, input.files, {
        query, topK: opts.topK, tokenBudget: input.tokenBudget, allowRerank: false,
      });
      return (res?.chunks ?? []).map((c: Record<string, unknown>) => ({
        sourceId: String(c.sourceId ?? ''),
        fileName: c.fileName as string | undefined,
        text: String(c.text ?? ''),
        chunkIndex: c.chunkIndex as number | undefined,
        score: c.score as number | undefined,
        ftsScore: c.ftsScore as number | undefined,
        vectorScore: c.vectorScore as number | undefined,
      }));
    },
  });
}
