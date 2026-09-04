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

/** The model the server runs as its embedding primary (natively-api EMBED_PRIMARY_MODEL). */
const MODEL = 'gemini-embedding-2';

/**
 * natively-api EMBED_DIMS. Every model there is requested at this width.
 * MUST match the server: the client declares this in its space key, and a
 * mismatch would stamp the wrong width over the vectors.
 */
const DIMENSIONS = 3072;

/**
 * Server-side per-request batch cap (natively-api DEFAULT_MAX_BATCH). Larger
 * batches are SPLIT here rather than rejected: the caller is chunking a
 * document, and making it care about our transport's cap would just push the
 * same loop up a layer.
 */
const SERVER_MAX_BATCH = 32;

const REQUEST_TIMEOUT_MS = 30_000;

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
      const err: any = new Error(`Natively embedding failed: ${res.status} ${res.statusText}`);
      err.status = res.status;
      err.provider = this.name;
      // 401/403 are structural (revoked/absent key): let the resolver demote
      // immediately instead of retrying a key that will never work.
      err.permanentAuthFailure = res.status === 401 || res.status === 403;
      // Surfaced so EmbeddingPipeline.retryAfterMs() can honour the server's own
      // backoff instead of guessing — a quota 429 has a real reset time.
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter != null) err.retryAfter = retryAfter;
      err.retryable = !err.permanentAuthFailure;
      throw err;
    }

    return res.json();
  }

  /**
   * Guard every response against the two ways a vector can be wrong in a way
   * nothing downstream would notice.
   */
  private validate(values: unknown, model: unknown): number[] {
    // The server falls back gemini-embedding-2 → gemini-embedding-001 behind a
    // circuit breaker. BOTH RETURN 768 DIMENSIONS, so a dimension check cannot
    // catch it — but they are incompatible vector spaces, and these vectors are
    // about to be persisted under THIS provider's space key. Refuse.
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

  async embed(text: string): Promise<number[]> {
    const data = await this.post({ text });
    return this.validate(data?.embedding, data?.model);
  }

  /**
   * The server applies no query/document asymmetry (POST /v1/embed takes no task
   * hint), so a query embeds exactly like a document. Kept explicit so it is
   * clear this is the server's contract rather than an oversight here.
   */
  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];

    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += SERVER_MAX_BATCH) {
      const slice = texts.slice(i, i + SERVER_MAX_BATCH);
      // ONE request per slice, not one per text: /v1/embed bills per request, so
      // a per-item loop would multiply both latency and cost.
      const data = await this.post({ input: slice });
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
