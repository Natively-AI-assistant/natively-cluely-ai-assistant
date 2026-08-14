/**
 * Smart Browser Context v2 — desktop-side envelope sanitizer.
 *
 * The `/dom` endpoint accepts an OPTIONAL structured envelope next to the legacy
 * `dom` string. This module validates the shape and caps every string field, so
 * an untrusted extension payload can't blow the budget or smuggle an unexpected
 * structure into the renderer/prompt. On ANY problem it returns undefined and the
 * caller falls back to plain-string behaviour (back-compat preserved).
 *
 * Pure + dependency-free so it unit-tests directly from dist-electron.
 */

import type {
  BrowserContextCategory,
  BrowserContextSensitivity,
  CaptureMode,
  ClassificationConfidence,
  ContextEnvelope,
  ExtractionSource,
} from './types';

const CATEGORIES: ReadonlySet<string> = new Set<BrowserContextCategory>([
  'coding_problem', 'coding_editor', 'interview_assessment', 'developer_docs',
  'job_description', 'google_docs_visible', 'notes', 'article', 'email', 'chat',
  'banking', 'auth', 'unknown',
]);
const SENSITIVITIES: ReadonlySet<string> = new Set<BrowserContextSensitivity>(['low', 'medium', 'high', 'critical']);
const CONFIDENCES: ReadonlySet<string> = new Set<ClassificationConfidence>(['high', 'medium', 'low']);
const CAPTURE_MODES: ReadonlySet<string> = new Set<CaptureMode>(['auto', 'manual', 'selected_text', 'screenshot_fallback']);
const EXTRACTION_SOURCES: ReadonlySet<string> = new Set<ExtractionSource>([
  'platform-selector', 'embedded-state', 'editor-dom', 'selection', 'readability', 'innerText', 'screenshot',
]);

/** Per-string-field cap inside the envelope payload. */
const FIELD_CAP = 8000;
/** Total budget for the whole envelope payload (JSON length) before we drop it. */
const PAYLOAD_CAP = 60000;

function capStr(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;
}

/** Recursively cap all string fields of a payload object/array. */
function capPayload(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined; // bound recursion
  if (typeof value === 'string') return value.slice(0, FIELD_CAP);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => capPayload(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value)) {
      if (n++ > 50) break;
      out[k] = capPayload(v, depth + 1);
    }
    return out;
  }
  return undefined;
}

/**
 * Validate + sanitize an untrusted envelope. Returns a clean ContextEnvelope or
 * undefined (caller falls back to the legacy string path). Never throws.
 */
export function sanitizeContextEnvelope(raw: unknown): ContextEnvelope | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const e = raw as Record<string, unknown>;

  if (e.envelopeVersion !== 1) return undefined;
  if (e.source !== 'browser_extension') return undefined;
  if (typeof e.category !== 'string' || !CATEGORIES.has(e.category)) return undefined;
  if (typeof e.captureMode !== 'string' || !CAPTURE_MODES.has(e.captureMode)) return undefined;
  if (typeof e.sensitivity !== 'string' || !SENSITIVITIES.has(e.sensitivity)) return undefined;
  if (typeof e.confidence !== 'string' || !CONFIDENCES.has(e.confidence)) return undefined;

  const m = (e.meta && typeof e.meta === 'object' ? e.meta : {}) as Record<string, unknown>;
  const extractionSource =
    typeof m.extractionSource === 'string' && EXTRACTION_SOURCES.has(m.extractionSource)
      ? (m.extractionSource as ExtractionSource)
      : 'innerText';

  // Sanitize the payload and enforce a total budget.
  let payload: unknown;
  try {
    payload = capPayload(e.payload);
    if (JSON.stringify(payload ?? null).length > PAYLOAD_CAP) {
      // Over budget — keep the envelope metadata but drop the heavy payload.
      payload = {};
    }
  } catch {
    payload = {};
  }

  const contextId = capStr(e.contextId, 128) ?? '';

  return {
    envelopeVersion: 1,
    contextId,
    source: 'browser_extension',
    captureMode: e.captureMode as CaptureMode,
    category: e.category as BrowserContextCategory,
    sensitivity: e.sensitivity as BrowserContextSensitivity,
    confidence: e.confidence as ClassificationConfidence,
    meta: {
      platform: capStr(m.platform, 64),
      title: capStr(m.title, 300),
      host: capStr(m.host, 256),
      // Raw private URLs are not needed downstream — keep only a host + hash.
      url: capStr(m.url, 2048),
      urlHash: capStr(m.urlHash, 64),
      capturedAt: typeof m.capturedAt === 'number' ? m.capturedAt : 0,
      charCount: typeof m.charCount === 'number' ? m.charCount : 0,
      extractionSource,
      // Partial-capture honesty signal — preserved so the overlay can flag a
      // thin auto-capture instead of pretending it's complete.
      partial: m.partial === true ? true : undefined,
      missing: Array.isArray(m.missing)
        ? m.missing.filter((x): x is string => typeof x === 'string').slice(0, 8)
        : undefined,
    },
    payload,
  };
}
