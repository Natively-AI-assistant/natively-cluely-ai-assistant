import { describeProbeError } from './probeError';
import { IEmbeddingProvider } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';

/**
 * Models that accept the `dimensions` parameter. Per OpenAI's embeddings guide,
 * only the text-embedding-3 series can shorten output; ada-002 is fixed at 1536
 * and REJECTS the parameter, so it must never be sent for it.
 */
const SUPPORTS_DIMENSIONS = /^text-embedding-3-/;

export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'openai';
  readonly dimensions: number;
  readonly model: string;
  readonly space: string;
  private readonly baseUrl: string;

  constructor(
    private apiKey: string,
    model = 'text-embedding-3-small',
    dimensions?: number,
    baseUrl = 'https://api.openai.com/v1',
  ) {
    this.model = model;
    // Default to the model's own documented width rather than a single constant:
    // 3-large is 3072, 3-small and ada-002 are 1536.
    this.dimensions = dimensions ?? (model === 'text-embedding-3-large' ? 3072 : 1536);
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
  }

  /** Request body, omitting `dimensions` for models that reject it. */
  private body(input: string | string[]): string {
    const payload: Record<string, unknown> = { model: this.model, input };
    if (SUPPORTS_DIMENSIONS.test(this.model)) payload.dimensions = this.dimensions;
    return JSON.stringify(payload);
  }

  /** Reject a wrong-length vector rather than let it into the index. */
  private validate(values: unknown): number[] {
    if (!Array.isArray(values) || values.length !== this.dimensions) {
      const err: any = new Error(
        `OpenAI embedding dimension mismatch: expected ${this.dimensions}, got `
        + `${Array.isArray(values) ? values.length : typeof values}`
      );
      err.retryable = true;
      throw err;
    }
    return values as number[];
  }

  private async errorFromResponse(res: Response, operation: string): Promise<Error> {
    const body = await res.text().catch(() => '');
    const message = `OpenAI ${operation} failed: ${res.status} ${res.statusText} ${body.slice(0, 500)}`;
    return Object.assign(new Error(message), {
      status: res.status,
      provider: this.name,
      permanentAuthFailure: res.status === 401 || res.status === 403,
      quotaExhausted: res.status === 429 && isOpenAiQuotaExhaustedBody(body),
    });
  }

  /**
   * Why the last isAvailable() returned false, or null after a success.
   * isAvailable() keeps its boolean contract (other callers rely on it not
   * throwing for a 429); the startup resolver reads this to tell an account
   * that is out of credits from an ordinary rate limit.
   */
  public lastProbeError: (Error & { status?: number; quotaExhausted?: boolean }) | null = null;

  async isAvailable(): Promise<boolean> {
    // Fast check — just validate the key format and do a single test embed
    try {
      await this.embed('test');
      this.lastProbeError = null;
      return true;
    } catch (error: any) {
      this.lastProbeError = error ?? null;
      if (error?.permanentAuthFailure) throw error;
      // Say why — see probeError.ts.
      console.warn(`[OpenAIEmbeddingProvider] availability probe failed: ${describeProbeError(error)}`);
      return false;
    }
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: this.body(text)
    });
    if (!res.ok) throw await this.errorFromResponse(res, 'embedding');
    const data = await res.json();
    return this.validate(data.data[0].embedding);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text); // text-embedding-3-small is symmetric
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: this.body(texts)
    });
    if (!res.ok) throw await this.errorFromResponse(res, 'batch embedding');
    const data = await res.json();
    // Order by the response's own index, never array position — the schema
    // carries it because a server may return out of order.
    const rows = data.data as Array<{ index?: number; embedding: number[] }>;
    // The same three guards every sibling provider carries. Without them a short
    // response leaves undefined HOLES that reach VectorStore.storeEmbedding, and
    // an out-of-range index silently extends the array — either way a chunk gets
    // paired with the wrong vector, or none.
    if (!Array.isArray(rows) || rows.length !== texts.length) {
      const err: any = new Error(
        `OpenAI returned ${Array.isArray(rows) ? rows.length : typeof rows} vectors `
        + `for ${texts.length} inputs — refusing a partial batch.`
      );
      err.retryable = true;
      throw err;
    }
    const out = new Array<number[]>(texts.length);
    rows.forEach((row, i) => {
      const at = Number.isInteger(row?.index) ? (row.index as number) : i;
      if (at < 0 || at >= texts.length) {
        const err: any = new Error(`OpenAI returned an out-of-range index (${at})`);
        err.retryable = true;
        throw err;
      }
      out[at] = this.validate(row?.embedding);
    });
    for (let i = 0; i < out.length; i++) {
      if (!out[i]) {
        const err: any = new Error(`OpenAI did not return a vector for input ${i}`);
        err.retryable = true;
        throw err;
      }
    }
    return out;
  }
}

/**
 * OpenAI answers 429 for two different things. A rate limit clears in seconds
 * and is worth retrying; an account with no credits (`insufficient_quota`)
 * answers the same way every time until the user adds credits. Matched on the
 * error code/type first; the message text is a fallback for gateways that
 * rewrite the body.
 */
export function isOpenAiQuotaExhaustedBody(body: string): boolean {
  const text = String(body || '');
  if (!text) return false;
  try {
    const err = JSON.parse(text)?.error;
    if (err && (err.code === 'insufficient_quota' || err.type === 'insufficient_quota')) return true;
    if (err && typeof err.message === 'string' && QUOTA_EXHAUSTED_MESSAGE_RE.test(err.message)) return true;
    return false;
  } catch {
    return QUOTA_EXHAUSTED_MESSAGE_RE.test(text);
  }
}
const QUOTA_EXHAUSTED_MESSAGE_RE = /insufficient_quota|no credits remaining|exceeded your current quota/i;
