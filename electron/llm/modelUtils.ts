/**
 * Model detection and JSON cleanup utilities extracted from LLMHelper.
 * Pure functions — no dependencies on LLM clients, API keys, or Electron.
 */

import { CustomProvider, CurlProvider } from '../services/CredentialsManager';

// Model constants (mirrored from LLMHelper.ts for pure function independence)
const GEMINI_FLASH_MODEL = "gemini-3.1-flash-lite-preview";
const GEMINI_PRO_MODEL = "gemini-3.1-pro-preview";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const OPENAI_MODEL = "gpt-5.4";
const CLAUDE_MODEL = "claude-sonnet-4-6";

export type Provider = CustomProvider | CurlProvider;

/**
 * Returns true if the model ID indicates a Gemini model.
 */
export function isGeminiModel(modelId: string): boolean {
  return modelId.startsWith("gemini-") || modelId.startsWith("models/");
}

/**
 * Returns true if the model ID indicates an OpenAI model.
 */
export function isOpenAiModel(modelId: string): boolean {
  return modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("o3-") || modelId.includes("openai");
}

/**
 * Returns true if the model ID indicates a Claude model.
 */
export function isClaudeModel(modelId: string): boolean {
  return modelId.startsWith("claude-");
}

/**
 * Returns true if the model ID indicates a Groq-hosted model.
 */
export function isGroqModel(modelId: string): boolean {
  return modelId.startsWith("llama-") || modelId.startsWith("mixtral-") || modelId.startsWith("gemma-");
}

/**
 * Strips markdown code fences and trims whitespace from LLM JSON responses.
 */
export function cleanJsonResponse(text: string): string {
  // Remove markdown code block syntax if present
  text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
  // Remove any leading/trailing whitespace
  text = text.trim();
  return text;
}

/**
 * Selects a matching provider from a list by model ID.
 * Returns null if no custom/curl provider matches.
 */
export function selectProviderForModel(modelId: string, providers: Provider[]): Provider | null {
  return providers.find(p => p.id === modelId) || null;
}

/**
 * Maps UI short codes to internal model IDs.
 */
export function resolveModelId(modelId: string): string {
  if (modelId === 'gemini') return GEMINI_FLASH_MODEL;
  if (modelId === 'gemini-pro') return GEMINI_PRO_MODEL;
  if (modelId === 'claude') return CLAUDE_MODEL;
  if (modelId === 'llama') return GROQ_MODEL;
  return modelId;
}

export { GEMINI_FLASH_MODEL, GEMINI_PRO_MODEL, GROQ_MODEL, OPENAI_MODEL, CLAUDE_MODEL };
