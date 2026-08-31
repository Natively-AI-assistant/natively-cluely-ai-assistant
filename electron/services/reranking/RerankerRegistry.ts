/**
 * Resolves the ONE reranker that may run at the single rerank seam.
 *
 * Natively already has a reranking stage: `ModeHybridRetriever.maybeRerankCandidates`
 * runs a local cross-encoder inside a 1200ms race, and `ragLocalRerank` /
 * `ragSpeculativeRerank` both default ON. This registry deliberately does NOT
 * add a second stage beside it. An enabled reranker extension REPLACES the
 * built-in at that same seam, so there remains exactly one rerank stage, one
 * budget, one fallback and one telemetry line.
 *
 * That is not only a design preference — `ModeSpeculativeRerank.test.mjs`
 * carries source-guard assertions that rerank "stays inside the existing
 * raceWithBudget envelope (no new unbounded await)". A second call site would
 * fail those by design.
 *
 * Priority at the seam: test override > enabled extension > built-in.
 *
 * Everything here fails CLOSED to the built-in ordering. A reranker that is
 * missing, disabled, slow, throwing, or that answers incompletely yields
 * `null`, and `maybeRerankCandidates` keeps the pre-rerank order. A reranker
 * failure must never surface as an error, and must never change the
 * safe-refusal behaviour.
 */

import { processSingleton, resetProcessSingleton, setProcessSingleton } from '../extensions/singleton';
import type { RankedCandidate, RerankCandidate } from '../extensions/types';

/** Default per-call ceiling. Matches the Phase 2 host `rerank` timeout. */
export const EXTENSION_RERANK_TIMEOUT_MS = 10_000;

/**
 * The shape `ModeHybridRetriever` injects at its seam. Structural on purpose:
 * the registry must be substitutable for the existing `LocalReranker` without
 * that file learning anything about extensions.
 */
export interface RerankSeamPort {
  rerank(query: string, passages: string[]): Promise<Array<{ index: number; score: number }> | null>;
}

export interface RerankOutcome {
  rerankerId: string;
  candidateCount: number;
  latencyMs: number;
  /** True when the caller must keep its existing ordering. */
  fallback: boolean;
  reason?: string;
}

/**
 * The slice of `ExtensionManager` this registry needs. Declared structurally so
 * the retrieval path never imports the extension subsystem directly.
 */
export interface ExtensionRerankerSource {
  list(): Array<{ id: string; enabled: boolean; manifest: { type: string } }>;
  running(): string[];
  load(id: string): Promise<unknown>;
  rerank(
    id: string,
    query: string,
    candidates: RerankCandidate[],
    topK: number,
    signal: AbortSignal,
  ): Promise<RankedCandidate[] | null>;
}

export interface RerankerRegistryOptions {
  /** Flag reader. Injected so tests never mutate the real flag registry. */
  isEnabled: () => boolean;
  source: ExtensionRerankerSource | null;
  timeoutMs?: number;
  onOutcome?: (outcome: RerankOutcome) => void;
  logger?: { warn(message: string, ...args: unknown[]): void };
  now?: () => number;
}

export class RerankerRegistry {
  private readonly options: RerankerRegistryOptions;

  constructor(options: RerankerRegistryOptions) {
    this.options = options;
  }

  /**
   * The extension that should own the seam, or null to leave it to the
   * built-in reranker.
   *
   * Two independent gates: the `extensionRerankers` flag, AND an installed,
   * enabled extension whose manifest type is `reranker`. Flipping the flag
   * alone changes nothing, which is what makes it safe to ship on.
   */
  activeExtensionId(): string | null {
    if (!this.options.isEnabled()) return null;
    const source = this.options.source;
    if (!source) return null;

    let candidates: Array<{ id: string; enabled: boolean; manifest: { type: string } }>;
    try {
      candidates = source.list();
    } catch {
      return null;
    }

    const enabled = candidates.filter((r) => r.enabled && r.manifest?.type === 'reranker');
    if (enabled.length === 0) return null;
    if (enabled.length > 1) {
      // Ambiguous: two extensions both claim the single seam. Refusing is
      // better than silently picking one and reordering the user's evidence by
      // whichever happened to sort first.
      this.options.logger?.warn(
        `[reranking] ${enabled.length} reranker extensions are enabled (${enabled.map((e) => e.id).join(', ')}); ` +
        'refusing to choose. Disable all but one.',
      );
      return null;
    }
    return enabled[0].id;
  }

  /**
   * A port for the seam, or null when the built-in should be used. Resolution
   * is synchronous so it adds no await to the retrieval path.
   */
  resolvePort(): RerankSeamPort | null {
    const extensionId = this.activeExtensionId();
    if (!extensionId) return null;
    return { rerank: (query, passages) => this.rerankVia(extensionId, query, passages) };
  }

