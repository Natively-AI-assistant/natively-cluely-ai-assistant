import { IEmbeddingProvider } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';

/**
 * 9Router embeddings — one self-hosted endpoint, many vendors' embedding models.
 *
 * Verified against a live instance (2026-09-21):
 *   POST {base}/embeddings  {model, input: string | string[], dimensions?}
 *     -> {data: [{index, embedding}]}   (OpenAI-shaped)
 *   GET  {base}/models/embedding  -> the catalogue; 6 models on a stock install
 *
 * Shaped like OpenRouterEmbeddingProvider, with two differences that both come
 * from 9Router being something the USER RUNS rather than a service they call.
 *
 * ── The space key carries the HOST ──────────────────────────────────────────
 * OpenRouter's provider explains why it does not: "OpenRouter is a single
 * service, so a model id means one thing. (For a self-hosted endpoint it means
 * whatever that box is serving, which is why that one keys on host.)" 9Router is
 * precisely that self-hosted case — its catalogue can include
 * `openai-compatible-*` and `custom-embedding-*` entries pointed at whatever
 * baseUrl their owner configured, so a model id is only meaningful together
 * with the instance serving it. CustomEmbeddingProvider states the trade-off
 * this accepts: "A false re-index when the endpoint moves is recoverable;
 * silent incomparability is not."
 *
 * ── A missing key is the SERVER's call, not ours ────────────────────────────
 * 9Router's REQUIRE_API_KEY defaults to false, so a keyless instance is a
 * legitimate configuration. OpenRouter's provider throws before it sends when
 * no key is set; doing that here would break a working local install. The base
 * URL is the presence gate everywhere else in this integration, and it is here
 * too.
 *
 * ── Dimensions are MEASURED, never declared ─────────────────────────────────
 * Sharper than OpenRouter's version of the same rule: `/v1/models/info` reports
 * no dimension at all for 5 of the 6 embedding models a stock instance serves,
 * and `dimensions` is forwarded upstream where only OpenAI v3 models honour it.
 * So the returned length is the only authority, and it is checked on every call.
 */

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_BASE_URL = 'http://localhost:20128/v1';

/** The host, for the space key. Falls back to the raw string if it will not parse. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

export interface NinerouterEmbeddingOptions {
  /** Optional: a stock instance runs with REQUIRE_API_KEY=false. */
  apiKey?: string;
  model: string;
  /** MEASURED width — see the class docblock. Never a declared or assumed value. */
  dimensions: number;
  baseUrl?: string;
  /** Injected in tests; production uses global fetch. */
  fetchImpl?: typeof fetch;
}

