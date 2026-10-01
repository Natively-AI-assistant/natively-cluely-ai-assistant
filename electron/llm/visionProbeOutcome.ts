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

// A quota, rate-limit, auth, filter or outage notice delivered as ordinary text.
// Deliberately broad: wrongly calling a reply "unknown" costs a retry later;
// wrongly calling it "no" blocks a capable model for a month.
const PROVIDER_NOTICE_RE = /quota|credit|billing|rate.?limit|too many requests|try again later|temporarily unavailable|overloaded|blocked|content.?filter|unauthori[sz]ed|api.?key|exhausted|无可用渠道|令牌/i;

/**
 * Judge the model's reply to "what number is shown?". Separators between digits
 * are ignored ("7 3 9 2", "7,392"); the number must stand alone, so "173920"
 * does not contain 7392. An empty or one-word reply is unknown, not "no": some
 * gateways return an empty stream when a channel misbehaves. A reply containing
 * a DIFFERENT number is a miss even when short.
 */
export function judgeProbeReply(reply: string, number: string): ProbeOutcome {
  const text = String(reply || '');
  const standsAlone = new RegExp(`(?<!\\d)${number}(?!\\d)`);
  // The raw text first: "7392, 4 digits in bold" must not be joined into
  // "73924". Then with separators between digits removed, for "7 3 9 2".
  if (standsAlone.test(text) || standsAlone.test(text.replace(/(\d)[\s,.\-_]+(?=\d)/g, '$1'))) return 'yes';
  // Some gateways answer HTTP 200 with the failure in the body. That is the
  // provider talking, not the model: unknown, to be retried later.
  if (PROVIDER_NOTICE_RE.test(text)) return 'unknown';
  // A different number IS an answer, however short: a blind model told to
  // "answer with the number only" replies "42" (deepseek-v4-pro, measured
  // 2026-10-01). By length alone that was "unknown", so a blind model was never
  // marked text-only.
  const digits = (text.match(/\d/g) ?? []).length;
  return digits >= 2 || text.replace(/[^\p{L}\p{N}]/gu, '').length >= 6 ? 'no' : 'unknown';
}

/** An error is a "no" only when it is a recognised image refusal. */
export function judgeProbeError(err: unknown): 'no' | 'unknown' {
  const message = (err as { message?: unknown } | null | undefined)?.message ?? err ?? '';
  return isImageRefusalMessage(String(message)) ? 'no' : 'unknown';
}
