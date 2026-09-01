import { IEmbeddingProvider } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';

/**
 * A user-hosted, OpenAI-compatible embedding endpoint.
 *
 * Covers LM Studio (http://localhost:1234/v1), llama.cpp's llama-server
 * (http://localhost:8080/v1, started with `--embedding` and a pooling type other
 * than `none`), vLLM, text-embeddings-inference and LiteLLM proxies — they all
 * expose the same POST /v1/embeddings, so one provider serves all of them.
 *
 * Contract (verified against LM Studio and llama.cpp docs, 2026-08-29):
 *   POST {base}/embeddings  {model, input: string | string[]}
 *     -> {data: [{index, embedding: number[]}], model}
 */

const REQUEST_TIMEOUT_MS = 30_000;

export interface CustomEmbeddingOptions {
  baseUrl: string;
  model: string;
  /** MEASURED width. Never a declared one — see customEmbeddingModels.ts. */
  dimensions: number;
  /** Optional. LM Studio and llama.cpp need none; proxies often do. */
  apiKey?: string;
}

/**
 * Normalize a user-typed endpoint.
 *
 * People paste `http://localhost:1234` (what LM Studio's UI shows) as often as
 * `http://localhost:1234/v1`. Appending /v1 only when no path is present keeps
 * a proxy mounted under a prefix (`https://gw/proxy/v1`) intact — rewriting that
 * would break the very deployments this provider exists for.
 *
 * TWO TRAPS IN `new URL()`, both of which used to pass:
 *
 *  1. `localhost:1234` PARSES. `localhost:` is read as the scheme and `1234` as
 *     the path, leaving the host EMPTY — so it was stored as a valid endpoint
 *     and every request then failed with "could not reach the endpoint", which
 *     sends the user to check their server instead of their typo. Dropping the
 *     scheme is the single most likely thing to type, so it is coerced to
 *     `http://` rather than rejected.
 *  2. Any scheme parses. `ftp://host/v1` was accepted and stored.
 *
 * So: coerce a scheme-less input, then require http/https AND a real host.
 *
 * Returns null for blank or unusable input so callers can distinguish
 * "not configured" from "configured wrongly".
 */
export function normalizeCustomBaseUrl(raw?: string | null): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const withoutTrailing = trimmed.replace(/\/+$/, '');

  // `host:port` and bare `host` get http://; anything already carrying a
  // scheme is left alone so the protocol check below can reject it honestly.
  //
  // Tested against `trimmed`, NOT `withoutTrailing`: stripping trailing slashes
  // turns "http://" into "http:", which no longer looks like a scheme and would
  // be coerced into "http://http:" — a URL with the host "http" that then
  // parses cleanly and is stored.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? withoutTrailing : `http://${withoutTrailing}`;

  let parsed: URL;
  try { parsed = new URL(candidate); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.host) return null;

  // No path at all (or just "/") → this is a bare host; add the conventional /v1.
  if (parsed.pathname === '' || parsed.pathname === '/') return `${candidate}/v1`;
  return candidate;
}

/** Host identity used in the space key. */
function hostOf(baseUrl: string): string {
  try { return new URL(baseUrl).host; } catch { return 'unknown'; }
}

export class CustomEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'custom';
  readonly model: string;
  readonly dimensions: number;
  readonly space: string;

  private readonly baseUrl: string | null;
  private readonly apiKey?: string;

  constructor(opts: CustomEmbeddingOptions) {
    this.baseUrl = normalizeCustomBaseUrl(opts.baseUrl);
    this.model = opts.model;
    this.dimensions = opts.dimensions;
    this.apiKey = opts.apiKey;
    // The space carries the HOST as well as the model. Every other provider has
    // exactly one meaning per model id; "custom" does not — two servers can
    // serve genuinely different weights under the same name, and comparing those
    // vectors yields nonsense with no error. A false re-index when the endpoint
    // moves is recoverable; silent incomparability is not.
    this.space = embeddingSpaceKey({
      name: `${this.name}@${this.baseUrl ? hostOf(this.baseUrl) : 'unset'}`,
      model: this.model,
      dimensions: this.dimensions,
    });
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private async post(input: string | string[]): Promise<any> {
    if (!this.baseUrl) {
      const err: any = new Error('No custom embedding endpoint configured');
      err.retryable = false;
      throw err;
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model: this.model, input }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e: any) {
      // Never interpolate the key or the raw cause — these strings reach logs.
      const err: any = new Error(e?.name === 'TimeoutError' || e?.name === 'AbortError'
        ? 'Custom embedding endpoint timed out'
        : 'Could not reach the custom embedding endpoint');
      err.retryable = true;
      throw err;
    }

    if (!res.ok) {
      const err: any = new Error(
        `Custom embedding endpoint failed: ${res.status} ${res.statusText}`
        + (res.status === 404 ? ' — check the endpoint URL and that the model is loaded.' : '')
      );
      err.status = res.status;
      err.provider = this.name;
      err.permanentAuthFailure = res.status === 401 || res.status === 403;
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
        `Custom embedding dimension mismatch: expected ${this.dimensions}, got `
        + `${Array.isArray(values) ? values.length : typeof values}. `
        + 'Re-select the model so its size is measured again.'
      );
      err.retryable = true;
      throw err;
    }
    return values as number[];
  }

  async isAvailable(): Promise<boolean> {
    if (!this.baseUrl || !this.model) return false;
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

  /** These servers apply no query/document asymmetry, so a query embeds like a document. */
  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    const data = await this.post(texts);
    const rows = data?.data;
    if (!Array.isArray(rows) || rows.length !== texts.length) {
      const err: any = new Error(
        `Custom embedding returned ${Array.isArray(rows) ? rows.length : typeof rows} vectors `
        + `for ${texts.length} inputs — refusing a partial batch.`
      );
      err.retryable = true;
      throw err;
    }
    // ORDER BY data[].index, never by array position. The OpenAI schema carries
    // an index precisely because a server may return out of order; trusting
    // position pairs vectors with the wrong chunks, which looks fine and
    // retrieves nonsense.
    const out = new Array<number[]>(texts.length);
    rows.forEach((row: any, i: number) => {
      const at = Number.isInteger(row?.index) ? row.index : i;
      if (at < 0 || at >= texts.length) {
        const err: any = new Error(`Custom embedding returned an out-of-range index (${at})`);
        err.retryable = true;
        throw err;
      }
      out[at] = this.validate(row?.embedding);
    });
    for (let i = 0; i < out.length; i++) {
      if (!out[i]) {
        const err: any = new Error(`Custom embedding did not return a vector for input ${i}`);
        err.retryable = true;
        throw err;
      }
    }
    return out;
  }
}
