// A provider that dies AFTER the answer started must end the turn as INCOMPLETE,
// not as a finished answer (pipeline forensics 2026-11-13, F-ACC-01).
//
// The shared fallback engine (streamFallbackEngine) never switches providers
// once one has yielded text, which is right. But its default after that point
// was to RETURN silently, so the three text call sites whose catch blocks turn
// a post-commit failure into TRUNCATION_SENTINEL never saw one. The replay
// harness showed "Raw spans are kept for 14" and "…When a node joins or" shown
// and stored as complete answers on the selected-provider path (LiteLLM).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const llmSrc = fs.readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');
const { LLMHelper } = await import('../../../dist-electron/electron/LLMHelper.js');

/** The real streamChatWithOutcome over a real streamSelectedProviderWithFailover. */
function helperWith(open) {
    const h = Object.create(LLMHelper.prototype);
    h.textHealth = new Map();
    h.activeModelIsUserEndpoint = () => false;
    h.observedLatencyFor = () => undefined;
    h.activeAnswerLatencyKey = () => 'test';
    h.buildTextSpareRungs = () => [];               // no spare: the hedged, single-provider turn
    h._streamChatInner = async function* (_m, _i, _c, _s, _a, _b, _scopes, abortSignal) {
        yield* this.streamSelectedProviderWithFailover({
            id: 'litellm', name: 'LiteLLM (test)', open,
            userContent: 'q', finalSystemPrompt: 's', thinkingBudget: 0, abortSignal,
        });
    };
    return h;
}

async function drive(h, abortSignal) {
    const { stream, outcome } = LLMHelper.prototype.streamChatWithOutcome.call(h, 'q', undefined, undefined, 's', true, true, [], abortSignal);
    let text = '';
    for await (const tok of stream) text += tok;
    return { text, outcome };
}

describe('selected-provider text turn (LiteLLM, Custom, OpenAI, Claude, DeepSeek, NIM, Antigravity)', () => {
    test('a provider that breaks off mid-answer ends the turn as incomplete, partial text kept', async () => {
        const h = helperWith(async function* () {
            yield 'Raw spans are kept for ';
            yield '14';
            throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        });
        const { text, outcome } = await drive(h);
        assert.equal(text, 'Raw spans are kept for 14');
        assert.equal(outcome.truncated, true, 'the caller must be able to tell this from a finished answer');
        assert.equal(outcome.reason, 'provider_failed_after_first_token');
    });

    test('a provider that finishes normally is complete (unchanged)', async () => {
        const h = helperWith(async function* () { yield 'Raw spans are kept for 14 days.'; });
        const { text, outcome } = await drive(h);
        assert.equal(text, 'Raw spans are kept for 14 days.');
        assert.equal(outcome.truncated, false);
    });

    test('a caller cancel after the first token is not reported as a truncated answer', async () => {
        const ctrl = new AbortController();
        const h = helperWith(async function* (sig) {
            yield 'Raw spans are kept for ';
            await new Promise((_, rej) => sig.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
        });
        const run = drive(h, ctrl.signal);
        setTimeout(() => ctrl.abort('superseded'), 20);
        const { outcome } = await run;
        assert.equal(outcome.truncated, false);
    });
});

describe('Gemini cascade (the primary text path)', () => {
    function gemini(stream) {
        const h = Object.create(LLMHelper.prototype);
        Object.assign(h, { client: {}, currentModelId: 'gemini-3.8-flash', textHealth: new Map(), streamWithGeminiModel: stream });
        return h;
    }

    test('a rung that dies mid-answer now reaches the caller (which marks the turn incomplete)', async () => {
        const h = gemini(async function* () { yield 'When a node joins or'; throw new Error('stream reset'); });
        let text = '';
        await assert.rejects(async () => { for await (const c of h.streamGeminiTextCascade('q', undefined, 's', undefined)) text += c; }, /stream reset/);
        assert.equal(text, 'When a node joins or', 'no second provider is tried after the first words');
    });

    test('a caller cancel mid-answer still ends quietly', async () => {
        const ctrl = new AbortController();
        const h = gemini(async function* (_m, _model, _i, _s, sig) {
            yield 'When a node joins or';
            await new Promise((_, rej) => sig.addEventListener('abort', () => rej(new Error('aborted')), { once: true }));
        });
        setTimeout(() => ctrl.abort(), 20);
        let text = '';
        for await (const c of h.streamGeminiTextCascade('q', undefined, 's', ctrl.signal)) text += c;
        assert.equal(text, 'When a node joins or');
    });
});

describe('every text call into the shared engine asks for post-commit failures', () => {
    test('the three runStreamingTextFallback sites pass rethrowAfterCommit: true', () => {
        // The race and the Gemini cascade already had catch blocks for this; the
        // selected-provider path now has one. All three are dead code without the flag.
        const race = llmSrc.match(/runStreamingTextFallback\(instrumented, this\.textHealth, \{ \.\.\.DEFAULT_TEXT_FALLBACK_CONFIG, rethrowAfterCommit: true \}/);
        assert.ok(race, 'the text TTFT race must ask the engine to rethrow after commit');
        assert.match(llmSrc, /const cfg: VisionFallbackConfig = \{ \.\.\.DEFAULT_TEXT_FALLBACK_CONFIG, stopChainOnError: isPermanentKeyError, rethrowAfterCommit: true \}/,
            'the Gemini cascade must ask the engine to rethrow after commit');
        const start = llmSrc.indexOf('private async *streamSelectedProviderWithFailover(');
        const end = llmSrc.indexOf('\n  }\n', start);
        assert.match(llmSrc.slice(start, end), /rethrowAfterCommit: true/, 'the selected-provider path must ask too');
        const bare = llmSrc.match(/runStreamingTextFallback\([^;]*DEFAULT_TEXT_FALLBACK_CONFIG, \{\}/g) || [];
        assert.equal(bare.length, 0, 'no text call site may use the silent default');
    });
});
