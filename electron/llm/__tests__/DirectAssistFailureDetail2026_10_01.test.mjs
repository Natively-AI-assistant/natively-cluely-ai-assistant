// Why a provider failed, carried to the overlay (2026-10-01).
//
// The overlay said "X didn't respond" for every fallback, whatever happened: a
// rejected key, a rate limit, a timeout. Main already knew the reason code;
// what it dropped was the HTTP status and the provider's own explanation.
// describeDirectAssistFailure keeps both, and these tests pin what is allowed
// to travel: a status, and one short human line with keys stripped. The
// fixtures are the strings the adapters really throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const distDirectAssist = path.resolve(root, 'dist-electron/electron/direct-assist/index.js');

async function load() {
  return import(pathToFileURL(distDirectAssist).href);
}

async function collect(generator) {
  const events = [];
  let result;
  while (true) {
    const item = await generator.next();
    if (item.done) { result = item.value; break; }
    events.push(item.value);
  }
  return { events, result };
}

function baseInput(overrides = {}) {
  return {
    requestId: 'direct-detail-1',
    source: 'typed',
    selection: { provider: 'openai', model: 'gpt-6' },
    currentRequest: 'What should I say next?',
    ...overrides,
  };
}

function fakeTimers() {
  return {
    set: () => ({}),
    clear: () => {},
  };
}

const withStatus = (status, message) => Object.assign(new Error(message), { status });

// ── the provider's own words ────────────────────────────────────────────────

test('an OpenAI key rejection keeps the status and the sentence, without the key or the leading status number', async () => {
  const { describeDirectAssistFailure } = await load();
  const failure = describeDirectAssistFailure(withStatus(
    401,
    '401 Incorrect API key provided: sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789. You can find your API key at https://platform.openai.com/account/api-keys.',
  ));
  assert.equal(failure.status, 401);
  assert.match(failure.detail, /^Incorrect API key provided: /);
  assert.match(failure.detail, /You can find your API key at/);
  assert.doesNotMatch(failure.detail, /AbCdEfGhIjKl/);
  // The key sat right before a full stop; the gap must not read "….".
  assert.equal(
    failure.detail,
    'Incorrect API key provided: … You can find your API key at https://platform.openai.com/account/api-keys.',
  );
});

test('every common key shape is stripped from the provider words', async () => {
  const { describeDirectAssistFailure } = await load();
  const keys = [
    'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',   // OpenAI project key
    'sk-or-v1-0123456789abcdef0123456789abcdef',      // OpenRouter
    'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz_0123',   // Anthropic
    'sk-AbCdEfGhIjKlMnOpQrStUvWx',                    // classic
    'gsk_AbCdEfGhIjKlMnOpQrStUvWxYz',                 // Groq
    'AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz012',            // Google
    'nvapi-AbCdEfGhIjKlMnOpQrStUvWxYz0123',           // NVIDIA
  ];
  for (const key of keys) {
    const { detail } = describeDirectAssistFailure(withStatus(401, `Invalid key ${key} supplied`));
    assert.ok(detail, `a detail is still shown for ${key.slice(0, 8)}`);
    assert.doesNotMatch(detail, new RegExp(key.slice(6, 20)), `${key.slice(0, 8)}… must not survive`);
  }
  const bearer = describeDirectAssistFailure(withStatus(401, 'Rejected header Authorization: Bearer abcdefghijklmnop.qrstuv'));
  assert.doesNotMatch(bearer.detail, /abcdefghijklmnop/);
  const query = describeDirectAssistFailure(withStatus(400, 'Bad request to https://example.test/v1/chat?key=abcdef0123456789abcdef'));
  assert.doesNotMatch(query.detail, /abcdef0123456789/);
});

test('a JSON error body is reduced to its message', async () => {
  const { describeDirectAssistFailure } = await load();
  // Anthropic SDK: the message is the status plus the raw body.
  const anthropic = describeDirectAssistFailure(withStatus(
    401,
    '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
  ));
  assert.deepEqual({ ...anthropic }, { status: 401, detail: 'invalid x-api-key' });

  // @google/genai: the whole message is the body.
  const google = describeDirectAssistFailure(withStatus(
    429,
    '{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}',
  ));
  assert.deepEqual({ ...google }, { status: 429, detail: 'Resource has been exhausted (e.g. check quota).' });
});

