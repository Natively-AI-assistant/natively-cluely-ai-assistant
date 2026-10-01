// electron/llm/promptDebug.ts
//
// DEVELOPMENT-ONLY prompt debug recorder (2026-09-29).
//
// Why this exists: Natively has several prompt layers (legacy prompts.ts,
// Prompt System v2, the Context Intelligence V3 composer, LLMHelper's own
// additions) and the question "what did the model actually receive?" kept
// being answered from file names. The composer-side captures
// (__nativelyE2eV3Prompts, providerPayloadCapture) record intent, and the
// adapter capture misses whole providers (DeepSeek, OpenRouter, NVIDIA NIM).
// This records the request body on the wire, for every provider whose SDK
// goes through the global fetch (openai, @anthropic-ai/sdk, @google/genai and
// every raw fetch call), plus the raw response text.
//
// Off unless NATIVELY_PROMPT_DEBUG=1, and never in a packaged build. It never
// records request headers (credentials live there) or URL query strings
// (Gemini REST can carry ?key=), and it scrubs base64 image bytes.
//
// NATIVELY_PROMPT_DEBUG_BLOCK_HOSTS=api.openai.com,api.anthropic.com records
// the request and answers it locally with a 401 instead of sending it, so a
// provider without a key can be shown to receive a prompt without shipping the
// test content to that provider.
//
// Must be imported before any SDK client is constructed: the openai and
// anthropic clients capture globalThis.fetch in their constructors. main.ts
// imports it right after the native-arch gate.

import * as crypto from 'crypto';

export interface PromptCompositionNote {
    surface: string;
    promptSource: string;
    action?: string;
    mode?: string | null;
    chatSurface?: boolean;
    tier?: string;
    provider?: string;
    model?: string;
    system: string;
    user: string;
    extra?: Record<string, unknown>;
}

interface WireRecord {
    seq: number;
    ts: string;
    provider: string;
    host: string;
    path: string;
    model: string | null;
    stream: boolean;
    blocked: boolean;
    params: Record<string, unknown>;
    system: string;
    systemSha: string;
    messages: Array<{ role: string; text: string }>;
    note: (Omit<PromptCompositionNote, 'system' | 'user'> & { seq: number; systemSha: string; userSha: string; systemMatchesWire: boolean; userMatchesWire: boolean }) | null;
    status?: number;
    response?: string;
    responseChars?: number;
}

const RING_MAX = 300;
let installed = false;
let seq = 0;
let noteSeq = 0;

function state(): { records: WireRecord[]; notes: Array<PromptCompositionNote & { seq: number; ts: number }> } {
    const g = globalThis as any;
    return (g.__nativelyPromptDebug ||= { records: [], notes: [] });
}

/** True when the recorder is armed for this process. */
export function isPromptDebugEnabled(): boolean {
    if (process.env.NATIVELY_PROMPT_DEBUG !== '1') return false;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { app } = require('electron');
        // A packaged build never records, whatever the environment says.
        if (app && app.isPackaged) return false;
    } catch { /* not an Electron main process (tests, offline capture) */ }
    return true;
}

const sha = (s: string): string => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function scrub(value: string): string {
    return value
        .replace(/(data:[\w.+-]+\/[\w.+-]+;base64,)[A-Za-z0-9+/]{64,}={0,2}/g, '$1[binary omitted]')
        .replace(/[A-Za-z0-9+/]{512,}={0,2}/g, '[binary omitted]');
}

function providerFor(host: string): string {
    if (host.includes('generativelanguage.googleapis.com') || host.includes('aiplatform.googleapis.com')) return 'gemini';
    if (host.includes('deepseek.com')) return 'deepseek';
    if (host.includes('api.openai.com')) return 'openai';
    if (host.includes('anthropic.com')) return 'claude';
    if (host.includes('openrouter.ai')) return 'openrouter';
    if (host.includes('groq.com')) return 'groq';
    if (host.includes('nvidia.com')) return 'nvidia_nim';
    if (host.includes('natively.software')) return 'natively_gateway';
    if (host.startsWith('127.0.0.1') || host.startsWith('localhost')) return 'local';
    return host;
}

