// Every provider failing is not "no provider is set up" (pipeline forensics
// 2026-11-13, F-ACC-10; A7 D5).
//
// _streamChatInner ends on exhaustedChainError(), which said "No AI provider
// configured. Please add at least one API key in Settings." whatever happened
// before it. A user with working keys during an outage (or a DNS failure) was
// told to add a provider. The line must only say that when nothing was tried.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: {
        app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
        safeStorage: { isEncryptionAvailable: () => false },
    },
};

const { LLMHelper } = require(dist('LLMHelper.js'));
const { providerFailureUserMessage, accountOrSetupUserMessage } = require(dist('llm/providerErrorClassifier.js'));

const http500 = () => Object.assign(new Error('500 Internal Server Error'), { status: 500 });

function makeHelper({ model = 'gemini-3.8-flash', gemini = null, natively = null } = {}) {
    const h = Object.create(LLMHelper.prototype);
    Object.assign(h, {
        useOllama: false, currentModelId: model, isLocalOnlyMode: false,
        customProvider: null, activeCurlProvider: null,
        textHealth: new Map(), visionHealth: new Map(), answerLatency: new Map(),
        configuredCustomProviders: [],
    });
    h.checkOllamaAvailable = async () => false;
    h.ensureOllamaModelSelected = async () => false;
    h.pickConfiguredCustomProviderForFallback = () => null;
    h.getActiveModeGroundingInfo = () => null;
    h.assertOutboundScopes = () => {};
    h.hasNatively = () => natively != null;
    if (gemini) {
        h._client = {};
        h.streamGeminiTextCascade = gemini;
    }
    if (natively) h.streamWithNatively = natively;
    return h;
}

async function drainInner(h) {
    try {
        for await (const _ of LLMHelper.prototype._streamChatInner.call(
            h, 'hello', undefined, undefined, 'SYS', true, true, [], undefined, 0, { v3Owned: true },
        )) { /* drain */ }
    } catch (e) { return e; }
    return null;
}

describe('an exhausted chain', () => {
    test('a configured Gemini that 500s is reported as a provider failure, not as no provider', async () => {
        const h = makeHelper({ gemini: async function* () { throw http500(); } });
        const err = await drainInner(h);
        assert.ok(err, 'the turn must fail');
        assert.doesNotMatch(String(err.message), /No AI provider configured/);
        assert.equal(accountOrSetupUserMessage(err), null, 'no "set one up" line for a user who has one');
        const line = providerFailureUserMessage(err);
        assert.ok(line, 'the user is told the provider failed');
        assert.doesNotMatch(line, /set up yet|add one|add at least one/i);
    });

    test('the Natively race + last resort failing says the providers failed', async () => {
        const h = makeHelper({
            model: 'natively',
            natively: async function* () { throw Object.assign(new Error('getaddrinfo ENOTFOUND api.natively.software'), { code: 'ENOTFOUND' }); },
        });
        const err = await drainInner(h);
        assert.ok(err);
        assert.doesNotMatch(String(err.message), /No AI provider configured/);
        assert.match(providerFailureUserMessage(err) ?? '', /unreachable|couldn't reach/i);
    });

    test('a key the provider rejects still gets the key line, through the chain error', async () => {
        const h = makeHelper({ gemini: async function* () { throw Object.assign(new Error('401 Unauthorized: API key not valid'), { status: 401 }); } });
        const err = await drainInner(h);
        assert.match(providerFailureUserMessage(err) ?? '', /API key/);
    });

    test('nothing configured at all still says so (unchanged)', async () => {
        const h = makeHelper();
        const err = await drainInner(h);
        assert.ok(err);
        assert.match(String(err.message), /No AI provider configured/);
        assert.match(accountOrSetupUserMessage(err) ?? '', /No AI provider is set up yet/);
    });
});
