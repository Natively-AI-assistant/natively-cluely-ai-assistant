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
 * A note on how load-bearing that is. `ModeSpeculativeRerank.test.mjs:161`
 * ("rerank stays inside the existing raceWithBudget envelope (no new unbounded
 * await)") is often cited as enforcing this. Read what it asserts: it reads
 * `llm/WhatToAnswerLLM.ts` and checks the HYBRID RETRIEVAL call is wrapped in
 * `raceWithBudget`. It says nothing about this file or about
 * `ModeHybridRetriever`, which hand-rolls its own setTimeout + Promise.race and
 * contains no `raceWithBudget` symbol at all. A second rerank call site would
 * NOT fail it.
 *
 * So the single seam is a deliberate design decision, not a test-enforced
 * invariant. Treat it as binding — but do not assume a net catches you.
 *
 * Priority at the seam:
 *
 *   test override > OpenRouter (when the provider is set to it) > enabled extension > built-in
 *
 * OpenRouter sits ahead of extensions because it is an explicit user choice of
 * provider, where an enabled extension is a standing preference. It is NOT an
 * extension itself: hosted rerank has no weights, no licence to acknowledge and
 * no binary to spawn, so putting it behind the extension host would gate it on
 * an unrelated flag and duplicate the OpenRouter client this repo already has.
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
  /**
   * How many passages this port wants per `rerank()` call. Omitted means "use
   * the caller's default".
   *
   * `ModeHybridRetriever` splits its 30-candidate pool into batches of 6, which
   * is an ONNX arena-memory measure (see RERANK_BATCH_SIZE's comment there), not
   * a latency one. For a port whose cost is a network round trip rather than a
   * forward pass, that batching multiplies both latency and spend by ~5 and can
   * turn a model that clears RERANK_BUDGET_MS into one that does not. Such a
   * port declares a larger size and gets the pool in one call.
   */
  readonly batchSize?: number;
}

export interface RerankOutcome {
  /** Which kind of reranker ran, so telemetry can tell hosted from local. */
  provider?: 'openrouter' | 'extension';
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
  /**
   * The hosted reranker, when the user has selected a hosted provider AND it is
   * usable. Returning null means "not selected, not configured, or not
   * permitted" — every one of those policy questions is answered by the factory,
   * so this registry stays synchronous and testable without a network.
   *
   * Local-only mode is one of those questions, and it is decided there. This
   * registry never learns what local-only means; it only ever sees null.
   */
  hostedPort?: () => RerankSeamPort | null;
  /**
   * A built-in reranker to try when the hosted one fails, and only when the user
   * has opted into that. Null/absent means a hosted failure keeps the existing
   * order, which is the default: silently substituting a different model would
   * reorder the user's evidence by something they did not choose.
   */
  hostedFallbackPort?: () => RerankSeamPort | null;
  /**
   * A local GGUF model the user selected, run by llama.cpp. Null when the
   * selection is ONNX (the built-in handles those) or nothing is selected.
   */
  localGgufPort?: () => RerankSeamPort | null;
  /** Drop a cached local GGUF worker when something else takes the seam. */
  releaseLocalGguf?: () => void;
  /**
   * The bundled reranker, used when an enabled extension fails.
   *
   * Without it an extension that cannot score leaves retrieval worse than
   * before it was installed, because it displaced the built-in at the seam.
   */
  builtInPort?: () => RerankSeamPort | null;
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
    // Hosted first, because selecting a hosted provider is an explicit,
    // deliberate choice, where an enabled extension is a standing preference.
    // The factory has already decided every policy question — provider
    // selected, key present, model chosen, local-only not in force — so a
    // non-null return here means "this may run".
    const hosted = this.resolveHostedPort();
    if (hosted) return hosted;

    const extensionId = this.activeExtensionId();
    if (extensionId) {
      return {
        // An extension rerank is an RPC into a utilityProcess — a round trip,
        // not a forward pass — so it takes the whole pool in one call, exactly
        // as OpenRouterReranker and GgufReranker do. Omitting this fell back to
        // the seam's RERANK_BATCH_SIZE of 6, which split a 30-candidate pool
        // into 5 sequential round trips, each with its own full timeout budget:
        // a 10s ceiling became a 50s worst case. It also multiplied the number
        // of `running()`/`load()` checks per query, which is what let one query
        // race itself into starting the same extension twice.
        batchSize: Number.MAX_SAFE_INTEGER,
        rerank: async (query, passages) => {
          const ranked = await this.rerankVia(extensionId, query, passages);
          if (ranked) return ranked;

          // An extension REPLACES the built-in at this seam, so its failure used
          // to mean no reranking at all — strictly worse than the bundled model
          // the user displaced by installing it. That is the normal case rather
          // than an edge one: an extension can throw on every single call and
          // still look installed, enabled and healthy (the Ettin extension's
          // scoreBatch() throws unconditionally by design). rerankVia has
          // already reported the failure with its reason, so this is a visible
          // degradation, not a silent substitution.
          const builtIn = this.options.builtInPort?.();
          if (!builtIn) return null;
          try {
            return await builtIn.rerank(query, passages);
          } catch {
            return null;
          }
        },
      };
    }

