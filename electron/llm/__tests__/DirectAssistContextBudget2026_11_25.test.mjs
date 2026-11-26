// #795: Direct Assist sized every prompt against a fixed 64 000-character
// budget whatever the model, so a mode with several reference files arrived
// truncated even on a long-context model. The budget is now the window the
// prompt really goes into: the model's own, the num_ctx Natively asks Ollama
// for, or a smaller ceiling a gateway reported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);
const load = () => import(pathToFileURL(path.resolve(root, 'dist-electron/electron/direct-assist/index.js')).href);
const loadCaps = () => import(pathToFileURL(path.resolve(root, 'dist-electron/electron/llm/modelCapabilities.js')).href);

function input(overrides = {}) {
  return {
    requestId: 'budget-795',
    source: 'typed',
    selection: { provider: 'claude', model: 'claude-opus-5-5' },
    currentRequest: 'How many reference files can you see?',
    ...overrides,
  };
}

/** The reporter's mode: 11 Markdown files of 10-24k chars, ~175k in all. */
function reportersFiles() {
  return Array.from({ length: 11 }, (_, i) => {
    const size = 10_000 + Math.round((14_000 * i) / 10);
    const head = `# Topic ${i}\nFIRST-${i}\n`;
    const tail = `\nLAST-${i}`;
    return { fileName: `topic-${i}.md`, content: head + 'x'.repeat(size - head.length - tail.length) + tail };
  });
}

test('#795: eleven reference files (~175k chars) reach a long-context model whole', async () => {
  const { prepareDirectAssistPrompt } = await load();
  const files = reportersFiles();
  const total = files.reduce((sum, f) => sum + f.content.length, 0);
  assert.ok(total > 170_000 && total < 200_000, `fixture is ${total} chars`);

  const prepared = prepareDirectAssistPrompt(input({ referenceFiles: files }));

  assert.deepEqual(prepared.shortenedFields, [], 'nothing should be shortened');
  assert.deepEqual(prepared.trimmedFields, []);
  assert.doesNotMatch(prepared.userPrompt, /\[TRUNCATED:/);
  for (let i = 0; i < files.length; i += 1) {
    assert.match(prepared.userPrompt, new RegExp(`FIRST-${i}\\n`));
    assert.match(prepared.userPrompt, new RegExp(`LAST-${i}\\b`), `topic-${i}.md lost its end`);
  }
});

test('#795: a long chat history no longer squeezes a reference file on a long-context model', async () => {
  const { prepareDirectAssistPrompt } = await load();
  const history = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: `turn ${i} `.repeat(400),
  }));
  const file = { fileName: 'design.md', content: `START ${'y'.repeat(20_000)} END-OF-DESIGN` };
  const prepared = prepareDirectAssistPrompt(input({ referenceFiles: [file], history }));
  assert.deepEqual(prepared.shortenedFields, []);
  assert.match(prepared.userPrompt, /END-OF-DESIGN/);
});

test('without an explicit bound the budget is the model input window, less output and reserve', async () => {
  const { buildDirectAssistRequest } = await load();
  const { getModelCapabilities } = await loadCaps();
  const caps = getModelCapabilities('claude-opus-5-5', false);
  const request = buildDirectAssistRequest(input());
  assert.equal(request.maxContextChars, (caps.maxContextTokens - caps.outputBudgetTokens - 1_000) * 4);
  assert.ok(request.maxContextChars > 64_000);
});

test('an explicit maxContextChars still bounds the prompt', async () => {
  const { buildDirectAssistRequest, prepareDirectAssistPrompt } = await load();
  assert.equal(buildDirectAssistRequest(input({ maxContextChars: 40_000 })).maxContextChars, 40_000);
  const prepared = prepareDirectAssistPrompt(input({ referenceFiles: reportersFiles(), maxContextChars: 40_000 }));
  assert.ok(prepared.userPrompt.length <= 40_000);
  assert.deepEqual(prepared.shortenedFields, ['referenceContext']);
});

