// src/lib/trial/endedTrialUsage.mjs
//
// The usage figures the end-of-trial card shows ("You used N AI tokens, ...").
//
// The launcher clears its live trial the moment the trial ends and only then
// opens the card, so the card was handed zeros: "You used 0 AI tokens" to a
// user whose answers had just run out (live macOS check, 2026-11-03). The card
// now gets the last figures the launcher saw.
//
// When the AI allowance is what ended the trial, the server refused because the
// whole allowance was used, so the AI figure is at least the allowance even if
// the last poll (every 30 s) saw less.
//
// Nothing seen (an ending found at launch, before any poll): null, and the card
// leaves the sentence out rather than print zeros.

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function usageForEndedCard(seen, reason) {
  const usage = seen && seen.usage;
  if (!usage || typeof usage !== 'object') return null;
  const out = { ...usage };
  const limit = n(seen.limits && seen.limits.ai_tokens);
  if (reason === 'allowance' && limit > 0) out.ai_tokens = Math.max(n(usage.ai_tokens), limit);
  return out;
}
