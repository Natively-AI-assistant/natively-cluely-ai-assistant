// Issue #543 — "What to answer" on a Codex (ChatGPT sign-in) model returned
// "Just to make sure I get this right — could you ask that once more?" while
// the same account answered screenshots.
//
// The chain, end to end on the shipped code:
//   Codex backend rejects the request with a PERMANENT 400 ("The '<model>'
//   model is not supported when using Codex with a ChatGPT account.") →
//   CodexCliService throws that message → WhatToAnswerLLM's catch tested it
//   against a 401/403/429/key/quota regex, it matched nothing, and the catch
//   yielded buildGracefulRetry (v2.8.8: "could you ask that once more?"; main
//   since 2026-09-08: yields nothing, the engine regenerates the same rejected
//   call, then "Press again and I'll retry"). Either way the provider's own
//   explanation never reached the user, and pressing again can never work.
//   Screenshots "worked" because the vision chain has spare rungs: Codex
//   failed there too and another provider answered.
//
// Driven through the REAL WhatToAnswerLLM → LLMHelper → CodexCliService; only
// the HTTPS call is stubbed.
//
// Run via: npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/llm/__tests__/WtaCodexModelRejectedIssue543_2026_09_11.test.mjs

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
const { WhatToAnswerLLM } = require(dist('llm/WhatToAnswerLLM.js'));
const {
  providerFailureUserMessage,
  providerRejectionUserMessage,
  isClarificationStall,
} = require(dist('llm/providerErrorClassifier.js'));
const { isProviderTransportError } = require(dist('llm/answerPolish.js'));

// Same seam CodexVisionPayload2026_08_05 uses: the CodexOAuthService copy
// inlined into the LLMHelper bundle reads tokens through this global slot.
const CRED_SLOT = '__nativelyCredentialsManagerV1__';
// Every other credential getter the answer path touches (Antigravity tokens,
// provider keys, …) reads as "not configured".
const seedSignedIn = () => {
  const known = {
    getCodexOAuthTokens: () => ({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      accountId: 'acct_test',
      expiresAt: Date.now() + 3_600_000,
    }),
    getDisabledProviders: () => [],
    anyVisionProviderConfigured: () => true,
    anyLocalVisionProviderConfigured: () => false,
  };
  globalThis[CRED_SLOT] = new Proxy(known, {
    get: (target, prop) => (prop in target ? target[prop] : () => null),
  });
};

// The Codex backend answers an unentitled model with a FastAPI-style envelope.
const REJECTION = "The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account.";

const modesManager = {
  getActiveModeSystemPromptSuffix: () => '',
  buildRetrievedActiveModeContextBlockHybrid: async () => '',
  buildRetrievedActiveModeContextBlock: () => '',
  buildActiveModeContextBlock: () => '',
};

async function pressWhatToAnswer(responseFactory) {
  seedSignedIn();
  const helper = new LLMHelper(undefined, false);
  helper.setCodexCliConfig({ enabled: true, model: 'gpt-5.5', timeoutMs: 30_000 });
  helper.setModel('codex-cli:gpt-5.5');
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('chatgpt.com/backend-api/codex')) { fetches++; return responseFactory(); }
    throw new Error(`unexpected fetch in test: ${url}`);
  };
  try {
    const answerer = new WhatToAnswerLLM(helper, modesManager);
    const snap = Object.freeze({
      activeModeInfo: null, modeId: 'general', requestId: 'r543',
      surface: 'what_to_answer', generationId: 1,
    });
    const chunks = [];
    for await (const c of answerer.generateStream(
      '[INTERVIEWER]: How would you design a rate limiter for a public API?',
      undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, snap,
    )) chunks.push(c);
    return { out: chunks.join(''), fetches };
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis[CRED_SLOT];
  }
}

describe('#543 — a Codex model the account cannot use is named on the WTA surface', () => {
  test('the provider\'s rejection reaches the user instead of an empty/"ask again" answer', async () => {
    const { out, fetches } = await pressWhatToAnswer(() => new Response(
      JSON.stringify({ detail: REJECTION }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    assert.equal(fetches, 1, 'a 400 is not retried');
    assert.ok(out.trim().length > 0, 'WTA yielded nothing — the engine would regenerate the same rejected call, then say "press again"');
    assert.match(out, /not supported when using Codex with a ChatGPT account/, out);
    assert.doesNotMatch(out, /\{"detail"/, 'the JSON envelope is unwrapped, not shown raw');
    assert.doesNotMatch(out, /repeat|rephrase|once more|press again/i, out);
    assert.equal(isClarificationStall(out), false, out);
    assert.equal(isProviderTransportError(out), true,
      'the engine must recognise the line as a provider error so it is shown but never stored as session history');
  });

  test('a transient failure still leaves the answer empty so the engine regenerates', async () => {
    const { out } = await pressWhatToAnswer(() => { throw new Error('socket closed unexpectedly'); });
    assert.equal(out, '', 'only PERMANENT rejections short-circuit the regeneration');
  });
});

describe('providerRejectionUserMessage', () => {
  const rejected = [
    new Error(REJECTION),
    new Error("Unsupported value: 'none' is not supported with the 'gpt-5.5' model."),
    new Error('The model `gpt-9` does not exist or you do not have access to it.'),
    new Error('models/gemini-9-flash is not found for API version v1beta, or is not supported for generateContent.'),
    Object.assign(new Error('model_not_found'), { status: 404 }),
  ];
  for (const err of rejected) {
    test(`names the rejection: ${err.message.slice(0, 50)}`, () => {
      const m = providerRejectionUserMessage(err);
      assert.ok(m, 'null');
      assert.ok(m.includes(err.message.replace(/\s+/g, ' ').trim().slice(0, 40)), m);
      assert.equal(isProviderTransportError(m), true);
      assert.equal(providerFailureUserMessage(err), m, 'both catches (WTA stream + engine) agree');
    });
  }

  const notRejections = [
    new Error('Codex request aborted.'),
    new Error('Cannot read properties of undefined (reading \'length\')'),
    new Error("ENOENT: no such file or directory, open '/tmp/shot.png'"),
    new Error('Codex upstream 503 after 3 retries: overloaded'),
    Object.assign(new Error('Invalid API key'), { status: 401 }),
    Object.assign(new Error('RESOURCE_EXHAUSTED: quota'), { status: 429 }),
  ];
  for (const err of notRejections) {
    test(`leaves other failures to their own handling: ${err.message.slice(0, 40)}`, () => {
      assert.equal(providerRejectionUserMessage(err), null);
    });
  }

  test('a long provider message is capped and kept on one line', () => {
    const m = providerRejectionUserMessage(new Error(`The model 'x' is not supported.\n${'detail '.repeat(200)}`));
    assert.ok(m && m.length < 400, String(m?.length));
    assert.doesNotMatch(m, /\n/);
  });
});