export class NinerouterEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'ninerouter';
  readonly model: string;
  readonly dimensions: number;
  readonly space: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: NinerouterEmbeddingOptions) {
    this.apiKey = (opts.apiKey || '').trim();
    this.model = opts.model;
    this.dimensions = opts.dimensions;
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl || fetch;
    this.space = embeddingSpaceKey({
      name: `${this.name}@${hostOf(this.baseUrl)}`,
      model: this.model,
      dimensions: this.dimensions,
    });
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    // Only when present: an empty Bearer is worse than none on the instances
    // that do check.
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private async post(input: string | string[]): Promise<any> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: this.headers(),
        // The requested width is sent, and then VERIFIED on the way back —
        // 9Router forwards this upstream and most models ignore it.
        body: JSON.stringify({ model: this.model, input, dimensions: this.dimensions }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e: any) {
      // Never interpolate the key or the raw cause — these strings reach logs,
      // and a transport error's message can contain the request it was making.
      const err: any = new Error(e?.name === 'TimeoutError' || e?.name === 'AbortError'
        ? '9Router embedding request timed out'
        : 'Could not reach 9Router');
      err.retryable = true;
      throw err;
    }

    if (!res.ok) {
      // Read the body before classifying: on 9Router a 401 has TWO meanings and
      // only the body separates them. Measured on a live instance —
      //
      //   ours:    {"error":{"message":"Missing API key",
      //                      "type":"authentication_error","code":"invalid_api_key"}}
      //   relayed: {"error":{"message":"[gemini/text-embedding-004] [401]: The
      //                      bound service account is deleted or disabled."}}
      //
      // — and in the second case a SIBLING model on the same instance and the
      // same key embeds fine at 3072d. 9Router propagates the upstream's status
      // verbatim, so one dead vendor account surfaces as a top-level 401.
      //
      // That distinction is load-bearing. isAvailable() rethrows on
      // permanentAuthFailure, which tells the resolver the credential itself is
      // dead; the resolver then demotes, and a demotion changes the active
      // embedding SPACE and strands every persisted vector. Letting one broken
      // upstream model do that would be a corpus-wide re-index triggered by a
      // model the user could simply have stopped choosing.
      let body: any = null;
      try { body = await res.json(); } catch { /* not JSON, or already consumed */ }
      const message: string = body?.error?.message || '';
      const isRelayedUpstream = /^\[[^\]]+\]\s*\[\d+\]/.test(message);
      const isOurAuthError = body?.error?.type === 'authentication_error'
        || body?.error?.code === 'invalid_api_key';

      const err: any = new Error(
        `9Router embedding failed: ${res.status} ${res.statusText}${message ? ` — ${message}` : ''}`
      );
      err.status = res.status;
      err.provider = this.name;
      err.permanentAuthFailure = (res.status === 401 || res.status === 403)
        && isOurAuthError && !isRelayedUpstream;
      err.upstreamRelayed = isRelayedUpstream;
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter != null) err.retryAfter = retryAfter;
      err.retryable = !err.permanentAuthFailure;
      throw err;
    }
    return res.json();
  }

  private validate(values: unknown): number[] {
    if (!Array.isArray(values) || values.length !== this.dimensions) {
      const err: any = new Error(
        `9Router embedding dimension mismatch: expected ${this.dimensions}, got `
        + `${Array.isArray(values) ? values.length : typeof values}. `
        + 'Re-select the model so its size is measured again.'
      );
      err.retryable = true;
      throw err;
    }
    return values as number[];
  }

  async isAvailable(): Promise<boolean> {
    if (!this.model) return false;
    try {
      await this.embed('natively embedding availability probe');
      return true;
    } catch (error: any) {
      if (error?.permanentAuthFailure) throw error;
      return false;
    }
  }

  async embed(text: string): Promise<number[]> {
    const data = await this.post(text);
    return this.validate(data?.data?.[0]?.embedding);
  }

  /** 9Router applies no query/document asymmetry, so a query embeds like a document. */
  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    const data = await this.post(texts);
    const rows = data?.data;
    if (!Array.isArray(rows) || rows.length !== texts.length) {
      const err: any = new Error(
        `9Router returned ${Array.isArray(rows) ? rows.length : typeof rows} vectors `
        + `for ${texts.length} inputs — refusing a partial batch.`
      );
      err.retryable = true;
      throw err;
    }
    // ORDER BY data[].index, never array position: the schema carries the index
    // precisely because a server may return out of order, and trusting position
    // pairs vectors with the wrong chunks — it looks fine and retrieves nonsense.
    const out = new Array<number[]>(texts.length);
    rows.forEach((row: any, i: number) => {
      const at = Number.isInteger(row?.index) ? row.index : i;
      if (at < 0 || at >= texts.length) {
        const err: any = new Error(`9Router returned an out-of-range index (${at})`);
        err.retryable = true;
        throw err;
      }
      out[at] = this.validate(row?.embedding);
    });
    for (let i = 0; i < out.length; i++) {
      if (!out[i]) {
        const err: any = new Error(`9Router did not return a vector for input ${i}`);
        err.retryable = true;
        throw err;
      }
    }
    return out;
  }
}
