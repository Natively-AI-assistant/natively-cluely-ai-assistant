// electron/llm/piTelemetry.ts
//
// Marker-only telemetry for Profile Intelligence + live SessionMemory (release
// 2026-06-07c). Emits STRUCTURED EVENTS with NON-SENSITIVE markers only — answer
// types, modes, route sources, recalled KINDS (never values), age buckets, timings,
// flag/rollout state, provider error classes, validator codes. It NEVER receives or
// records raw resume / JD / salary / transcript / custom context / answer text / API
// keys.
//
// Privacy is enforced two ways:
//   1. The PUBLIC event payloads below are typed to marker fields only.
//   2. A defensive `scrub()` runs on every payload and DROPS any field whose key or
//      string value looks like sensitive content (so a careless caller can't leak).
//
// By default events are buffered in-memory (bounded ring) and a marker line is logged
// only when NATIVELY_PI_TELEMETRY_DEBUG=true. A sink can be registered (e.g. to ship
// to an analytics backend) — the sink only ever sees scrubbed marker payloads.

export type PiTelemetryEvent =
  | 'pi_answer_plan_created'
  | 'pi_context_policy_applied'
  | 'pi_candidate_sanitizer_applied'
  | 'pi_provider_error_classified'
  | 'wta_question_extracted'
  | 'wta_live_session_memory_enabled'
  | 'wta_live_followup_resolved'
  | 'wta_context_free_clarification'
  | 'session_memory_recall_attempted'
  | 'session_memory_recall_succeeded'
  | 'session_memory_recall_blocked_by_mode'
  | 'session_memory_sensitive_comp_blocked'
  | 'session_memory_correction_applied'
  | 'session_memory_stale_context_rejected'
  | 'provider_fallback_used'
  | 'provider_zero_token_empty'
  | 'first_useful_token_recorded'
  // Manual regression 2026-06-12: final-boundary answer polish markers.
  | 'pi_scaffold_compressed'
  | 'pi_answer_repeated'
  // Groq-scout E2E sprint 2026-06-14: assistant-voice identity/refusal misfire guard.
  | 'pi_assistant_voice_misfire_repaired'
  // Document-grounded real-path fix 2026-06-27: groundedness/greeting validator.
  | 'pi_doc_grounded_validation_failed'
  | 'pi_doc_grounded_regenerated'
  | 'pi_doc_grounded_safe_failure'
  // Round-7 Failure-3: completeness re-ask kept the original (valid but partial) answer.
  | 'pi_doc_grounded_completeness_kept_original'
  // OKF Phase 0 (2026-07-01): false-refusal self-trigger guard + repair markers.
  | 'pi_doc_grounded_false_refusal_repair_attempted'
  | 'pi_doc_grounded_retrieval_summary'
  // OKF Profile Intelligence upgrade (2026-07-02): profile-pack lifecycle +
  // fail-closed retrieval + evidence composition markers. Marker-only — card
  // COUNTS and coarse reasons, never card titles / bodies / profile content.
  | 'pi_okf_profile_pack_generated'
  | 'pi_okf_profile_pack_stale'
  | 'pi_okf_profile_pack_invalidated'
  | 'pi_okf_profile_retrieval_allowed'
  | 'pi_okf_profile_retrieval_blocked'
  | 'pi_okf_profile_evidence_assembled'
  | 'pi_okf_profile_export_requested'
  | 'pi_okf_profile_export_completed';

export interface PiTelemetryRecord {
  event: PiTelemetryEvent;
  /** Marker fields only — no raw content. */
  data: Record<string, unknown>;
}

type Sink = (rec: PiTelemetryRecord) => void;

