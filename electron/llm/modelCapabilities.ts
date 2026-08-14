// electron/llm/modelCapabilities.ts
// Routes prompt tier (full vs tiny) and context budgets based on the active model.
// Cloud + large local models -> 'full' prompts. Small local models -> 'tiny' prompts.

import type { TranscriptTurn } from './transcriptCleaner';

export type ModelTier = 'cloud' | 'local-large' | 'local-small';
export type PromptTier = 'full' | 'tiny';

export interface ModelCapabilities {
  tier: ModelTier;
  maxContextTokens: number;
  promptBudgetTokens: number;
  outputBudgetTokens: number;
  supportsXmlTags: boolean;
  supportsImages: boolean;
  name: string;
}

const TIER_BUDGETS: Record<ModelTier, { max: number; system: number; output: number }> = {
  'cloud':       { max: 128_000, system: 4000, output: 4000 },
  'local-large': { max: 32_000,  system: 1500, output: 4000 },
  'local-small': { max: 8_000,   system: 800,  output: 2000 },
};

// Native (model-card) context windows for known Ollama families.
// Order matters — first match wins. Longer-version patterns precede generic ones.
const KNOWN_OLLAMA_NATIVE_CTX: Array<[RegExp, number]> = [
  [/^qwen3/i, 32_000],
  [/^qwen2\.5/i, 32_000],
  [/^llama3\.1/i, 128_000],
  [/^llama3\.2/i, 128_000],
  [/^llama3(?![.\d])/i, 8_000],
  [/^phi3/i, 128_000],
  [/^gemma2/i, 8_000],
  [/^mistral/i, 32_000],
  [/^codellama/i, 16_000],
  [/^deepseek-coder/i, 16_000],
];

// Models ids we treat as cloud regardless of provider hint.
function isCloudIdentifier(id: string): boolean {
  const s = id.toLowerCase();
  if (s === 'natively' || s.startsWith('natively-')) return true;
  if (s.startsWith('gemini-') || s.startsWith('models/gemini')) return true;
  if (s.startsWith('gpt-') || s.startsWith('o1-') || s.startsWith('o3-') || s.startsWith('o4-') || s.startsWith('chatgpt-')) return true;
  if (s.startsWith('claude-')) return true;
  // DeepSeek cloud API (OpenAI-compatible). The local Ollama "deepseek-coder"
  // family is handled by the isOllama branch above.
  if (/^deepseek-v\d/.test(s)) return true;
  return false;
}

// Large Groq-hosted models we trust like cloud.
function isLargeGroqModel(id: string): boolean {
  const s = id.toLowerCase();
  if (s.includes('llama-3.3-70b') || s.includes('llama-3.1-70b') || s.includes('llama3-70b')) return true;
  if (s.includes('mixtral-8x7b') || s.includes('mixtral-8x22b')) return true;
  if (s.includes('qwen') && /\b(32b|72b|110b)\b/.test(s)) return true;
  return false;
}

// Parse parameter size from an Ollama model id like "llama3.1:8b" or "qwen2.5-coder:14b".
// Returns the size in billions of parameters, or null if not detected.
export function parseOllamaSize(id: string): number | null {
  const s = id.toLowerCase();
  const m = s.match(/[:\-]([0-9]+(?:\.[0-9]+)?)\s*b\b/);
  if (m) {
    const n = parseFloat(m[1]);
    if (!isNaN(n)) return n;
  }
  // Bare size hints (mini/nano/tiny) are unreliable signals — return null and let
  // family table + tier defaults decide. Caller treats null as "unknown -> small".
  return null;
}

// Vision-capable Ollama families.
function ollamaSupportsImages(id: string): boolean {
  const s = id.toLowerCase();
  return /llava|bakllava|moondream|llama3\.2-vision|llama-3\.2-vision|gemma3|minicpm-v|qwen2\.5-vl|qwen2-vl|pixtral/.test(s);
}