  private async rerankVia(
    extensionId: string,
    query: string,
    passages: string[],
  ): Promise<Array<{ index: number; score: number }> | null> {
    const now = this.options.now ?? (() => Date.now());
    const startedAt = now();
    const timeoutMs = this.options.timeoutMs ?? EXTENSION_RERANK_TIMEOUT_MS;

    const report = (fallback: boolean, reason?: string): void => {
      this.options.onOutcome?.({
        rerankerId: extensionId,
        candidateCount: passages.length,
        latencyMs: now() - startedAt,
        fallback,
        reason,
      });
    };

    if (passages.length === 0) {
      report(true, 'no candidates');
      return null;
    }

    const source = this.options.source;
    if (!source) {
      report(true, 'no extension source');
      return null;
    }

    const candidates: RerankCandidate[] = passages.map((text, index) => ({
      id: String(index),
      text,
    }));

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      // The host already enforces its own per-call deadline, but the doc-grounded
      // path passes `budgetMs: null` upstream (LLMHelper.ts:3032) — nothing above
      // this bounds the wait. So the ceiling is enforced here too: an
      // out-of-process extension that hangs must never stall an answer.
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      });

      // Ensure it is running. A disabled or crashed extension resolves to null
      // below rather than throwing into the retrieval path.
      if (!source.running().includes(extensionId)) {
        await source.load(extensionId);
      }

      const result = await Promise.race([
        source.rerank(extensionId, query, candidates, passages.length, controller.signal),
        timeout,
      ]);

      if (result === 'timeout') {
        controller.abort();
        report(true, `timed out after ${timeoutMs}ms`);
        return null;
      }
      if (!result) {
        report(true, 'reranker returned no ranking');
        return null;
      }

      const mapped = this.toSeamResults(result, passages.length);
      if (!mapped) {
        report(true, 'reranker returned an incomplete or invalid ranking');
        return null;
      }

      report(false);
      return mapped;
    } catch (error) {
      report(true, error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Convert `RankedCandidate[]` back to the seam's `{index, score}` shape.
   *
   * Returns null unless EVERY passage is scored exactly once. This is not
   * defensive pedantry: `ModeHybridRetriever.rankScore(c, true)` returns
   * `-Infinity` for a candidate with no `rerankScore`, so a partial ranking
   * silently sinks every unscored chunk below every scored one. Failing the
   * whole call keeps the pre-rerank order instead, which is the honest
   * fallback.
   */
  private toSeamResults(
    ranked: RankedCandidate[],
    expected: number,
  ): Array<{ index: number; score: number }> | null {
    if (!Array.isArray(ranked) || ranked.length !== expected) return null;

    const seen = new Set<number>();
    const out: Array<{ index: number; score: number }> = [];

    for (const item of ranked) {
      const index = Number(item?.id);
      if (!Number.isInteger(index) || index < 0 || index >= expected) return null;
      if (seen.has(index)) return null;
      if (typeof item.score !== 'number' || !Number.isFinite(item.score)) return null;
      seen.add(index);
      out.push({ index, score: item.score });
    }

    if (seen.size !== expected) return null;
    out.sort((a, b) => b.score - a.score);
    return out;
  }
}

// ---------------------------------------------------------------------------
// Process-wide accessor
// ---------------------------------------------------------------------------

const SINGLETON_KEY = 'RerankerRegistry';

/**
 * Anchored per process rather than per module, because this repo's esbuild
 * config makes every electron TS file its own bundle — see
 * `services/extensions/singleton.ts`.
 */
export function getRerankerRegistry(): RerankerRegistry {
  return processSingleton(SINGLETON_KEY, () => new RerankerRegistry(defaultOptions()));
}

/** Replace the process-wide registry. Used by app wiring and by tests. */
export function setRerankerRegistry(registry: RerankerRegistry): void {
  setProcessSingleton(SINGLETON_KEY, registry);
}

/** Tests only. */
export function resetRerankerRegistry(): void {
  resetProcessSingleton(SINGLETON_KEY);
}

function defaultOptions(): RerankerRegistryOptions {
  return {
    isEnabled: () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const flags = require('../../intelligence/intelligenceFlags') as typeof import('../../intelligence/intelligenceFlags');
        return flags.isExtensionRerankersEnabled();
      } catch {
        return false;
      }
    },
    // Nothing constructs ExtensionManager yet (that lands with Phase 5 wiring),
    // so the default source is null and the built-in reranker keeps the seam.
    source: null,
    onOutcome: (outcome) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { telemetryService } = require('../telemetry/TelemetryService');
        telemetryService.track({
          name: 'extension_rerank',
          properties: {
            rerankerId: outcome.rerankerId,
            candidateCount: outcome.candidateCount,
            latencyMs: outcome.latencyMs,
            fallback: outcome.fallback,
            reason: outcome.reason,
          },
        });
      } catch {
        /* telemetry never blocks retrieval */
      }
    },
    logger: console,
  };
}
