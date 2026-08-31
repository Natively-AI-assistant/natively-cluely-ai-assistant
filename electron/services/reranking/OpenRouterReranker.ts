/**
 * A hosted reranker at the single rerank seam, via OpenRouter's rerank endpoint.
 *
 *   POST {base}/rerank
 *   { model, query, documents: string[], top_n }
 *   -> { results: [{ index, relevance_score, document }], usage: { cost }, provider }
 *
 * That shape is not guesswork and is not from the docs — it was confirmed
 * empirically against the real API on 2026-09-01 and has been exercised across a
 * full benchmark run (benchmarks/reranker-eval/lib/rerankers/openrouter.mjs,
 * whose behaviour this file mirrors). `results` arrives already sorted
 * descending by `relevance_score`.
 *
 * WHY THIS IS NOT AN EXTENSION
 *
 * Hosted rerank has no weights, no licence to acknowledge, no binary to spawn
 * and nothing to sandbox. Routing it through the extension host would gate it
 * behind the `extensionRerankers` flag, require `network.remote` +
 * `allowedHosts`, and duplicate the OpenRouter client this repo already has for
 * embeddings. It belongs beside that client, and it resolves at the same seam.
 *
 * WHY `batchSize` EXISTS
 *
 * `ModeHybridRetriever` reranks a 30-candidate pool in batches of 6. That
 * batching is an ONNX arena-memory measure (see RERANK_BATCH_SIZE's comment) and
 * is exactly wrong for a network call: it would turn one request into five
 * sequential round trips — ~5x the latency and ~5x the cost, and it would blow
 * RERANK_BUDGET_MS (1200ms) on a model that clears it comfortably in one pass.
 * The seam honours a port's declared `batchSize`, and this one asks for the
 * whole pool at once.
 *
 * EVERYTHING FAILS CLOSED
 *
 * Every error path returns null, which the seam reads as "keep the existing
 * order". A rerank failure must never surface to the user as an error and must
 * never change safe-refusal behaviour.
 */

import type { RerankSeamPort } from './RerankerRegistry';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Per-request ceiling. Deliberately larger than RERANK_BUDGET_MS (1200ms): the
 * seam's own race already bounds the LIVE path, and the document-grounded path
 * passes `budgetMs: null` upstream (LLMHelper.ts:3032), so this is the only
 * bound that path has.
 */
export const OPENROUTER_RERANK_TIMEOUT_MS = 8_000;

/** One 429/5xx retry, and only when the deadline leaves room for it. */
const RETRY_BASE_DELAY_MS = 250;
const MAX_RETRIES = 1;

export type RerankFailureKind =
  | 'no-api-key'
  | 'no-model'
  | 'auth'
  | 'insufficient-credits'
  | 'model-unavailable'
  | 'rate-limited'
  | 'timeout'
  | 'server-error'
  | 'malformed-response'
  | 'network';

export interface RerankRequestStats {
  model: string;
  /** Wall-clock for the whole call INCLUDING network. Never call this inference time. */
  requestLatencyMs: number;
  candidateCount: number;
  ok: boolean;
  failure?: RerankFailureKind;
  /** OpenRouter's own per-call charge, when it reports one. */
  costUsd?: number;
  httpStatus?: number;
}

export class OpenRouterRerankError extends Error {
  constructor(public readonly kind: RerankFailureKind, message: string, public readonly httpStatus?: number) {
    super(message);
    this.name = 'OpenRouterRerankError';
  }
}

export interface OpenRouterRerankerOptions {
  /** Read lazily: the key can be set while the app is running. */
  getApiKey: () => string | undefined;
  getModel: () => string | undefined;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Receives one record per call, success or failure. Never receives query text. */
  onStats?: (stats: RerankRequestStats) => void;
  logger?: { warn(message: string, ...args: unknown[]): void };
}

/**
 * Turn an HTTP status into something the UI can act on. The distinction that
 * matters most is 402 (add credits) vs 401/403 (fix the key) — telling a user
 * with an expired balance to check their API key sends them to the wrong page.
 */
export function classifyStatus(status: number): RerankFailureKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'insufficient-credits';
  if (status === 404) return 'model-unavailable';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'server-error';
  return 'server-error';
}

/** A user-facing sentence per failure. No key material, ever. */
export function describeFailure(kind: RerankFailureKind, model?: string): string {
  switch (kind) {
    case 'no-api-key':
      return 'No OpenRouter API key is configured.';
    case 'no-model':
      return 'No OpenRouter rerank model is selected.';
    case 'auth':
      return 'OpenRouter rejected the API key. Check the key in Settings.';
    case 'insufficient-credits':
      return 'OpenRouter credits are insufficient for this reranker. Switch to a local reranker or add OpenRouter credits.';
    case 'model-unavailable':
      return `OpenRouter no longer serves ${model ?? 'this model'}. Choose another rerank model.`;
    case 'rate-limited':
      return 'OpenRouter rate-limited this request. Free-tier rerank models allow only a few requests per minute.';
    case 'timeout':
      return 'The rerank request timed out.';
    case 'server-error':
      return 'OpenRouter returned a server error.';
    case 'malformed-response':
      return 'OpenRouter returned a response this build could not read.';
    case 'network':
      return 'OpenRouter could not be reached.';
  }
}

export class OpenRouterReranker implements RerankSeamPort {
  /**
   * Ask the seam for the whole pool in one request. See the header note — the
   * default batch of 6 is an ONNX memory measure, not a latency one.
   */
  readonly batchSize = Number.MAX_SAFE_INTEGER;

  /** Populated after every call, for the settings panel's latency/cost line. */
  lastStats: RerankRequestStats | null = null;

  private readonly options: OpenRouterRerankerOptions;

