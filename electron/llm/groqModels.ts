// electron/llm/groqModels.ts
//
// The single place that names which Groq model Natively talks to, and what it
// falls back to when that model is gone.
//
// Why a ladder and not one pinned id: on 2026-08-23 Groq's catalogue held
// exactly one model that accepts image input — `qwen/qwen3.6-27b` — and it is
// PREVIEW tier. Groq's own docs say preview models can be discontinued without
// notice, which is precisely how the previous pins died (llama-3.3-70b-versatile
// 2026-08-16, meta-llama/llama-4-scout-17b-16e-instruct 2026-07-17). A pinned
// preview id is a scheduled outage.
//
// So every Groq entry point tries the primary and, on a model-gone error ONLY,
// retries once on a PRODUCTION-tier id. Production models carry Groq's
// deprecation-notice guarantee; preview models do not.
//
// The fallback is text-only. That is not an oversight: if qwen3.6-27b goes away
// Groq has no image-capable model at all, and the vision chain is expected to
// fall through to another provider rather than pretend otherwise. Only the TEXT
// paths ladder down.
//
// Platform note: pure constants and string matching, identical on macOS and
// Windows.

import { classifyVisionError } from './visionStreamFallback';

/** Preview tier, multimodal. What routing uses by default. */
export const GROQ_PRIMARY_MODEL = 'qwen/qwen3.6-27b';

/**
 * Production tier, text-only. Survives the primary's retirement.
 * https://console.groq.com/docs/models — production models are the ones Groq
 * commits to giving deprecation notice for.
 */
export const GROQ_PRODUCTION_FALLBACK_MODEL = 'openai/gpt-oss-120b';

/**
 * Ordered text-model ladder. Index 0 is what we prefer; every later entry is a
 * strictly more durable tier. Used by the Settings "Test Connection" probe and
 * by the runtime retry in LLMHelper, so the two can never disagree about what
 * "Groq works" means.
 */
export const GROQ_TEXT_MODEL_LADDER: readonly string[] = [
  GROQ_PRIMARY_MODEL,
  GROQ_PRODUCTION_FALLBACK_MODEL,
];

/**
 * The next id to try after `modelId` failed as gone, or null when the ladder is
 * exhausted (or `modelId` is a user-chosen id that is not on the ladder — we do
 * not silently reroute a model the user picked deliberately).
 */
export function groqFallbackFor(modelId: string): string | null {
  const i = GROQ_TEXT_MODEL_LADDER.indexOf(modelId);
  if (i < 0) return null;
  return GROQ_TEXT_MODEL_LADDER[i + 1] ?? null;
}

/**
 * Every id prefix Groq hosts that Natively can encounter (pinned ids, the
 * picker's offerings, legacy auto-set defaults, discovery-promoted ids).
 *
 * THE one predicate (code-review 2026-08-23): this existed as three hand-
 * synced copies — LLMHelper.isGroqModel, ipcHandlers' isKnownGroqModel, and
 * CredentialsManager's auto-default prefix list — and they had already
 * drifted ('qwen-' only in LLMHelper, 'meta-llama/' missing from
 * CredentialsManager), so routing and credential checks disagreed about the
 * same id. All three now import this.
 *
 * NOTE 'openai/gpt-oss-' is a GROQ prefix: Groq hosts OpenAI's open-weight
 * models under their upstream vendor path. Provider classifiers must check
 * isGroqModelId BEFORE any bare "openai" substring test.
 */
export const GROQ_MODEL_ID_PREFIXES: readonly string[] = [
  'llama-', 'mixtral-', 'gemma-', 'meta-llama/', 'qwen/', 'qwen-',
  'openai/gpt-oss-', 'groq/',
];

export function isGroqModelId(modelId: string | null | undefined): boolean {
  const id = modelId || '';
  return GROQ_MODEL_ID_PREFIXES.some((p) => id.startsWith(p));
}

/**
 * The one image-capable Groq model, and the one predicate for it (code-review
 * 2026-08-23: this fact was encoded in four uncoordinated places —
 * modelCapabilities' regex, LLMHelper's local alias, VisionProviderRegistry,
 * and CredentialsManager — so a vision-model swap that missed one silently
 * re-armed the "Groq vision refused" bug).
 */
export const GROQ_VISION_MODEL = GROQ_PRIMARY_MODEL;
export function groqSupportsImages(modelId: string | null | undefined): boolean {
  return /qwen3\.6/i.test(modelId || '');
}

/**
 * Ids Groq has SHUT DOWN — compare by id, not version: a retirement is not a
 * version bump (llama-4-scout parses 4.0, its replacement qwen3.6-27b 3.6).
 * Moved here from ModelVersionManager (code-review 2026-08-23) so retirement
 * knowledge lives in the module that declares itself the Groq authority and
 * is importable from lightweight contexts (ipcHandlers' default-model repair).
 * See https://console.groq.com/docs/deprecations
 */
export const RETIRED_MODEL_IDS: ReadonlySet<string> = new Set<string>([
  'meta-llama/llama-4-scout-17b-16e-instruct', // shut down 2026-07-17
  'meta-llama/llama-4-maverick-17b-128e-instruct', // shut down 2026-03-09
  'llama-3.3-70b-versatile',                   // shut down 2026-08-16
  'llama-3.1-8b-instant',                      // shut down 2026-08-16
  'qwen/qwen3-32b',                            // shut down 2026-07-17
  'moonshotai/kimi-k2-instruct-0905',          // shut down 2026-04-15
  'meta-llama/llama-guard-4-12b',              // shut down 2026-03-05
]);
export function isRetiredModelId(modelId: string | null | undefined): boolean {
  return RETIRED_MODEL_IDS.has(modelId || '');
}

// ── Known-gone memo (code-review 2026-08-23) ────────────────────────────────
// Without it, every Groq call after a retirement paid a doomed full-payload
// round trip to the dead model before laddering. Process-lifetime is the
// right scope: a retirement never un-happens within a run, and a restart
// (or rediscovery flipping the tier) naturally re-probes.
const goneModels = new Set<string>();
export function markGroqModelGone(modelId: string): void { if (modelId) goneModels.add(modelId); }
export function isGroqModelKnownGone(modelId: string | null | undefined): boolean { return goneModels.has(modelId || ''); }
/** Test hook. */
export function _resetGroqGoneMemo(): void { goneModels.clear(); }

/**
 * True when `err` says the MODEL is gone, as opposed to the key being bad or
 * the account being rate-limited.
 *
 * Delegates to classifyVisionError, which already gets the ordering right that
 * matters here: a 403 quoting a model name is auth, not a retirement. Laddering
 * on an auth failure would fire a second doomed request and report the wrong
 * remedy to the user ("model retired" when the key is simply invalid).
 *
 * `axiosLike` normalises the axios shape (status under err.response.status,
 * body under err.response.data) that the IPC probe sees.
 */
export function isGroqModelGone(err: any): boolean {
  const status = Number(err?.response?.status ?? err?.status ?? err?.statusCode ?? 0) || 0;
  const body = err?.response?.data;
  const message = [
    err?.message,
    typeof body === 'string' ? body : body ? JSON.stringify(body) : '',
  ].filter(Boolean).join(' ');
  return classifyVisionError({ status, message }, false) === 'model_gone';
}