test('Ollama is sized to the num_ctx Natively requests, not the model\'s native window', async () => {
  const { buildDirectAssistRequest, prepareDirectAssistPrompt } = await load();
  const { getModelCapabilities, ollamaRequestContext } = await loadCaps();
  // llama3.1 is 128k natively but runs at 16 384: a prompt sized to 128k would
  // be cut by the Ollama adapter from the oldest line, mid reference block.
  const model = 'llama3.1:8b';
  const caps = getModelCapabilities(model, true);
  const numCtx = ollamaRequestContext(model);
  assert.ok(numCtx < caps.maxContextTokens, 'fixture must have num_ctx below the native window');

  const selection = { provider: 'ollama', model };
  const request = buildDirectAssistRequest(input({ selection }));
  assert.equal(request.maxContextChars, (numCtx - caps.outputBudgetTokens - 1_000) * 4);
  assert.equal(request.modelInputChars, (numCtx - caps.outputBudgetTokens) * 4);

  const prepared = prepareDirectAssistPrompt(input({ selection, referenceFiles: reportersFiles() }));
  assert.ok(prepared.userPrompt.length <= request.maxContextChars);
  assert.ok(
    Math.ceil(prepared.userPrompt.length / 4) + Math.ceil(prepared.systemPrompt.length / 4) + caps.outputBudgetTokens <= numCtx,
    'system + user + output must fit the num_ctx the request asks for',
  );
});

test('a gateway-reported context window bounds the prompt; it never raises it', async () => {
  const { buildDirectAssistRequest } = await load();
  const { getModelCapabilities } = await loadCaps();
  const selection = { provider: 'litellm', model: 'litellm/qwen2.5-32b' };
  const caps = getModelCapabilities('qwen2.5-32b', false);

  const small = buildDirectAssistRequest(input({ selection, contextWindowTokens: 32_000 }));
  assert.equal(small.maxContextChars, (32_000 - caps.outputBudgetTokens - 1_000) * 4);
  assert.equal(small.modelInputChars, (32_000 - caps.outputBudgetTokens) * 4);

  const huge = buildDirectAssistRequest(input({ selection, contextWindowTokens: 10_000_000 }));
  assert.equal(huge.maxContextChars, (caps.maxContextTokens - caps.outputBudgetTokens - 1_000) * 4);

  for (const bad of [0, -5, Number.NaN, '32000']) {
    const request = buildDirectAssistRequest(input({ selection, contextWindowTokens: bad }));
    assert.equal(request.maxContextChars, huge.maxContextChars, `ignored ${String(bad)}`);
  }
});

test('LLMHelper hands Direct Assist the window a gateway reported, and nothing for other providers', async () => {
  const { LLMHelper } = require(path.resolve(root, 'dist-electron/electron/LLMHelper.js'));
  // Bare prototype: no constructor, so no network, settings or provider clients.
  const helper = Object.create(LLMHelper.prototype);
  helper.litellmModelInputCaps = new Map([['qwen2.5-32b', 32_000]]);
  helper.ninerouterModelInputCaps = new Map([['gemma-3-12b', 8_192]]);

  assert.equal(helper.getDirectAssistContextWindowTokens({ provider: 'litellm', model: 'litellm/qwen2.5-32b' }), 32_000);
  assert.equal(helper.getDirectAssistContextWindowTokens({ provider: 'ninerouter', model: 'ninerouter/gemma-3-12b' }), 8_192);
  assert.equal(helper.getDirectAssistContextWindowTokens({ provider: 'litellm', model: 'litellm/unlisted' }), undefined);
  assert.equal(helper.getDirectAssistContextWindowTokens({ provider: 'claude', model: 'claude-opus-5-5' }), undefined);
});

test('the IPC handler passes the gateway window into the Direct Assist request', async () => {
  const source = fs.readFileSync(path.resolve(root, 'electron/ipcHandlers.ts'), 'utf8');
  assert.match(source, /contextWindowTokens = llmHelper\.getDirectAssistContextWindowTokens\(selection\);/);
  const request = source.slice(source.indexOf('const directRequest: DirectAssistRequestInput'));
  assert.match(request.slice(0, request.indexOf('});')), /\bcontextWindowTokens,/);
});

