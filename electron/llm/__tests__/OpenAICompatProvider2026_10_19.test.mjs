// OpenAI-compatible provider plumbing: the routed model-id codec (shared with
// the renderer), registry routing between endpoint instances, and the
// provider's stream/generate against a fake SDK client (no network). The TS
// modules are exercised as compiled (dist-electron), exactly what LLMHelper
// consumes; compatModelId.mjs is imported from source, exactly what the
// renderer imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
    OPENAI_COMPAT_PREFIX,
    compatModelId,
    parseCompatModelId,
} from '../providers/compatModelId.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const { ProviderRegistry } = require(path.join(root, 'dist-electron/electron/llm/providers/ProviderRegistry.js'));
const { OpenAICompatProvider } = require(path.join(root, 'dist-electron/electron/llm/providers/OpenAICompatProvider.js'));

// ── parseCompatModelId table ────────────────────────────────────────────────

test('compat ids split at the FIRST slash only', () => {
    assert.deepEqual(parseCompatModelId('compat:abc/gpt-4o'), { instanceId: 'abc', model: 'gpt-4o' });
    // Provider-prefixed wire names (OpenRouter style) survive intact.
    assert.deepEqual(parseCompatModelId('compat:abc/openai/gpt-4o'), { instanceId: 'abc', model: 'openai/gpt-4o' });
});

test('non-compat and half-empty ids parse to null', () => {
    assert.equal(parseCompatModelId('litellm/x'), null);
    assert.equal(parseCompatModelId('gpt-4o'), null);
    assert.equal(parseCompatModelId('compat:/x'), null);
    assert.equal(parseCompatModelId('compat:abc/'), null);
    assert.equal(parseCompatModelId('compat:'), null);
    assert.equal(parseCompatModelId(''), null);
    assert.equal(parseCompatModelId(null), null);
    assert.equal(parseCompatModelId(undefined), null);
});

test('compatModelId round-trips through parse', () => {
    const id = compatModelId('work-proxy', 'anthropic/claude-sonnet-4.5');
    assert.equal(id, OPENAI_COMPAT_PREFIX + 'work-proxy/anthropic/claude-sonnet-4.5');
    assert.deepEqual(parseCompatModelId(id), { instanceId: 'work-proxy', model: 'anthropic/claude-sonnet-4.5' });
});

// ── ProviderRegistry ────────────────────────────────────────────────────────

function fakeProvider(id, owns) {
    return { id, name: id, ownsModel: (m) => owns.includes(m), stream: null, generate: null };
}

test('forModel routes to the owning provider and null otherwise', () => {
    const reg = new ProviderRegistry();
    const a = fakeProvider('compat:a', ['compat:a/m1']);
    const b = fakeProvider('compat:b', ['compat:b/m2']);
    reg.register(a);
    reg.register(b);
    assert.equal(reg.forModel('compat:a/m1'), a);
    assert.equal(reg.forModel('compat:b/m2'), b);
    assert.equal(reg.forModel('compat:c/m3'), null);
    assert.equal(reg.forModel('gpt-4o'), null);
    assert.equal(reg.forModel(''), null);
    assert.equal(reg.forModel(null), null);
    assert.equal(reg.forModel(undefined), null);
    assert.deepEqual(reg.list(), [a, b]);
});

test('register replaces same-id; unregisterWhere drops by predicate', () => {
    const reg = new ProviderRegistry();
    const a1 = fakeProvider('compat:a', ['old']);
    const a2 = fakeProvider('compat:a', ['new']);
    reg.register(a1);
    reg.register(a2);
    assert.equal(reg.list().length, 1);
    assert.equal(reg.forModel('new'), a2);
    reg.unregisterWhere((p) => p.id.startsWith(OPENAI_COMPAT_PREFIX));
    assert.deepEqual(reg.list(), []);
});

// ── OpenAICompatProvider ────────────────────────────────────────────────────

const CFG = { id: 'abc', name: 'My Endpoint', baseURL: 'http://localhost:1234/v1/', models: ['gpt-4o'] };

test('ownsModel matches only its own instance prefix', () => {
    const p = new OpenAICompatProvider(CFG, {});
    assert.equal(p.id, 'compat:abc');
    assert.equal(p.ownsModel('compat:abc/gpt-4o'), true);
    assert.equal(p.ownsModel('compat:abc/openai/gpt-4o'), true);
    assert.equal(p.ownsModel('compat:other/gpt-4o'), false);
    assert.equal(p.ownsModel('gpt-4o'), false);
});

function fakeClient(capture, chunks) {
    return {
        chat: {
            completions: {
                create: async (params) => {
                    capture.params = params;
                    if (!params.stream) {
                        return { choices: [{ message: { content: chunks.join('') } }] };
                    }
                    return {
                        async *[Symbol.asyncIterator]() {
                            for (const c of chunks) yield { choices: [{ delta: { content: c } }] };
                            // A final chunk with no content must be skipped, not yielded as ''.
                            yield { choices: [{ delta: {} }] };
                        },
                    };
                },
            },
        },
    };
}

test('stream yields deltas in order and sends the wire model + system message', async () => {
    const capture = {};
    const p = new OpenAICompatProvider(CFG, fakeClient(capture, ['Hel', 'lo', '!']));
    const out = [];
    for await (const delta of p.stream({
        userMessage: 'hi', systemPrompt: 'be brief', modelId: 'compat:abc/openai/gpt-4o',
    })) out.push(delta);
    assert.deepEqual(out, ['Hel', 'lo', '!']);
    assert.equal(capture.params.model, 'openai/gpt-4o');
    assert.equal(capture.params.stream, true);
    assert.equal(capture.params.messages[0].role, 'system');
    assert.equal(capture.params.messages[0].content, 'be brief');
    assert.equal(capture.params.messages[1].role, 'user');
});

test('stream without a system prompt sends only the user message', async () => {
    const capture = {};
    const p = new OpenAICompatProvider(CFG, fakeClient(capture, ['x']));
    for await (const _ of p.stream({ userMessage: 'hi', modelId: 'compat:abc/gpt-4o' })) { /* drain */ }
    assert.equal(capture.params.messages.length, 1);
    assert.equal(capture.params.messages[0].role, 'user');
});

test('generate returns the message content, empty string when absent', async () => {
    const capture = {};
    const p = new OpenAICompatProvider(CFG, fakeClient(capture, ['one', 'two']));
    assert.equal(await p.generate({ userMessage: 'hi', modelId: 'compat:abc/gpt-4o' }), 'onetwo');
    assert.equal(capture.params.stream, undefined);
    const empty = new OpenAICompatProvider(CFG, {
        chat: { completions: { create: async () => ({ choices: [{}] }) } },
    });
    assert.equal(await empty.generate({ userMessage: 'hi', modelId: 'compat:abc/gpt-4o' }), '');
});
