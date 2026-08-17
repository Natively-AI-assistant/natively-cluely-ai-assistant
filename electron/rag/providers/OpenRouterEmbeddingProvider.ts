import { IEmbeddingProvider, EmbedOptions } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';

// OpenRouter's OpenAI-compatible /v1/embeddings endpoint. Default model is
// NVIDIA Nemotron 3 Embed 1B on the free tier (2048d, 32k context).
//
// Verified endpoint behaviour (probed against the live API):
//  - `input` accepts a string OR an array of strings; a 128-item array returns
//    128 vectors in order.
//  - Vectors come back ALREADY L2-normalized (‖v‖ = 1.0), so no manual
//    normalization is needed.
//  - The model is ASYMMETRIC and honours `input_type`: 'query' vs 'passage' on
//    the same text yields cos ≈ 0.86, and omitting the field is identical to
//    'query'. Documents therefore MUST be sent as 'passage' and searches as
//    'query' or retrieval quality silently degrades.
//  - `dimensions` truncation is rejected ("dimensions must be one of 2048") and
//    `encoding_format: 'base64'` is rejected — send neither.
const DEFAULT_MODEL = 'nvidia/nemotron-3-embed-1b:free';
const DEFAULT_DIMS = 2048;
// The endpoint accepted 128 inputs in one call; stay under that so a batch of
// long chunks can't trip a payload limit. Larger corpora are chunked locally.
const MAX_BATCH_INPUTS = 96;
// Free-tier models are rate-limited per minute/day. A 429 is expected under bulk
// indexing, so retry with capped exponential backoff (honouring Retry-After)
// instead of failing the chunk and leaving the file marked lexical_only.
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 700;
const MAX_BACKOFF_MS = 8_000;

type InputType = 'query' | 'passage';