export function getModelCapabilities(modelId: string, isOllama: boolean): ModelCapabilities {
  const id = modelId || '';
  const lower = id.toLowerCase();

  if (isOllama) {
    const size = parseOllamaSize(id);
    // Default to small when size is unknown (safer for memory/context).
    // Threshold lowered from 13B → 7B: modern 7-9B code models (qwen2.5-coder:7b,
    // qwen3:8b, llama3.1:8b, deepseek-coder-v2:16b-lite) handle the full system
    // prompt and produce multi-section coding answers comfortably. The old 13B
    // threshold silently capped them at 180 output tokens (num_predict in
    // streamWithOllama), truncating answers mid-function and producing the canned
    // "Let me come back to that" fallback on follow-up turns.
    const tier: ModelTier = (size != null && size >= 7) ? 'local-large' : 'local-small';
    const b = TIER_BUDGETS[tier];
    // Family-specific native context window override.
    let maxCtx = b.max;
    for (const [pat, ctx] of KNOWN_OLLAMA_NATIVE_CTX) {
      if (pat.test(id)) { maxCtx = ctx; break; }
    }
    return {
      tier,
      maxContextTokens: maxCtx,
      promptBudgetTokens: b.system,
      outputBudgetTokens: b.output,
      supportsXmlTags: tier === 'local-large',
      supportsImages: ollamaSupportsImages(id),
      name: id || 'ollama',
    };
  }

  if (isCloudIdentifier(id)) {
    const b = TIER_BUDGETS['cloud'];
    const supportsImages = lower.startsWith('gemini-') || lower.startsWith('claude-')
      || lower.startsWith('gpt-4o') || lower.startsWith('gpt-4.1') || lower.startsWith('gpt-5')
      || lower === 'natively' || lower.startsWith('natively-');
    return {
      tier: 'cloud',
      maxContextTokens: b.max,
      promptBudgetTokens: b.system,
      outputBudgetTokens: b.output,
      supportsXmlTags: true,
      supportsImages,
      name: id || 'cloud',
    };
  }

  // Groq-hosted: split by size.
  if (isLargeGroqModel(id)) {
    const b = TIER_BUDGETS['cloud'];
    return {
      tier: 'cloud',
      maxContextTokens: b.max,
      promptBudgetTokens: b.system,
      outputBudgetTokens: b.output,
      supportsXmlTags: true,
      supportsImages: false,
      name: id,
    };
  }

  // Small Groq models (llama-3.1-8b-instant, gemma-7b, etc.)
  if (/\b(0\.5|1|2|3|4|7|8)b\b|\binstant\b/i.test(lower)) {
    const b = TIER_BUDGETS['local-small'];
    return {
      tier: 'local-small',
      maxContextTokens: b.max,
      promptBudgetTokens: b.system,
      outputBudgetTokens: b.output,
      supportsXmlTags: false,
      supportsImages: false,
      name: id,
    };
  }

  // Unknown -> conservative cloud assumption (custom providers are usually large hosted).
  const b = TIER_BUDGETS['cloud'];
  return {
    tier: 'cloud',
    maxContextTokens: b.max,
    promptBudgetTokens: b.system,
    outputBudgetTokens: b.output,
    supportsXmlTags: true,
    supportsImages: false,
    name: id || 'unknown',
  };
}

