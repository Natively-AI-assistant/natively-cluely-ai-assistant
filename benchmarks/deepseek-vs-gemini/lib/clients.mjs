import OpenAI from 'openai';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

// PARITY WITH PRODUCTION THINKING SETTINGS.
//
// Natively ships Gemini at its lowest thinking tier: buildThinkingConfig()
// in electron/LLMHelper.ts returns `{ thinkingLevel: MINIMAL }` for the
// flash/flash-lite models. Left unset, the Gemini API applies DEFAULT
// (dynamic) thinking — a measured 1148 thought tokens on one coding prompt —
// which is NOT what production does, and which inflates both latency and
// output-token cost relative to the shipped configuration.
//
// DeepSeek V4 Flash is a reasoning model whose thinking is ENABLED by default.
// Per api-docs.deepseek.com/guides/thinking_mode it is switched off with
// `thinking: {type: 'disabled'}` (passed through the OpenAI SDK's extra_body).
// Note reasoning_effort is NOT a way down: the docs state low/medium both map
// to `high`, so disabling is the only setting equivalent to Gemini MINIMAL.
//
// Both providers are therefore pinned to their floor so the comparison
// measures the models as Natively would actually run them.
const GEMINI_THINKING_LEVEL = ThinkingLevel.MINIMAL;
const DEEPSEEK_THINKING = { type: 'disabled' };

// 64k ceiling. This is a CEILING, not a spend: billing is on tokens actually
// emitted. With thinking off, real output is far below this.
const MAX_OUTPUT_TOKENS = 65536;
const DEEPSEEK_MAX_OUTPUT_TOKENS = 65536;
const INTERACTIVE_SEED = 7;

export function createDeepseekClient(apiKey) {
  return new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL });
}

export function createGeminiClient(apiKey) {
  return new GoogleGenAI({ apiKey });
}

/**
 * CallResult adds streaming performance metrics:
 *   ttftMs       — time to FIRST non-empty content chunk (what a user feels)
 *   latencyMs    — total wall-clock to the final chunk
 *   throughputTps— outputTokens / total seconds. END-TO-END rate; this is the
 *                  cross-provider-comparable throughput number.
 *   genTps       — outputTokens / seconds AFTER first token. NOT comparable
 *                  across providers: it measures the SDK's chunk delivery, not
 *                  the model. Gemini's SDK emits nearly the whole answer in one
 *                  chunk (observed genTps of 2769 and 12500 on 36- and 25-token
 *                  answers — i.e. a ~2-13ms tail), whereas DeepSeek streams
 *                  incrementally. Recorded for completeness; do not rank on it.
 */
function finish({ text, inputTokens, outputTokens, start, ttftMs, error = null }) {
  const latencyMs = Date.now() - start;
  const genMs = ttftMs == null ? null : latencyMs - ttftMs;
  const throughputTps = latencyMs > 0 && outputTokens > 0
    ? +(outputTokens / (latencyMs / 1000)).toFixed(2)
    : null;
  const genTps = genMs && genMs > 0 && outputTokens > 0
    ? +(outputTokens / (genMs / 1000)).toFixed(2)
    : null;
  return { text, inputTokens, outputTokens, ttftMs, latencyMs, throughputTps, genTps, error };
}

export async function callDeepseek(client, { model = 'deepseek-v4-flash', systemPrompt, userPrompt, maxOutputTokens }) {
  const start = Date.now();
  let ttftMs = null;
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const stream = await client.chat.completions.create({
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxOutputTokens ?? DEEPSEEK_MAX_OUTPUT_TOKENS,
      seed: INTERACTIVE_SEED,
      stream: true,
      stream_options: { include_usage: true },
      // OpenAI SDK passthrough for DeepSeek's non-OpenAI thinking toggle.
      thinking: DEEPSEEK_THINKING,
    });
    for await (const chunk of stream) {
      const piece = chunk.choices?.[0]?.delta?.content;
      if (piece) {
        if (ttftMs === null) ttftMs = Date.now() - start;
        text += piece;
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
    }
    return finish({ text, inputTokens, outputTokens, start, ttftMs });
  } catch (err) {
    return finish({ text: '', inputTokens: 0, outputTokens: 0, start, ttftMs, error: String(err?.message || err) });
  }
}

export async function callGemini(client, { model, systemPrompt, userPrompt, maxOutputTokens }) {
  const start = Date.now();
  let ttftMs = null;
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const stream = await client.models.generateContentStream({
      model,
      contents: userPrompt,
      config: {
        maxOutputTokens: maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        temperature: 0.4,
        thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL },
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
      },
    });
    for await (const chunk of stream) {
      const piece = chunk.text;
      if (piece) {
        if (ttftMs === null) ttftMs = Date.now() - start;
        text += piece;
      }
      // Gemini reports usage on the terminal (often textless) chunk.
      if (chunk.usageMetadata) {
        inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
      }
    }
    return finish({ text, inputTokens, outputTokens, start, ttftMs });
  } catch (err) {
    return finish({ text: '', inputTokens: 0, outputTokens: 0, start, ttftMs, error: String(err?.message || err) });
  }
}