function textOf(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map((p: any) => {
            if (typeof p === 'string') return p;
            if (typeof p?.text === 'string') return p.text;
            if (p?.type === 'image_url' || p?.type === 'image' || p?.inlineData || p?.inline_data) return '[image]';
            return '';
        }).join('');
    }
    if (content && typeof content === 'object' && Array.isArray((content as any).parts)) return textOf((content as any).parts);
    return '';
}

/** Normalise the provider-specific request into system text + ordered messages. */
function normalise(body: any): { system: string; messages: Array<{ role: string; text: string }> } | null {
    if (!body || typeof body !== 'object') return null;
    const messages: Array<{ role: string; text: string }> = [];
    let system = '';
    if (Array.isArray(body.messages)) {
        for (const m of body.messages) {
            const text = textOf(m?.content);
            if (m?.role === 'system' || m?.role === 'developer') system += (system ? '\n\n' : '') + text;
            else messages.push({ role: String(m?.role ?? '?'), text });
        }
        if (body.system != null) system = textOf(body.system) + (system ? `\n\n${system}` : '');
        return { system, messages };
    }
    if (Array.isArray(body.contents)) {
        system = textOf(body.systemInstruction ?? body.system_instruction ?? body.config?.systemInstruction ?? '');
        for (const c of body.contents) messages.push({ role: String(c?.role ?? 'user'), text: textOf(c) });
        return { system, messages };
    }
    if (typeof body.prompt === 'string') return { system: textOf(body.system ?? ''), messages: [{ role: 'user', text: body.prompt }] };
    return null;
}

function paramsOf(body: any): Record<string, unknown> {
    const gc = body?.generationConfig ?? body?.generation_config ?? {};
    const out: Record<string, unknown> = {
        temperature: body?.temperature ?? gc.temperature,
        top_p: body?.top_p ?? gc.topP,
        seed: body?.seed ?? gc.seed,
        max_tokens: body?.max_tokens ?? body?.max_completion_tokens ?? body?.max_output_tokens ?? gc.maxOutputTokens,
        thinking: body?.thinking ?? body?.reasoning_effort ?? gc.thinkingConfig ?? body?.options?.think,
        response_format: body?.response_format ?? gc.responseMimeType,
        // Gemini context caching: a request that names a cachedContent carries
        // no systemInstruction — the system prompt lives in the cache created
        // by an earlier POST /cachedContents (recorded too, response holds the
        // name). Recorded so the two can be joined.
        cachedContent: typeof body?.cachedContent === 'string' ? body.cachedContent : undefined,
    };
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
}

function persist(line: unknown): void {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const path = require('path');
        let file = process.env.NATIVELY_PROMPT_DEBUG_FILE;
        if (!file) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { app } = require('electron');
                if (app?.getPath) file = path.join(app.getPath('userData'), 'prompt-debug', 'requests.jsonl');
            } catch { /* no app */ }
        }
        if (!file) return;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
    } catch { /* recording must never break a request */ }
}

function matchNote(system: string, messages: Array<{ role: string; text: string }>): WireRecord['note'] {
    const notes = state().notes;
    const userText = messages.map((m) => m.text).join('\n');
    for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        if (Date.now() - n.ts > 120_000) break;
        const head = n.system.slice(0, 200);
        const qHead = n.user.slice(0, 200);
        if ((head && system.includes(head)) || (qHead && userText.includes(qHead))) {
            const { system: ns, user: nu, ...rest } = n;
            return {
                ...rest,
                systemSha: sha(ns),
                userSha: sha(nu),
                systemMatchesWire: ns === system,
                userMatchesWire: messages.length > 0 && nu === messages[messages.length - 1].text,
            };
        }
    }
    return null;
}

let turnFacts: { facts: Record<string, unknown>; ts: number } | null = null;

/**
 * Facts decided upstream of the composition point (which v2 action the
 * persona used, the mode, whether it is a coding turn). The next composition
 * note within 30 s carries them. A no-op unless the recorder is armed.
 */
export function setPromptDebugTurnFacts(facts: Record<string, unknown>): void {
    if (!installed) return;
    turnFacts = { facts, ts: Date.now() };
}

