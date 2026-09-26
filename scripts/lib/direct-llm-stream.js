// scripts/lib/direct-llm-stream.js
//
// Minimal direct-LLM streamer for the profile/JD benchmark harness.
// Bypasses LLMHelper's Natively-only production routing so the harness can
// run against the Gemini API directly (`GEMINI_API_KEY` + `generativelanguage
// .googleapis.com`) or any other OpenAI-compatible endpoint that supports
// `POST /v1/chat/completions` (e.g. MiniMax international `api.minimax.io`).
//
// The production code path (LLMHelper.streamChat → setNativelyKey →
// NATIVELY_API_URL/v1/chat) is unchanged. This module exists ONLY so the
// benchmark harness can produce real answers in environments where the
// Natively proxy is unreachable (sandboxed networks) but a raw vendor key
// IS available. It deliberately does NOT do any retrieval / mode wiring —
// the harness builds the question, this module just streams the answer.
//
// Detection: env-driven, in priority order:
//   1. E2E_MINIMAX_API_KEY  → POST https://api.minimax.io/v1/chat/completions
//                                Authorization: Bearer <key>
//                                model = E2E_MINIMAX_MODEL (default MiniMax-M3)
//   2. E2E_GEMINI_API_KEY   → POST https://generativelanguage.googleapis.com
//                                /v1beta/models/<model>:streamGenerateContent
//                                x-goog-api-key: <key>
//                                model = E2E_GEMINI_MODEL (default gemini-3.1-flash-lite)
//   3. NATIVELY_API_KEY      → falls back to the production LLMHelper path
//                                (the original behavior of the harness)
//
// Streaming: returns an AsyncGenerator<string> so the harness's `for await`
// loop can collect tokens exactly as it does with LLMHelper.streamChat.

'use strict';

const axios = require('axios');

function readProvider() {
    if (process.env.E2E_MINIMAX_API_KEY) {
        const baseURL = process.env.E2E_MINIMAX_BASE_URL || 'https://api.minimax.io/v1';
        return {
            kind: 'minimax',
            apiKey: process.env.E2E_MINIMAX_API_KEY,
            baseURL,
            model: process.env.E2E_MINIMAX_MODEL || 'MiniMax-M3',
            // MiniMax OpenAI-compatible streaming chat completion endpoint
            url: `${baseURL.replace(/\/+$/, '')}/chat/completions`,
            authHeader: 'Authorization',
            authScheme: 'Bearer',
        };
    }
    if (process.env.E2E_GEMINI_API_KEY) {
        const baseURL = 'https://generativelanguage.googleapis.com/v1beta';
        const model = process.env.E2E_GEMINI_MODEL || 'gemini-3.1-flash-lite';
        return {
            kind: 'gemini',
            apiKey: process.env.E2E_GEMINI_API_KEY,
            baseURL,
            model,
            url: `${baseURL}/models/${model}:streamGenerateContent?alt=sse`,
            authHeader: 'x-goog-api-key',
            authScheme: '', // header value is just the key, no scheme prefix
        };
    }
    return null; // harness will fall back to NATIVELY_API_KEY via LLMHelper
}

async function* streamMiniMax(provider, prompt) {
    const headers = {
        [provider.authHeader]: `${provider.authScheme} ${provider.apiKey}`,
        'Content-Type': 'application/json',
    };
    const body = {
        model: provider.model,
        messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: prompt },
        ],
        stream: true,
        max_tokens: 1024,
        temperature: 0.2,
    };
    const res = await axios.post(provider.url, body, { headers, responseType: 'stream', timeout: 30000 });
    let buffer = '';
    for await (const chunk of res.data) {
        buffer += chunk.toString('utf8');
        // SSE: lines separated by \n\n; data: prefix per line. MiniMax
        // follows the OpenAI SSE schema: "data: {json}\n\n" and
        // "data: [DONE]\n\n" at the end.
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            for (const line of event.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const payload = trimmed.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                try {
                    const obj = JSON.parse(payload);
                    const delta = obj.choices?.[0]?.delta?.content;
                    if (delta) yield delta;
                } catch { /* skip non-JSON keep-alive pings */ }
            }
        }
    }
}

async function* streamGemini(provider, prompt) {
    const headers = {
        [provider.authHeader]: provider.apiKey,
        'Content-Type': 'application/json',
    };
    const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
    };
    const res = await axios.post(provider.url, body, { headers, responseType: 'stream', timeout: 30000 });
    let buffer = '';
    for await (const chunk of res.data) {
        buffer += chunk.toString('utf8');
        // Gemini SSE: "data: {json}\n\n" per chunk.
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            for (const line of event.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const payload = trimmed.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                try {
                    const obj = JSON.parse(payload);
                    const parts = obj.candidates?.[0]?.content?.parts;
                    if (Array.isArray(parts)) {
                        for (const part of parts) {
                            if (part.text) yield part.text;
                        }
                    }
                } catch { /* skip non-JSON keep-alive pings */ }
            }
        }
    }
}

/**
 * Returns an AsyncGenerator<string> yielding token strings from the
 * provider chosen by env vars. Pass `null` if no direct provider is
 * configured (the harness will fall back to the LLMHelper path).
 */
function createDirectStream() {
    const provider = readProvider();
    if (!provider) return null;
    return async function* streamDirect(prompt) {
        if (provider.kind === 'minimax') {
            yield* streamMiniMax(provider, prompt);
        } else if (provider.kind === 'gemini') {
            yield* streamGemini(provider, prompt);
        } else {
            throw new Error(`[direct-llm-stream] unknown provider kind: ${provider.kind}`);
        }
    };
}

function describeActiveProvider() {
    const provider = readProvider();
    if (!provider) return null;
    return { kind: provider.kind, model: provider.model, url: provider.url };
}

module.exports = { createDirectStream, describeActiveProvider };