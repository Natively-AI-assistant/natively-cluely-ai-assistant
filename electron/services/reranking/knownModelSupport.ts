/**
 * Does Core already know this model cannot work?
 *
 * Core's reranker catalogue records, per model, whether Core can actually
 * execute it. Nothing in the catalogue is `supported: false` today —
 * `jina-reranker-v3.5-GGUF` was the last one and Core scores it now — but that
 * is a fact about the current catalogue, not about this gate, which exists for
 * whenever the next unrunnable model is listed.
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

/** The slice of a catalogue entry this module needs. Structural on purpose. */
export interface SupportCatalogEntry {
  id: string;
  repo: string;
  supported: boolean;
  unsupportedReason?: string;
}

/**
 * Builds a lookup over ANY catalogue.
 *
 * Exported as a factory because the real catalogue is volatile product data:
 * on 2026-09-01 `jina-reranker-v3.5-GGUF` was unsupported, and by 2026-09-03 it
 * was fixed and every entry was supported. Tests that asserted a particular
 * model's status broke the moment that changed — and they were testing the
 * catalogue's contents, not this mechanism. Mechanism tests build their own
 * catalogue; only invariants are asserted against the real one.
 */
export function createModelSupportLookup(
  catalog: readonly SupportCatalogEntry[],
): ModelSupportLookup & { unsupportedRepos(): string[] } {
  const byRepo = new Map<string, KnownModelSupport>();

  for (const entry of catalog) {
    if (!entry?.repo) continue;
    const key = normalizeRepo(entry.repo);
    // First entry wins. Two rows sharing a repo would be a catalogue bug, and
    // letting a later one overwrite would hide it rather than surface it.
    if (byRepo.has(key)) continue;
    byRepo.set(key, {
      catalogId: entry.id,
      supported: entry.supported,
      ...(entry.supported ? {} : { reason: entry.unsupportedReason }),
    });
  }

  const lookup = ((repo) => {
    if (typeof repo !== 'string' || !repo.trim()) return null;
    return byRepo.get(normalizeRepo(repo)) ?? null;
  }) as ModelSupportLookup & { unsupportedRepos(): string[] };

  lookup.unsupportedRepos = () =>
    [...byRepo.entries()].filter(([, v]) => !v.supported).map(([repo]) => repo).sort();

  return lookup;
}

/**
 * The production lookup, over Core's real reranker catalogue.
 *
 * Returns null when Core has no opinion — the overwhelmingly common case, since
 * an extension exists precisely to bring a model Core does not ship.
 */
export const lookupKnownModelSupport = createModelSupportLookup(RERANKER_MODEL_CATALOG);

/** Every catalogue repo Core cannot run. Exposed for diagnostics. */
export function knownUnsupportedRepos(): string[] {
  return lookupKnownModelSupport.unsupportedRepos();
}
