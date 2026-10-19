import OpenAI from 'openai';
import type { LLMProvider, LLMProviderRequest } from './types';
import { OPENAI_COMPAT_PREFIX, parseCompatModelId } from './compatModelId.mjs';

/** One user-configured OpenAI-compatible endpoint (stored in CredentialsManager). */
export interface OpenAICompatConfig {
  /** Stable instance id (`/^[a-z0-9-]{1,40}$/`); part of every routed model id. */
  id: string;
  /** Display name in the model picker and settings. */
  name: string;
  /** e.g. `https://openrouter.ai/api/v1` or `http://localhost:11434/v1`. */
  baseURL: string;
  /** Optional — local servers (Ollama, LM Studio) accept anything. */
  apiKey?: string;
  /** Wire model names the user listed for this endpoint. */
  models: string[];
}

/**
 * Any service speaking the OpenAI chat-completions API: OpenRouter, Ollama,
 * LM Studio, LiteLLM-style proxies, Gemini's OpenAI endpoint, work gateways.
 * Configured in Settings › AI Providers — no code per service.
 *
 * ponytail: text-only; screenshots go through Natively's existing vision
 * chain. Add image parts (LLMHelper.buildOpenAiImageParts) when a compat
 * model must see images.
 */
export class OpenAICompatProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  private readonly cfg: OpenAICompatConfig;
  private readonly client: Pick<OpenAI, 'chat'>;

  constructor(cfg: OpenAICompatConfig, client?: Pick<OpenAI, 'chat'>) {
    this.cfg = cfg;
    this.id = OPENAI_COMPAT_PREFIX + cfg.id;
    this.name = cfg.name;
    // Same "dummy" convention as the LiteLLM client (LLMHelper.setLitellmConfig):
    // keyless local servers still get an Authorization header the SDK requires.
    this.client = client
      ?? new OpenAI({ apiKey: cfg.apiKey || 'dummy', baseURL: cfg.baseURL.replace(/\/+$/, '') });
  }

  ownsModel(modelId: string): boolean {
    return parseCompatModelId(modelId)?.instanceId === this.cfg.id;
  }

  /** `compat:<id>/<model>` → the wire model name (everything after the first slash). */
  private wireModel(modelId: string): string {
    return parseCompatModelId(modelId)?.model ?? modelId;
  }

  private buildMessages(req: LLMProviderRequest): Array<{ role: 'system' | 'user'; content: string }> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (req.systemPrompt) messages.push({ role: 'system', content: req.systemPrompt });
    messages.push({ role: 'user', content: req.userMessage });
    return messages;
  }

  async *stream(req: LLMProviderRequest): AsyncGenerator<string, void, unknown> {
    const stream = await this.client.chat.completions.create(
      { model: this.wireModel(req.modelId), messages: this.buildMessages(req), stream: true as const },
      { signal: req.signal },
    );
    // Same abort shape as streamWithLiteLLM: stop yielding the moment the
    // signal fires and tell the SDK to tear the request down.
    const abortable = stream as { abort?: () => void };
    try {
      for await (const chunk of stream) {
        if (req.signal?.aborted) return;
        const content = chunk.choices[0]?.delta?.content;
        if (content) yield content;
      }
    } finally {
      if (req.signal?.aborted && typeof abortable.abort === 'function') abortable.abort();
    }
  }

  async generate(req: LLMProviderRequest): Promise<string> {
    const res = await this.client.chat.completions.create(
      { model: this.wireModel(req.modelId), messages: this.buildMessages(req) },
      { signal: req.signal },
    );
    return res.choices[0]?.message?.content ?? '';
  }
}
