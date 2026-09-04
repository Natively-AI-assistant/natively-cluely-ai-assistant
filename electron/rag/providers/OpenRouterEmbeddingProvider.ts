import { IEmbeddingProvider } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';

/**
 * OpenRouter embeddings — one key, many vendors' embedding models.
 *
 * Verified against openrouter.ai docs and a live probe (2026-08-31):
 *   POST {base}/embeddings  {model, input: string | string[], dimensions?}
 *     -> {data: [{index, embedding}]}   (OpenAI-shaped)
 *
 * Model ids are namespaced (`voyageai/voyage-4-lite`) and may carry a variant
 * suffix (`nvidia/nemotron-3-embed-1b:free`), both of which are part of the
 * identity and are kept verbatim in the space key.
 *
 * Unlike CustomEmbeddingProvider the space does NOT include the host: OpenRouter
 * is a single service, so a model id means one thing. (For a self-hosted endpoint
 * it means whatever that box is serving, which is why that one keys on host.)
 */

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export interface OpenRouterEmbeddingOptions {
  apiKey: string;
  model: string;
  /** MEASURED width. OpenRouter's model list carries no dimension field, and not
   *  every upstream model honours `dimensions`, so it is probed, never declared. */
  dimensions: number;
  baseUrl?: string;
}

export class OpenRouterEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'openrouter';
  readonly model: string;
  readonly dimensions: number;
  readonly space: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: OpenRouterEmbeddingOptions) {
    this.apiKey = (opts.apiKey || '').trim();
    this.model = opts.model;
    this.dimensions = opts.dimensions;
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      // OpenRouter attributes usage per app via these. Harmless elsewhere, and it
      // makes Natively's traffic identifiable on the user's own dashboard.
      'HTTP-Referer': 'https://natively.software',
      'X-Title': 'Natively',
    };
  }

  private async post(input: string | string[]): Promise<any> {
    if (!this.apiKey) {
      const err: any = new Error('No OpenRouter API key configured');
      err.retryable = false;
      throw err;
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: this.headers(),
        // Send the requested width. OpenRouter forwards `dimensions` upstream,
        // and not every model behind it honours the parameter — so the caller
        // MUST verify the returned length rather than trust the request (see
        // the set-config probe, which refuses a model that ignores it).
        body: JSON.stringify({ model: this.model, input, dimensions: this.dimensions }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e: any) {
      // Never interpolate the key or raw cause — these strings reach logs.
      const err: any = new Error(e?.name === 'TimeoutError' || e?.name === 'AbortError'
        ? 'OpenRouter embedding request timed out'
        : 'Could not reach OpenRouter');
      err.retryable = true;
      throw err;
    }

    if (!res.ok) {
      const err: any = new Error(`OpenRouter embedding failed: ${res.status} ${res.statusText}`);
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
        `OpenRouter embedding dimension mismatch: expected ${this.dimensions}, got `
        + `${Array.isArray(values) ? values.length : typeof values}. `
        + 'Re-select the model so its size is measured again.'
      );
      err.retryable = true;
      throw err;
    }
    return values as number[];
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey || !this.model) return false;
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

  /** OpenRouter applies no query/document asymmetry, so a query embeds like a document. */
  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    const data = await this.post(texts);
    const rows = data?.data;
    if (!Array.isArray(rows) || rows.length !== texts.length) {
      const err: any = new Error(
        `OpenRouter returned ${Array.isArray(rows) ? rows.length : typeof rows} vectors `
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
        const err: any = new Error(`OpenRouter returned an out-of-range index (${at})`);
        err.retryable = true;
        throw err;
      }
      out[at] = this.validate(row?.embedding);
    });
    for (let i = 0; i < out.length; i++) {
      if (!out[i]) {
        const err: any = new Error(`OpenRouter did not return a vector for input ${i}`);
        err.retryable = true;
        throw err;
      }
    }
    return out;
  }
}