export class OpenRouterEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'openrouter';
  readonly model: string;
  readonly dimensions: number;
  readonly space: string;

  private readonly endpoint: string;

  constructor(
    private apiKey: string,
    model: string = DEFAULT_MODEL,
    dimensions: number = DEFAULT_DIMS,
    baseUrl: string = process.env.NATIVELY_OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  ) {
    if (!(apiKey || '').trim()) throw new Error('OpenRouterEmbeddingProvider: no API key provided');
    this.apiKey = apiKey.trim();
    this.model = model.trim();
    this.dimensions = dimensions;
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
    this.endpoint = `${baseUrl.replace(/\/+$/, '')}/embeddings`;
  }

  // API key travels in a header, never a URL query string (URLs leak into logs,
  // proxies, and crash reports). HTTP-Referer/X-Title are OpenRouter's optional
  // app-attribution headers.
  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://natively.app',
      'X-Title': 'Natively',
    };
  }

  private isPermanentAuthFailure(status: number): boolean {
    // 402 = out of credits: retrying can't fix it inside this session, so treat
    // it like an auth failure and let the resolver demote immediately rather
    // than burning the probe-retry budget.
    return status === 401 || status === 402 || status === 403;
  }

  private async errorFromResponse(res: Response, operation: string): Promise<Error> {
    const body = await res.text().catch(() => '');
    const message = `OpenRouter ${operation} failed: ${res.status} ${res.statusText} ${body.slice(0, 500)}`;
    return Object.assign(new Error(message), {
      status: res.status,
      provider: this.name,
      permanentAuthFailure: this.isPermanentAuthFailure(res.status),
      retryAfterMs: this.parseRetryAfterMs(res),
    });
  }

  /** Retry-After is seconds or an HTTP date; capped so a hostile value can't stall us. */
  private parseRetryAfterMs(res: Response): number {
    const raw = res.headers?.get?.('retry-after');
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.min(Math.max(0, seconds * 1000), 60_000);
    const at = Date.parse(raw);
    if (!Number.isFinite(at)) return 0;
    return Math.min(Math.max(0, at - Date.now()), 60_000);
  }

  /** Validate a returned vector is a finite-number array of the expected length. */
  private validateVector(values: unknown, ctx: string): number[] {
    if (!Array.isArray(values) || values.length !== this.dimensions) {
      throw new Error(`OpenRouter ${ctx}: expected ${this.dimensions}-dim array, got ${Array.isArray(values) ? values.length : typeof values}`);
    }
    return values as number[];
  }

  /**
   * POST one embeddings request, retrying 429/5xx with capped exponential backoff.
   * Permanent auth failures and malformed-request 4xx propagate on the first hit
   * so the resolver can demote to the next provider without delay.
   */
  private async post(inputs: string[], inputType: InputType, operation: string): Promise<number[][]> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let res: Response;
      try {
        res = await fetch(this.endpoint, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ model: this.model, input: inputs, input_type: inputType }),
        });
      } catch (e: any) {
        if (attempt >= MAX_RETRIES) throw new Error(`OpenRouter ${operation} network error: ${e?.message || e}`);
        await this.sleepForAttempt(attempt++, 0, operation, String(e?.message || e));
        continue;
      }

      if (!res.ok) {
        const error = await this.errorFromResponse(res, operation);
        const status = (error as any).status as number;
        const transient = status === 429 || status >= 500;
        if (!transient || attempt >= MAX_RETRIES) throw error;
        await this.sleepForAttempt(attempt++, (error as any).retryAfterMs || 0, operation, `${status}`);
        continue;
      }

      const data: any = await res.json();
      // OpenRouter can return an OpenAI-style error object with HTTP 200.
      if (data?.error) {
        throw Object.assign(new Error(`OpenRouter ${operation} error: ${JSON.stringify(data.error).slice(0, 500)}`), {
          provider: this.name,
          status: Number(data.error?.code) || undefined,
        });
      }
      const rows = data?.data;
      // Positional mapping to chunk ids means a length mismatch would silently
      // attach the wrong vector to the wrong chunk — fail loudly instead.
      if (!Array.isArray(rows) || rows.length !== inputs.length) {
        throw new Error(`OpenRouter ${operation}: expected ${inputs.length} vectors, got ${Array.isArray(rows) ? rows.length : typeof rows}`);
      }
      return rows.map((row: { embedding: unknown }, i: number) => this.validateVector(row?.embedding, `${operation}[${i}]`));
    }
  }

  private async sleepForAttempt(attempt: number, retryAfterMs: number, operation: string, reason: string): Promise<void> {
    const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
    const delayMs = Math.max(backoff, retryAfterMs);
    console.warn(`[OpenRouterEmbeddingProvider] ${operation} transient failure (${reason}), attempt ${attempt + 1}/${MAX_RETRIES} — backing off ${delayMs}ms`);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.embed('test');
      return true;
    } catch (error: any) {
      if (error?.permanentAuthFailure) throw error;
      return false;
    }
  }

  async embed(text: string, _opts: EmbedOptions = {}): Promise<number[]> {
    const [vector] = await this.post([text], 'passage', 'embedding');
    return vector;
  }

  async embedQuery(text: string, _opts: EmbedOptions = {}): Promise<number[]> {
    const [vector] = await this.post([text], 'query', 'query embedding');
    return vector;
  }

  async embedBatch(texts: string[], _opts: EmbedOptions = {}): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let start = 0; start < texts.length; start += MAX_BATCH_INPUTS) {
      const batch = texts.slice(start, start + MAX_BATCH_INPUTS);
      try {
        out.push(...await this.post(batch, 'passage', 'batch embedding'));
      } catch (error: any) {
        if (error?.permanentAuthFailure) throw error;
        // A batch-level failure (payload size, partial upstream outage) must not
        // lose the whole file: fall back to serial single embeds, which keep
        // order and carry their own 429 backoff.
        console.warn(`[OpenRouterEmbeddingProvider] batch ${start}-${start + batch.length - 1} failed: ${error?.message || error}. Falling back to serial.`);
        for (const text of batch) out.push(await this.embed(text));
      }
    }
    return out;
  }
}
