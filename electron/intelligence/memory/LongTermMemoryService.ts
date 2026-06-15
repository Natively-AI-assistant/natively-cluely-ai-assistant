// electron/intelligence/memory/LongTermMemoryService.ts
//
// Spec Phase 16 — the facade the rest of the app uses for long-term memory. It owns the
// active MemoryProvider (Noop by default) and exposes the typed retain/recall helpers
// (retainMeetingTranscript / retainMeetingSummary / retainConversationTurn /
// retainLectureSummary / recallRelevantMemory). It is feature-flagged: when
// hindsight_memory is off OR no config is present, the provider is Noop and the whole
// app works unchanged.
//
// CRITICAL: recallRelevantMemory is NEVER used as a primary identity source and NEVER on
// the live current-question path by this service's contract — callers decide WHEN to
// call it (the ContextRouter only sets useHindsightRecall for backward-looking asks).
// Here we only guarantee: bounded timeout, scoped tags, [] on disabled/error.

import {
  type MemoryProvider, type MemoryScope, type MemorySourceType, type RecalledMemory,
  NoopMemoryProvider,
} from './MemoryProvider';
import { HindsightClientAdapter, type HindsightConfig } from './HindsightClientAdapter';
import { isIntelligenceFlagEnabled } from '../intelligenceFlags';

export interface LongTermMemoryConfig {
  hindsight?: HindsightConfig;
}

export class LongTermMemoryService {
  private provider: MemoryProvider;

  constructor(provider?: MemoryProvider) {
    this.provider = provider ?? new NoopMemoryProvider();
  }

  /**
   * Build the service honoring the feature flags. Returns a Noop-backed service unless
   * hindsight_memory is enabled AND a baseUrl is configured AND the client is installed.
   * Never throws — any failure → Noop.
   */
  static fromFlags(config?: LongTermMemoryConfig, providerOverride?: MemoryProvider): LongTermMemoryService {
    try {
      if (providerOverride) return new LongTermMemoryService(providerOverride);
      const memoryOn = isIntelligenceFlagEnabled('hindsightMemory');
      if (!memoryOn || !config?.hindsight?.baseUrl) return new LongTermMemoryService(new NoopMemoryProvider());
      const adapter = new HindsightClientAdapter(config.hindsight);
      // If the client wasn't installed/constructable, adapter.enabled is false → Noop.
      return new LongTermMemoryService(adapter.enabled ? adapter : new NoopMemoryProvider());
    } catch {
      return new LongTermMemoryService(new NoopMemoryProvider());
    }
  }

  get providerName(): string { return this.provider.name; }
  get enabled(): boolean { return this.provider.enabled; }

  private retain(content: string, scope: MemoryScope, source: MemorySourceType, mode?: string, timestamp?: number): void {
    try {
      if (!content || !content.trim()) return;
      this.provider.retain({ content, scope, source, mode, timestamp });
    } catch { /* never throw */ }
  }

  // ── Typed retain helpers (all async/non-blocking via the provider's queue) ──
  retainMeetingTranscript(meetingId: string, content: string, scope: MemoryScope, mode?: string): void {
    this.retain(content, { ...scope, meetingId }, 'meeting_transcript', mode);
  }
  retainMeetingSummary(meetingId: string, summary: string, scope: MemoryScope, mode?: string): void {
    this.retain(summary, { ...scope, meetingId }, 'meeting_summary', mode);
  }
  retainConversationTurn(sessionId: string, turnText: string, scope: MemoryScope, mode?: string): void {
    this.retain(turnText, { ...scope, sessionId }, 'chat_history', mode);
  }
  retainUserFeedback(feedback: string, scope: MemoryScope): void {
    this.retain(feedback, scope, 'feedback');
  }
  retainLectureSummary(lectureId: string, summary: string, scope: MemoryScope, courseId?: string): void {
    this.retain(summary, { ...scope, lectureId, courseId }, 'lecture_summary', 'lecture');
  }
  retainLectureDiagram(lectureId: string, diagramSpec: string, scope: MemoryScope, courseId?: string): void {
    this.retain(diagramSpec, { ...scope, lectureId, courseId }, 'lecture_diagram', 'lecture');
  }

  /**
   * Recall scoped memories. Bounded timeout; [] when disabled/error/timeout. Default
   * 800ms (live recall ceiling); pass a wider timeout for offline/global search.
   */
  async recallRelevantMemory(
    query: string,
    scope: MemoryScope,
    options: { timeoutMs?: number; maxResults?: number } = {},
  ): Promise<RecalledMemory[]> {
    try {
      return await this.provider.recall(query, scope, {
        timeoutMs: options.timeoutMs ?? 800,
        maxResults: options.maxResults ?? 8,
      });
    } catch {
      return [];
    }
  }

  async flush(): Promise<void> {
    try { await this.provider.flush?.(); } catch { /* best effort */ }
  }
}
