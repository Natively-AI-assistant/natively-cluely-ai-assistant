// A provider outage must not become a retry storm (pipeline forensics
// 2026-11-13, F-LAT-10; ADR-003).
//
// P2/O2/F0-s16g, every request 500: 15-17 answer calls per question (the SDK's
// own 2 retries x the parallel hedge x speculation, prefetch and regeneration),
// then the canned line 7-10 s after speech end. Now: per turn at most 1 primary,
// 1 hedge or spare and 1 regeneration; a family that keeps failing is skipped
// for a cool-down (one probe after it); and the SDK does not retry calls the
// fallback engine owns.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LLMHelper } = await import('../../../dist-electron/electron/LLMHelper.js');
const budgetMod = await import('../../../dist-electron/electron/llm/providerCallBudget.js');
const { ProviderCircuitBreaker } = budgetMod;

const http500 = () => Object.assign(new Error('500 Internal Server Error'), { status: 500 });

function helperWith(open) {
    const h = Object.create(LLMHelper.prototype);
    h.textHealth = new Map();
    h.activeModelIsUserEndpoint = () => false;
    h.observedLatencyFor = () => undefined;
    h.activeAnswerLatencyKey = () => 'test';
    h.buildTextSpareRungs = () => [];               // a lone selected provider: the hedged case
    h._streamChatInner = async function* (_m, _i, _c, _s, _a, _b, _scopes, abortSignal) {
        yield* this.streamSelectedProviderWithFailover({
            id: 'litellm', name: 'LiteLLM (test)', open,
            userContent: 'q', finalSystemPrompt: 's', thinkingBudget: 0, abortSignal,
        });
    };
    return h;
}

async function turn(h, signal) {
    try {
        const { stream } = LLMHelper.prototype.streamChatWithOutcome.call(h, 'q', undefined, undefined, 's', true, true, [], signal);
        let text = '';
        for await (const t of stream) text += t;
        return { text, error: null };
    } catch (e) { return { text: '', error: e }; }
}

describe('outage: a provider that always returns 500', () => {
    test('one question (speculation, prefetch, regeneration) costs at most 3 calls; the next question none', async () => {
        let calls = 0;
        const h = helperWith(async function* () { calls++; throw http500(); });
        const speculation = new AbortController().signal;
        const prefetch = new AbortController().signal;
        await turn(h, speculation);
        await turn(h, prefetch);
        await turn(h, prefetch);                     // the regeneration replays the prefetch turn
        const q1 = calls;
        assert.ok(q1 <= 3, `question 1 cost ${q1} provider calls (was 6 here, 15-17 with SDK retries)`);
        await turn(h, new AbortController().signal); // the next question, inside the cool-down
        assert.equal(calls - q1, 0, 'a family that just failed 3 times in a row is skipped, not called again');
    });

    test('the failure the user gets is an honest provider failure', async () => {
        const h = helperWith(async function* () { throw http500(); });
        for (let i = 0; i < 3; i++) await turn(h, new AbortController().signal);
        const { error } = await turn(h, new AbortController().signal);
        assert.ok(error, 'the turn fails');
        const { providerFailureUserMessage } = require('../../../dist-electron/electron/llm/providerErrorClassifier.js');
        assert.match(providerFailureUserMessage(error) ?? '', /unreachable or overloaded/);
    });

    test('per-turn budget alone (breaker out of the way): 1 primary + 1 hedge + 1 regeneration', async () => {
        let calls = 0;
        const h = helperWith(async function* () { calls++; throw http500(); });
        h._providerBreaker = new ProviderCircuitBreaker({ threshold: 1000 });
        const sig = new AbortController().signal;
        await turn(h, sig);
        await turn(h, sig);
        await turn(h, sig);
        assert.equal(calls, 3);
    });

    test('a regeneration with a fresh signal shares its turn\'s budget (retryAnswerCall)', async () => {
        let calls = 0;
        const h = helperWith(async function* () { calls++; throw http500(); });
        h._providerBreaker = new ProviderCircuitBreaker({ threshold: 1000 });
        const turnSig = new AbortController().signal;
        h.answerCallByTurn = new WeakMap([[turnSig, ['q', undefined, undefined, 's', true, true, [], turnSig]]]);
        await turn(h, turnSig);
        const retrySig = new AbortController().signal;
        h.retryAnswerCall(turnSig, retrySig);
        await turn(h, retrySig);
        await turn(h, retrySig);
        assert.equal(calls, 3);
    });

    test('a healthy provider is unaffected, and answering refunds the slot', async () => {
        let calls = 0;
        const h = helperWith(async function* () { calls++; yield 'Use a token bucket.'; });
        const sig = new AbortController().signal;
        for (let i = 0; i < 6; i++) assert.equal((await turn(h, sig)).text, 'Use a token bucket.');
        assert.equal(calls, 6, 'repairs and verifier passes on an answered turn are never refused');
    });
});

