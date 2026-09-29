// electron/llm/performance/fixtures.ts
//
// Deterministic inputs for the capability probe and the calibration suite.
//
// WHY THESE ARE SMALL AND BORING. Phase 26 asks for lightweight deterministic
// fixtures and explicitly rules out "enormous 100K files solely for onboarding
// calibration". Phase 6 asks for prompts that are "deterministic, small output,
// representative, safe, not dependent on model creativity, designed to measure
// latency rather than quality". Every choice below follows from those two
// sentences:
//
//   • the filler is GENERATED, not stored — a 32K-token fixture checked into the
//     repo is ~128KB of dead weight in every bundle, and the bytes are
//     meaningless anyway since nothing reads them back;
//   • the filler is deterministic (a fixed sentence repeated with an index), so
//     two runs measure the same request and a provider's prompt cache behaves
//     the same way on both;
//   • every prompt asks for a ONE WORD answer. A long output would blur TTFT
//     into generation time, which is the one distinction calibration exists to
//     make.

import { estimateTokens } from '../modelCapabilities';

/**
 * The calibration ladder, in tokens.
 *
 * 4K / 12K / 32K exactly as Phase 5 names them. These are INPUT sizes; the
 * output stays one word at every rung, so the three points differ only in
 * prefill — which is precisely what the context-scaling fit needs in order to
 * separate `interceptMs` from `slopeMsPerKToken`.
 */
export const CALIBRATION_LADDER_TOKENS = [4_000, 12_000, 32_000] as const;

/**
 * Deterministic filler of approximately `tokens` tokens.
 *
 * Prose rather than random characters: a tokenizer splits `x'.repeat(n)` very
 * differently from English, so random filler would measure a prefill the user's
 * real prompts never pay. The sentence is neutral and contains nothing that
 * could be mistaken for an instruction — a filler paragraph that reads like a
 * request is a prompt-injection surface in a string we send to every provider.
 */
export function deterministicFiller(tokens: number): string {
  const unit = 'The quarterly report notes steady throughput across the primary and secondary regions. ';
  const perUnit = Math.max(1, estimateTokens(unit));
  const repeats = Math.max(1, Math.ceil(tokens / perUnit));
  const parts: string[] = [];
  for (let i = 0; i < repeats; i++) parts.push(`${i}. ${unit}`);
  return parts.join('');
}

/**
 * A calibration prompt of roughly `tokens` input tokens whose answer is one word.
 *
 * The question is answerable from the filler itself and has exactly one correct
 * response, so a wrong answer means the request was mangled rather than that the
 * model was uncreative. We do not grade it — calibration measures latency, not
 * quality — but a deterministic question makes a malformed request visible in
 * the logs instead of silently producing a plausible essay.
 */
export function calibrationPrompt(tokens: number): string {
  const overheadTokens = 60;
  return [
    '<reference>',
    deterministicFiller(Math.max(1, tokens - overheadTokens)),
    '</reference>',
    '',
    'Reply with exactly one word: OK',
  ].join('\n');
}

/**
 * An 8x8 opaque red PNG, base64.
 *
 * The smallest thing that is unambiguously an image to every provider we drive.
 * A 1x1 is smaller but several vision endpoints reject or silently ignore it,
 * which would make an UNSUPPORTED verdict a property of our fixture rather than
 * of the model — the exact inference Phase 0 rule 16 forbids.
 *
 * Contains no user data by construction: it is eight rows of one colour.
 */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHElEQVQoz2P8z8Dwn4GKgIlqJo0aOGrgqIHDx0AAeI0D/Q1sZBEAAAAASUVORK5CYII=';

export const TINY_PNG_DATA_URI = `data:image/png;base64,${TINY_PNG_BASE64}`;

/**
 * Materialise the probe image as a real FILE and return its path.
 *
 * REQUIRED, and the reason is a defect this feature shipped with until it was
 * run against a live provider. `imagePaths` throughout LLMHelper are filesystem
 * paths — every adapter does `fs.existsSync(p)` and silently SKIPS anything that
 * is not a readable file. Passing TINY_PNG_DATA_URI therefore sent no image at
 * all: the probe degraded into a plain text request, and a model that answered
 * it was recorded as vision-SUPPORTED having never been shown a picture.
 *
 * A wrong capability verdict is the worst possible output of a capability probe
 * because it is durable — it persists, and the answer path reads it. So the
 * probe now writes a real file, and {@link visionProbeImagePath} returns null
 * rather than a data URI if it cannot, so the caller can decline to probe
 * instead of probing nothing.
 */
export function visionProbeImagePath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require('node:os');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('node:path');
    const dir = path.join(os.tmpdir(), 'natively-capability-probe');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'probe-8x8.png');
    // Content-addressed by construction (the fixture is a constant), so a
    // rewrite is only needed when the file is missing or truncated.
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
      fs.writeFileSync(file, Buffer.from(TINY_PNG_BASE64, 'base64'));
    }
    return file;
  } catch {
    return null;
  }
}

/**
 * The vision probe's question.
 *
 * Deliberately does NOT ask what colour the image is. A model that cannot see
 * the image will still guess a colour, and a guess is indistinguishable from an
 * answer — so a colour question cannot tell "saw it" from "hallucinated it".
 * Asking it to acknowledge the attachment tests the only thing a capability
 * probe can actually establish: that the request carrying an image was accepted
 * and answered rather than rejected.
 */
export const VISION_PROBE_PROMPT = 'An image is attached. Reply with exactly one word: SEEN';

/** The text probe — the cheapest possible round trip. */
export const TEXT_PROBE_PROMPT = 'Reply with exactly one word: OK';
