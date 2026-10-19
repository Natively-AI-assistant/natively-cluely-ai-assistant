/**
 * The provider contract new LLM integrations implement. Existing providers
 * (OpenAI, Claude, Gemini, Ollama, OpenRouter, LiteLLM, 9Router) predate this
 * interface and still live as per-provider adapters + switch arms inside
 * LLMHelper.ts; they are deliberately NOT migrated (see DEVELOPMENT.md).
 * A provider registered in ProviderRegistry needs no switch edits: LLMHelper's
 * registry lane routes any model an registered provider owns.
 */

export interface LLMProviderRequest {
  userMessage: string;
  systemPrompt?: string;
  /** The routed model id as configured/picked (e.g. `compat:work/gpt-4o`);
   *  the provider maps it to its own wire model name. */
  modelId: string;
  signal?: AbortSignal;
}

export interface LLMProvider {
  /** Routing id, unique in the registry — e.g. `compat:work-proxy`. */
  readonly id: string;
  /** Human name for UI and logs. */
  readonly name: string;
  /** True when this provider serves `modelId` (exact ownership decision). */
  ownsModel(modelId: string): boolean;
  /** Stream the answer as text deltas. */
  stream(req: LLMProviderRequest): AsyncGenerator<string, void, unknown>;
  /** One-shot answer text. */
  generate(req: LLMProviderRequest): Promise<string>;
}
