/**
 * Is this model id one the app believes is a small, fast tier?
 *
 * ADVISORY ONLY — it drives an inline hint and never blocks a choice, so a stale
 * entry costs a missing or spurious hint and nothing more. That is exactly why
 * this is a hint and not a filter: a hand-maintained allow-list used to gate the
 * dropdown would hide good new models every time a provider ships one, and would
 * go stale on every retirement.
 *
 * Unset ('' / null / 'auto') never warns — "Auto" means the measured
 * per-provider ladder, which is the right default, not a slow pick.
 */
const FAST_PATTERNS = [
  /(^|\/)gemini-[\d.]+-flash(-lite)?$/,
  /(^|\/)gpt-5\.\d+-(mini|nano)$/,
  /(^|\/)gpt-5\.5$/,
  /(^|\/)deepseek-[\w.]+-flash$/,
  /(^|\/)(llama|mixtral|gemma|qwen)[\w./-]*$/,
];

export function isKnownFastModel(modelId) {
  if (!modelId || modelId === 'auto') return true;   // unset never warns
  const id = String(modelId).toLowerCase();
  return FAST_PATTERNS.some((re) => re.test(id));
}
