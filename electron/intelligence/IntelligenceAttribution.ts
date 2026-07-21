// electron/intelligence/IntelligenceAttribution.ts
//
// SINGLE per-answer ATTRIBUTION record — the definition-of-done for the memory/context
// fix (task Phase 3). For every manual answer / WTA answer / search / lecture / diagram /
// post-meeting pipeline, exactly ONE attribution record says which memory and context
// layers were actually used to produce the answer. This is what lets a real backend run
// PROVE "ProfileTree fast path fired", "RAG injected 8 nodes", "conversation memory
// resolved the follow-up", "Hindsight was not_configured", etc. — instead of inferring
// it from scattered logs.
//
// PRIVACY (hard rule): this records BOOLEANS, COUNTS, short ENUM LABELS, and a QUERY
// HASH only. It NEVER receives or logs the raw query, resume, JD, transcript, answer
// text, or API keys. All string fields are short enum labels; the only free-ish field
// is `trace_id` (a random id) and `query_hash` (a sha256 prefix). A defensive scrub
// drops anything that doesn't fit, mirroring piTelemetry's allowlist discipline.
//
// It is log-only + a bounded in-memory ring (for the verification harness + tests to
// read back the last N records). It never throws and never affects the answer.

import { createHash } from 'crypto';

export type HindsightMode =
  | 'real'        // a configured, healthy Hindsight server actually answered
  | 'noop'        // memory ON but provider is the Noop (no server configured)
  | 'mock'        // a test/mock provider
  | 'disabled'    // flags OFF
  | 'not_configured' // flags ON but no baseUrl/server
  | 'not_wired'   // code path not reached
  | 'error';      // attempted but threw/timed out

export type LayerMode = 'active' | 'shadow' | 'off';

/** The full per-answer attribution record (task Phase 3 schema). */
export interface IntelligenceAttribution {
  trace_id: string;
  query_hash: string;
  answer_type: string;
  mode: string;
  surface: string; // manual | what_to_answer | search | lecture | diagram | meeting

  // ProfileTree / profile grounding
  profile_tree_used: boolean;
  profile_tree_fast_path_used: boolean;
  structured_resume_used: boolean;
  structured_jd_used: boolean;
  custom_context_used: boolean;
  ai_persona_used: boolean;

  // RAG / knowledge
  hybrid_rag_used: boolean;
  hybrid_rag_node_count: number;
  knowledge_orchestrator_used: boolean;

  // Context tree / router / assembler
  context_router_used: boolean;
  context_router_mode: LayerMode;
  prompt_assembler_v2_used: boolean;
  prompt_assembler_v2_mode: LayerMode;
  context_fusion_used: boolean;

  // Conversation / session / durable memory
  conversation_memory_used: boolean;
  conversation_memory_turns_used: number;
  session_tracker_used: boolean;
  durable_context_used: boolean;

  // Meeting memory / search
  meeting_memory_used: boolean;
  meeting_memory_record_used: boolean;
  global_search_used: boolean;
  in_meeting_search_used: boolean;

  // Live transcript brain (WTA)
  live_transcript_brain_used: boolean;
  live_transcript_brain_mode: LayerMode;

  // Hindsight long-term memory
  hindsight_enabled: boolean;
  hindsight_mode: HindsightMode;
  hindsight_recall_used: boolean;
  hindsight_recall_count: number;
  hindsight_retain_queued: boolean;
  hindsight_reflect_used: boolean;

  // Output / guards
  output_normalizer_used: boolean;
  assistant_voice_guard_triggered: boolean;

  // Coding-contract markers (2026-06-15 fix)
  coding_explicit_contract: string; // none | code_only | complexity_only | dry_run_only | explain_only
  coding_followup_resolved: boolean;
}

/** Caller-facing input — everything optional; defaults fill the rest. */
export type AttributionInput = Partial<Omit<IntelligenceAttribution, 'trace_id' | 'query_hash'>> & {
  /** Raw question — hashed here, NEVER stored. */
  question?: string;
  /** Optional explicit trace id (e.g. reuse the IntelligenceTrace id). */
  traceId?: string;
};

const ATTR_RING_MAX = 200;
const ring: IntelligenceAttribution[] = [];
let seq = 0;

const SHORT_LABEL_RE = /^[\w .:_/+-]{0,48}$/;
const boundedLabel = (v: unknown, fallback = ''): string => {
  const s = typeof v === 'string' ? v : fallback;
  return SHORT_LABEL_RE.test(s) ? s.slice(0, 48) : fallback;
};
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const layerMode = (v: unknown): LayerMode => (v === 'active' || v === 'shadow' ? v : 'off');

const queryHash = (question?: string): string => {
  try {
    return question ? createHash('sha256').update(question).digest('hex').slice(0, 12) : 'none';
  } catch {
    return 'none';
  }
};

/**
 * Build the full attribution record from a partial input, defaulting every unset field.
 * Pure — no side effects. Use `recordAttribution` to also log + ring it.
 */
