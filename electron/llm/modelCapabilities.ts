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
    const tier: ModelTier = (size != null && size >= 13) ? 'local-large' : 'local-small';
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