export function selectPromptTier(modelId: string, isOllama: boolean): PromptTier {
  return getModelCapabilities(modelId, isOllama).tier === 'local-small' ? 'tiny' : 'full';
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Per-model max output (completion) token ceiling for the OpenAI Chat Completions
// API. OpenAI rejects max_completion_tokens above a model's documented limit with
// a 400 "max_tokens is too large" error (see issue #298: gpt-4o caps output at
// 16384, so the global 65536 default failed on the very first request).
//
// Documented output caps (OpenAI docs, 2026-06):
//   gpt-5 / 5.1 / 5.2 / 5.4 / 5.5 (+ -mini/-nano) → 128000
//   o1 / o3 / o4 (+ -mini/-pro)                   → 100000
//   gpt-4.1 (+ -mini)                             → 32768
//   gpt-4o (+ -mini)                              → 16384
//   gpt-4-turbo / gpt-4-vision / gpt-3.5-turbo    → 4096
//   bare gpt-4 / 32k variants                     → 8192
//   unknown OpenAI-compatible id                  → 16384 (conservative)
// Every model gets an explicit cap so a future bump to the requested default
// can't silently reintroduce the 400 on gpt-5.x / o-series.
export function getOpenAiMaxOutput(modelId: string, requested: number): number {
  const id = (modelId || '').toLowerCase();
  let cap: number;
  if (/\bgpt-5/.test(id)) cap = 128000; // gpt-5.x family
  else if (/\bo[1-9]\b/.test(id) || /\bo[1-9]-/.test(id)) cap = 100000; // o1/o3/o4 reasoners
  else if (id.startsWith('gpt-4.1')) cap = 32768;
  else if (id.startsWith('gpt-4o')) cap = 16384;
  else if (id.startsWith('gpt-4-turbo') || id.startsWith('gpt-4-1106') || id.startsWith('gpt-4-0125') || id.startsWith('gpt-4-vision')) cap = 4096;
  else if (id.startsWith('gpt-3.5')) cap = 4096;
  else if (id.startsWith('gpt-4')) cap = 8192; // bare gpt-4 / 32k variants cap at 8192
  else cap = 16384; // unknown OpenAI-compatible id — conservative but usable default
  return Math.min(requested, cap);
}

export type OpenAiReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

// Lowest-latency *valid* reasoning_effort for an OpenAI reasoning model, or null
// for non-reasoning models (gpt-4*, gpt-3.5) that reject the param entirely.
//
// The supported set differs per family and OpenAI dropped `minimal` after the
// original gpt-5 line (see issue: gpt-5.4/5.5 reject `minimal` with a 400). We
// pick a low-latency level the model actually accepts so TTFT stays low:
//   - original gpt-5 / -mini / -nano      → minimal   (none not supported)
//   - gpt-5.1 / 5.2 / 5.4 / 5.5 (chat)    → low       (minimal removed; low keeps light reasoning)
//   - gpt-5-codex / gpt-5.x-codex         → low       (neither none nor minimal supported)
//   - gpt-5-pro                           → high      (only high is accepted)
//   - o1 / o3 / o4 (and -mini/-pro)       → low       (only low/medium/high)
// Anything else (gpt-4*, custom proxies)  → null      (omit the param).
export function getOpenAiReasoningEffort(modelId: string): OpenAiReasoningEffort | null {
  const id = (modelId || '').toLowerCase();

  // o-series reasoners: low/medium/high only.
  if (/\bo[1-9]\b/.test(id) || /\bo[1-9]-/.test(id)) return 'low';

  if (/\bgpt-5/.test(id)) {
    if (id.includes('gpt-5-pro') || id.includes('gpt-5.1-pro') || id.includes('gpt-5.2-pro')) return 'high'; // pro: high only
    if (id.includes('codex')) return 'low'; // codex variants: no none/minimal
    // Original gpt-5 / gpt-5-mini / gpt-5-nano (NOT 5.1+) keep `minimal`.
    if (/\bgpt-5(-mini|-nano)?(\b|-20)/.test(id) && !/\bgpt-5\.\d/.test(id)) return 'minimal';
    // gpt-5.1 / 5.2 / 5.4 / 5.5 and chat-latest: `minimal` removed; use `low`.
    return 'low';
  }

  // gpt-4*, gpt-3.5, unknown — not a reasoning model; omit the param.
  return null;
}

// Drop oldest turns until the joined transcript fits the token budget. Most recent turns are preserved.
export function truncateTranscriptToFit(
  transcript: TranscriptTurn[],
  budgetTokens: number
): TranscriptTurn[] {
  if (!transcript?.length || budgetTokens <= 0) return transcript ?? [];
  const total = (turns: TranscriptTurn[]) => turns.reduce((s, t) => s + estimateTokens(t.text) + 6, 0);
  if (total(transcript) <= budgetTokens) return transcript;
  const kept = [...transcript];
  while (kept.length > 1 && total(kept) > budgetTokens) {
    kept.shift();
  }
  return kept;
}