  constructor(options: OpenRouterRerankerOptions) {
    this.options = options;
  }

  /**
   * Both the seam entry point and what "Test connection" exercises, so a green
   * test means the exact request path the retrieval hot path uses — not a
   * cheaper probe that could pass while the real call fails.
   */
  async rerank(query: string, passages: string[]): Promise<Array<{ index: number; score: number }> | null> {
    try {
      const { order } = await this.rerankOrThrow(query, passages);
      return order;
    } catch {
      // Fails closed. The caller keeps its existing ordering; the reason is
      // already recorded in lastStats and reported through onStats.
      return null;
    }
  }

  /**
   * The same call, but surfacing WHY it failed. Used by "Test connection" and by
   * activation validation, where a user is waiting for a diagnosis rather than
   * an answer.
   */
  async rerankOrThrow(
    query: string,
    passages: string[],
  ): Promise<{ order: Array<{ index: number; score: number }>; stats: RerankRequestStats }> {
    const now = this.options.now ?? (() => Date.now());
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const doFetch = this.options.fetchImpl ?? fetch;
    const timeoutMs = this.options.timeoutMs ?? OPENROUTER_RERANK_TIMEOUT_MS;
    const base = (this.options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const startedAt = now();
    const deadline = startedAt + timeoutMs;

    const model = (this.options.getModel() || '').trim();
    const apiKey = (this.options.getApiKey() || '').trim();

    const fail = (kind: RerankFailureKind, httpStatus?: number): never => {
      const stats: RerankRequestStats = {
        model, requestLatencyMs: now() - startedAt, candidateCount: passages.length,
        ok: false, failure: kind, httpStatus,
      };
      this.lastStats = stats;
      this.options.onStats?.(stats);
      throw new OpenRouterRerankError(kind, describeFailure(kind, model), httpStatus);
    };

    if (!apiKey) fail('no-api-key');
    if (!model) fail('no-model');
    if (passages.length === 0) fail('malformed-response');

    let attempt = 0;
    for (;;) {
      const remaining = deadline - now();
      if (remaining <= 0) fail('timeout');

      let res: Response;
      try {
        res = await doFetch(`${base}/rerank`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // The key goes in a header and nowhere else. Never a URL, never a log.
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://natively.software',
            'X-Title': 'Natively',
          },
          // ONLY the query and the candidate text. No file paths, no chunk ids,
          // no metadata — the mapping back to candidates is done locally, by index.
          body: JSON.stringify({ model, query, documents: passages, top_n: passages.length }),
          signal: AbortSignal.timeout(remaining),
        });
      } catch (e: any) {
        const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
        // A retry only makes sense if there is time left to use it.
        if (!timedOut && attempt < MAX_RETRIES && deadline - now() > RETRY_BASE_DELAY_MS * 2) {
          attempt += 1;
          await sleep(RETRY_BASE_DELAY_MS * attempt);
          continue;
        }
        return fail(timedOut ? 'timeout' : 'network');
      }

      if (!res.ok) {
        const kind = classifyStatus(res.status);
        const retryable = kind === 'rate-limited' || kind === 'server-error';
        if (retryable && attempt < MAX_RETRIES) {
          // Bounded exponential backoff, and only inside the deadline. An
          // unbounded retry on a 429 would stall an answer indefinitely, which
          // is worse than not reranking at all.
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          if (deadline - now() > delay + RETRY_BASE_DELAY_MS) {
            attempt += 1;
            await sleep(delay);
            continue;
          }
        }
        // The body can carry provider detail worth logging, but it is untrusted
        // text — it is never rendered as an instruction and never parsed for control.
        this.options.logger?.warn(`[reranking] OpenRouter rerank HTTP ${res.status} for model ${model}`);
        return fail(kind, res.status);
      }

      let json: any;
      try {
        json = await res.json();
      } catch {
        return fail('malformed-response', res.status);
      }

      const order = toSeamOrder(json?.results, passages.length);
      if (!order) return fail('malformed-response', res.status);

      const stats: RerankRequestStats = {
        model,
        requestLatencyMs: now() - startedAt,
        candidateCount: passages.length,
        ok: true,
        costUsd: typeof json?.usage?.cost === 'number' ? json.usage.cost : undefined,
        httpStatus: res.status,
      };
      this.lastStats = stats;
      this.options.onStats?.(stats);
      return { order, stats };
    }
  }
}

/**
 * Map OpenRouter's results back onto the seam's `{index, score}` shape.
 *
 * Mapping is BY INDEX, never by the returned `document` text. Duplicate chunks
 * genuinely occur in this corpus (a heading repeated across files, boilerplate
 * in two documents), and matching on text would silently attach one candidate's
 * score to another candidate's file path, page and offsets.
 *
 * Returns null unless every index is present exactly once and every score is
 * finite. A partial ranking is rejected wholesale for the same reason
 * RerankerRegistry rejects one: `ModeHybridRetriever.rankScore(c, true)` returns
 * -Infinity for an unscored candidate, so a partial result silently sinks every
 * unscored chunk below every scored one.
 */
export function toSeamOrder(results: unknown, expected: number): Array<{ index: number; score: number }> | null {
  if (!Array.isArray(results) || results.length !== expected) return null;

  const seen = new Set<number>();
  const out: Array<{ index: number; score: number }> = [];

  for (const row of results as any[]) {
    const index = Number(row?.index);
    const score = Number(row?.relevance_score);
    if (!Number.isInteger(index) || index < 0 || index >= expected) return null;
    if (seen.has(index)) return null;
    if (!Number.isFinite(score)) return null;
    seen.add(index);
    out.push({ index, score });
  }

  if (seen.size !== expected) return null;
  out.sort((a, b) => b.score - a.score);
  return out;
}
