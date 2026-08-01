import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const MAX_OUTPUT_TOKENS = 2048;
// DeepSeek V4 Flash is a reasoning model: internal reasoning tokens
// (message.reasoning_content) are counted against max_tokens alongside the
// final answer (message.content). At MAX_OUTPUT_TOKENS=2048 the reasoning
// phase alone can exhaust the entire budget (finish_reason: 'length',
// content: '', reasoning_tokens: 2048), leaving zero tokens for the answer.
// Matches the validated production cap in electron/LLMHelper.ts
// (DEEPSEEK_MAX_OUTPUT_TOKENS = 8192). Gemini is unaffected and keeps
// MAX_OUTPUT_TOKENS.
const DEEPSEEK_MAX_OUTPUT_TOKENS = 8192;
const INTERACTIVE_SEED = 7;

export function createDeepseekClient(apiKey) {
  return new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL });
}

export function createGeminiClient(apiKey) {
  return new GoogleGenAI({ apiKey });
}

export async function callDeepseek(client, { model = 'deepseek-v4-flash', systemPrompt, userPrompt }) {
  const start = Date.now();
  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userPrompt },
      ],
      max_tokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
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

export async function callGemini(client, { model, systemPrompt, userPrompt }) {
  const start = Date.now();
  try {
    const response = await client.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
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
