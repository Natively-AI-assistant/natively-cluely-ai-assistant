import { IEmbeddingProvider, EmbedOptions } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';

// gemini-embedding-2 (multimodal, April 2026). Its vector space is INCOMPATIBLE
// with gemini-embedding-001 — switching models re-indexes all data automatically
// because the composite `space` key changes (see embeddingSpace.ts).
//
// Key v2 API differences from v1, all handled below:
//  - NO `task_type` param. The task is baked into the prompt text instead.
//  - Batch must use `batchEmbedContents` with SEPARATE Content objects. Multiple
//    parts inside ONE Content aggregate into a single vector (wrong for us).
//  - v2 auto-normalizes truncated (non-3072) dimensions, so no manual L2 needed.
const DEFAULT_MODEL = 'gemini-embedding-2';
// 768 keeps us on the existing vec_chunks_768 table (already in KNOWN_DIMS) —
// lowest-risk dimension choice for the migration.
const DEFAULT_DIMS = 768;
// Gemini rejects batchEmbedContents requests with >100 items. Chunk locally so a
// large PDF doesn't fall back to hundreds of serial embedContent calls and blow
// through per-minute quota.
const MAX_BATCH_REQUESTS = 100;

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'gemini';
  readonly model: string;
  readonly dimensions: number;
  readonly space: string;

  constructor(
    private apiKey: string,
    model: string = DEFAULT_MODEL,
    dimensions: number = DEFAULT_DIMS,
  ) {
    // Accept a bare id or a 'models/'-prefixed id; store bare for the space key,
    // re-add the prefix on the wire.
    this.model = model.replace(/^models\//, '');
    this.dimensions = dimensions;
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
  }

  async isAvailable(): Promise<boolean> {
    try { await this.embed('test'); return true; } catch { return false; }
  }

  // ── v2 prompt formatting (task baked into text; no task_type param) ──────────
  private formatDocument(text: string, title?: string): string {
    return `title: ${title && title.trim() ? title.trim() : 'none'} | text: ${text}`;
  }
  private formatQuery(text: string, hint: EmbedOptions['taskHint']): string {
    return hint === 'code'
      ? `task: code retrieval | query: ${text}`
      : `task: search result | query: ${text}`;
  }

  // API key goes in a header, NOT the URL query string — URLs leak into logs,
  // proxies, and crash reports.
  private get headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey };
  }
  private url(method: 'embedContent' | 'batchEmbedContents'): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:${method}`;
  }

  /** Validate a returned vector is a finite-number array of the expected length. */
  private validateVector(values: unknown, ctx: string): number[] {
    if (!Array.isArray(values) || values.length !== this.dimensions) {
      throw new Error(`Gemini v2 ${ctx}: expected ${this.dimensions}-dim array, got ${Array.isArray(values) ? values.length : typeof values}`);
    }
    return values as number[];
  }

  // ── Single document embed ───────────────────────────────────────────────────
  async embed(text: string, opts: EmbedOptions = {}): Promise<number[]> {
    const formatted = this.formatDocument(text, opts.title);
    const res = await fetch(this.url('embedContent'), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        content: { parts: [{ text: formatted }] },
        outputDimensionality: this.dimensions, // v2 auto-normalizes truncated dims
      })
    });
    if (!res.ok) {
      throw new Error(`Gemini v2 embed failed: ${res.status} ${res.statusText} ${await res.text().catch(() => '')}`);
    }
    const data = await res.json();
    return this.validateVector(data?.embedding?.values, 'embed');
  }

  // ── Asymmetric retrieval query ──────────────────────────────────────────────
  async embedQuery(text: string, opts: EmbedOptions = {}): Promise<number[]> {
    const formatted = this.formatQuery(text, opts.taskHint);
    const res = await fetch(this.url('embedContent'), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        content: { parts: [{ text: formatted }] },
        outputDimensionality: this.dimensions,
      })
    });
    if (!res.ok) {
      throw new Error(`Gemini v2 query embed failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return this.validateVector(data?.embedding?.values, 'embedQuery');
  }

  // ── Batch: SEPARATE Content objects via batchEmbedContents ───────────────────
  // One request per text → one vector per text, order preserved. NOT a single
  // multi-part Content (that would aggregate into one vector).
  async embedBatch(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];

    for (let start = 0; start < texts.length; start += MAX_BATCH_REQUESTS) {
      const batch = texts.slice(start, start + MAX_BATCH_REQUESTS);
      const requests = batch.map(t => ({
        model: `models/${this.model}`,
        content: { parts: [{ text: this.formatDocument(t, opts.title) }] },
        outputDimensionality: this.dimensions,
      }));
      let res: Response;
      try {
        res = await fetch(this.url('batchEmbedContents'), {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ requests })
        });
      } catch (e: any) {
        console.warn(`[GeminiEmbeddingProvider] batchEmbedContents network error, falling back to serial for batch ${start}-${start + batch.length - 1}: ${e?.message || e}`);
        out.push(...await this.embedSerial(batch, opts));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // 429: rate-limited on this sub-batch only. Treat it like any other batch-
        // endpoint failure: serial-embed the rate-limited slice, continue with the
        // rest of the batches. Throwing here would discard successfully-embedded
        // prior sub-batches and force the caller to re-embed them via fallback.
        if (res.status === 429) {
          console.warn(`[GeminiEmbeddingProvider] batchEmbedContents 429 for batch ${start}-${start + batch.length - 1}: ${body}. Falling back to serial for this sub-batch.`);
          out.push(...await this.embedSerial(batch, opts));
          continue;
        }
        // Resilient fallback: serial single-embed preserves order and survives a
        // partial batch-endpoint outage (re-index must be error-tolerant). Log the
        // body so a schema error isn't silently masked as a "batch outage".
        console.warn(`[GeminiEmbeddingProvider] batchEmbedContents failed (${res.status} ${res.statusText}) for batch ${start}-${start + batch.length - 1}: ${body}. Falling back to serial.`);
        out.push(...await this.embedSerial(batch, opts));
        continue;
      }
      const data = await res.json();
      const embeddings = data?.embeddings;
      // Guard against a short/misaligned batch response — positional mapping to chunk
      // ids means a length mismatch silently corrupts which vector belongs to which chunk.
      if (!Array.isArray(embeddings) || embeddings.length !== batch.length) {
        console.warn(`[GeminiEmbeddingProvider] batch returned ${Array.isArray(embeddings) ? embeddings.length : typeof embeddings} vectors for ${batch.length} inputs. Falling back to serial.`);
        out.push(...await this.embedSerial(batch, opts));
        continue;
      }
      out.push(...embeddings.map((e: { values: unknown }, i: number) => this.validateVector(e?.values, `embedBatch[${start + i}]`)));
    }

    return out;
  }

  // Serial fallback for the batch endpoint. The batch path only reaches here
  // AFTER a batch failure (often a 429), so firing 100 un-throttled single-doc
  // embeds would hammer an already rate-limited endpoint and exhaust quota even
  // faster (LOW #6). Each embed retries on 429/503 with capped exponential
  // backoff so a transient rate-limit drains instead of cascading into hard
  // failures across the whole sub-batch.
  private async embedSerial(texts: string[], opts: EmbedOptions): Promise<number[][]> {
    const out: number[][] = [];
    for (const t of texts) out.push(await this.embedWithBackoff(t, opts));
    return out;
  }

  private async embedWithBackoff(text: string, opts: EmbedOptions, maxRetries = 4): Promise<number[]> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.embed(text, opts);
      } catch (e: any) {
        const msg = String(e?.message || e);
        const isTransient = / 429 | 503 |RESOURCE_EXHAUSTED|UNAVAILABLE/.test(msg) || /\b(429|503)\b/.test(msg);
        if (!isTransient || attempt >= maxRetries) throw e;
        // 0.5s, 1s, 2s, 4s — bounded so the serial drain can't stall the
        // whole re-index for minutes on a persistent outage.
        const delayMs = Math.min(4000, 500 * 2 ** attempt);
        attempt++;
        console.warn(`[GeminiEmbeddingProvider] serial embed transient failure (attempt ${attempt}/${maxRetries}), backing off ${delayMs}ms: ${msg}`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
}