/**
 * Record what a caller composed, right before it hands the prompt to LLMHelper.
 * The wire record that follows links back to it, so composed and sent can be
 * diffed. A no-op unless the recorder is armed.
 */
export function notePromptComposition(note: PromptCompositionNote): void {
    if (!installed) return;
    const st = state();
    const facts = turnFacts && Date.now() - turnFacts.ts < 30_000 ? turnFacts.facts : undefined;
    turnFacts = null;
    const entry = { ...note, extra: { ...(note.extra ?? {}), ...(facts ? { turnFacts: facts } : {}) }, seq: ++noteSeq, ts: Date.now() };
    st.notes.push(entry);
    if (st.notes.length > 50) st.notes.shift();
    persist({ kind: 'composition', ...entry, systemSha: sha(note.system), userSha: sha(note.user) });
}

export function getPromptDebugState(): { records: WireRecord[]; notes: unknown[] } {
    const st = state();
    return { records: st.records.slice(), notes: st.notes.slice() };
}

export function clearPromptDebugState(): void {
    const st = state();
    st.records.length = 0;
    st.notes.length = 0;
}

/** Wrap globalThis.fetch once. Safe to call repeatedly; inert when disabled. */
export function installPromptDebug(): void {
    if (installed || !isPromptDebugEnabled() || typeof globalThis.fetch !== 'function') return;
    installed = true;
    const original = globalThis.fetch.bind(globalThis);
    const blocked = new Set((process.env.NATIVELY_PROMPT_DEBUG_BLOCK_HOSTS || '')
        .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));

    globalThis.fetch = async function promptDebugFetch(input: any, init?: any): Promise<Response> {
        let record: WireRecord | null = null;
        try {
            const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : String(input?.url ?? ''));
            const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
            const rawBody = init?.body;
            const bodyText = typeof rawBody === 'string'
                ? rawBody
                : (rawBody instanceof Uint8Array ? Buffer.from(rawBody).toString('utf8') : null);
            if (method === 'POST' && bodyText && url) {
                const parsed = JSON.parse(bodyText);
                const norm = normalise(parsed);
                if (norm) {
                    const u = new URL(url);
                    const host = u.host.toLowerCase();
                    const modelFromPath = /models\/([^:/]+)/.exec(u.pathname)?.[1] ?? null;
                    record = {
                        seq: ++seq,
                        ts: new Date().toISOString(),
                        provider: providerFor(host),
                        host,
                        path: u.pathname,
                        model: typeof parsed.model === 'string' ? parsed.model : modelFromPath,
                        stream: parsed.stream === true || /stream/i.test(u.pathname),
                        blocked: blocked.has(host),
                        params: paramsOf(parsed),
                        system: scrub(norm.system),
                        systemSha: sha(norm.system),
                        messages: norm.messages.map((m) => ({ role: m.role, text: scrub(m.text) })),
                        note: matchNote(norm.system, norm.messages),
                    };
                    const st = state();
                    st.records.push(record);
                    if (st.records.length > RING_MAX) st.records.shift();
                }
            }
        } catch { record = null; /* not JSON / not an LLM call: pass through untouched */ }

        if (record?.blocked) {
            record.status = 401;
            record.response = 'prompt-debug: captured locally, not sent';
            persist({ kind: 'wire', ...record });
            return new Response(JSON.stringify({ error: { message: 'prompt-debug blocked this request (captured, not sent)', type: 'invalid_request_error', code: 'prompt_debug_blocked' } }), {
                status: 401,
                headers: { 'content-type': 'application/json' },
            });
        }

        const response = await original(input, init);
        if (record) {
            const rec = record;
            rec.status = response.status;
            // clone() tees the body, so the SDK reads its own copy unchanged.
            try {
                response.clone().text().then((text) => {
                    rec.response = scrub(text).slice(0, 200_000);
                    rec.responseChars = text.length;
                    persist({ kind: 'wire', ...rec });
                }, () => persist({ kind: 'wire', ...rec }));
            } catch { persist({ kind: 'wire', ...rec }); }
        }
        return response;
    } as typeof fetch;
}

installPromptDebug();
