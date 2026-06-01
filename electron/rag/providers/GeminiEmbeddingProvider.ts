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
    const requests = texts.map(t => ({
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
      console.warn(`[GeminiEmbeddingProvider] batchEmbedContents network error, falling back to serial: ${e?.message || e}`);
      return this.embedSerial(texts, opts);
    }
    if (!res.ok) {
      // Resilient fallback: serial single-embed preserves order and survives a
      // partial batch-endpoint outage (re-index must be error-tolerant). Log the
      // body so a schema/quota error isn't silently masked as a "batch outage".
      console.warn(`[GeminiEmbeddingProvider] batchEmbedContents failed (${res.status} ${res.statusText}): ${await res.text().catch(() => '')}. Falling back to serial.`);
      return this.embedSerial(texts, opts);
    }
    const data = await res.json();
    const embeddings = data?.embeddings;
    // Guard against a short/misaligned batch response — positional mapping to chunk
    // ids means a length mismatch silently corrupts which vector belongs to which chunk.
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      console.warn(`[GeminiEmbeddingProvider] batch returned ${Array.isArray(embeddings) ? embeddings.length : typeof embeddings} vectors for ${texts.length} inputs. Falling back to serial.`);
      return this.embedSerial(texts, opts);
    }
    return embeddings.map((e: { values: unknown }, i: number) => this.validateVector(e?.values, `embedBatch[${i}]`));
  }

  private async embedSerial(texts: string[], opts: EmbedOptions): Promise<number[][]> {
    const out: number[][] = [];
    for (const t of texts) out.push(await this.embed(t, opts));
    return out;
  }
}
