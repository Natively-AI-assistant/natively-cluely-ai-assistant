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
// wrongly calling it "no" blocks a capable model for a month. The last
// alternative is a bare HTTP status ("429", "503") sent as the whole reply.
const PROVIDER_NOTICE_RE = /quota|credit|billing|rate.?limit|too many requests|try again later|temporarily unavailable|overloaded|blocked|content.?filter|unauthori[sz]ed|api.?key|exhausted|无可用渠道|令牌|^\s*[45]\d\d\s*$/i;

// A failure described in words: the transport or the provider talking, not the
// model answering (2026-10-01 review). Checked BEFORE the "different number"
// rule, or "Error 502: Bad Gateway" reads as the wrong answer 502.
const ERROR_TEXT_RE = /\b(?:error|exception|bad gateway|gateway time-?out|service unavailable|unavailable|internal server|timed? ?out|timeout|upstream|no available channel|failed|failure|forbidden|denied)\b/i;

// The model saying it cannot see the picture: the only reply WITHOUT a number
// that is evidence of "no".
const BLIND_RE = new RegExp([
  '\\bno (?:image|picture|photo|attachment)\\b',
  '\\b(?:can(?:\'|no)?t|cannot|unable to|not able to|don\'?t|do not|couldn\'?t|could not)\\b[^.]{0,60}\\b(?:see|view|read|process|analy[sz]e|access|open|display|interpret)\\b[^.]{0,40}\\b(?:image|picture|photo|attachment|visual)',
  '\\b(?:ability|able) to (?:see|view|process|analy[sz]e|read) (?:image|picture|photo)',
  '\\btext[- ](?:only|based)\\b',
  '\\b(?:image|picture|photo|attachment)s?\\b[^.]{0,40}\\b(?:wasn\'?t|isn\'?t|not|never) (?:provided|attached|visible|included|shared|available|shown|uploaded|received)',
  // "I do not have vision capabilities", "without image input support"
  '\\b(?:no|without|lack(?:s|ing)?|don\'?t have|do not have|doesn\'?t have|does not have)\\b[^.]{0,30}\\b(?:vision|image|visual)s?\\b[^.]{0,20}\\b(?:capabilit|support|input|abilit|access)',
].join('|'), 'i');

/** How long a saved test result counts as an answer. After it the model is
 *  "not known" again until a new test settles it — so an old "no" cannot stay
 *  in force just because its re-test keeps coming back inconclusive. */
export const VISION_TEST_FRESH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Judge the model's reply to "what number is shown?".
 *
 *   yes      the number stands alone in the reply (separators between digits
 *            are ignored: "7 3 9 2", "7,392"; "173920" does not contain 7392).
 *   no       POSITIVE evidence only: the reply says it cannot see an image, or
 *            it answers with a DIFFERENT number (a blind model told to "answer
 *            with the number only" replies "42" — deepseek-v4-pro, measured).
 *   unknown  everything else: empty, a provider notice or an error sentence
 *            sent as text, a refusal to answer, a description without digits.
 *
 * A "no" stops a model receiving screenshots for 30 days, so prose that merely
 * lacks the number is not one. It used to be: any reply of six letters was
 * "a real answer without the number", and a gateway that answers HTTP 200 with
 * "Internal Server Error" does so on the confirmation attempt too.
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
  // Models write "can’t" with a typographic apostrophe (deepseek-v4-pro,
  // measured 2026-10-01); the rules are written with the plain one.
  const plain = text.replace(/[\u2018\u2019\u02BC]/g, "'");
  if (isImageRefusalMessage(plain) || BLIND_RE.test(plain)) return 'no';
  if (ERROR_TEXT_RE.test(text)) return 'unknown';
  // A different number IS an answer, however short.
  return (text.match(/\d/g) ?? []).length >= 2 ? 'no' : 'unknown';
}

/** An error is a "no" only when it is a recognised image refusal — and not when
 *  it is about the ACCOUNT (auth, plan, billing): that says nothing about the model. */
export function judgeProbeError(err: unknown): 'no' | 'unknown' {
  const message = String((err as { message?: unknown } | null | undefined)?.message ?? err ?? '');
  if (/\b40[123]\b|unauthori[sz]ed|forbidden|api.?key|billing|quota|credit|\bplan\b|subscription|free tier/i.test(message)) return 'unknown';
  return isImageRefusalMessage(message) ? 'no' : 'unknown';
}
