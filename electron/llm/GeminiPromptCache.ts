import crypto from 'crypto';
import type { GoogleGenAI } from '@google/genai';

/**
 * Process-local manager for Gemini explicit context caches (caches.create).
 *
 * Why this exists:
 *   System prompts in this app are 1.7K-3.7K tokens and reused turn-after-turn
 *   for the same session. Passing them as `systemInstruction` on every request
 *   re-bills the input tokens. An explicit cache stores the prompt once
 *   server-side and bills cached-token rates (currently ~10× cheaper) for
 *   subsequent requests.
 *
 * Lifecycle:
 *   - Keyed by sha1(model + systemPrompt). Same prompt + same model → same cache.
 *   - TTL is `CACHE_TTL_SECONDS`. On near-expiry (< RENEWAL_WINDOW_MS remaining),
 *     transparently re-create on the next `getOrCreate` call.
 *   - In-flight creations are deduped: concurrent callers for the same key
 *     await the same Promise.
 *   - The Gemini SDK does not surface listCaches in a session-portable way,
 *     so caches we don't know about (from a previous process) are NOT reused —
 *     they expire on the server (1h default) and we create fresh ones. The
 *     storage-hour cost of that orphan window is < a single uncached request.
 *
 * Failure mode:
 *   getOrCreate() returns null on any error (too-small input, model
 *   incompatibility, transient API failure, missing client). The caller MUST
 *   fall back to passing `systemInstruction` directly. Never throw upward.
 *
 * Eviction:
 *   No explicit delete — server-side TTL handles it. The in-memory entry is
 *   cleared lazily when we detect a stale name (e.g. a `cachedContent` error
 *   from generateContent → call `invalidate(name)` from the catch site).
 */

interface CacheEntry {
  /** Server-side resource name, e.g. "cachedContents/abc123". */
  name: string;
  /** Wall-clock ms at which we treat the cache as expired client-side. */
  expiresAt: number;
}

/**
 * Minimum prompt size to attempt caching, in characters.
 *
 * Gemini explicit caching has a per-model minimum input token count:
 *   - gemini-2.0+ / 3.x: 1024 tokens
 *   - gemini-1.5: 32,768 tokens
 *
 * The codebase uses gemini-3.1 models exclusively; the 1024-token floor
 * applies. 4096 chars is a conservative proxy (≈1024 tokens at 4 chars/tok);
 * a tighter bound rejects prompts that would be borderline. Bumping to 4500
 * leaves a safety margin so we don't waste an API round-trip on
 * INVALID_ARGUMENT.
 */
const MIN_PROMPT_CHARS = 4500;

/** Server-side TTL we request. 1 hour matches Gemini's default. */
const CACHE_TTL_SECONDS = 3600;

/** When < this many ms remain on a cache, treat it as expired and recreate. */
const RENEWAL_WINDOW_MS = 5 * 60 * 1000;

export class GeminiPromptCache {
  private entries = new Map<string, CacheEntry>();
  /** In-flight creation promises keyed by hash — for dedupe under concurrency. */
  private inflight = new Map<string, Promise<string | null>>();

  /**
   * Return the cache resource name for (model, systemPrompt), creating it if
   * absent or near-expired. Returns null when caching is not viable —
   * callers must fall back to passing `systemInstruction` directly.
   */
  async getOrCreate(
    client: GoogleGenAI,
    model: string,
    systemPrompt: string
  ): Promise<string | null> {
    if (!systemPrompt || systemPrompt.length < MIN_PROMPT_CHARS) return null;

    const key = this.hashKey(model, systemPrompt);
    const now = Date.now();

    const existing = this.entries.get(key);
    if (existing) {
      // Sentinel from a previous failure — still in cooldown, skip retry.
      if (!existing.name && existing.expiresAt > now) return null;
      // Live cache, still far enough from expiry.
      if (existing.name && existing.expiresAt - now > RENEWAL_WINDOW_MS) {
        return existing.name;
      }
    }

    // Dedupe concurrent creates for the same key.
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const creation = this.create(client, model, systemPrompt, key).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, creation);
    return creation;
  }

  /**
   * Drop a stale entry when the server reports the cache no longer exists
   * (e.g. expired between our last use and now). Safe to call with any name.
   */
  invalidate(name: string): void {
    for (const [k, v] of this.entries) {
      if (v.name === name) {
        this.entries.delete(k);
        return;
      }
    }
  }

  /**
   * Drop every entry. Call this when the Gemini API key changes — cache
   * resource names are scoped to the project/key that created them, so a
   * key swap makes all in-memory names invalid (they'd fail with NOT_FOUND
   * or PERMISSION_DENIED on reuse). Clearing forces a fresh create under the
   * new key on the next request instead of one wasted failing round-trip.
   */
  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  /** For diagnostics. */
  size(): number {
    return this.entries.size;
  }

  private async create(
    client: GoogleGenAI,
    model: string,
    systemPrompt: string,
    key: string
  ): Promise<string | null> {
    try {
      // Gemini requires both `contents` AND `systemInstruction` to have non-empty
      // bodies. We use a one-token placeholder for contents so the entire prompt
      // sits in `systemInstruction` (which is what we want to cache).
      const response: any = await (client as any).caches.create({
        model,
        config: {
          contents: [{ role: 'user', parts: [{ text: '_' }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          ttl: `${CACHE_TTL_SECONDS}s`,
          displayName: `natively-sys-${key.slice(0, 8)}`,
        },
      });
      const name: string | undefined = response?.name;
      if (!name) {
        console.warn('[GeminiPromptCache] caches.create returned no name; skipping cache');
        return null;
      }
      this.entries.set(key, {
        name,
        expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
      });
      console.log(`[GeminiPromptCache] created ${name} for model=${model} (${systemPrompt.length} chars)`);
      return name;
    } catch (err: any) {
      // Non-fatal. Common reasons: prompt below model minimum, model doesn't
      // support caching, transient 5xx. We log once and fall back to
      // systemInstruction on every subsequent call for this key until the
      // process restarts — there's no value in retrying create on every turn
      // when the underlying constraint is structural.
      console.warn(
        `[GeminiPromptCache] caches.create failed for model=${model}: ${err?.message || err}. ` +
        `Falling back to systemInstruction.`
      );
      // Mark as failed for a short cooldown by stashing a sentinel entry.
      this.entries.set(key, {
        name: '',
        expiresAt: Date.now() + 5 * 60 * 1000, // 5min cooldown before retrying create
      });
      return null;
    }
  }

  private hashKey(model: string, systemPrompt: string): string {
    return crypto.createHash('sha1').update(model).update('\0').update(systemPrompt).digest('hex');
  }
}
