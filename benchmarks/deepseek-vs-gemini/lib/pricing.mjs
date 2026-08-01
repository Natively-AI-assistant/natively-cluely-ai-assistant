// Per-token pricing verified against api-docs.deepseek.com and
// ai.google.dev/gemini-api/docs/pricing on 2026-08-01. Re-verify before a
// future rerun if pricing has changed.

export const PRICING = {
  'deepseek-v4-flash': { inputPerM: 0.14, outputPerM: 0.28, cacheHitInputPerM: 0.028 },
  'gemini-3.6-flash': { inputPerM: 1.50, outputPerM: 7.50 },
  'gemini-3.1-flash-lite': { inputPerM: 0.25, outputPerM: 1.50 },
};

export function costFor(modelId, inputTokens, outputTokens, { cacheHit = false } = {}) {
  const p = PRICING[modelId];
  if (!p) throw new Error(`No pricing entry for model "${modelId}"`);
  const inputRate = cacheHit && p.cacheHitInputPerM ? p.cacheHitInputPerM : p.inputPerM;
  const inputCost = (inputTokens / 1_000_000) * inputRate;
  const outputCost = (outputTokens / 1_000_000) * p.outputPerM;
  return inputCost + outputCost;
}

export function estimateRunCost(modelIds, promptCount, avgInputTokens, avgOutputTokens) {
  let total = 0;
  for (const modelId of modelIds) {
    total += promptCount * costFor(modelId, avgInputTokens, avgOutputTokens);
  }
  return total;
}
