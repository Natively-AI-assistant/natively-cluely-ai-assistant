/**
 * Ollama and screenshots that must stay on the machine (2026-10-01).
 *
 * Two things, both on one resolver (LLMHelper.refreshOllamaVisionModel:
 * /api/tags + /api/show, cached):
 *
 *  1. "Keep screenshots on this device", and a denied `screenshots` scope,
 *     decided whether local vision exists from the SELECTED model's NAME, then
 *     sent the image to that model. A user on a text model with a vision model
 *     installed was refused; a vision model whose name is not on the list was
 *     refused too (defect 4).
 *  2. After a screenshot answer, the Ollama model writes the screen's text
 *     record when no cloud provider does (Evin's rule).
 *
 * No Ollama is installed where this runs. A fake Ollama HTTP server stands in,
 * and the requests are asserted ON THE WIRE: the model named, the image bytes.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  fakeOllama, helper, ask, png, pngBase64, setMode, setScopes, fakeCredentials, isolateSingletons,
  userData, dist, require, LLMHelper, CRED_SLOT,
} from './fakeOllamaHarness.mjs';

const { PRIVATE_VISION_NO_LOCAL_MESSAGE } = require(dist('llm/visionPolicy.js'));
const { renderDigitsPng } = require(dist('llm/visionTestImage.js'));
isolateSingletons();

// ── 1. Keep on device, and a denied screenshots scope ────────────────────────

describe('"Keep screenshots on this device": the screenshot goes to the Ollama model that reads images', () => {
  let ollama; let url;
  const boot = async (models, opts) => { ollama = fakeOllama(models, opts); url = await ollama.start(); };
  afterEach(async () => { await ollama?.stop(); ollama = null; });
  beforeEach(() => { fakeCredentials(); setScopes({}); });

  test('a text model is selected and a vision model is installed: the vision model answers, with the image', async () => {
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true });
    setMode('private_vision');
    const h = helper(url, 'qwen2.5:4b');
    const out = await ask(h, 'what is on my screen?', [png]);
    assert.notEqual(out, PRIVATE_VISION_NO_LOCAL_MESSAGE, 'refused although an installed local model reads images');
    assert.equal(out, 'local model reply');
    const chat = ollama.chats();
    assert.equal(chat.length, 1);
    assert.equal(chat[0].body.model, 'llava:7b', 'the model the check found must be the model the image is sent to');
    assert.deepEqual(chat[0].body.messages.at(-1).images, [pngBase64]);
    assert.deepEqual(h.cloud, [], 'nothing cloud');
    assert.equal(h.ollamaModel, 'qwen2.5:4b', 'the selected text model is not replaced by the vision model');
  });
  test('the selected model reads images but its name is on no list: /api/show is believed', async () => {
    await boot({ 'acme-sight:latest': true });
    setMode('private_vision');
    const out = await ask(helper(url, 'acme-sight:latest'), 'what is on my screen?', [png]);
    assert.equal(out, 'local model reply');
    assert.equal(ollama.chats()[0].body.model, 'acme-sight:latest');
  });
  test('no installed model reads images: refused as before, and nothing is sent', async () => {
    await boot({ 'qwen2.5:4b': false, 'mistral:7b': false });
    setMode('private_vision');
    const h = helper(url, 'qwen2.5:4b');
    assert.equal(await ask(h, 'what is on my screen?', [png]), PRIVATE_VISION_NO_LOCAL_MESSAGE);
    assert.equal(ollama.chats().length, 0);
    assert.deepEqual(h.cloud, []);
  });
  test('a text turn in that mode still goes to the selected text model', async () => {
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true });
    setMode('private_vision');
    const h = helper(url, 'qwen2.5:4b');
    // The text route's failover wrapper needs the whole text engine; reduced
    // here to "open the selected provider" so the REAL adapter's request is seen.
    h.streamSelectedProviderWithFailover = async function* (rung) { yield* rung.open(new AbortController().signal); };
    await ask(h, 'hello', undefined);
    const chats = ollama.chats();
    assert.ok(chats.length >= 1, 'the text turn reached Ollama');
    assert.ok(chats.every((c) => c.body.model === 'qwen2.5:4b'), `models asked: ${chats.map((c) => c.body.model)}`);
  });
});

describe('an Ollama on ANOTHER machine (OLLAMA_URL)', () => {
  // Evin, 2026-10-01: keep what was allowed before — a remote Ollama may take a
  // keep-on-device screenshot when the SELECTED model itself reads images. What
  // this phase added (any OTHER installed model that reads images) applies only
  // to a daemon on this machine or the local network.
  //
  // The fake listens on loopback; `fetch` is redirected so the helper believes
  // it is talking to a public host.
  let ollama; let realFetch;
  const REMOTE = 'http://ollama.example.com:11434';
  const remoteHelper = async (models, selected) => {
    ollama = fakeOllama(models);
    const local = await ollama.start();
    realFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => realFetch(String(input).replace(REMOTE, local), init);
    return helper(REMOTE, selected);
  };
  afterEach(async () => { if (realFetch) globalThis.fetch = realFetch; realFetch = null; await ollama?.stop(); ollama = null; });
  beforeEach(() => { fakeCredentials(); setScopes({}); });

  test('keep on device, a TEXT model selected: refused, even though another model there reads images', async () => {
    setMode('private_vision');
    const h = await remoteHelper({ 'qwen2.5:4b': false, 'llava:7b': true }, 'qwen2.5:4b');
    assert.equal(await ask(h, 'what is on my screen?', [png]), PRIVATE_VISION_NO_LOCAL_MESSAGE);
    assert.equal(ollama.chats().length, 0, `the new "any installed model" rule must not reach ${REMOTE}`);
    assert.equal(await h.scopeFallbackAvailable(true), false);
  });
  test('keep on device, the selected model reads images: allowed as before, and it is the SELECTED model that answers', async () => {
    setMode('private_vision');
    const h = await remoteHelper({ 'llava:7b': true, 'bakllava:latest': true }, 'bakllava:latest');
    assert.equal(await ask(h, 'what is on my screen?', [png]), 'local model reply');
    const chat = ollama.chats();
    assert.equal(chat.length, 1);
    assert.equal(chat[0].body.model, 'bakllava:latest');
    assert.deepEqual(chat[0].body.messages.at(-1).images, [pngBase64]);
    assert.equal(await h.scopeFallbackAvailable(true), true, 'the indicator answers as it did before');
  });
  test('the old rule judged the selected model by its NAME, and still does for a remote daemon', async () => {
    setMode('private_vision');
    const h = await remoteHelper({ 'acme-sight:latest': true }, 'acme-sight:latest');
    assert.equal(await ask(h, 'what is on my screen?', [png]), PRIVATE_VISION_NO_LOCAL_MESSAGE, 'a name on no list was refused before; a remote daemon gets nothing new');
    assert.equal(ollama.chats().length, 0);
  });
  test('text fallback is unaffected', async () => {
    const h = await remoteHelper({ 'qwen2.5:4b': false }, 'qwen2.5:4b');
    assert.equal(await h.scopeFallbackAvailable(false), true);
  });
});

describe('customProviderIsLocal', () => {
  const { customProviderIsLocal } = require(dist('llm/visionCapability.js'));
  test('IPv6 loopback is this machine', () => {
    assert.equal(customProviderIsLocal({ curlCommand: 'curl http://[::1]:11434/api/chat' }), true);
    assert.equal(customProviderIsLocal({ curlCommand: 'http://[::1]:11434' }), true);
  });
  test('a public IPv6 address, and every host it already refused, are not', () => {
    for (const url of ['http://[2001:db8::1]:11434', 'http://ollama.example.com:11434', 'http://100.64.0.3:11434', '127.0.0.1:11434']) {
      assert.equal(customProviderIsLocal({ curlCommand: url }), false, url);
    }
  });
});

describe('screenshots scope denied, Ollama selected', () => {
  let ollama; let url;
  afterEach(async () => { await ollama?.stop(); ollama = null; setScopes({}); });
  beforeEach(() => { fakeCredentials(); setMode('vision_first'); });

  test('a screenshot turn goes to the installed vision model, not the selected text model', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false, 'llava:7b': true }); url = await ollama.start();
    setScopes({ screenshots: false });
    const h = helper(url, 'qwen2.5:4b');
    assert.equal(await ask(h, 'what is on my screen?', [png]), 'local model reply');
    const chat = ollama.chats();
    assert.equal(chat.length, 1);
    assert.equal(chat[0].body.model, 'llava:7b');
    assert.deepEqual(chat[0].body.messages.at(-1).images, [pngBase64]);
    assert.deepEqual(h.cloud, []);
  });
});

describe('the Privacy panel\'s "local vision available" indicator', () => {
  let ollama;
  afterEach(async () => { await ollama?.stop(); ollama = null; });
  // Scopes and mode persist in the settings file: reset what the previous block denied.
  beforeEach(() => { fakeCredentials(); setScopes({}); setMode('vision_first'); });

  test('true when ANY installed model reads images; false when none does; never rewrites the selection', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false, 'llava:7b': true });
    const h = helper(await ollama.start(), 'qwen2.5:4b');
    assert.equal(await h.scopeFallbackAvailable(true), true);
    assert.equal(await h.scopeFallbackAvailable(false), true);
    assert.equal(h.ollamaModel, 'qwen2.5:4b');
    await ollama.stop();
    ollama = fakeOllama({ 'qwen2.5:4b': false });
    const none = helper(await ollama.start(), 'qwen2.5:4b');
    assert.equal(await none.scopeFallbackAvailable(true), false);
    assert.equal(await none.scopeFallbackAvailable(false), true, 'text fallback is still available');
  });
  test('Ollama not selected: no request is made to any daemon', async () => {
    ollama = fakeOllama({ 'llava:7b': true });
    const h = Object.assign(helper(await ollama.start(), 'llava:7b'), { useOllama: false });
    assert.equal(await h.scopeFallbackAvailable(true), false);
    assert.equal(ollama.requests.length, 0);
  });
  test('fails CLOSED: a daemon that lists models but cannot describe them is not "local vision available"', async () => {
    // With /api/show failing the resolver falls back to the model's NAME, and
    // `llava` looks like a vision model. A guess must not light the indicator
    // or admit a screenshot: the answer has to be confirmed by the daemon.
    ollama = fakeOllama({ 'llava:7b': true }, { showFails: true });
    const h = helper(await ollama.start(), 'llava:7b');
    assert.equal(await h.scopeFallbackAvailable(true), false);
    setMode('private_vision');
    assert.equal(await ask(h, 'what is on my screen?', [png]), PRIVATE_VISION_NO_LOCAL_MESSAGE);
    assert.equal(ollama.chats().length, 0);
  });
  test('the remembered vision model was uninstalled: refused once, forgotten, and the next check finds the new one', async () => {
    const models = { 'qwen2.5:4b': false, 'llava:7b': true };
    ollama = fakeOllama(models);
    const h = helper(await ollama.start(), 'qwen2.5:4b');
    assert.equal(await h.scopeFallbackAvailable(true), true);
    delete models['llava:7b']; models['bakllava:latest'] = true;       // `ollama rm llava:7b && ollama pull bakllava`
    assert.equal(await h.scopeFallbackAvailable(true), false, 'the remembered model is gone: not available');
    assert.equal(await h.scopeFallbackAvailable(true), true, 'and it is looked up again, not remembered as gone');
    assert.equal(h.getOllamaRecordTarget().model, 'bakllava:latest');
  });
});

// ── 2. The Ollama model writes the after-the-answer screen record ────────────

const { getScreenUnderstandingService, OLLAMA_RECORD_BUDGET_MS } = require(dist('services/screen/ScreenUnderstandingService.js'));
const { composeScreenDescription } = require(dist('services/screen/screenDescription.js'));
const SYSTEM = 'Extract what is on the screen.';

describe('runVisionRequest("ollama"): the record request, on the wire', () => {
  let ollama;
  afterEach(async () => { await ollama?.stop(); ollama = null; });
  beforeEach(() => fakeCredentials());

  test('the resolved vision model, the image and the system prompt', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false, 'llava:7b': true }, { reply: 'A terminal with a build error.' });
    const url = await ollama.start();
    const h = helper(url, 'qwen2.5:4b');
    assert.equal(h.getOllamaRecordTarget(), null, 'nothing is known before the resolver has run');
    assert.deepEqual(await h.resolveOllamaRecordTarget(), { model: 'llava:7b', url });
    assert.deepEqual(h.getOllamaRecordTarget(), { model: 'llava:7b', url });
    assert.equal(await h.runVisionRequest('ollama', 'What is on the screen?', SYSTEM, png, {}), 'A terminal with a build error.');
    const [chat] = ollama.chats();
    assert.equal(chat.body.model, 'llava:7b');
    assert.deepEqual(chat.body.messages.at(-1).images, [pngBase64]);
    assert.equal(chat.body.messages[0].content, SYSTEM);
    assert.equal(h.ollamaModel, 'qwen2.5:4b');
  });
  test('no model that reads images: no target, and the request is refused before it is made', async () => {
    ollama = fakeOllama({ 'qwen2.5:4b': false });
    const h = helper(await ollama.start(), 'qwen2.5:4b');
    assert.equal(await h.resolveOllamaRecordTarget(), null);
    await assert.rejects(() => h.runVisionRequest('ollama', 'u', SYSTEM, png, {}), /No local model that reads images/);
    assert.equal(ollama.chats().length, 0);
  });
  test('Ollama not selected: no target and no request to any daemon', async () => {
    ollama = fakeOllama({ 'llava:7b': true });
    const h = Object.assign(helper(await ollama.start(), 'llava:7b'), { useOllama: false });
    assert.equal(await h.resolveOllamaRecordTarget(), null);
    assert.equal(ollama.requests.length, 0);
  });
});

describe('the screen record through the service', () => {
  let ollama; let h; let n = 0;
  const svc = getScreenUnderstandingService();
  const cloudKeys = (keys) => {
    const has = (k) => (keys.includes(k) ? `key-${k}` : undefined);
    globalThis[CRED_SLOT] = {
      getDisabledProviders: () => [], anyVisionProviderConfigured: () => true, anyLocalVisionProviderConfigured: () => false,
      getNativelyApiKey: () => undefined, getOpenaiApiKey: () => undefined, getGeminiApiKey: () => has('gemini'), getClaudeApiKey: () => undefined,
      getGroqApiKey: () => undefined, getDeepseekApiKey: () => undefined, getOpenrouterApiKey: () => undefined, getNvidiaNimApiKey: () => undefined,
      getFluxionApiKey: () => undefined, getAgentRouterApiKey: () => undefined, getLitellmBaseURL: () => undefined, getNinerouterBaseURL: () => undefined,
      getNinerouterVisionModels: () => [], getAllCredentials: () => ({}),
    };
  };
  const boot = async (models, opts, selected = 'qwen2.5:4b') => {
    ollama = fakeOllama(models, opts);
    h = helper(await ollama.start(), selected);
    globalThis.__nativelyGetLLMHelper = () => h;
  };
  const understand = (userAction, mode = 'vision_first') => {
    const shot = path.join(userData, `record-${++n}.png`);
    fs.writeFileSync(shot, renderDigitsPng(String(2000 + n)));          // a new image each time: no cache hit
    return svc.understand({ imagePaths: [shot], userAction, transcript: 'q', screenUnderstandingMode: mode, providerPolicy: { allowScreenshots: true, localOnly: mode === 'private_vision' } });
  };
  beforeEach(() => { cloudKeys([]); svc.rungHealth.clear(); });
  afterEach(async () => { delete globalThis.__nativelyGetLLMHelper; await ollama?.stop(); ollama = null; });

  test('no cloud provider: the Ollama vision model writes the record', async () => {
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true }, { reply: 'FATAL: disk quota exceeded (code E4012).' });
    const result = await understand('transcribe');
    assert.equal(result.status, 'available');
    assert.equal(result.providerUsed, 'ollama');
    assert.match(composeScreenDescription(result), /E4012/, 'the text a later turn will quote');
    assert.equal(ollama.chats()[0].body.model, 'llava:7b');
  });
  test('"keep on this device": the record stays local, written by Ollama', async () => {
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true }, { reply: 'A login form.' });
    cloudKeys(['gemini']);
    const cloud = [];
    const real = h.runVisionRequest;
    h.runVisionRequest = function (id, ...rest) { if (id !== 'ollama') { cloud.push(id); return Promise.resolve('CLOUD'); } return real.call(this, id, ...rest); };
    const result = await understand('transcribe', 'private_vision');
    assert.equal(result.providerUsed, 'ollama');
    assert.deepEqual(cloud, [], 'no cloud provider may be asked in this mode');
  });
  test('a cloud provider is available: it writes the record, and Ollama is not asked', async () => {
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true });
    cloudKeys(['gemini']);
    const real = h.runVisionRequest;
    h.runVisionRequest = function (id, ...rest) { return id === 'ollama' ? real.call(this, id, ...rest) : Promise.resolve('Cloud transcription of the screen.'); };
    const result = await understand('transcribe');
    assert.equal(result.providerUsed, 'gemini_flash_lite');
    assert.equal(ollama.chats().length, 0);
  });
  test('every cloud provider fails: Ollama still writes it', async () => {
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true }, { reply: 'A stack trace.' });
    cloudKeys(['gemini']);
    const real = h.runVisionRequest;
    h.runVisionRequest = function (id, ...rest) { return id === 'ollama' ? real.call(this, id, ...rest) : Promise.reject(Object.assign(new Error('503 unavailable'), { status: 503 })); };
    assert.equal((await understand('transcribe')).providerUsed, 'ollama');
  });
  test('the PRE-PASS never asks Ollama: it runs before the answer, inside 6 seconds', async () => {
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true });
    // The record target is resolved FIRST (test audit, 2026-10-01): on a fresh
    // helper the Ollama rung is unconfigured whatever the purpose rule says, so
    // without this the test passed with that rule deleted.
    assert.deepEqual(await h.resolveOllamaRecordTarget(), { model: 'llava:7b', url: h.ollamaUrl });
    for (const action of ['what_to_say', 'what_to_answer', 'manual_use_screen']) {
      const result = await understand(action);
      assert.notEqual(result.status, 'available', action);
    }
    assert.equal(ollama.chats().length, 0);
  });
  test('whatever shape the local model answers in, a record is kept', async () => {
    for (const reply of [
      JSON.stringify({ visibleSummary: 'A build log.', extractedText: 'error TS2345 at src/app.ts:12' }),
      'The screen shows a build log. Line 12 reports error TS2345 in src/app.ts.',
      '```json\n' + JSON.stringify({ visibleSummary: 'A build log.', extractedText: 'error TS2345 at src/app.ts:12' }) + '\n```',
    ]) {
      await boot({ 'llava:7b': true }, { reply }, 'llava:7b');
      const text = composeScreenDescription(await understand('transcribe'));
      assert.match(text, /TS2345/, `lost for reply: ${reply.slice(0, 40)}`);
      assert.doesNotMatch(text, /```json/, 'a fenced JSON reply is unwrapped, not stored as raw markup');
      await ollama.stop(); ollama = null; svc.rungHealth.clear();
    }
  });
  test('a record that failed or was cancelled is tried again for the same screen; a failed PRE-PASS is still remembered', async () => {
    // The service remembers its last result per image for 5 minutes. A failure
    // remembered for the RECORD meant a screen whose record was cancelled by a
    // quick follow-up was never recorded, however often it was captured again.
    await boot({ 'llava:7b': true }, { reply: 'FATAL E4012' }, 'llava:7b');
    const shot = path.join(userData, 'same-screen.png');
    fs.writeFileSync(shot, renderDigitsPng('7777'));
    const ask = (userAction) => svc.understand({ imagePaths: [shot], userAction, transcript: 'q', screenUnderstandingMode: 'vision_first', providerPolicy: { allowScreenshots: true } });
    const real = h.runVisionRequest;
    h.runVisionRequest = () => Promise.reject(new Error('The screen record was cancelled'));
    assert.notEqual((await ask('transcribe')).status, 'available');
    h.runVisionRequest = real; svc.rungHealth.clear();
    const again = await ask('transcribe');
    assert.equal(again.status, 'available', 'the failed record was served from memory instead of being tried again');
    assert.match(composeScreenDescription(again), /E4012/);
    const chatsAfterRecord = ollama.chats().length;
    assert.equal((await ask('transcribe')).status, 'available');
    assert.equal(ollama.chats().length, chatsAfterRecord, 'a record that SUCCEEDED is remembered: no second request for the same screen');
    // The pre-pass keeps remembering a failure: retrying it would add its wait to every answer.
    cloudKeys(['gemini']);
    let cloudCalls = 0;
    h.runVisionRequest = function (id, ...rest) { if (id === 'ollama') return real.call(this, id, ...rest); cloudCalls++; return Promise.reject(Object.assign(new Error('503'), { status: 503 })); };
    const pre = path.join(userData, 'prepass-screen.png');
    fs.writeFileSync(pre, renderDigitsPng('8888'));
    h.useOllama = false;                                              // a cloud selection, so the pre-pass has cloud rungs
    const prepass = () => svc.understand({ imagePaths: [pre], userAction: 'what_to_say', transcript: 'q', screenUnderstandingMode: 'vision_first', providerPolicy: { allowScreenshots: true } });
    await prepass();
    const after = cloudCalls;
    assert.ok(after > 0, 'the pre-pass really tried a cloud rung');
    await prepass();
    assert.equal(cloudCalls, after, 'a failed pre-pass is not retried for the same screen');
  });
  test('the record gets its own time limit, far longer than the pre-pass', async () => {
    assert.ok(OLLAMA_RECORD_BUDGET_MS >= 30_000 && OLLAMA_RECORD_BUDGET_MS <= 60_000, String(OLLAMA_RECORD_BUDGET_MS));
    // …and the second stage is really GIVEN it (the constant alone proves
    // nothing): the timers the chain arms are observed. A cloud rung fails
    // inside the pre-pass's 6 s; then Ollama's attempt is armed with 45 s.
    await boot({ 'qwen2.5:4b': false, 'llava:7b': true }, { reply: 'A terminal.' });
    cloudKeys(['gemini']);
    const real = h.runVisionRequest;
    h.runVisionRequest = function (id, ...rest) { return id === 'ollama' ? real.call(this, id, ...rest) : Promise.reject(Object.assign(new Error('503 unavailable'), { status: 503 })); };
    const armed = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...rest) => { if (typeof ms === 'number' && ms >= 1000) armed.push(ms); return realSetTimeout(fn, ms, ...rest); };
    let result;
    try { result = await understand('transcribe'); } finally { globalThis.setTimeout = realSetTimeout; }
    assert.equal(result.providerUsed, 'ollama');
    // (A few milliseconds short of the full 45 s: what is left of the stage's deadline.)
    assert.ok(armed.some((ms) => ms > 40_000 && ms <= OLLAMA_RECORD_BUDGET_MS), `no attempt was armed with the record budget: ${armed}`);
    const cloudAttempts = armed.filter((ms) => ms <= 40_000);
    assert.ok(cloudAttempts.length > 0 && cloudAttempts.every((ms) => ms <= 6000), `a cloud attempt was armed past the 6 s pre-pass budget: ${armed}`);
  });
  test('an Ollama ANSWER cancels a record still in flight: the answer is not queued behind it, and nothing is kept', async () => {
    // The fake serves one chat at a time, as a daemon does for one model: while
    // the record is being written, the answer's request waits. Without the
    // cancellation the answer would wait out the record's whole time limit.
    await boot({ 'llava:7b': true }, { holdChat: (body) => Boolean(body?.messages?.at(-1)?.images) }, 'llava:7b');
    const record = understand('transcribe');
    for (let i = 0; i < 200 && ollama.chats().length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(ollama.chats().length, 1, 'the record request is in flight');
    const within = (ms, promise, what) => Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error(`${what} did not finish within ${ms} ms`)), ms))]);
    const started = Date.now();
    const answer = await within(3000, (async () => { let out = ''; for await (const piece of h.streamWithOllama('the next question', undefined, 'SYS')) out += piece; return out; })(), 'the answer');
    assert.equal(answer, 'local model reply');
    const result = await within(3000, record, 'the cancelled record');
    assert.ok(Date.now() - started < 3000, 'neither waited for the record\'s 45 s limit');
    assert.equal(ollama.chats()[0].aborted, true, 'the record request was cancelled on the wire');
    assert.equal(composeScreenDescription(result), '');
  });
});
