/**
 * Does Core already know this model cannot work?
 *
 * Core's reranker catalogue records, per model, whether Core can actually
 * execute it — `jina-reranker-v3.5-GGUF` is `supported: false` because the
 * bundled llama.cpp discards the model's sliding-window attention settings, so
 * most of its layers would run wrong and every score would be meaningless.
 *
 * That gate only ever covered Core's OWN catalogue. An extension shipping the
 * same model went around it completely: it spawns its own `llama-server` from
 * the user's PATH, so nothing consulted the catalogue, nothing warned at
 * install, and a model Core had already judged unusable could quietly take over
 * the rerank seam.
 *
 * This closes that hole by matching on the Hugging Face repo id, which is the
 * one identifier both sides genuinely share. It is advisory, not a veto: an
 * extension is third-party code and the user may have a `llama-server` build
 * that fixes the defect. The point is that the judgement is SHOWN rather than
 * silently absent.
 */

import { RERANKER_MODEL_CATALOG } from '../../rag/rerankerModelCatalog';

export interface KnownModelSupport {
  /** The catalogue entry this model matched. */
  catalogId: string;
  supported: boolean;
  /** Present only when `supported` is false. */
  reason?: string;
}

/** The shape `ExtensionManager` accepts, so it never imports the catalogue. */
export type ModelSupportLookup = (repo: string | null | undefined) => KnownModelSupport | null;

/**
 * Repo ids are compared case-insensitively and without surrounding whitespace.
 * Hugging Face treats `Owner/Name` and `owner/name` as the same repository, so
 * a manifest that differs only in case must not slip past the check.
 */
function normalizeRepo(repo: string): string {
  return repo.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
}

const BY_REPO = new Map<string, KnownModelSupport>();
for (const entry of RERANKER_MODEL_CATALOG) {
  if (!entry.repo) continue;
  const value: KnownModelSupport = {
    catalogId: entry.id,
    supported: entry.supported,
    ...(entry.supported ? {} : { reason: entry.unsupportedReason }),
  };
  // First entry wins. Two catalogue rows sharing a repo would be a catalogue
  // bug; silently letting the later one overwrite would hide it.
  if (!BY_REPO.has(normalizeRepo(entry.repo))) {
    BY_REPO.set(normalizeRepo(entry.repo), value);
  }
}

/**
 * Returns null when Core has no opinion — the overwhelmingly common case, since
 * an extension exists precisely to bring a model Core does not ship.
 */
export const lookupKnownModelSupport: ModelSupportLookup = (repo) => {
  if (typeof repo !== 'string' || !repo.trim()) return null;
  return BY_REPO.get(normalizeRepo(repo)) ?? null;
};

/** Every catalogue repo Core cannot run. Exposed for tests and diagnostics. */
export function knownUnsupportedRepos(): string[] {
  return [...BY_REPO.entries()].filter(([, v]) => !v.supported).map(([repo]) => repo).sort();
}
