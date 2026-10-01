// electron/llm/visionProbeOutcome.ts
//
// Telling "this model cannot see images" apart from every other failure
// (design: docs/plans/2026-10-01-vision-capability-design.md, phase 3). Pure.
//
// STRICT ON PURPOSE. A "no" is saved for 30 days and stops a model receiving
// screenshots, so it needs positive evidence: a recognised image refusal, or a
// real reply that does not contain the number. An empty daily pool, a rate
// limit, a timeout, a content filter and an auth failure are all "unknown".

export type ProbeOutcome = 'yes' | 'no' | 'unknown';

// The image-refusal allow-list lives in streamFallbackEngine.ts (that engine
// takes no imports, so it is the one place both can read it from).
import { isImageRefusalMessage } from './streamFallbackEngine';
export { isImageRefusalMessage };

/**
 * Judge the model's reply to "what number is shown?". Separators between digits
 * are ignored ("7 3 9 2", "7,392"); the number must stand alone, so "173920"
 * does not contain 7392. An empty or one-word reply is unknown, not "no": some
 * gateways return an empty stream when a channel misbehaves.
 */
export function judgeProbeReply(reply: string, number: string): ProbeOutcome {
  const text = String(reply || '');
  const joined = text.replace(/(\d)[\s,.\-_]+(?=\d)/g, '$1');
  if (new RegExp(`(?<!\\d)${number}(?!\\d)`).test(joined)) return 'yes';
  return text.replace(/[^\p{L}\p{N}]/gu, '').length >= 6 ? 'no' : 'unknown';
}

/** An error is a "no" only when it is a recognised image refusal. */
export function judgeProbeError(err: unknown): 'no' | 'unknown' {
  const message = (err as { message?: unknown } | null | undefined)?.message ?? err ?? '';
  return isImageRefusalMessage(String(message)) ? 'no' : 'unknown';
}