// ── The Natively API keeps only the first 100 000 chars of a message ─────────
// Measured live on the fix's first version: a ~190 000-char prompt on the
// Natively API answered "the request itself didn't come through", because the
// server cut the CURRENT REQUEST off the end of the message.

test('#795 live: on the Natively API the prompt fits one message, with the question still in it', async () => {
  const { buildDirectAssistRequest, prepareDirectAssistPrompt, NATIVELY_API_MESSAGE_CHAR_CAP } = await load();
  const selection = { provider: 'natively', model: 'natively' };
  assert.equal(buildDirectAssistRequest(input({ selection })).maxContextChars, NATIVELY_API_MESSAGE_CHAR_CAP);
  const prepared = prepareDirectAssistPrompt(input({ selection, referenceFiles: reportersFiles() }));
  assert.ok(prepared.userPrompt.length <= NATIVELY_API_MESSAGE_CHAR_CAP, `prompt was ${prepared.userPrompt.length}`);
  assert.match(
    prepared.userPrompt.slice(0, NATIVELY_API_MESSAGE_CHAR_CAP),
    /How many reference files can you see\?/,
    'what the server keeps must still hold the question',
  );
  // Still more than the old 64 000 bound gave this model.
  assert.ok(prepared.userPrompt.length > 64_000);
});

test('the client cap matches the Natively API server default', async (t) => {
  const serverFile = path.resolve(root, 'natively-api/lib/deepseekProvider.js');
  if (!fs.existsSync(serverFile)) {
    t.skip('natively-api submodule not checked out');
    return;
  }
  const { NATIVELY_API_MESSAGE_CHAR_CAP } = await load();
  const match = fs.readFileSync(serverFile, 'utf8').match(/DEEPSEEK_MSG_CHAR_CAP\s*=\s*Number\(process\.env\.PROVIDER_MSG_CHAR_CAP\)\s*\|\|\s*([\d_]+)/);
  assert.ok(match, 'server cap declaration not found');
  assert.equal(Number(match[1].replace(/_/g, '')), NATIVELY_API_MESSAGE_CHAR_CAP);
});

function ladder(overrides = {}) {
  const { LLMHelper } = require(path.resolve(root, 'dist-electron/electron/LLMHelper.js'));
  const self = Object.create(LLMHelper.prototype);
  Object.assign(self, {
    isLocalOnlyMode: false,
    _client: {}, _groqClient: {}, _openaiClient: {}, _claudeClient: {},
    hasNatively: () => true,
    isProviderDisabled: () => false,
    ...overrides,
  });
  return (request) => LLMHelper.prototype.listDirectAssistRungs.call(self, request).map((r) => r.provider);
}
test('a prompt sized for a bigger model does not fall back to the Natively API', async () => {
  const { NATIVELY_API_MESSAGE_CHAR_CAP } = await load();
  const request = (userPrompt) => ({
    requestId: 'r795',
    selection: { provider: 'claude', model: 'claude-opus-5-5' },
    systemPrompt: 's', userPrompt, imagePaths: [], historyImagePaths: [],
  });
  const fits = ladder()(request('u'.repeat(NATIVELY_API_MESSAGE_CHAR_CAP)));
  assert.equal(fits[0], 'claude');
  assert.ok(fits.includes('natively'), 'a prompt that fits keeps the Natively fallback');
  const tooBig = ladder()(request('u'.repeat(NATIVELY_API_MESSAGE_CHAR_CAP + 1)));
  assert.equal(tooBig[0], 'claude');
  assert.ok(!tooBig.includes('natively'), `ladder was ${tooBig.join(', ')}`);
});

