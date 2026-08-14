// electron/intelligence/memory/MemoryProvider.ts
//
// Spec Phase 16 — the optional long-term memory provider interface + a Noop default.
//
// NON-NEGOTIABLE (rules #3/#14/#15): Hindsight is OPTIONAL. The default provider is the
// Noop — the app works fully with memory disabled. No provider is ever REQUIRED for a
// live answer. All recall is bounded by a strict timeout (the caller passes one). All
// retain is async/fire-and-forget. Isolation is enforced by per-scope BANK + strict
// TAGS, never metadata alone (rule #6 + Phase 0 research).

export interface MemoryScope {
  userId: string;
  orgId?: string;
  sessionId?: string;
  meetingId?: string;
  courseId?: string;
  lectureId?: string;
  company?: string;
  participantHash?: string;
  documentId?: string;
  /** YYYY-MM-DD */
  date?: string;
}

export type MemorySourceType =
  | 'meeting_transcript' | 'meeting_summary' | 'chat_history' | 'resume' | 'jd'
  | 'reference_file' | 'browser_dom' | 'user_preference' | 'feedback'
  | 'lecture_transcript' | 'lecture_summary' | 'lecture_diagram' | 'course_memory';

export interface RetainItem {
  content: string;
  scope: MemoryScope;
  source: MemorySourceType;
  mode?: string;
  timestamp?: number;
}

export interface RecallOptions {
  /** Hard timeout in ms (live: 300–800; global: 2000–5000). */
  timeoutMs: number;
  maxResults?: number;
}

export interface RecalledMemory {
  text: string;
  score?: number;
  source?: string;
  tags?: string[];
}

export interface MemoryProvider {
  readonly name: string;
  readonly enabled: boolean;
  /** Enqueue an async retain. Must return immediately; never blocks the caller. */
  retain(item: RetainItem): void;
  /** Recall scoped memories within the strict timeout. Returns [] on any error/timeout. */
  recall(query: string, scope: MemoryScope, options: RecallOptions): Promise<RecalledMemory[]>;
  /** Drain/flush any queued retains (e.g. on shutdown). Best-effort. */
  flush?(): Promise<void>;
}

/**
 * The default provider — does nothing. The app runs fully with this in place
 * (memory disabled). retain is a no-op; recall returns []. Never throws.
 */
export class NoopMemoryProvider implements MemoryProvider {
  readonly name = 'noop';
  readonly enabled = false;
  retain(_item: RetainItem): void { /* intentionally nothing */ }
  async recall(_query: string, _scope: MemoryScope, _options: RecallOptions): Promise<RecalledMemory[]> { return []; }
  async flush(): Promise<void> { /* nothing */ }
}
