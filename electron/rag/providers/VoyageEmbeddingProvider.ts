import { IEmbeddingProvider } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';

/**
 * Voyage AI embeddings. Verified against docs.voyageai.com (2026-08-31):
 *
 *   POST https://api.voyageai.com/v1/embeddings
 *     {model, input: string | string[], input_type?: 'query'|'document',
 *      output_dimension?, output_dtype?, truncation?}
 *     -> {data: [{object, embedding, index}], model, usage:{total_tokens}}
 *
 * WHAT MAKES VOYAGE DIFFERENT: `input_type`. Every other provider wired here is
 * symmetric — a query embeds exactly like a document, which is why their
 * embedQuery() just calls embed(). Voyage asks which you are embedding and
 * produces a different vector accordingly. Both still land in ONE space (a query
 * must be able to match a document); the asymmetry is in how they are made.
 *
 * Getting it wrong is SILENT: nothing errors, retrieval simply gets worse.
 */

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_BASE_URL = 'https://api.voyageai.com/v1';

/** Documented cap: the input list may hold at most 1,000 strings. */
export const VOYAGE_MAX_BATCH = 1000;

export interface VoyageEmbeddingOptions {
  apiKey: string;
  model: string;
  /** Output width. Voyage's configurable models take 256 | 512 | 1024 | 2048. */
  dimensions: number;
  baseUrl?: string;
}

export class VoyageEmbeddingProvider implements IEmbeddingProvider {
  /**
   * Models that accept `output_dimension`. VERIFIED LIVE against the API
   * (2026-08-31), not inferred from prose: voyage-code-4 accepts 512 and 2048
   * (the docs' support list omits it), while voyage-finance-2 and voyage-law-2
   * answer 400 —
   *   "Value '512' supplied for argument 'output_dimension' is not valid"
   * — so sending the parameter to them breaks an otherwise working model.
   */
  static supportsOutputDimension(model: string): boolean {
    const m = (model || '').trim();
    return /^voyage-(4|4-large|4-lite|code-4|3-large|3\.5|3\.5-lite|3-5|3-5-lite|code-3|code-3\.5|code-3-5)$/i.test(m);
  }

  readonly name = 'voyage';
  readonly model: string;
  readonly dimensions: number;
  readonly space: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: VoyageEmbeddingOptions) {
    this.apiKey = (opts.apiKey || '').trim();
    this.model = opts.model;
    this.dimensions = opts.dimensions;
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    // Deliberately distinct from `openrouter:voyageai/<model>:<dims>`. The two
    // routes may well produce identical vectors, but nothing here can verify
    // that, and assuming it would silently mix two indexes.
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
  }

  private async post(input: string | string[], inputType: 'query' | 'document'): Promise<any> {
    if (!this.apiKey) {
      const err: any = new Error('No Voyage API key configured');
      err.retryable = false;
      throw err;
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          input,
          input_type: inputType,
          // Only for models that accept it — finance-2 and law-2 return 400.
          ...(VoyageEmbeddingProvider.supportsOutputDimension(this.model)
            ? { output_dimension: this.dimensions }
            : {}),
          // Explicit: int8/binary return a bit-packed list an eighth the length,
          // which would fail validation in a way that looks like a wrong model.
          output_dtype: 'float',
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e: any) {
      // Never interpolate the key or raw cause — these strings reach logs.
      const err: any = new Error(e?.name === 'TimeoutError' || e?.name === 'AbortError'
        ? 'Voyage embedding request timed out'
        : 'Could not reach Voyage');
      err.retryable = true;
      throw err;
    }

    if (!res.ok) {
      const err: any = new Error(`Voyage embedding failed: ${res.status} ${res.statusText}`);
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
        `Voyage embedding dimension mismatch: expected ${this.dimensions}, got `
        + `${Array.isArray(values) ? values.length : typeof values}. `
        + 'Re-select the model so its size is measured again.'
      );
      err.retryable = true;
      throw err;
    }
    return values as number[];
  }

  /** One request's worth, ordered by the response's own index. */
  private order(rows: any, expected: number): number[][] {
    if (!Array.isArray(rows) || rows.length !== expected) {
      const err: any = new Error(
        `Voyage returned ${Array.isArray(rows) ? rows.length : typeof rows} vectors `
        + `for ${expected} inputs — refusing a partial batch.`
      );
      err.retryable = true;
      throw err;
    }
    const out = new Array<number[]>(expected);
    rows.forEach((row: any, i: number) => {
      const at = Number.isInteger(row?.index) ? row.index : i;
      if (at < 0 || at >= expected) {
        const err: any = new Error(`Voyage returned an out-of-range index (${at})`);
        err.retryable = true;
        throw err;
      }
      out[at] = this.validate(row?.embedding);
    });
    for (let i = 0; i < expected; i++) {
      if (!out[i]) {
        const err: any = new Error(`Voyage did not return a vector for input ${i}`);
        err.retryable = true;
        throw err;
      }
    }
    return out;
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
    const data = await this.post(text, 'document');
    return this.validate(data?.data?.[0]?.embedding);
  }

  /** A QUERY, not a document — this is the whole reason to use Voyage directly. */
  async embedQuery(text: string): Promise<number[]> {
    const data = await this.post(text, 'query');
    return this.validate(data?.data?.[0]?.embedding);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];

    // Split at the documented cap. Each response restarts its index at 0, so the
    // slices are ordered INDEPENDENTLY and then concatenated in caller order —
    // merging them by a global index would pair chunks with the wrong vectors,
    // which surfaces as poor retrieval rather than as an error.
    const out: number[][] = [];
    for (let start = 0; start < texts.length; start += VOYAGE_MAX_BATCH) {
      const slice = texts.slice(start, start + VOYAGE_MAX_BATCH);
      const data = await this.post(slice, 'document');
      out.push(...this.order(data?.data, slice.length));
    }
    return out;
  }
}
