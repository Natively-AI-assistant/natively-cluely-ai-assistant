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

// Per-key cooldown after a 429 so a rate-limited key is skipped until its window
// likely resets, instead of being hammered. Mirrors the backend's key-pool cooldown.
const KEY_COOLDOWN_MS = Number(process.env.NATIVELY_GEMINI_EMBED_COOLDOWN_MS) || 60_000;
// When ALL keys are cooling, wait at most this long for the soonest to free up
// before giving up (so a re-index drains rather than hard-failing on a transient
// full-pool rate-limit). The per-minute Gemini window is ~60s, so the default
// budget must exceed that or an all-keys-hot pool never drains — set to 75s.
// Bounded so a persistent multi-minute outage still eventually degrades gracefully.
const MAX_COOLDOWN_WAIT_MS = Number(process.env.NATIVELY_GEMINI_EMBED_MAX_WAIT_MS) || 75_000;

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'gemini';
  readonly model: string;
  readonly dimensions: number;
  readonly space: string;

  // Key pool + per-key cooldown-until timestamps. Single-key callers pass a string;
  // it becomes a one-element pool so all the rotation logic is uniform.
  private readonly apiKeys: string[];
  private readonly coolingUntil: number[]; // epoch ms; 0 = healthy
  private keyCursor = 0;

  constructor(
    apiKeyOrKeys: string | string[],
    model: string = DEFAULT_MODEL,
    dimensions: number = DEFAULT_DIMS,
  ) {
    const keys = (Array.isArray(apiKeyOrKeys) ? apiKeyOrKeys : [apiKeyOrKeys])
      .map((k) => (k || '').trim())
      .filter(Boolean);
    // De-dupe while preserving order (the same key twice adds no rotation value).
    this.apiKeys = [...new Set(keys)];
    if (this.apiKeys.length === 0) throw new Error('GeminiEmbeddingProvider: no API key(s) provided');
    this.coolingUntil = this.apiKeys.map(() => 0);
    // Accept a bare id or a 'models/'-prefixed id; store bare for the space key,
    // re-add the prefix on the wire.
    this.model = model.replace(/^models\//, '');
    this.dimensions = dimensions;
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
    if (this.apiKeys.length > 1) {
      console.log(`[GeminiEmbeddingProvider] key pool: ${this.apiKeys.length} keys, per-key cooldown ${KEY_COOLDOWN_MS}ms`);
    }
  }

  private nowMs(): number { return Date.now(); }

  /** Index of the next healthy (non-cooling) key, round-robin from the cursor. */
  private pickHealthyKeyIndex(): number | null {
    const now = this.nowMs();
    for (let i = 0; i < this.apiKeys.length; i++) {
      const idx = (this.keyCursor + i) % this.apiKeys.length;
      if (this.coolingUntil[idx] <= now) { this.keyCursor = (idx + 1) % this.apiKeys.length; return idx; }
    }
    return null; // all keys cooling
  }

  /** Ms until the soonest key frees up (0 if one is already healthy). */
  private msUntilSoonestHealthy(): number {
    const now = this.nowMs();
    let soonest = Infinity;
    for (const until of this.coolingUntil) soonest = Math.min(soonest, Math.max(0, until - now));
    return soonest === Infinity ? 0 : soonest;
  }

  /**
   * Number of keys NOT currently cooling from a 429. Exposed so a caller doing a
   * burst of indexing followed by a latency-sensitive query (e.g. the live WTA
   * path, or the E2E harness settling before asking) can check pool health and
   * only pay a settle delay when it's actually degraded, instead of a blind wait.
   */
  healthyKeyCount(): number {
    const now = this.nowMs();
    return this.coolingUntil.filter((until) => until <= now).length;
  }

  /** Total keys in the rotation pool (for computing a health fraction). */
  keyPoolSize(): number {
    return this.apiKeys.length;
  }

  // Parse a Gemini 429 body for RetryInfo.retryDelay (e.g. "57s" / "1200ms").
  // Returns ms, or 0 if not present. Capped so a hostile/huge value can't stall us.
  private parseRetryDelayMs(body: string): number {
    if (!body) return 0;
    const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)(ms|s)"/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const ms = m[2].toLowerCase() === 's' ? n * 1000 : n;
    return Math.min(ms, 120_000);
  }

  private markCooling(idx: number, retryMs = 0): void {
    // Use the server's retryDelay when it exceeds our default guess (+1s slack),
    // so waiting for the cooldown actually clears the window.
    const cool = Math.max(KEY_COOLDOWN_MS, retryMs > 0 ? retryMs + 1000 : 0);
    this.coolingUntil[idx] = this.nowMs() + cool;
    if (this.apiKeys.length > 1) {
      console.warn(`[GeminiEmbeddingProvider] key #${idx} rate-limited (429) — cooling for ${cool}ms; ${this.apiKeys.filter((_, j) => this.coolingUntil[j] <= this.nowMs()).length} keys still healthy`);
    }
  }

  /**
   * POST to a Gemini embedding endpoint, rotating across the key pool. On a 429 for
   * one key, mark it cooling and try the next healthy key. If ALL keys are cooling,
   * wait (bounded) for the soonest to free up, then retry. Non-429 errors propagate
   * (the caller's serial-backoff handles transient 503s). Returns the parsed JSON.
   */
  private async postWithKeyRotation(method: 'embedContent' | 'batchEmbedContents', body: unknown): Promise<any> {
    const url = this.url(method);
    let waitedForCooldown = false;
    // Bounded attempts: at most one pass per key, plus one post-wait pass.
    const maxAttempts = this.apiKeys.length + 1;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let idx = this.pickHealthyKeyIndex();
      if (idx === null) {
        // All keys cooling. Wait once for the soonest, if within budget.
        const wait = this.msUntilSoonestHealthy();
        if (waitedForCooldown || wait <= 0 || wait > MAX_COOLDOWN_WAIT_MS) {
          throw lastErr || new Error(`Gemini v2 ${method}: all ${this.apiKeys.length} keys rate-limited (429); soonest free in ${wait}ms > budget ${MAX_COOLDOWN_WAIT_MS}ms`);
        }
        console.warn(`[GeminiEmbeddingProvider] all keys cooling — waiting ${wait}ms for the soonest to free up`);
        await new Promise((r) => setTimeout(r, wait + 50));
        waitedForCooldown = true;
        idx = this.pickHealthyKeyIndex();
        if (idx === null) throw lastErr || new Error(`Gemini v2 ${method}: all keys still cooling after wait`);
      }
      let res: Response;
      try {
        res = await fetch(url, { method: 'POST', headers: this.headersFor(idx), body: JSON.stringify(body) });
      } catch (e: any) {
        // Network error is not key-specific — surface it (serial backoff retries).
        throw new Error(`Gemini v2 ${method} network error: ${e?.message || e}`);
      }
      if (res.status === 429) {
        // Honor the server's RetryInfo.retryDelay when present ("57s"), so the
        // cooldown matches the actual per-minute window instead of a fixed guess.
        const bodyText = await res.text().catch(() => '');
        this.markCooling(idx, this.parseRetryDelayMs(bodyText));
        lastErr = new Error(`Gemini v2 ${method} 429 on key #${idx}`);
        continue; // try next healthy key
      }
      if (!res.ok) {
        throw new Error(`Gemini v2 ${method} failed: ${res.status} ${res.statusText} ${await res.text().catch(() => '')}`);
      }
      return res.json();
    }
    throw lastErr || new Error(`Gemini v2 ${method}: exhausted key rotation`);
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
  // proxies, and crash reports. Keyed by pool index for rotation.
  private headersFor(keyIdx: number): Record<string, string> {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKeys[keyIdx] };
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
    const data = await this.postWithKeyRotation('embedContent', {
      content: { parts: [{ text: formatted }] },
      outputDimensionality: this.dimensions, // v2 auto-normalizes truncated dims
    });
    return this.validateVector(data?.embedding?.values, 'embed');
  }

  // ── Asymmetric retrieval query ──────────────────────────────────────────────
  async embedQuery(text: string, opts: EmbedOptions = {}): Promise<number[]> {
    const formatted = this.formatQuery(text, opts.taskHint);
    const data = await this.postWithKeyRotation('embedContent', {
      content: { parts: [{ text: formatted }] },
      outputDimensionality: this.dimensions,
    });
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
      let data: any;
      try {
        // Key-rotating POST: a 429 rotates to the next healthy key (and waits for a
        // cooldown if the whole pool is hot) BEFORE we drop to the slower serial path.
        data = await this.postWithKeyRotation('batchEmbedContents', { requests });
      } catch (e: any) {
        // Only after key rotation is exhausted (or a non-429 error) do we fall back
        // to serial single-embed, which preserves order and survives a partial
        // batch-endpoint outage (re-index must be error-tolerant).
        console.warn(`[GeminiEmbeddingProvider] batchEmbedContents failed for batch ${start}-${start + batch.length - 1} after key rotation: ${e?.message || e}. Falling back to serial.`);
        out.push(...await this.embedSerial(batch, opts));
        continue;
      }
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