describe('circuit breaker', () => {
    test('opens after 3 consecutive failures in the window, probes once after the cool-down, closes on success', () => {
        let now = 0;
        const b = new ProviderCircuitBreaker({ threshold: 3, windowMs: 30_000, cooldownMs: 20_000, now: () => now });
        for (let i = 0; i < 3; i++) { assert.equal(b.admit('x'), 'closed'); b.recordFailure('x'); now += 1000; }
        assert.equal(b.admit('x'), 'open');
        now += 20_000;
        assert.equal(b.admit('x'), 'probe');
        assert.equal(b.admit('x'), 'open', 'one probe at a time');
        b.recordSuccess('x');
        assert.equal(b.admit('x'), 'closed');
    });

    test('a failed probe re-opens it; failures spread beyond the window do not trip it', () => {
        let now = 0;
        const b = new ProviderCircuitBreaker({ threshold: 3, windowMs: 30_000, cooldownMs: 20_000, now: () => now });
        for (let i = 0; i < 3; i++) b.recordFailure('x');
        now += 20_000; assert.equal(b.admit('x'), 'probe'); b.recordFailure('x');
        assert.equal(b.admit('x'), 'open');
        const c = new ProviderCircuitBreaker({ threshold: 3, windowMs: 30_000, cooldownMs: 20_000, now: () => now });
        for (let i = 0; i < 5; i++) { c.recordFailure('y'); now += 31_000; }
        assert.equal(c.admit('y'), 'closed');
    });
});

describe('the SDK does not retry a call the engine owns', () => {
    test('LiteLLM over the real OpenAI SDK against a local server that always 500s: 2 requests, not 6', async () => {
        let requests = 0;
        const server = http.createServer((req, res) => {
            requests++;
            req.resume();
            req.on('end', () => { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":{"message":"boom"}}'); });
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const { port } = server.address();
        try {
            const OpenAI = require('openai').default ?? require('openai');
            const h = helperWith(null);
            h._providerBreaker = new ProviderCircuitBreaker({ threshold: 1000 });
            Object.assign(h, {
                isLocalOnlyMode: false, currentModelId: 'litellm/fake',
                litellmClient: new OpenAI({ apiKey: 'test', baseURL: `http://127.0.0.1:${port}/v1` }),
                rateLimiters: { litellm: { acquire: async () => {} } },
            });
            h.assertOutboundScopes = () => {};
            h.resolveLitellmMaxTokens = async () => 64;
            h._streamChatInner = async function* (_m, _i, _c, _s, _a, _b, _scopes, abortSignal) {
                yield* this.streamSelectedProviderWithFailover({
                    id: 'litellm', name: 'LiteLLM', open: (sig) => this.streamWithLiteLLM('q', 's', undefined, sig, 'litellm/fake'),
                    userContent: 'q', finalSystemPrompt: 's', thinkingBudget: 0, abortSignal,
                });
            };
            await turn(h, new AbortController().signal);
            assert.equal(requests, 2, `primary + hedge, no SDK retries (got ${requests})`);
        } finally {
            server.close();
        }
    });
});