test('the Natively dispatch refuses a prompt the server would cut, and sends one that fits', async () => {
  const { NATIVELY_API_MESSAGE_CHAR_CAP } = await load();
  const { LLMHelper } = require(path.resolve(root, 'dist-electron/electron/LLMHelper.js'));
  const sent = [];
  const self = Object.create(LLMHelper.prototype);
  Object.assign(self, {
    isLocalOnlyMode: false,
    streamWithNatively: async function* (userContent) { sent.push(userContent.length); yield 'ok'; },
  });
  const stream = (userPrompt) => LLMHelper.prototype.streamDirectAssist.call(self, {
    requestId: 'r795',
    selection: { provider: 'natively', model: 'natively' },
    systemPrompt: 's', userPrompt, imagePaths: [], historyImagePaths: [],
  });
  const drain = async (gen) => { for await (const _ of gen) { /* drain */ } };

  await drain(stream('u'.repeat(NATIVELY_API_MESSAGE_CHAR_CAP)));
  assert.deepEqual(sent, [NATIVELY_API_MESSAGE_CHAR_CAP]);
  await assert.rejects(drain(stream('u'.repeat(NATIVELY_API_MESSAGE_CHAR_CAP + 1))), { code: 'CONTEXT_TOO_LARGE' });
  assert.equal(sent.length, 1, 'the oversized prompt must never be sent');
});

// ── A window the app only assumes keeps the old bound ────────────────────────
// Custom endpoints and gateway models no table lists resolve to the cloud
// tier's 128k guess. Before #795 the 64 000 default covered them; sized to the
// guess, a 32k model behind a custom endpoint would be sent a prompt it rejects.

test('only the unknown-model fallback is tagged as an assumed window', async () => {
  const { getModelCapabilities, hasAssumedContextWindow } = await loadCaps();
  assert.equal(hasAssumedContextWindow(getModelCapabilities('my-lmstudio-endpoint', false)), true);
  assert.equal(hasAssumedContextWindow(getModelCapabilities('openrouter/mistralai/mistral-small-3', false)), true);
  assert.equal(hasAssumedContextWindow(getModelCapabilities('claude-opus-5-5', false)), false);
  assert.equal(hasAssumedContextWindow(getModelCapabilities('natively', false)), false);
  assert.equal(hasAssumedContextWindow(getModelCapabilities('openrouter/anthropic/claude-sonnet-5', false)), false);
  assert.equal(hasAssumedContextWindow(getModelCapabilities('llama3.1:8b', true)), false);
  assert.equal(hasAssumedContextWindow({ ...getModelCapabilities('my-lmstudio-endpoint', false) }), false, 'a copy is not tagged');
});

test('a custom endpoint or an unlisted gateway model keeps the 64 000 default', async () => {
  const { buildDirectAssistRequest, prepareDirectAssistPrompt } = await load();
  for (const selection of [
    { provider: 'custom', model: 'my-lmstudio-endpoint' },
    { provider: 'curl', model: 'curl-provider-1' },
    { provider: 'openrouter', model: 'openrouter/mistralai/mistral-small-3' },
    { provider: 'litellm', model: 'litellm/local/qwen-coder-32k' },
  ]) {
    assert.equal(buildDirectAssistRequest(input({ selection })).maxContextChars, 64_000, selection.model);
  }
  const prepared = prepareDirectAssistPrompt(input({
    selection: { provider: 'custom', model: 'my-lmstudio-endpoint' },
    referenceFiles: reportersFiles(),
  }));
  assert.ok(prepared.userPrompt.length <= 64_000);
  // A listed model behind the same gateways gets its full window.
  assert.ok(buildDirectAssistRequest(input({ selection: { provider: 'openrouter', model: 'openrouter/anthropic/claude-sonnet-5' } })).maxContextChars > 64_000);
});

test('a reported window replaces the assumed one, larger or smaller than 64 000 chars', async () => {
  const { buildDirectAssistRequest } = await load();
  const selection = { provider: 'litellm', model: 'litellm/local/qwen-coder-32k' };
  assert.equal(buildDirectAssistRequest(input({ selection, contextWindowTokens: 32_000 })).maxContextChars, (32_000 - 4_000 - 1_000) * 4);
  assert.equal(buildDirectAssistRequest(input({ selection, contextWindowTokens: 8_192 })).maxContextChars, (8_192 - 4_000 - 1_000) * 4);
});
