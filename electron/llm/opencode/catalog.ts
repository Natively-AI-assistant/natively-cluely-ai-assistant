/**
 * OpenCode catalogue parsing, protocol resolution and cold-start presets.
 *
 * Pure: no Electron, no network, no module-scope I/O. Everything here is
 * exercised directly by the catalogue/protocol tests, and the tests are the
 * reason the resolver can be read in one screen:
 *
 *   - `parseOpencodeCatalogue` turns a `/v1/models` payload into the metadata
 *     map the adapters dispatch on.
 *   - `resolveOpencodeFamily` is the answer for an id with no metadata (a cold
 *     start, or a catalogue fetched before a model was added).
 *   - `OPENCODE_PRESET_MODELS` is what the overlay picker shows before the
 *     first fetch. Every entry names its family explicitly — a preset that
 *     relied on the heuristic would be the one model the heuristic gets wrong.
 */

import {
  OPENCODE_ANTHROPIC_BASE,
  OPENCODE_GOOGLE_BASE,
  OPENCODE_INFERENCE_BASE,
  OPENCODE_OPENAI_BASE,
} from './constants';
import { OPENCODE_API_FAMILIES, type OpencodeApiFamily, type OpencodeModelMeta } from './types';

/** The base URL each family uses when the catalogue does not name one. */
export function opencodeFamilyBaseUrl(family: OpencodeApiFamily): string {
  switch (family) {
    case 'messages': return OPENCODE_ANTHROPIC_BASE;
    // `openai/v1` serves both; the Responses call appends `/responses`.
    case 'responses':
    case 'chat-completions': return OPENCODE_OPENAI_BASE;
    case 'generate-content': return OPENCODE_GOOGLE_BASE;
  }
}

/**
 * Free-tier ids end in `-free` (every one of them in the 2026-11-19 catalogue).
 *
 * They are filtered out rather than offered-and-refused: OpenCode documents
 * that free chat models answer HTTP 403 to every client that is not OpenCode,
 * even with a valid key. A picker row that can only fail is worse than no row.
 */
export function isFreeOpencodeModel(id: string): boolean {
  return /[-_]free$/i.test(String(id || '').trim());
}

