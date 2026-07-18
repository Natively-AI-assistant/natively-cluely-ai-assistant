// electron/llm/whatToAnswerRequestSnapshot.ts
//
// Audit findings #6 + #3 (full) + #9 (full): a single request-scoped, immutable
// snapshot minted ONCE at the start of IntelligenceEngine.runWhatShouldISay and
// threaded through the pipeline stages that would otherwise re-read live,
// mutable state at different points across `await` boundaries.
//
// WHY (finding #6 — the race this closes):
//   runWhatShouldISay reads the active mode at several points separated by real
//   awaits (intent classification, profile grounding, dynamic import, the stream
//   deadline race). ModesManager.getActiveModeInfo()/getActiveMode() are backed
//   by a DB read + invalidate-on-write cache, and the `modes:set-active` IPC
//   (which calls ModesManager.setActiveMode) runs synchronously on the same main
//   thread — so it can flip the active mode WHILE this request is parked at an
//   await. The answer planner (mode prior → answerType → context route) would
//   then disagree with the prompt suffix / pinned instructions / reference
//   retrieval that WhatToAnswerLLM re-reads from the live singleton later in the
//   SAME request → a mismatched contract vs. prompt for one answer.
//
//   The fix is the standard request-scoped read: capture the mode ONCE at t0 and
//   pass the snapshot to every stage that previously re-read. When no mid-request
//   switch happens the snapshot is byte-identical to what the live reads would
//   return, so behavior is unchanged in the common case.
//
// WHY (finding #3 — live token supersession id):
//   The snapshot carries the request's `generationId`, which is stamped onto the
//   `suggested_answer_token` → `intelligence-token-batch` payload so the renderer
//   can drop batches belonging to a superseded live answer (engine-side
//   supersession already blocks most emits; this is renderer-side defense-in-depth
//   for the already-queued-batch window).
//
// WHY (finding #9 — joinable telemetry):
//   The snapshot carries the `requestId` (shared with the PiLatencyTrace) plus
//   sessionId / meetingId / surface / modeId so the engine's IntelligenceTrace can
//   be correlated with the latency trace and joined across IPC → engine →
//   provider. IDS / MARKERS ONLY — never raw transcript / prompt / profile /
//   question content.
//
// This module is intentionally a tiny plain data carrier (NOT a framework / god
// object). It is pure and dependency-light so it can be unit-tested directly.

import type { ActiveModeInfo } from './modeProfiles';

/**
 * An immutable, request-scoped snapshot of the mutable state runWhatShouldISay
 * reads more than once. Built ONCE at t0; never mutated. Optional everywhere it
 * is consumed so existing callers/tests that don't supply it fall back to the
 * current live reads (backward compatible).
 */
export interface WhatToAnswerRequestSnapshot {
  /** The active mode INFO captured at t0 (the planner's routing prior). Null when
   *  no mode is active or ModesManager was unavailable — same semantics as a live
   *  getActiveModeInfo() returning null (mode-blind). */
  readonly activeModeInfo: ActiveModeInfo | null;
  /** The active mode's templateType captured at t0 (e.g. 'technical-interview',
   *  'general'). Used for session-memory routing and the trace marker. */
  readonly modeId: string;
  /** The active mode's UNIQUE id captured at t0 (e.g. 'mode_<uuid>'), or undefined
   *  when no mode is active. This is what ModesManager.resolveMode pins on so the
   *  prompt builders read the SAME mode the answer was planned from (#6). Distinct
   *  from `modeId` (templateType): two custom modes can share a templateType but
   *  never an id. */
  readonly modeUniqueId?: string;
  /** Correlation id shared with the PiLatencyTrace so the engine IntelligenceTrace,
   *  the latency trace, and downstream provider logs can be joined (#9). */
  readonly requestId: string;
  /** Session id (per-meeting) marker for telemetry correlation (#9). */
  readonly sessionId?: string;
  /** Stable meeting marker for telemetry correlation (#9). Ids only. */
  readonly meetingId?: string;
  /** The surface that originated this request — always 'what_to_answer' for the
   *  live path (vs. 'manual' for the chat handler). */
  readonly surface: 'what_to_answer';
  /** The generation id for this request. Stamped onto every emitted live token so
   *  the renderer can reject tokens from a superseded answer (#3). */
  readonly generationId: number;
  /** Context OS (H1): when present AND `contextOsEvidencePackEnabled`, the typed
   *  EvidencePack GOVERNS the WTA factual prompt — the raw mode block is replaced
   *  by the rendered contract + evidence pack and the candidate_profile factual
   *  block is suppressed. Opaque (`unknown`) to avoid a cross-module type cycle;
   *  WhatToAnswerLLM narrows it at the use site. Absent → legacy assembly. */
  readonly contextOsGeneration?: unknown;
}

