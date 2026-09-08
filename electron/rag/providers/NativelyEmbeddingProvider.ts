import { IEmbeddingProvider } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';
import { TRIAL_SENTINEL_KEY } from '../../config/constants';

/**
 * Natively-managed embeddings via POST /v1/embed.
 *
 * This is the provider a Natively API key is supposed to get. Before it existed,
 * EmbeddingProviderResolver consulted only openaiKey/geminiKey, so a customer on
 * a Natively key — the "easiest experience" tier — silently fell through to
 * Ollama or the bundled MiniLM model and got the weakest retrieval in the app.
 */

/**
 * The managed embedding model, requested BY NAME on every call.
 *
 * Naming it is what makes the server's rollout safe. `/v1/embed` serves two
 * incompatible vector spaces now, and it picks between them from the request:
 * a body with no `model` gets the old Gemini waterfall, because that is what
 * every build up to 2.8.8 sends and those builds pin gemini-embedding-2 at 3072
 * dimensions. Asking for voyage-4 by name PROVES this build knows its width;
 * a version header would only have asserted it. See natively-api
 * lib/managedModels.js for the other half of the rule.
 *
 * Changing this constant changes `space` below, which the pipeline treats as a
 * re-index trigger — see the note on DIMENSIONS.
 */
const MODEL = 'voyage-4';

/**
 * The width the server serves voyage-4 at (natively-api VOYAGE_EMBED_DIMENSIONS).
 * voyage-4 emits 256/512/1024/2048 on request; 2048 is what Natively asks for.
 *
 * MUST match the server. It is half the identity of `space`, so a mismatch is
 * not a formatting difference — it is a different vector space wearing the same
 * name. validate() below refuses rather than storing one.
 *
 * NOTE ON UPGRADING FROM 2.8.x: this pair changes `space` from
 * `natively:gemini-embedding-2:3072` to `natively:voyage-4:2048`, so vectors
 * embedded by an older build are in a space this one cannot reproduce. That is
 * handled, not ignored — EmbeddingPipeline compares the active space against
 * `last_embedding_space` at startup and RAGManager.scheduleAutoReindex()
 * re-embeds what does not match. The re-index is the designed response to
 * exactly this change; nothing needs to be migrated by hand.
 */
const DIMENSIONS = 2048;

/**
 * Server-side per-request batch cap (natively-api DEFAULT_MAX_BATCH). Larger
 * batches are SPLIT here rather than rejected: the caller is chunking a
 * document, and making it care about our transport's cap would just push the
 * same loop up a layer.
 */
const SERVER_MAX_BATCH = 32;

/**
 * Voyage embeds a query and a document into DIFFERENT projections of the same
 * space. Measured on voyage-4 through the Natively server, the same sentence
 * embedded both ways comes back at cosine ~0.79 — clearly not the same vector.
 *
 * That is an ENCODING distance, not a demonstrated retrieval gain, and the two
 * are not the same claim: a 12-query probe with same-topic near-miss
 * distractors could not separate query/document from sending nothing at all.
 * This path sends the asymmetry because it is Voyage's documented usage and
 * because the space key changed anyway, so it costs nothing here — NOT because
 * a quality delta has been measured.
 *
 * embedQuery() sends 'query'; embed()/embedBatch() send 'document'.
 */
type EmbedInputType = 'query' | 'document';

/**
 * Per-HTTP-request timeout.
 *
 * MUST stay strictly below EmbeddingPipeline's EMBED_TIMEOUT_MS (30s), which
 * wraps the WHOLE embedBatch() call. When the two were equal, a single slow
 * request could only ever fail by exhausting the outer deadline first — so the
 * caller got the pipeline's generic "batch timed out" instead of this
 * transport's specific error, and the whole batch was discarded with no
 * indication of which request stalled. Inner budgets belong inside outer ones.
 */
const REQUEST_TIMEOUT_MS = 25_000;

export interface NativelyEmbeddingOptions {
  baseUrl?: string;
  /** Required when the key is TRIAL_SENTINEL_KEY — trials authenticate by token. */
  trialToken?: string;
}