/** `claude-sonnet-5-5` → `Claude Sonnet 5.5`. Used when the catalogue names nothing. */
export function opencodeDisplayName(id: string): string {
  const bare = String(id || '').replace(/^opencode\//i, '');
  if (!bare) return '';
  const words = bare.split(/[-_/]+/).filter(Boolean);
  const out: string[] = [];
  for (const original of words) {
    const w = original;
    // `5-5` → `5.5`: OpenCode writes Claude versions with dashes. Append to the
    // previous token in the OUTPUT array, not the source: mutating the source
    // while mapping produced "Claude Sonnet 5" for `claude-sonnet-5-5`.
    if (/^\d{1,2}$/.test(w) && out.length && /^\d+(?:\.\d+)*$/.test(out[out.length - 1])) {
      out[out.length - 1] = `${out[out.length - 1]}.${w}`;
      continue;
    }
    if (/^gpt$/i.test(w)) out.push('GPT');
    else if (/^glm$/i.test(w)) out.push('GLM');
    else if (/^oss$/i.test(w)) out.push('OSS');
    else if (/^ai$/i.test(w)) out.push('AI');
    else out.push(w.charAt(0).toUpperCase() + w.slice(1));
  }
  return out.join(' ');
}

interface RawApiEntry {
  base_url?: unknown;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  recommended_api?: unknown;
  api?: unknown;
  modalities?: { input?: unknown };
  limit?: { context?: unknown; output?: unknown };
  capabilities?: {
    reasoning?: {
      supported?: unknown;
      effort?: unknown;
    };
  };
}

function isFamily(value: unknown): value is OpencodeApiFamily {
  return typeof value === 'string' && (OPENCODE_API_FAMILIES as readonly string[]).includes(value);
}

/**
 * Which protocol serves this entry.
 *
 * Order, and the reason for it:
 *   1. `recommended_api` when it is a known family — it is the catalogue's own
 *      recommendation and matches the single key of `api` on every live entry.
 *   2. The single known key of `api`.
 *   3. `recommended_api` even when `api` is absent (a degraded catalogue still
 *      knows the protocol).
 *   4. The name heuristic, so an entry never becomes unselectable just because
 *      its metadata was incomplete.
 */
function pickFamily(item: RawModel): OpencodeApiFamily {
  const api = item.api && typeof item.api === 'object' ? item.api as Record<string, RawApiEntry> : null;
  const recommended = isFamily(item.recommended_api) ? item.recommended_api : null;
  if (recommended && api?.[recommended]) return recommended;
  if (api) {
    const keys = Object.keys(api).filter(isFamily);
    if (keys.length === 1) return keys[0];
    if (keys.length > 1 && recommended && keys.includes(recommended)) return recommended;
    if (keys.length > 1) return keys[0];
  }
  if (recommended) return recommended;
  return resolveOpencodeFamily(typeof item.id === 'string' ? item.id : '');
}

const OPENCODE_ORIGIN = new URL(OPENCODE_INFERENCE_BASE).origin;

/** True only for OpenCode's own https origin. */
function isOpencodeOrigin(url: string): boolean {
  try {
    return new URL(url).origin === OPENCODE_ORIGIN;
  } catch {
    return false;
  }
}

function pickBaseUrl(item: RawModel, family: OpencodeApiFamily): string {
  const api = item.api && typeof item.api === 'object' ? item.api as Record<string, RawApiEntry> : null;
  const named = api?.[family]?.base_url;
  if (typeof named !== 'string' || !named.trim()) return opencodeFamilyBaseUrl(family);
  const base = named.trim().replace(/\/+$/, '');
  // The bearer key travels to whatever host this names, so only OpenCode's own
  // origin is trusted. Anything else — a malformed URL, plain http, another
  // host — falls back to the family default rather than carrying the key away.
  if (!isOpencodeOrigin(base)) return opencodeFamilyBaseUrl(family);
  // The catalogue publishes the API's OWN base (`.../anthropic/v1`,
  // `.../google/v1beta`). Natively appends the protocol path itself: the
  // Anthropic SDK adds `/v1/messages`, and the Gemini adapter adds
  // `/v1beta/models/<id>:…`. Storing the published form verbatim would produce
  // `/v1/v1/messages` and `/v1beta/v1beta/models/…`. Normalise here, once, so
  // every adapter can trust the stored base.
  if (family === 'messages') return base.replace(/\/v1$/i, '');
  if (family === 'generate-content') return base.replace(/\/v1(?:beta|alpha)?$/i, '');
  return base;
}

function pickVision(item: RawModel): boolean {
  const inputs = Array.isArray(item.modalities?.input) ? item.modalities.input : [];
  return inputs.some((m) => typeof m === 'string' && (m === 'image' || m.startsWith('image/')));
}

function pickNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function pickEffort(item: RawModel): string[] | undefined {
  const effort = item.capabilities?.reasoning?.effort;
  if (!Array.isArray(effort)) return undefined;
  const levels = effort.filter((l): l is string => typeof l === 'string' && l.length > 0);
  return levels.length ? levels : undefined;
}

/**
 * Parse a `/v1/models` or `/go/v1/models` payload.
 *
 * Accepts the documented `{ object:'list', data:[…] }` shape and a bare array
 * (the shape every test fixture uses). Anything else degrades to `{}` — a
 * malformed catalogue must never throw into the key-save path.
 *
 * `go` only tags the entries; the merge decides precedence.
 */
export function parseOpencodeCatalogue(
  payload: unknown,
  opts: { go?: boolean } = {},
): Record<string, OpencodeModelMeta> {
  const raw: unknown = Array.isArray(payload)
    ? payload
    : (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(raw)) return {};

  const out: Record<string, OpencodeModelMeta> = {};
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as RawModel;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id) continue;
    // The endpoint only lists chat models today, but a future decision/voice
    // model must not be handed a chat adapter.
    if (typeof item.type === 'string' && item.type !== 'chat') continue;
    if (isFreeOpencodeModel(id)) continue;

    const api = pickFamily(item);
    const effort = pickEffort(item);
    out[id] = {
      api,
      baseUrl: pickBaseUrl(item, api),
      vision: pickVision(item),
      contextTokens: pickNumber(item.limit?.context),
      outputTokens: pickNumber(item.limit?.output),
      // A reasoning object with no effort list (e.g. `{ supported: true }`) is
      // still an answer to "does this model reason?", which the Settings
      // control needs in order to hide itself.
      reasoning: item.capabilities?.reasoning?.supported === true || !!effort,
      reasoningEffort: effort,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : undefined,
      go: opts.go === true ? true : undefined,
    };
  }
  return out;
}

/**
 * Merge the paid catalogue and the Go catalogue.
 *
 * Go wins on an id collision: a key that can see the Go list has already paid
 * for those models, and a key that cannot never receives the list, so the
 * collision cannot mislead a non-subscriber. Fields the Go entry omits fall
 * back to the main entry rather than being erased.
 */