// The next two fixtures are what the installed SDKs really threw for a made-up
// key on 2026-10-01 (openai AuthenticationError, @google/genai ApiError).
test('a key the provider already masked with asterisks is still removed whole', async () => {
  const { describeDirectAssistFailure } = await load();
  const failure = describeDirectAssistFailure(withStatus(
    401,
    '401 Incorrect API key provided: sk-proj-**************************************6789. You can find your API key at https://platform.openai.com/account/api-keys.',
  ));
  assert.equal(
    failure.detail,
    'Incorrect API key provided: … You can find your API key at https://platform.openai.com/account/api-keys.',
  );
});

test('a JSON body wrapped inside another JSON body is still reduced to its sentence', async () => {
  const { describeDirectAssistFailure } = await load();
  const inner = JSON.stringify({
    error: {
      code: 400,
      message: 'API key not valid. Please pass a valid API key.',
      status: 'INVALID_ARGUMENT',
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }],
    },
  }, null, 2);
  const failure = describeDirectAssistFailure(withStatus(
    400,
    JSON.stringify({ error: { message: inner, code: 400, status: 'Bad Request' } }),
  ));
  assert.deepEqual({ ...failure }, { status: 400, detail: 'API key not valid. Please pass a valid API key.' });
});

test('a provider that could not be reached shows WHERE it was looking, never the socket error code', async () => {
  const { describeDirectAssistFailure } = await load();
  // "connect ECONNREFUSED …" is a raw error code with a sentence's worth of
  // nothing around it. The address is the one useful part: it tells someone
  // running Ollama or a custom endpoint which one was not there.
  const refused = describeDirectAssistFailure(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
  assert.deepEqual({ ...refused }, { detail: '127.0.0.1:11434', unreachable: true });
  assert.deepEqual(
    { ...describeDirectAssistFailure(new Error('getaddrinfo EAI_AGAIN my-gateway.internal')) },
    { detail: 'my-gateway.internal', unreachable: true },
  );
  assert.deepEqual(
    { ...describeDirectAssistFailure(new Error('request to https://api.example.test/v1/chat failed, reason: connect ETIMEDOUT 203.0.113.7:443')) },
    { detail: '203.0.113.7:443', unreachable: true },
  );
  // No address in the message: the headline already says all there is.
  assert.deepEqual({ ...describeDirectAssistFailure(new Error('read ECONNRESET')) }, { unreachable: true });
  assert.deepEqual({ ...describeDirectAssistFailure(new Error('socket hang up')) }, { unreachable: true });
  // A provider that answered with a status WAS reached, whatever its words.
  const answered = describeDirectAssistFailure(withStatus(503, '503 upstream connect error or network unavailable'));
  assert.equal('unreachable' in answered, false);
});

test('the older Google SDK wrapper is reduced to the sentence Google wrote', async () => {
  const { describeDirectAssistFailure } = await load();
  const failure = describeDirectAssistFailure(new Error(
    '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:streamGenerateContent?alt=sse: [400 Bad Request] API key not valid. Please pass a valid API key. [{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"API_KEY_INVALID","domain":"googleapis.com"}]',
  ));
  assert.equal(failure.status, 400);
  assert.equal(failure.detail, 'API key not valid. Please pass a valid API key.');
});

test('the Natively API wrapper loses its request ids and endpoint', async () => {
  const { describeDirectAssistFailure } = await load();
  const failure = describeDirectAssistFailure(new Error(
    'Natively API stream HTTP 500 requestId=7f3c-11 serverRequestId=srv-90210 endpoint=https://api.natively.software/v1/chat/stream: upstream model is overloaded',
  ));
  assert.equal(failure.status, 500);
  assert.equal(failure.detail, 'upstream model is overloaded');
});

test('both Ollama wrappers give the status and the daemon message', async () => {
  const { describeDirectAssistFailure } = await load();
  const chat = describeDirectAssistFailure(new Error(
    `Ollama /api/chat 404: {"error":"model 'llama9' not found, try pulling it first"}`,
  ));
  assert.deepEqual({ ...chat }, { status: 404, detail: "model 'llama9' not found, try pulling it first" });

  const generate = describeDirectAssistFailure(new Error(
    `Ollama API error: 404 Not Found {"error":"model 'phi9' not found"}`,
  ));
  assert.deepEqual({ ...generate }, { status: 404, detail: "model 'phi9' not found" });
});

test('a wrapper that carries only a status gives a status and no second line', async () => {
  const { describeDirectAssistFailure } = await load();
  assert.deepEqual({ ...describeDirectAssistFailure(new Error('Custom Provider HTTP 500')) }, { status: 500 });
  assert.deepEqual(
    { ...describeDirectAssistFailure(withStatus(502, 'Custom Provider returned HTTP 502')) },
    { status: 502 },
  );
  // The prose a streaming generator yields instead of throwing.
  assert.deepEqual(
    { ...describeDirectAssistFailure(new Error('Error: Custom Provider returned HTTP 503')) },
    { status: 503 },
  );
  assert.deepEqual({ ...describeDirectAssistFailure(new Error('Error streaming from custom provider.')) }, {});
});

test('a sentence that merely starts with a number is not read as a status', async () => {
  const { describeDirectAssistFailure } = await load();
  assert.deepEqual(
    { ...describeDirectAssistFailure(new Error('500 tokens exceeded the limit for this model')) },
    { detail: '500 tokens exceeded the limit for this model' },
  );
});

test('"fetch failed" is replaced by the reason underneath it', async () => {
  const { describeDirectAssistFailure } = await load();
  const error = new TypeError('fetch failed');
  error.cause = new Error('getaddrinfo ENOTFOUND api.openai.com');
  assert.deepEqual(
    { ...describeDirectAssistFailure(error) },
    { detail: 'api.openai.com', unreachable: true },
  );
});

test('a machine code in front of the provider sentence is dropped', async () => {
  const { describeDirectAssistFailure } = await load();
  assert.equal(
    describeDirectAssistFailure(withStatus(429, 'RESOURCE_EXHAUSTED: Quota exceeded for requests per minute.')).detail,
    'Quota exceeded for requests per minute.',
  );
  assert.equal(
    describeDirectAssistFailure(withStatus(400, '400 invalid_request_error: The model does not support images.')).detail,
    'The model does not support images.',
  );
  // An ordinary word followed by a colon is the provider talking.
  assert.equal(
    describeDirectAssistFailure(withStatus(400, 'Warning: the prompt is too long for this model.')).detail,
    'Warning: the prompt is too long for this model.',
  );
});

test('none of the provider words in this file carry a raw error code', async () => {
  const { describeDirectAssistFailure } = await load();
  const cause = new TypeError('fetch failed');
  cause.cause = new Error('getaddrinfo ENOTFOUND api.openai.com');
  const thrown = [
    withStatus(401, '401 Incorrect API key provided: sk-proj-**************************************6789.'),
    withStatus(401, '401 {"type":"error","error":{"type":"authentication_error","message":"API key is invalid."},"request_id":null}'),
    withStatus(401, '401 {"error":{"message":"Invalid API Key","type":"invalid_request_error","code":"invalid_api_key"}}'),
    withStatus(429, 'RESOURCE_EXHAUSTED: Quota exceeded for requests per minute.'),
    new Error('connect ECONNREFUSED 127.0.0.1:11434'),
    new Error('read ECONNRESET'),
    new Error('Natively API stream HTTP 500 requestId=7f3c-11 serverRequestId=srv-90210 endpoint=https://api.natively.software/v1/chat/stream: upstream model is overloaded'),
    new Error(`Ollama /api/chat 404: {"error":"model 'llama9' not found, try pulling it first"}`),
    cause,
  ];
  for (const error of thrown) {
    const { detail = '' } = describeDirectAssistFailure(error);
    assert.doesNotMatch(detail, /\b[A-Z]+(?:_[A-Z]+)+\b/, `"${detail}" carries a code`);
    assert.doesNotMatch(detail, /\bE[A-Z]{4,}\b/, `"${detail}" carries a socket error code`);
    // A leading status is three digits and a space; "127.0.0.1" is an address.
    assert.doesNotMatch(detail, /\bHTTP \d{3}\b|^\d{3}\s/, `"${detail}" carries a status`);
  }
});

test('the detail is one line, at most 240 characters', async () => {
  const { describeDirectAssistFailure } = await load();
  const long = describeDirectAssistFailure(withStatus(400, `Invalid request:\n\n  ${'word '.repeat(120)}`));
  assert.ok(long.detail.length <= 241, `got ${long.detail.length}`);
  assert.ok(long.detail.endsWith('…'));
  assert.doesNotMatch(long.detail, /\s{2,}|\n/);
});

// ── the request must not come back in the provider's words ──────────────────

const REQUEST = 'Summarise the confidential acquisition of Northwind Traders for 4.2 billion dollars before Friday';

test('a provider that quotes the request back has the quote cut out and keeps its own words', async () => {
  const { describeDirectAssistFailure } = await load();
  const failure = describeDirectAssistFailure(
    withStatus(400, `400 Invalid request: the content "${REQUEST}" was flagged by our safety system. Please rephrase and try again.`),
    { echoOf: ['You are a meeting assistant.', `CURRENT REQUEST:\n${REQUEST}\n`] },
  );
  assert.equal(
    failure.detail,
    'Invalid request: the content "…" was flagged by our safety system. Please rephrase and try again.',
  );
});

test('different case and line breaks do not hide a quote of the request', async () => {
  const { describeDirectAssistFailure } = await load();
  const failure = describeDirectAssistFailure(
    withStatus(400, `Could not process: SUMMARISE THE CONFIDENTIAL   ACQUISITION OF NORTHWIND TRADERS for 4.2 billion — too long.`),
    { echoOf: [`Summarise the confidential\nacquisition of Northwind Traders\nfor 4.2 billion dollars`] },
  );
  assert.doesNotMatch(failure.detail, /northwind|acquisition|confidential/i);
  assert.match(failure.detail, /^Could not process: …/);
  assert.match(failure.detail, /too long\.$/);
});

test('words the provider wrote itself are left alone', async () => {
  const { describeDirectAssistFailure } = await load();
  const sentence = 'Rate limit reached for gpt-6 in organization org-abc on requests per min. Please try again in 20s.';
  const failure = describeDirectAssistFailure(withStatus(429, `429 ${sentence}`), { echoOf: [REQUEST, 'Answer briefly. Please be concise.'] });
  assert.equal(failure.detail, sentence);
});

test('a detail that is nothing but the request is dropped', async () => {
  const { describeDirectAssistFailure } = await load();
  const failure = describeDirectAssistFailure(withStatus(400, `400 ${REQUEST}`), { echoOf: [REQUEST] });
  assert.deepEqual({ ...failure }, { status: 400 });
});

test('the request never reaches the overlay on either event, even when the provider quotes it', async () => {
  const { DirectAssistService } = await load();
  const echoing = () => withStatus(400, `400 Unsupported input: "${REQUEST}" cannot be processed by this model.`);
  const transport = twoRungTransport(echoing);
  const { events } = await collect(new DirectAssistService(transport, {
    timerScheduler: fakeTimers(),
    sleep: async () => {},
  }).stream(baseInput({ currentRequest: REQUEST })));
  const [hop] = events.filter((event) => event.type === 'provider_switch');
  assert.equal(hop.detail, 'Unsupported input: "…" cannot be processed by this model.');
  assert.doesNotMatch(JSON.stringify(hop), /Northwind/);

  const solo = { async *streamDirectAssist() { throw echoing(); } };
  const failed = await collect(new DirectAssistService(solo, {
    timerScheduler: fakeTimers(),
    sleep: async () => {},
  }).stream(baseInput({ currentRequest: REQUEST })));
  assert.equal(failed.events.at(-1).type, 'error');
  assert.doesNotMatch(JSON.stringify(failed.events.at(-1)), /Northwind/);
});

// ── what never becomes a detail ─────────────────────────────────────────────

test('our own canned sentences and the engine sentinels add no second line', async () => {
  const { describeDirectAssistFailure, DirectAssistError, normalizeDirectAssistError } = await load();
  // Every sentence normalizeDirectAssistError can produce says no more than
  // its code does, so repeating it under the reason would be noise.
  const inputs = [
    withStatus(401, 'x'), withStatus(402, 'x'), withStatus(429, 'x'), withStatus(404, 'x'),
    withStatus(500, 'x'), new Error('request timed out'), new Error('client not initialized'), {},
  ];
  for (const input of inputs) {
    const canned = normalizeDirectAssistError(input);
    assert.deepEqual({ ...describeDirectAssistFailure(canned) }, {}, `"${canned.message}" must not be a detail`);
  }
  for (const message of [
    'The selected provider ended the stream without returning an answer.',
    'The selected provider could not start the stream.',
    'No provider answered in time.',
    'The request was cancelled.',
  ]) {
    assert.deepEqual({ ...describeDirectAssistFailure(new DirectAssistError('PROVIDER_ERROR', message)) }, {});
  }
  assert.deepEqual({ ...describeDirectAssistFailure(new Error('empty-stream')) }, {});
  assert.deepEqual({ ...describeDirectAssistFailure(new Error('interchunk-stall')) }, {});
  assert.deepEqual({ ...describeDirectAssistFailure(Object.assign(new Error('aborted'), { name: 'AbortError' })) }, {});
  assert.deepEqual({ ...describeDirectAssistFailure(undefined) }, {});
});

test('our own specific explanation is kept, because the reason alone would hide it', async () => {
  const { describeDirectAssistFailure, DirectAssistError } = await load();
  assert.deepEqual(
    { ...describeDirectAssistFailure(new DirectAssistError('PROVIDER_ERROR', 'Cloud providers are disabled in local-only mode.')) },
    { detail: 'Cloud providers are disabled in local-only mode.' },
  );
  const antigravity = Object.assign(new Error('token revoked'), { name: 'AntigravityError', code: 'auth_revoked' });
  assert.deepEqual(
    { ...describeDirectAssistFailure(antigravity) },
    { detail: 'Sign in to Google Antigravity again in Settings → AI Providers.' },
  );
});

test('an exhausted ladder is described by the first provider error, like its reason code', async () => {
  const { describeDirectAssistFailure } = await load();
  const aggregate = new Error('All vision providers failed: openai attempt 1/2: auth | gemini attempt 1/1: timeout');
  aggregate.firstProviderError = withStatus(401, '401 Incorrect API key provided.');
  assert.deepEqual(
    { ...describeDirectAssistFailure(aggregate) },
    { status: 401, detail: 'Incorrect API key provided.' },
  );
});

// ── carried on the events ───────────────────────────────────────────────────

function twoRungTransport(firstRungError, { onAttempt } = {}) {
  return {
    listDirectAssistRungs: () => ([
      { provider: 'openai', model: 'gpt-6', priority: 0, isFallback: false },
      { provider: 'gemini', model: 'gemini-3.7-flash', priority: 1, isFallback: true },
    ]),
    async *streamDirectAssist(_request, _signal, rung) {
      if (rung.priority === 0) {
        onAttempt?.();
        throw firstRungError();
      }
      yield 'answer';
    },
  };
}

test('a switch says why the provider was left: status, its words, and how long it was given', async () => {
  const { DirectAssistService } = await load();
  let clock = 1_000;
  const transport = twoRungTransport(
    () => withStatus(429, '429 Rate limit reached for gpt-6 in organization org-abc on requests per min.'),
    { onAttempt: () => { clock += 4_000; } },
  );
  const { events, result } = await collect(new DirectAssistService(transport, {
    timerScheduler: fakeTimers(),
    sleep: async () => {},
    now: () => clock,
  }).stream(baseInput()));

  assert.equal(result.state, 'complete');
  const [hop] = events.filter((event) => event.type === 'provider_switch');
  assert.equal(hop.reason, 'RATE_LIMITED');
  assert.equal(hop.status, 429);
  assert.equal(hop.detail, 'Rate limit reached for gpt-6 in organization org-abc on requests per min.');
  // Two attempts on the selected provider, four seconds each.
  assert.equal(hop.waitedMs, 8_000);
});

test('a provider that simply never answered has no words to show, only the wait', async () => {
  const { DirectAssistService } = await load();
  const transport = {
    listDirectAssistRungs: () => ([
      { provider: 'openai', model: 'gpt-6', priority: 0, isFallback: false },
      { provider: 'gemini', model: 'gemini-3.7-flash', priority: 1, isFallback: true },
    ]),
    async *streamDirectAssist(_request, signal, rung) {
      if (rung.priority === 0) {
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        // Debris thrown on the way out of an abort is not the provider talking.
        throw new Error('socket hang up while aborting');
      }
      yield 'answer';
    },
  };
  const { events } = await collect(new DirectAssistService(transport, {
    sleep: async () => {},
    fallbackConfigOverrides: { ttftTimeoutMs: 20 },
  }).stream(baseInput()));

  const [hop] = events.filter((event) => event.type === 'provider_switch');
  assert.equal(hop.reason, 'CONNECT_TIMEOUT');
  assert.equal('detail' in hop, false);
  assert.equal('status' in hop, false);
  assert.ok(hop.waitedMs >= 20, `waited ${hop.waitedMs}ms`);
});

test('a failed answer carries the same status and words on its error, and the canned message is unchanged', async () => {
  const { DirectAssistService } = await load();
  const transport = {
    async *streamDirectAssist() {
      throw withStatus(401, '401 Incorrect API key provided: sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789.');
    },
  };
  const { events, result } = await collect(new DirectAssistService(transport, {
    timerScheduler: fakeTimers(),
    sleep: async () => {},
  }).stream(baseInput()));

  const terminal = events.at(-1);
  assert.equal(terminal.type, 'error');
  assert.equal(terminal.error.code, 'AUTH_FAILED');
  assert.equal(terminal.error.message, 'The selected provider rejected its credentials.');
  assert.equal(terminal.error.status, 401);
  assert.match(terminal.error.detail, /^Incorrect API key provided: /);
  assert.doesNotMatch(terminal.error.detail, /AbCdEfGhIjKl/);
  assert.deepEqual(result.error, terminal.error);
});

test('when every provider fails, no switch is announced and the one error is about the selected provider', async () => {
  const { DirectAssistService } = await load();
  // The overlay words the error against the provider it was told started. If
  // main announced switches here, the card would show the same cause twice
  // and a "trying…" line for a request that is already over.
  const transport = {
    listDirectAssistRungs: () => ([
      { provider: 'openai', model: 'gpt-6', priority: 0, isFallback: false },
      { provider: 'gemini', model: 'gemini-3.7-flash', priority: 1, isFallback: true },
    ]),
    async *streamDirectAssist(_request, _signal, rung) {
      throw rung.priority === 0
        ? withStatus(401, '401 Incorrect API key provided.')
        : withStatus(503, '503 The model is overloaded.');
    },
  };
  const { events } = await collect(new DirectAssistService(transport, {
    timerScheduler: fakeTimers(),
    sleep: async () => {},
  }).stream(baseInput()));

  assert.deepEqual(events.map((event) => event.type), ['start', 'error']);
  assert.equal(events[0].provider, 'openai');
  assert.equal(events[1].error.code, 'AUTH_FAILED');
  assert.equal(events[1].error.status, 401);
  assert.equal(events[1].error.detail, 'Incorrect API key provided.');
});

test('when every provider fails, the error lists each one with its own reason, in the order tried', async () => {
  const { DirectAssistService } = await load();
  let clock = 0;
  const transport = {
    listDirectAssistRungs: () => ([
      { provider: 'openai', model: 'gpt-6', priority: 0, isFallback: false },
      { provider: 'gemini', model: 'gemini-3.7-flash', priority: 1, isFallback: true },
      { provider: 'ollama', model: 'llama3.2:3b', priority: 2, isFallback: true },
    ]),
    async *streamDirectAssist(_request, _signal, rung) {
      clock += 1_000;
      if (rung.priority === 0) throw withStatus(401, '401 Incorrect API key provided.');
      if (rung.priority === 1) throw withStatus(503, '503 The model is overloaded.');
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    },
  };
  const { events, result } = await collect(new DirectAssistService(transport, {
    timerScheduler: fakeTimers(),
    sleep: async () => {},
    now: () => clock,
  }).stream(baseInput()));

  const { error } = events.at(-1);
  // The headline fields still describe the provider the user selected.
  assert.equal(error.code, 'AUTH_FAILED');
  assert.equal(error.message, 'The selected provider rejected its credentials.');
  assert.deepEqual(error.attempts.map((attempt) => ({ ...attempt })), [
    // One attempt each: a rejected key is not retried, and a fallback gets one.
    { provider: 'openai', model: 'gpt-6', reason: 'AUTH_FAILED', status: 401, detail: 'Incorrect API key provided.', waitedMs: 1_000 },
    { provider: 'gemini', model: 'gemini-3.7-flash', reason: 'PROVIDER_ERROR', status: 503, detail: 'The model is overloaded.', waitedMs: 1_000 },
    { provider: 'ollama', model: 'llama3.2:3b', reason: 'PROVIDER_ERROR', detail: '127.0.0.1:11434', unreachable: true, waitedMs: 1_000 },
  ]);
  assert.deepEqual(result.error, error);
});

test('one provider failing on its own adds no list', async () => {
  const { DirectAssistService } = await load();
  const transport = { async *streamDirectAssist() { throw withStatus(401, '401 Incorrect API key provided.'); } };
  const { events } = await collect(new DirectAssistService(transport, {
    timerScheduler: fakeTimers(),
    sleep: async () => {},
  }).stream(baseInput()));
  assert.equal('attempts' in events.at(-1).error, false);
});

test('a provider the time budget never let open is not listed as having failed', async () => {
  const { DirectAssistService } = await load();
  // The engine announces a rung just BEFORE opening it; the budget can still
  // refuse the open. That rung said nothing and did nothing.
  let clock = 0;
  const opened = [];
  const transport = {
    listDirectAssistRungs: () => ([
      { provider: 'openai', model: 'gpt-6', priority: 0, isFallback: false },
      { provider: 'gemini', model: 'gemini-3.7-flash', priority: 1, isFallback: true },
    ]),
    async *streamDirectAssist(_request, _signal, rung) {
      opened.push(rung.provider);
      clock += 60_000;
      throw withStatus(503, '503 The model is overloaded.');
    },
  };
  const { events } = await collect(new DirectAssistService(transport, {
    timerScheduler: fakeTimers(),
    sleep: async () => {},
    now: () => clock,
  }).stream(baseInput()));

  assert.ok(!opened.includes('gemini'), 'the budget ran out before the fallback could open');
  const { error } = events.at(-1);
  assert.equal(error.code, 'CONNECT_TIMEOUT');
  assert.equal('attempts' in error, false, 'only one provider was actually tried');
});

test('an answer that was cut off partway carries no list of attempts', async () => {
  const { DirectAssistService } = await load();
  const transport = {
    listDirectAssistRungs: () => ([
      { provider: 'openai', model: 'gpt-6', priority: 0, isFallback: false },
      { provider: 'gemini', model: 'gemini-3.7-flash', priority: 1, isFallback: true },
    ]),
    async *streamDirectAssist(_request, _signal, rung) {
      if (rung.priority === 0) throw withStatus(401, '401 Incorrect API key provided.');
      yield 'Open with the timeline, then';
      throw withStatus(503, '503 The model is overloaded.');
    },
  };
  const { events } = await collect(new DirectAssistService(transport, {
    timerScheduler: fakeTimers(),
    sleep: async () => {},
  }).stream(baseInput()));
  const terminal = events.at(-1);
  assert.equal(terminal.type, 'error');
  assert.equal(terminal.partial, true);
  // The switch was already announced; the error is the fallback's own.
  assert.equal(events.filter((event) => event.type === 'provider_switch').length, 1);
  assert.equal('attempts' in terminal.error, false);
  assert.equal(terminal.error.detail, 'The model is overloaded.');
});

test('a failure with nothing to add keeps the exact old error shape', async () => {
  const { DirectAssistService } = await load();
  const transport = { async *streamDirectAssist() { /* ends with no token */ } };
  const { events } = await collect(new DirectAssistService(transport, {
    timerScheduler: fakeTimers(),
    sleep: async () => {},
  }).stream(baseInput()));
  assert.deepEqual(Object.keys(events.at(-1).error).sort(), ['code', 'message', 'retryable']);
});

// ── where the words may go ──────────────────────────────────────────────────

test('the provider words leave main only on the Direct Assist event, never through a log or a store', () => {
  const service = fs.readFileSync(path.resolve(root, 'electron/direct-assist/DirectAssistService.ts'), 'utf8');
  assert.doesNotMatch(service, /console\.(log|warn|error|info)\(/, 'the service logs nothing itself');

  const handlers = fs.readFileSync(path.resolve(root, 'electron/ipcHandlers.ts'), 'utf8');
  const start = handlers.indexOf('for await (const streamEvent of service.stream(directRequest, controller.signal))');
  const end = handlers.indexOf("'direct-assist-cancel'", start);
  assert.ok(start >= 0 && end > start, 'the Direct Assist stream loop is where it was');
  const loop = handlers.slice(start, end);
  // The loop forwards events to the window that asked and does nothing else
  // with them: no log line, no telemetry, no history write.
  assert.doesNotMatch(loop, /console\.(log|warn|error|info)\([^)]*streamEvent/);
  assert.doesNotMatch(loop, /\.detail\b/);
  assert.doesNotMatch(loop, /telemetry|recordUsage|logInteraction|addAssistantMessage|phoneMirror/i);
});
