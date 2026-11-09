// A fixed seed, except when the same prompt is sent again (2026-11-09).
//
// The interactive text path samples at temperature 0.2 with seed 7 so the same
// question keeps the same structure across turns and fallback rungs (LLMHelper,
// REPORT §22 D1). The cost of a fixed seed: when one exact prompt makes a model
// hang or come back empty, it does so EVERY time. Live on Gemini Flash, a
// Lecture-mode "What grade did you get in chemistry last semester?" timed out
// 8 times out of 8 (engine retries and re-presses alike); removing any one
// line from the prompt made it answer at once.
//
// So: the first send of a prompt keeps the base seed (style unchanged), and
// each REPEAT of the identical prompt within a few minutes (an engine retry, a
// user's "Press again", a regenerate) gets the next seed. Different prompts
// never interfere. Pure in-memory bookkeeping, no platform behaviour.

import { createHash } from 'node:crypto';

export const BASE_INTERACTIVE_SEED = 7;
/** How long a send counts as "recent" for a repeat of the same prompt. */
export const REPEAT_WINDOW_MS = 10 * 60_000;
const MAX_TRACKED = 200;

interface SeenPrompt { count: number; lastAt: number }

const seen = new Map<string, SeenPrompt>();

export function promptFingerprint(...parts: Array<string | undefined | null>): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(String(p ?? ''));
    h.update('\u0000');
  }
  return h.digest('hex').slice(0, 32);
}

/**
 * The seed for one provider request. `parts` are what the model is sent
 * (system prompt, user message, model id); the provider name keeps a Groq and
 * a Gemini attempt of the same prompt counted apart, so one fallback rung's
 * first try is never treated as another's retry.
 */
export function interactiveSeedFor(provider: string, parts: Array<string | undefined | null>, now: number = Date.now()): number {
  const key = promptFingerprint(provider, ...parts);
  const prev = seen.get(key);
  const repeat = prev && now - prev.lastAt <= REPEAT_WINDOW_MS ? prev.count : 0;
  seen.delete(key); // re-insert: Map order doubles as least-recently-used
  seen.set(key, { count: repeat + 1, lastAt: now });
  while (seen.size > MAX_TRACKED) {
    const oldest = seen.keys().next().value;
    if (oldest === undefined) break;
    seen.delete(oldest);
  }
  return BASE_INTERACTIVE_SEED + repeat;
}

/** Tests only. */
export function resetInteractiveSeeds(): void {
  seen.clear();
}