export class NativelyEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'natively';
  readonly model = MODEL;
  readonly dimensions = DIMENSIONS;
  readonly space: string;
  /**
   * The server refuses batches above DEFAULT_MAX_BATCH (natively-api
   * lib/embeddingQuota.js). embedBatch() splits larger arrays into sequential
   * requests; declaring the ceiling lets callers size their batches so that
   * split never happens and one caller-level batch is exactly one round trip.
   */
  readonly maxBatchSize = SERVER_MAX_BATCH;

  private readonly baseUrl: string;
  private readonly trialToken?: string;

  constructor(private apiKey: string, opts: NativelyEmbeddingOptions = {}) {
    this.baseUrl = (opts.baseUrl || process.env.NATIVELY_API_URL || 'https://api.natively.software').replace(/\/+$/, '');
    this.trialToken = opts.trialToken;
    // Deliberately NOT the same space key as the direct-Gemini provider, even
    // though the server runs the same model at the same dimensionality. The two
    // transports have different input caps and formatting, and a shared key
    // would be an invariant spanning two repositories that no test in either can
    // fail when the other drifts.
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
  }

  /** Auth headers. A trial's "key" is a sentinel, never a credential. */
  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey === TRIAL_SENTINEL_KEY) {
      if (!this.trialToken) throw new Error('Natively trial token not available for embeddings');
      h['x-trial-token'] = this.trialToken;
    } else {
      h['x-natively-key'] = this.apiKey;
    }
    return h;
  }

  private async post(body: unknown): Promise<any> {
    // Build the headers BEFORE the try. headers() throws when a trial token is
    // missing, and inside the try that permanent configuration error was
    // rewritten as a retryable 'request failed' — so the resolver burned all
    // three probe attempts on it and the one diagnostic string that names the
    // real cause never reached a log.
    const requestHeaders = this.headers();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/embed`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e: any) {
      // Never interpolate the key into a message — these strings reach logs and
      // crash reports.
      const err: any = new Error(e?.name === 'TimeoutError' || e?.name === 'AbortError'
        ? 'Natively embedding request timed out'
        : 'Natively embedding request failed');
      err.retryable = true;
      throw err;
    }

    if (!res.ok) {
      // The server classifies its own failures (`retryable`, `retry_after`,
      // `upstream_status`). Read the body BEFORE deciding anything, because a
      // status-only heuristic gets two cases wrong: it calls a 502
      // `provider_rejected_request` retryable when the server has said it is
      // permanently not, and it cannot distinguish a provider rate limit from a
      // quota refusal — both of which arrive as 429.
      const detail: any = await res.json().catch(() => ({}));
      const err: any = new Error(
        `Natively embedding failed: ${res.status} ${res.statusText}${detail?.error ? ` (${detail.error})` : ''}`
      );
      err.status = res.status;
      err.provider = this.name;
      err.serverError = typeof detail?.error === 'string' ? detail.error : undefined;
      err.upstreamStatus = detail?.upstream_status ?? undefined;
      // 401/403 are structural (revoked/absent key): let the resolver demote
      // immediately instead of retrying a key that will never work.
      err.permanentAuthFailure = res.status === 401 || res.status === 403;
      // Prefer the header, fall back to the body. EmbeddingPipeline.retryAfterMs()
      // honours whichever is present rather than guessing a backoff.
      const retryAfter = res.headers.get('retry-after')
        ?? (typeof detail?.retry_after === 'number' ? String(detail.retry_after) : null);
      if (retryAfter != null) err.retryAfter = retryAfter;
      // The server's explicit verdict WINS. Retrying something it has told us is
      // permanent only spends quota to fail the same way.
      err.retryable = typeof detail?.retryable === 'boolean'
        ? detail.retryable
        : !err.permanentAuthFailure;
      throw err;
    }

    return res.json();
  }

  /**
   * Guard every response against the two ways a vector can be wrong in a way
   * nothing downstream would notice.
   */
  private validate(values: unknown, model: unknown): number[] {
    // The server can serve more than one embedding model, and models of the SAME
    // WIDTH are not interchangeable — a dimension check alone cannot catch a
    // substitution. These vectors are about to be persisted under THIS
    // provider's space key, so anything but the model we asked for is refused.
    //
    // This is also the guard that catches a server misconfiguration: if
    // /v1/embed could not route voyage-4 it answers 503 rather than quietly
    // serving Gemini, but were that ever to change, this is what stops 3072-dim
    // Gemini vectors from being stored as `natively:voyage-4:2048`.
    //
    // Marked retryable and NOT a permanent auth failure on purpose: a drift is a
    // transient server-side breaker state, and EmbeddingPipeline only promotes
    // the local MiniLM fallback after several CONSECUTIVE hard failures. Failing
    // this one call leaves the chunk unembedded for a later retry, which is what
    // we want; flagging it permanent would short-circuit that hysteresis and
    // drop the user onto MiniLM — the exact outcome this provider exists to fix.
    if (typeof model === 'string' && model !== this.model) {
      const err: any = new Error(
        `Natively served embeddings from model '${model}', expected '${this.model}' — `
        + `refusing to store vectors from a different embedding space`
      );
      err.retryable = true;
      err.modelDrift = true;
      throw err;
    }
    if (!Array.isArray(values) || values.length !== this.dimensions) {
      const err: any = new Error(
        `Natively embedding dimension mismatch: expected ${this.dimensions}, got `
        + `${Array.isArray(values) ? values.length : typeof values}`
      );
      err.retryable = true;
      throw err;
    }
    return values as number[];
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    if (this.apiKey === TRIAL_SENTINEL_KEY && !this.trialToken) return false;
    try {
      await this.embed('natively embedding availability probe');
      return true;
    } catch (error: any) {
      // Let the resolver see a structural auth failure and demote at once; any
      // other error is transient and answers "not available right now".
      if (error?.permanentAuthFailure) throw error;
      return false;
    }
  }

  private async embedOne(text: string, inputType: EmbedInputType): Promise<number[]> {
    const data = await this.post({ text, model: this.model, input_type: inputType });
    return this.validate(data?.embedding, data?.model);
  }

  async embed(text: string): Promise<number[]> {
    return this.embedOne(text, 'document');
  }

  /**
   * A query, embedded AS a query.
   *
   * IEmbeddingProvider already draws this distinction by METHOD — embed() is
   * "for storage", embedQuery() is "a search query" — so the asymmetry needs no
   * new parameter, only a provider that stops treating the two as identical.
   * See EmbedInputType for what is and is not established about the effect.
   */
  async embedQuery(text: string): Promise<number[]> {
    return this.embedOne(text, 'query');
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];

    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += SERVER_MAX_BATCH) {
      const slice = texts.slice(i, i + SERVER_MAX_BATCH);
      // ONE request per slice, not one per text: /v1/embed bills per request, so
      // a per-item loop would multiply both latency and cost.
      const data = await this.post({ input: slice, model: this.model, input_type: 'document' });
      const vectors = data?.embeddings;
      if (!Array.isArray(vectors) || vectors.length !== slice.length) {
        const err: any = new Error(
          `Natively batch embedding returned ${Array.isArray(vectors) ? vectors.length : typeof vectors} `
          + `vectors for ${slice.length} inputs`
        );
        err.retryable = true;
        throw err;
      }
      for (const v of vectors) out.push(this.validate(v, data?.model));
    }
    return out;
  }
}