export function buildAttribution(input: AttributionInput): IntelligenceAttribution {
  return {
    trace_id: boundedLabel(input.traceId, `attr_${seq++}`) || `attr_${seq++}`,
    query_hash: queryHash(input.question),
    answer_type: boundedLabel(input.answer_type, 'unknown'),
    mode: boundedLabel(input.mode, 'manual'),
    surface: boundedLabel(input.surface, 'manual'),

    profile_tree_used: bool(input.profile_tree_used),
    profile_tree_fast_path_used: bool(input.profile_tree_fast_path_used),
    structured_resume_used: bool(input.structured_resume_used),
    structured_jd_used: bool(input.structured_jd_used),
    custom_context_used: bool(input.custom_context_used),
    ai_persona_used: bool(input.ai_persona_used),

    hybrid_rag_used: bool(input.hybrid_rag_used),
    hybrid_rag_node_count: count(input.hybrid_rag_node_count),
    knowledge_orchestrator_used: bool(input.knowledge_orchestrator_used),

    context_router_used: bool(input.context_router_used),
    context_router_mode: layerMode(input.context_router_mode),
    prompt_assembler_v2_used: bool(input.prompt_assembler_v2_used),
    prompt_assembler_v2_mode: layerMode(input.prompt_assembler_v2_mode),
    context_fusion_used: bool(input.context_fusion_used),

    conversation_memory_used: bool(input.conversation_memory_used),
    conversation_memory_turns_used: count(input.conversation_memory_turns_used),
    session_tracker_used: bool(input.session_tracker_used),
    durable_context_used: bool(input.durable_context_used),

    meeting_memory_used: bool(input.meeting_memory_used),
    meeting_memory_record_used: bool(input.meeting_memory_record_used),
    global_search_used: bool(input.global_search_used),
    in_meeting_search_used: bool(input.in_meeting_search_used),

    live_transcript_brain_used: bool(input.live_transcript_brain_used),
    live_transcript_brain_mode: layerMode(input.live_transcript_brain_mode),

    hindsight_enabled: bool(input.hindsight_enabled),
    hindsight_mode: (input.hindsight_mode as HindsightMode) || 'disabled',
    hindsight_recall_used: bool(input.hindsight_recall_used),
    hindsight_recall_count: count(input.hindsight_recall_count),
    hindsight_retain_queued: bool(input.hindsight_retain_queued),
    hindsight_reflect_used: bool(input.hindsight_reflect_used),

    output_normalizer_used: bool(input.output_normalizer_used),
    assistant_voice_guard_triggered: bool(input.assistant_voice_guard_triggered),

    coding_explicit_contract: boundedLabel(input.coding_explicit_contract, 'none') || 'none',
    coding_followup_resolved: bool(input.coding_followup_resolved),
  };
}

/**
 * Build + RECORD an attribution: pushes to the bounded ring and logs ONE
 * `[IntelligenceAttribution]` line. Never throws. Returns the record (handy for tests).
 *
 * The log line is gated on the `trace` intelligence flag OR an explicit
 * NATIVELY_INTELLIGENCE_ATTRIBUTION=true env (so it can be turned on without enabling
 * the full trace ring). The RING is always populated (cheap, content-free) so the
 * verify:memory-context harness can read attribution even with logging off.
 */
export function recordAttribution(input: AttributionInput): IntelligenceAttribution {
  let rec: IntelligenceAttribution;
  try {
    rec = buildAttribution(input);
  } catch {
    rec = buildAttribution({});
  }
  try {
    ring.push(rec);
    if (ring.length > ATTR_RING_MAX) ring.shift();
  } catch { /* ring never breaks the hot path */ }
  try {
    let on = false;
    try {
      const env = (process.env.NATIVELY_INTELLIGENCE_ATTRIBUTION || '').trim().toLowerCase();
      const traceEnv = (process.env.NATIVELY_INTELLIGENCE_TRACE || '').trim().toLowerCase();
      on = env === 'true' || env === '1' || traceEnv === 'true' || traceEnv === '1';
    } catch { /* ignore */ }
    if (on) {
      // eslint-disable-next-line no-console
      console.log('[IntelligenceAttribution]', JSON.stringify(rec));
    }
  } catch { /* logging never breaks the hot path */ }
  return rec;
}

/**
 * Centralized, HONEST Hindsight mode classification (task hard rules 9-12). Takes plain
 * booleans so it stays dependency-free and matches what verify:hindsight reports.
 *   memoryFlagOn  = hindsightMemory flag enabled (env or settings)
 *   configured    = a baseUrl is set (HindsightManager.getHindsightConfig() != null)
 *   available     = a recent health-check passed (server reachable)
 *   errored       = an attempt threw/timed out
 */
export function hindsightModeFor(args: {
  memoryFlagOn: boolean;
  configured: boolean;
  available?: boolean;
  errored?: boolean;
}): HindsightMode {
  if (args.errored) return 'error';
  if (!args.memoryFlagOn) return 'disabled';
  if (!args.configured) return 'not_configured';
  // configured + flag on. 'real' only when the server actually answered (available);
  // otherwise it's a configured-but-unreachable server → noop fallback.
  return args.available ? 'real' : 'noop';
}

/** Recent attribution records (verification harness + tests). */
export function recentAttributions(n = 50): IntelligenceAttribution[] {
  return ring.slice(-Math.max(0, n));
}

/** The most recent attribution record, or null. */
export function lastAttribution(): IntelligenceAttribution | null {
  return ring.length ? ring[ring.length - 1] : null;
}

/** Clear the ring (tests). */
export function resetAttributions(): void {
  ring.length = 0;
}
