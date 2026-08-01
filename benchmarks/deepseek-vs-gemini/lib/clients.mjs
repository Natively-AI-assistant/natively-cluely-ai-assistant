import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
// Default output-token budgets used by run-raw-comparison.mjs (unaffected by
// this change — it never passes maxOutputTokens). Both DeepSeek V4 Flash and
// Gemini 3.x are reasoning/thinking models: their internal reasoning tokens
// (DeepSeek: message.reasoning_content / usage.completion_tokens_details
// .reasoning_tokens; Gemini: usageMetadata.thoughtsTokenCount) are counted
// against the SAME budget as the visible answer (max_tokens / maxOutputTokens
// respectively). On hard problems the reasoning/thinking phase alone can
// exhaust the entire budget (finish_reason: 'length', empty content/text),
// leaving zero tokens for the answer. Live diagnostics on run-coding-harness.mjs
// confirmed this at both DEEPSEEK_MAX_OUTPUT_TOKENS=8192 (reasoning_tokens
// hit the cap) and Gemini's MAX_OUTPUT_TOKENS=2048 (thoughtsTokenCount ate
// most of the budget). Callers needing more headroom for hard problems pass
// an explicit `maxOutputTokens` override to callDeepseek/callGemini instead
// of raising these shared defaults out from under run-raw-comparison.mjs.
// Both are set to 64k (the max output Gemini 3.x supports; DeepSeek V4 Flash
// allows up to 384k) so the reasoning/thinking phase can never starve the
// visible answer. This is a CEILING, not a spend: billing is on tokens
// actually emitted, and a model that answers in 300 tokens still costs 300.
const MAX_OUTPUT_TOKENS = 65536;
const DEEPSEEK_MAX_OUTPUT_TOKENS = 65536;
const INTERACTIVE_SEED = 7;

export function createDeepseekClient(apiKey) {
  return new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL });
}

export function createGeminiClient(apiKey) {
  return new GoogleGenAI({ apiKey });
}

export async function callDeepseek(client, { model = 'deepseek-v4-flash', systemPrompt, userPrompt, maxOutputTokens }) {
  const start = Date.now();
  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxOutputTokens ?? DEEPSEEK_MAX_OUTPUT_TOKENS,
      seed: INTERACTIVE_SEED,
    });
    return {
      text: completion.choices?.[0]?.message?.content || '',
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - start,
      error: null,
    };
  } catch (err) {
    return { text: '', inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - start, error: String(err?.message || err) };
  }
}

export async function callGemini(client, { model, systemPrompt, userPrompt, maxOutputTokens }) {
  const start = Date.now();
  try {
    const response = await client.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        maxOutputTokens: maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        temperature: 0.4,
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
      },
    });
    const text = response.text ?? response.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    return {
      text,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs: Date.now() - start,
      error: null,
    };
  } catch (err) {
    return { text: '', inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - start, error: String(err?.message || err) };
  }
}