    // A locally selected GGUF model. ONNX selections need nothing here — the
    // built-in reranker reads the same setting and swaps its own model — but
    // llama.cpp is a different runtime, so it takes the seam directly.
    return this.options.localGgufPort?.() ?? null;
  }

  /**
   * Wrap the hosted port so a failure is reported once, and so the optional
   * local fallback runs only when the user asked for it.
   *
   * The wrapper preserves the hosted port's `batchSize`. Dropping it would
   * silently restore the seam's default batching and turn one request into five.
   */
  private resolveHostedPort(): RerankSeamPort | null {
    const hosted = this.options.hostedPort?.() ?? null;
    if (!hosted) return null;

    const now = this.options.now ?? (() => Date.now());
    const registry = this;

    return {
      batchSize: hosted.batchSize,
      async rerank(query, passages) {
        const startedAt = now();
        let result: Array<{ index: number; score: number }> | null = null;
        let reason: string | undefined;

        try {
          result = await hosted.rerank(query, passages);
          if (!result) reason = 'hosted reranker returned no ranking';
        } catch (error) {
          // A hosted reranker must not be able to throw into retrieval.
          reason = error instanceof Error ? error.message : String(error);
        }

        if (result) {
          registry.options.onOutcome?.({
            provider: 'openrouter',
            rerankerId: 'openrouter',
            candidateCount: passages.length,
            latencyMs: now() - startedAt,
            fallback: false,
          });
          return result;
        }

        // Fallback is opt-in. Without it, a hosted failure keeps the existing
        // order rather than quietly reordering the user's evidence with a model
        // they did not pick.
        const fallbackPort = registry.options.hostedFallbackPort?.() ?? null;
        if (fallbackPort) {
          registry.options.logger?.warn(
            `[reranking] OpenRouter reranker unavailable (${reason ?? 'unknown'}); ` +
            'using the local reranker for this request.',
          );
          try {
            const local = await fallbackPort.rerank(query, passages);
            registry.options.onOutcome?.({
              provider: 'openrouter',
              rerankerId: 'openrouter->local',
              candidateCount: passages.length,
              latencyMs: now() - startedAt,
              fallback: true,
              reason,
            });
            return local;
          } catch {
            /* fall through to the no-rerank outcome below */
          }
        }

        registry.options.onOutcome?.({
          provider: 'openrouter',
          rerankerId: 'openrouter',
          candidateCount: passages.length,
          latencyMs: now() - startedAt,
          fallback: true,
          reason,
        });
        return null;
      },
    };
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
        provider: 'extension',
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

      // Ensure it is running, INSIDE the race. A cold start is not free — an
      // extension that spawns llama-server and waits for it to answer can take
      // seconds — and awaiting it out here spent the budget before the rerank
      // began, then reported "timed out" against whatever was left. Worse, a
      // load() that never settles meant this method never resolved: the finally
      // never ran, the timer was never cleared, and abort() never fired. The
      // ceiling the docstring promises was not actually enforced.
      const attempt = (async () => {
        if (!source.running().includes(extensionId)) {
          await source.load(extensionId);
        }
        return source.rerank(extensionId, query, candidates, passages.length, controller.signal);
      })();

      const result = await Promise.race([attempt, timeout]);

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
    hostedPort: () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { buildHostedRerankPort } = require('./rerankerConfig') as typeof import('./rerankerConfig');
        return buildHostedRerankPort();
      } catch {
        // An unreadable configuration is not permission to send document text
        // to a third party. Fall through to the local path.
        return null;
      }
    },
    builtInPort: () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getLocalReranker } = require('../../rag/LocalReranker');
        const local = getLocalReranker();
        return local ? { rerank: (q: string, p: string[]) => local.rerank(q, p) } : null;
      } catch {
        return null;
      }
    },
    releaseLocalGguf: () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { resetLocalGgufPort } = require('./rerankerConfig') as typeof import('./rerankerConfig');
        resetLocalGgufPort();
      } catch { /* nothing cached */ }
    },
    localGgufPort: () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { buildLocalGgufPort } = require('./rerankerConfig') as typeof import('./rerankerConfig');
        return buildLocalGgufPort();
      } catch {
        return null;
      }
    },
    hostedFallbackPort: () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { buildHostedFallbackPort } = require('./rerankerConfig') as typeof import('./rerankerConfig');
        return buildHostedFallbackPort();
      } catch {
        return null;
      }
    },
    onOutcome: (outcome) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { telemetryService } = require('../telemetry/TelemetryService');
        telemetryService.track({
          name: 'extension_rerank',
          properties: {
            provider: outcome.provider,
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