export function mergeOpencodeCatalogues(
  main: Record<string, OpencodeModelMeta>,
  go: Record<string, OpencodeModelMeta>,
): Record<string, OpencodeModelMeta> {
  const merged: Record<string, OpencodeModelMeta> = { ...main };
  for (const [id, meta] of Object.entries(go)) {
    const base = merged[id];
    merged[id] = {
      ...(base || { api: meta.api, baseUrl: meta.baseUrl, vision: meta.vision }),
      ...meta,
      vision: meta.vision || base?.vision === true,
      contextTokens: meta.contextTokens ?? base?.contextTokens,
      outputTokens: meta.outputTokens ?? base?.outputTokens,
      reasoningEffort: meta.reasoningEffort ?? base?.reasoningEffort,
      name: meta.name ?? base?.name,
      go: true,
    };
  }
  return merged;
}

/**
 * The protocol for an id with no catalogue metadata.
 *
 * This is a COLD-START fallback, not the source of truth. It is deliberately
 * narrow and reviewed against the live catalogue:
 *   - `qwen3.8-max` is chat-completions while `qwen3.8-flash` is messages, so
 *     only `plus`/`flash` qwen ids may claim messages.
 *   - `grok-*` and `muse-*` are responses, not chat-completions.
 */
export function resolveOpencodeFamily(
  id: string,
  meta?: OpencodeModelMeta,
): OpencodeApiFamily {
  if (meta?.api) return meta.api;
  const bare = String(id || '').replace(/^opencode\//i, '').toLowerCase();
  if (bare.startsWith('claude-')) return 'messages';
  if (bare.startsWith('qwen') && /(plus|flash)/.test(bare)) return 'messages';
  if (bare.startsWith('gpt-') || bare.startsWith('grok-') || bare.startsWith('muse-') || bare.startsWith('codex')) {
    return 'responses';
  }
  if (bare.startsWith('gemini-')) return 'generate-content';
  return 'chat-completions';
}

export interface OpencodePreset {
  id: string;
  name: string;
  desc: string;
  api: OpencodeApiFamily;
  vision: boolean;
}

/**
 * What the overlay picker and the Settings card show before any fetch.
 *
 * One per family at minimum, so a user can validate every adapter from the
 * picker without a catalogue round-trip. The full catalogue still lives in
 * Settings: this list is deliberately six rows, not 89.
 */
export const OPENCODE_PRESET_MODELS: readonly OpencodePreset[] = [
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', desc: 'Fast • Multimodal', api: 'chat-completions', vision: true },
  { id: 'kimi-k3', name: 'Kimi K3', desc: 'Long context • Multimodal', api: 'chat-completions', vision: true },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', desc: 'Balanced • Multimodal', api: 'messages', vision: true },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', desc: 'Reasoning • Multimodal', api: 'responses', vision: true },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', desc: 'Fastest • Multimodal', api: 'generate-content', vision: true },
  { id: 'glm-5.3', name: 'GLM 5.3', desc: 'Coding • Text', api: 'chat-completions', vision: false },
];

/** Preset metadata, so a cold start dispatches without a fetch. */
export function opencodePresetMeta(): Record<string, OpencodeModelMeta> {
  const out: Record<string, OpencodeModelMeta> = {};
  for (const p of OPENCODE_PRESET_MODELS) {
    out[p.id] = {
      api: p.api,
      baseUrl: opencodeFamilyBaseUrl(p.api),
      vision: p.vision,
      name: p.name,
    };
  }
  return out;
}

/** The vision-capable subset, which the screenshot seat reads synchronously. */
export function opencodeVisionSubset(meta: Record<string, OpencodeModelMeta>): string[] {
  return Object.entries(meta)
    .filter(([, m]) => m.vision === true)
    .map(([id]) => id);
}

/**
 * The deepest reasoning level we are willing to send automatically for a live
 * turn: the lowest the model lists. `none` beats `minimal` beats `low`; a
 * model with an unusual vocabulary gets nothing rather than a guess, because
 * an unsupported effort is a hard 400 on the interactive stream.
 */
export function opencodeFastReasoningEffort(meta?: OpencodeModelMeta): string | null {
  if (!meta?.reasoning) return null;
  const levels = meta.reasoningEffort || [];
  for (const preferred of ['none', 'minimal', 'low']) {
    if (levels.includes(preferred)) return preferred;
  }
  return null;
}
