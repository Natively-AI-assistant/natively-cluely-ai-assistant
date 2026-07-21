// generateStructured.ts (Phase 7)
// A reusable, provider-agnostic "generate a validated JSON object" helper for the meeting
// notes pipeline. It never depends on provider JSON guarantees — it ALWAYS runs the ladder:
//
//   build prompt (system + JSON shape hint)
//     → LLM call (LLMHelper.generateMeetingSummary: scope-gated, provider fallback chain)
//     → extract JSON (fence-strip / first-{..last-})
//     → validate (caller-supplied schema validator with repair/coercion)
//     → if invalid: ONE repair retry (send the raw output + errors back, ask for fixed JSON)
//     → if still invalid: caller fallback() or { ok:false }
//
// This is the single choke point every meeting-note LLM call should use (chunk atoms,
// optional direct/long-context summary, follow-up draft).
//
// Privacy: this module sends only what the caller passes in `userContent`/`systemPrompt`.
// The meeting pipeline always passes summary-safe content (no raw reference-file bodies),
// and the underlying generateMeetingSummary honors providerDataScopes.post_call_summary.

import type { LLMHelper } from '../../LLMHelper';

export interface StructuredValidation<T> {
  ok: boolean;
  data?: T;
  errors: string[];
  repaired: boolean;
}

export interface GenerateStructuredOptions<T> {
  /** Human/schema name, used in the repair prompt. */
  schemaName: string;
  /** Example JSON appended to the prompt to anchor the shape. */
  jsonShapeHint: string;
  /** System prompt (rules). */
  systemPrompt: string;
  /** User content (the transcript chunk / summary inputs). */
  userContent: string;
  /** Validate + repair the parsed value. Must never throw. */
  validate: (raw: unknown) => StructuredValidation<T>;
  /** The LLM helper to route through. */
  llmHelper: LLMHelper;
  /** Optional deterministic fallback when the LLM cannot produce valid output. */
  fallback?: () => T;
  /** Disable the one repair retry (default: enabled). */
  disableRepairRetry?: boolean;
}

export interface GenerateStructuredResult<T> {
  ok: boolean;
  data?: T;
  raw: string;
  errors: string[];
  repaired: boolean;
  usedFallback: boolean;
}

/** Extract the most likely JSON object substring from a raw LLM response. */
export function extractJsonObject(raw: string): unknown | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] || text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(candidate.slice(first, last + 1)); } catch { /* fall through */ }
    }
    return null;
  }
}

function buildPrompt(systemPrompt: string, jsonShapeHint: string): string {
  return `${systemPrompt}

Output ONLY a single valid JSON object. No markdown fences, no comments, no prose before or after.
Return exactly this JSON shape:
${jsonShapeHint}`;
}

export async function generateStructured<T>(opts: GenerateStructuredOptions<T>): Promise<GenerateStructuredResult<T>> {
  const system = buildPrompt(opts.systemPrompt, opts.jsonShapeHint);

  // Attempt 1: primary generation.
  let raw = '';
  try {
    raw = await opts.llmHelper.generateMeetingSummary(system, opts.userContent, system) || '';
  } catch (e) {
    raw = '';
  }

  let parsed = extractJsonObject(raw);
  let result = opts.validate(parsed);
  if (result.ok && result.data !== undefined) {
    return { ok: true, data: result.data, raw, errors: result.errors, repaired: result.repaired, usedFallback: false };
  }

  // Attempt 2: one repair retry — show the model its own (bad) output + the errors.
  if (!opts.disableRepairRetry) {
    const repairSystem = `You returned JSON that failed validation for "${opts.schemaName}".
Fix it and return ONLY corrected JSON matching the required shape. No prose, no fences.

Validation errors:
${(result.errors.length ? result.errors : ['invalid or missing JSON']).map(e => `- ${e}`).join('\n')}

Required JSON shape:
${opts.jsonShapeHint}`;
    const repairUser = `Previous output to correct:\n${raw || '(empty)'}`;
    let repairRaw = '';
    try {
      repairRaw = await opts.llmHelper.generateMeetingSummary(repairSystem, repairUser, repairSystem) || '';
    } catch {
      repairRaw = '';
    }
    const repairedParsed = extractJsonObject(repairRaw);
    const repairedResult = opts.validate(repairedParsed);
    if (repairedResult.ok && repairedResult.data !== undefined) {
      return { ok: true, data: repairedResult.data, raw: repairRaw, errors: repairedResult.errors, repaired: true, usedFallback: false };
    }
    // Keep the better of the two error sets for telemetry.
    raw = repairRaw || raw;
    result = repairedResult;
  }

  // Attempt 3: deterministic fallback.
  if (opts.fallback) {
    return { ok: true, data: opts.fallback(), raw, errors: result.errors, repaired: true, usedFallback: true };
  }

  return { ok: false, raw, errors: result.errors.length ? result.errors : ['failed to produce valid JSON'], repaired: result.repaired, usedFallback: false };
}