/** Minimal interface for the bits of ModesManager the snapshot reads. Keeps this
 *  module decoupled from the concrete class (which needs Electron `app`). */
export interface ModeReader {
  getActiveModeInfo(): ActiveModeInfo | null;
  getActiveMode(): { templateType?: string } | null;
}

export interface BuildSnapshotInput {
  /** Live mode reader (ModesManager.getInstance()). When absent/throwing the
   *  snapshot is mode-blind (activeModeInfo=null, modeId='general'). */
  modeReader?: ModeReader | null;
  requestId: string;
  generationId: number;
  sessionId?: string;
  meetingId?: string;
}

/**
 * Build the immutable request snapshot. Reads the active mode EXACTLY ONCE here so
 * that every downstream stage shares one consistent view even if `modes:set-active`
 * fires mid-request. Never throws — a failing/absent reader yields the mode-blind
 * default (matching the engine's existing defensive getActiveModeId/Info helpers).
 */
export function buildWhatToAnswerRequestSnapshot(
  input: BuildSnapshotInput,
): WhatToAnswerRequestSnapshot {
  let activeModeInfo: ActiveModeInfo | null = null;
  let modeId = 'general';
  try {
    if (input.modeReader) {
      activeModeInfo = input.modeReader.getActiveModeInfo() ?? null;
      const tt = input.modeReader.getActiveMode()?.templateType;
      modeId = (typeof tt === 'string' && tt.length > 0) ? tt : 'general';
    }
  } catch {
    activeModeInfo = null;
    modeId = 'general';
  }
  return Object.freeze({
    activeModeInfo,
    modeId,
    modeUniqueId: activeModeInfo?.id,
    requestId: input.requestId,
    sessionId: input.sessionId,
    meetingId: input.meetingId,
    surface: 'what_to_answer' as const,
    generationId: input.generationId,
  });
}

/**
 * Renderer-side / main-side reducer for live-answer token supersession (#3).
 * Mirrors chatStreamGuard's "newest wins" policy but for the live
 * `suggested_answer` token-batch path, which is keyed only on intent.
 *
 *   - no incoming id            → accept, active id unchanged (backward compatible)
 *   - no active id yet          → accept, adopt incoming id
 *   - incoming id === active id  → accept, active id unchanged
 *   - incoming id  >  active id  → accept, adopt incoming id (newer answer took over)
 *   - incoming id  <  active id  → DROP (stale superseded answer still trickling)
 */
export function resolveLiveAnswerBatch(
  activeId: number | null | undefined,
  incomingId: number | null | undefined,
): { accept: boolean; activeId: number | null } {
  const cur = typeof activeId === 'number' ? activeId : null;
  if (typeof incomingId !== 'number') {
    return { accept: true, activeId: cur };
  }
  if (cur === null) {
    return { accept: true, activeId: incomingId };
  }
  if (incomingId === cur) {
    return { accept: true, activeId: cur };
  }
  if (incomingId > cur) {
    return { accept: true, activeId: incomingId };
  }
  return { accept: false, activeId: cur };
}
