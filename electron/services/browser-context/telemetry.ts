/**
 * Smart Browser Context v2 — privacy-safe telemetry.
 *
 * Emits ONLY non-identifying signals about a capture: category, platform label,
 * confidence bucket, capture mode, success/failure, a char-count BUCKET (not the
 * count), whether it was used in an answer, and an error code. It NEVER carries
 * raw URLs, titles, page text, code, screenshots, or document/email/chat content.
 *
 * `buildCaptureTelemetry()` is pure (testable). `emitCaptureTelemetry()` routes
 * the sanitized event to console-debug by default; if a sink is registered it
 * forwards there. There is no new external network sink.
 */

import type {
  BrowserContextCategory,
  CaptureMode,
  ClassificationConfidence,
} from './types';

/** The ONLY fields ever emitted. No raw content of any kind. */
export interface CaptureTelemetryEvent {
  event: 'browser_context_capture';
  category: BrowserContextCategory | 'unknown';
  platform?: string;
  confidenceBucket: ClassificationConfidence;
  captureMode: CaptureMode;
  success: boolean;
  charCountBucket: string;
  usedInAnswer: boolean;
  errorCode?: string;
}

export interface CaptureTelemetryInput {
  category?: BrowserContextCategory;
  platform?: string;
  confidence?: ClassificationConfidence;
  captureMode?: CaptureMode;
  success: boolean;
  charCount?: number;
  usedInAnswer?: boolean;
  errorCode?: string;
}

/** Bucket a char count into a coarse range so the raw size never leaks. */
export function charCountBucket(n: number | undefined): string {
  if (!n || n <= 0) return '0';
  if (n < 500) return '<500';
  if (n < 2000) return '500-2k';
  if (n < 8000) return '2k-8k';
  if (n < 25000) return '8k-25k';
  return '25k+';
}

/** Platform labels are short, public product names — safe. Cap defensively. */
function safePlatform(p: string | undefined): string | undefined {
  if (!p || typeof p !== 'string') return undefined;
  // Only allow short, simple labels; anything odd is dropped (never a URL/title).
  const trimmed = p.trim().slice(0, 40);
  return /^[\w .+#/-]{1,40}$/.test(trimmed) ? trimmed : undefined;
}

/**
 * Build the sanitized telemetry event. Pure — no I/O. The output is guaranteed to
 * contain only the allowlisted fields.
 */
export function buildCaptureTelemetry(input: CaptureTelemetryInput): CaptureTelemetryEvent {
  return {
    event: 'browser_context_capture',
    category: input.category ?? 'unknown',
    platform: safePlatform(input.platform),
    confidenceBucket: input.confidence ?? 'low',
    captureMode: input.captureMode ?? 'auto',
    success: Boolean(input.success),
    charCountBucket: charCountBucket(input.charCount),
    usedInAnswer: Boolean(input.usedInAnswer),
    errorCode: input.errorCode ? String(input.errorCode).slice(0, 64) : undefined,
  };
}

type Sink = (event: CaptureTelemetryEvent) => void;
let sink: Sink | null = null;

/** Register a telemetry sink (e.g. the app's TelemetryService). Optional. */
export function setCaptureTelemetrySink(fn: Sink | null): void {
  sink = fn;
}

/** Emit a sanitized capture telemetry event. Never throws. */
export function emitCaptureTelemetry(input: CaptureTelemetryInput): CaptureTelemetryEvent {
  const event = buildCaptureTelemetry(input);
  try {
    if (sink) sink(event);
    else console.debug('[browser-context] telemetry', event);
  } catch {
    /* telemetry must never break capture */
  }
  return event;
}
