// intelligence-eval-real-ui/helpers/cost-recorder-ui.ts
// Estimates per-response cost. The Natively /v1/chat SSE does not return token
// usage in deltas, so costSource is usually "estimated" (char/4 heuristic) unless
// a usage field appears. Pricing is a configurable table; model comes from the
// stream's `model` field when observed.

export interface CostRecord {
  inputTokens: number; outputTokens: number; totalTokens: number;
  estimatedCostUsd: number; actualCostUsd: number;
  costSource: 'provider_metadata' | 'api_usage' | 'estimated' | 'unavailable';
  model: string;
}

// USD per 1K tokens (input/output). Generic table; gemini-3.5-flash-ish defaults.
// Adjust as Natively publishes real pricing.
const PRICING: Record<string, { in: number; out: number }> = {
  'gemini-3.5-flash': { in: 0.00015, out: 0.0006 },
  default: { in: 0.0002, out: 0.0008 },
};

const estTokens = (s: string) => Math.ceil((s || '').length / 4);

export function recordCost(promptText: string, answerText: string, model: string, usage?: { input?: number; output?: number }): CostRecord {
  const inputTokens = usage?.input ?? estTokens(promptText);
  const outputTokens = usage?.output ?? estTokens(answerText);
  const p = PRICING[model] || PRICING.default;
  const est = (inputTokens / 1000) * p.in + (outputTokens / 1000) * p.out;
  return {
    inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: Math.round(est * 1e6) / 1e6,
    actualCostUsd: usage ? Math.round(est * 1e6) / 1e6 : 0,
    costSource: usage ? 'api_usage' : 'estimated',
    model: model || 'unknown',
  };
}
