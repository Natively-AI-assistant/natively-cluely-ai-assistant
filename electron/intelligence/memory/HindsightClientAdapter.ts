// electron/intelligence/memory/HindsightClientAdapter.ts
//
// Spec Phase 16 — the Hindsight MemoryProvider implementation. Wraps the published
// @vectorize-io/hindsight-client (researched in Phase 0) behind our MemoryProvider
// interface, so the app depends on OUR interface, not the client's 0.x API.
//
// The client is an OPTIONAL dependency, lazy-required: if it isn't installed or the
// adapter isn't configured, construction fails gracefully and the caller falls back to
// Noop. retain is async (fire-and-forget queue); recall is bounded by AbortSignal +
// a Promise.race timeout. Isolation = per-scope bank + strict tags (HindsightTagBuilder).
//
// Verified against @vectorize-io/hindsight-client@0.8.2 (dist/index.d.ts):
//   client.retain(bankId, content, { tags, async, timestamp, signal, ... }) → RetainResponse
//   client.recall(bankId, query, { tags, tagsMatch: 'all_strict', maxTokens, signal, ... })
//     → RecallResponse = { results: Array<{ id, text, type?, context?, ... }> }
//   tagsMatch 'all_strict' = AND + EXCLUDE untagged (the isolation guarantee).
//   NOTE: recall has NO `maxResults` (use maxTokens) and RecallResult has NO score/tags.

import type { MemoryProvider, RetainItem, MemoryScope, RecallOptions, RecalledMemory } from './MemoryProvider';
import { HindsightTagBuilder } from './HindsightTagBuilder';
import { HindsightRetainQueue } from './HindsightRetainQueue';

export interface HindsightConfig {
  baseUrl: string;
  apiKey?: string;
  defaultBank?: string;
  /** Default recall timeout if a call doesn't specify one. */
  timeoutMs?: number;
}

// Structural type for just the bits of the client we use (so we don't hard-import it).
// Mirrors the real 0.8.2 RecallResult: { id, text, type?, context?, ... } (no score/tags).
interface HindsightRecallResult { id?: string; text?: string; type?: string | null; context?: string | null; }
interface HindsightClientLike {
  retain(bankId: string, content: string, options?: Record<string, unknown>): Promise<unknown>;
  recall(bankId: string, query: string, options?: Record<string, unknown>): Promise<{ results?: HindsightRecallResult[] }>;
}

/** Lazily require the optional client. Returns null when it isn't installed. */
function loadHindsightClient(): (new (opts: { baseUrl: string; apiKey?: string }) => HindsightClientLike) | null {
  try {
    // Optional dependency — never bundled, never required at import time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@vectorize-io/hindsight-client');
    return (mod?.HindsightClient ?? null) as any;
  } catch {
    return null;
  }
}

export class HindsightClientAdapter implements MemoryProvider {
  readonly name = 'hindsight';
  readonly enabled: boolean;
  private client: HindsightClientLike | null = null;
  private readonly tags = new HindsightTagBuilder();
  private readonly queue: HindsightRetainQueue;

  constructor(private config: HindsightConfig, clientOverride?: HindsightClientLike) {
    let client: HindsightClientLike | null = clientOverride ?? null;
    if (!client) {
      const Ctor = loadHindsightClient();
      if (Ctor && config?.baseUrl) {
        try { client = new Ctor({ baseUrl: config.baseUrl, apiKey: config.apiKey }); } catch { client = null; }
      }
    }
    this.client = client;
    this.enabled = Boolean(client);
    this.queue = new HindsightRetainQueue(async (item) => {
      await this.doRetain(item);
    });
  }

  retain(item: RetainItem): void {
    if (!this.enabled) return;
    // Enqueue — never blocks the caller (live answer path).
    this.queue.enqueue(item);
  }

  private async doRetain(item: RetainItem): Promise<void> {
    if (!this.client) return;
    const bankId = this.tags.bankId(item.scope, this.config.defaultBank);
    const tags = this.tags.retainTags(item.scope, item.source, item.mode);
    try {
      await this.client.retain(bankId, item.content, {
        tags,
        async: true, // server-side async fact extraction
        timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : undefined,
      });
    } catch {
      // Swallow — a failed retain must never surface. (A real impl would retry later.)
    }
  }

  async recall(query: string, scope: MemoryScope, options: RecallOptions): Promise<RecalledMemory[]> {
    if (!this.enabled || !this.client) return [];
    const bankId = this.tags.bankId(scope, this.config.defaultBank);
    const tags = this.tags.recallTags(scope);
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? 800;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let raceTimer: NodeJS.Timeout | undefined; // the Promise.race fallback timer (clear on win)
    try {
      // 0.8.2 recall bounds by TOKENS, not result count. Approximate a result cap by
      // budgeting ~120 tokens per desired result (the server returns the most relevant
      // facts within the budget). tagsMatch 'all_strict' = AND + exclude untagged.
      const maxTokens = Math.max(256, (options.maxResults ?? 8) * 120);
      const res = await Promise.race([
        this.client.recall(bankId, query, {
          tags,
          tagsMatch: 'all_strict',
          maxTokens,
          signal: controller.signal,
        }),
        new Promise<{ results: [] }>((resolve) => { raceTimer = setTimeout(() => resolve({ results: [] }), timeoutMs); }),
      ]);
      const results = (res as { results?: HindsightRecallResult[] })?.results;
      if (!Array.isArray(results)) return [];
      // Map the real RecallResult → our RecalledMemory. No score/tags on 0.8.2 results;
      // carry `type` as `source` and append `context` to the text when present.
      return results
        .map((r): RecalledMemory => {
          const base = String(r?.text ?? '').trim();
          const ctx = r?.context ? String(r.context).trim() : '';
          const text = ctx && !base.includes(ctx) ? `${base} (${ctx})` : base;
          return { text, source: r?.type ? String(r.type) : undefined };
        })
        .filter((r) => r.text.trim().length > 0);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
      if (raceTimer) clearTimeout(raceTimer); // don't leave the fallback timer dangling on win
    }
  }

  async flush(): Promise<void> {
    try { await this.queue.drain(); } catch { /* best effort */ }
  }
}