// ALLOWLIST of marker keys (code-review 2026-06-07c HIGH: a denylist can't guarantee
// "a careless caller can't leak" — a new entity/free-text field would slip through).
// Only these keys are ever emitted; ANYTHING else is dropped, so a future caller that
// passes `recalledEntity`/`entity`/`jdText`/`question` can never leak raw content.
const ALLOWED_KEYS = new Set<string>([
  // routing / answer markers
  'event', 'answerType', 'mode', 'surface', 'routeSource', 'profilePolicy', 'isCoding',
  'reason', 'via', 'resolved', 'questionType', 'detectedSpeaker', 'isFollowUp', 'answerStyle',
  // session-memory markers (KIND/bucket only — never the value)
  'recalledKind', 'memoryKind', 'ageBucket', 'memItemCount', 'memNotes', 'memSize',
  'resolvedFollowup', 'isClarification', 'blockedByMode', 'compBlocked', 'correctionApplied',
  'staleRejected', 'crossMode',
  // flag / rollout markers
  'enabled', 'rolloutPercent', 'bucket', 'killSwitch', 'flagState', 'flagReason',
  // context-layer NAME markers (layer names are a fixed enum — never content)
  'contextLayers', 'forbiddenLayers', 'requiredLayers',
  // provider / latency markers
  'provider', 'model', 'kind', 'outage', 'retryable', 'fallbackUsed', 'errorClass',
  'firstTokenMs', 'firstUsefulMs', 'totalMs',
  // validator / sanitizer markers
  'sanitizerApplied', 'repaired', 'needsFallback', 'markerCount', 'violationCode',
  // speakability markers (coarse class only — never raw answer text)
  'speakabilityClass',
  // OKF Profile Intelligence markers (2026-07-02): COUNTS + coarse reasons /
  // states only — never card titles, bodies, quotes, or any profile content.
  'cardCount', 'nodeCount', 'entityCount', 'relationCount', 'rejectedCount',
  'fastPathUsed', 'blockedReason', 'evidenceTier', 'packVersion', 'docType',
  'conformant', 'fileCount', 'generatedMs',
]);
// Even for an allowed key, a string value is bounded + must look like a marker label
// (no free-text, no salary/PII numbers). Defense-in-depth on top of the allowlist.
const SENSITIVE_VALUE_RE = /\b\d{2,3}\s?k\b|\b\d{1,3}\s?(?:lpa|lakh)\b|[$£€]\s?\d|\b\d{4,}\b|\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/i;
const MARKER_VALUE_RE = /^[\w .:_/+-]{1,48}$/; // short label shape only
const MAX_STRING_LEN = 48;

function safeStringValue(v: string): boolean {
  return v.length <= MAX_STRING_LEN && MARKER_VALUE_RE.test(v) && !SENSITIVE_VALUE_RE.test(v);
}

/**
 * Keep ONLY allow-listed marker keys with marker-shaped values. Pure. This is the
 * privacy backstop: raw resume/JD/salary/transcript/answer/PII can never pass because
 * (a) their keys aren't allow-listed and (b) free-text/number values are rejected even
 * under an allowed key.
 */
export function scrubTelemetry(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (!ALLOWED_KEYS.has(k)) continue; // allowlist — unknown keys dropped outright
    if (typeof v === 'string') {
      if (safeStringValue(v)) out[k] = v;
    } else if (typeof v === 'number' || typeof v === 'boolean' || v == null) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      // arrays of short marker labels / numbers only (e.g. context-layer names)
      out[k] = v.filter(x => (typeof x === 'string' && safeStringValue(x)) || typeof x === 'number');
    }
    // objects are dropped (markers are flat)
  }
  return out;
}

const RING_MAX = 500;

class PiTelemetry {
  private ring: PiTelemetryRecord[] = [];
  private sink: Sink | null = null;

  /** Register a sink (e.g. analytics shipper). Receives only scrubbed marker payloads. */
  setSink(sink: Sink | null): void { this.sink = sink; }

  emit(event: PiTelemetryEvent, data: Record<string, unknown> = {}): void {
    const rec: PiTelemetryRecord = { event, data: scrubTelemetry(data) };
    this.ring.push(rec);
    if (this.ring.length > RING_MAX) this.ring.shift();
    try { this.sink?.(rec); } catch { /* sink must never break the hot path */ }
    let debug = false;
    try { debug = (process.env.NATIVELY_PI_TELEMETRY_DEBUG || '').trim().toLowerCase() === 'true'; } catch { /* ignore */ }
    if (debug) {
      // eslint-disable-next-line no-console
      console.log(`[piTelemetry] ${event}`, rec.data);
    }
  }

  /** Recent buffered events (diagnostics/tests). */
  recent(n = 50): PiTelemetryRecord[] { return this.ring.slice(-n); }
  /** Clear the buffer (tests). */
  reset(): void { this.ring = []; }
}

export const piTelemetry = new PiTelemetry();

/** Bucket an age (seconds) into a coarse marker — never the raw value. */
export function ageBucket(seconds: number | null | undefined): string {
  if (seconds == null) return 'none';
  if (seconds < 60) return 'immediate';
  if (seconds < 5 * 60) return '1-5min';
  if (seconds < 15 * 60) return '5-15min';
  if (seconds < 30 * 60) return '15-30min';
  if (seconds < 60 * 60) return '30-60min';
  return '60min+';
}
