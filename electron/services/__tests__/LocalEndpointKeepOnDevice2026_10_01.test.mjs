/**
 * "Keep screenshots on this device" with a LOCAL custom endpoint selected
 * (2026-10-01).
 *
 * The mode counted only Ollama as local vision, so a user whose selected
 * provider was LM Studio, llama.cpp or any other endpoint on 127.0.0.1 or the
 * LAN — one that reads images — was told "no local vision model is available"
 * and pointed at Ollama. The screen pre-pass already treats such an endpoint as
 * local (phase 5b); the answer itself did not.
 *
 * A fake OpenAI-compatible endpoint on loopback stands in, and the request is
 * asserted on the wire.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  helper, ask, png, setMode, setScopes, isolateSingletons, dist, require, LLMHelper, CRED_SLOT,
} from './fakeOllamaHarness.mjs';

const { PRIVATE_VISION_NO_LOCAL_MESSAGE } = require(dist('llm/visionPolicy.js'));
isolateSingletons();

function fakeEndpoint({ status = 200, reply = 'endpoint reply' } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      requests.push({ path: req.url, body: raw ? JSON.parse(raw) : null });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { choices: [{ message: { role: 'assistant', content: reply } }] } : { error: { message: 'boom' } }));
    });
  });
  return {
    requests,
    start: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))),
    stop: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
const MESSAGES_BODY = `-H "Content-Type: application/json" -d '{"model":"local-vlm","messages":[{"role":"system","content":"{{SYSTEM_PROMPT}}"},{"role":"user","content":"{{USER_MESSAGE}}"}]}'`;
const TEXT_ONLY_BODY = `-H "Content-Type: application/json" -d '{"prompt":"{{TEXT}}"}'`;
const provider = (url, body = MESSAGES_BODY) => ({ id: 'lmstudio', name: 'LM Studio', curlCommand: `curl ${url}/v1/chat/completions ${body}`, responsePath: 'choices[0].message.content' });

/** A helper with a custom provider selected; every cloud adapter and Ollama are recorded stubs. */
function helperWith(customProvider) {
  const h = helper('http://127.0.0.1:1', 'unused');
  Object.assign(h, { useOllama: false, customProvider, ollamaModel: '' });
  h.streamWithCustom = LLMHelper.prototype.streamWithCustom;      // the real adapter: its request is what is under test
  h.streamWithOllama = async function* (...args) { h.cloud.push({ provider: 'streamWithOllama', args }); yield 'OLLAMA'; };
  // The text route's failover wrapper needs the whole text engine; a text turn
  // is only a control here, so it is reduced to "open the selected provider".
  h.streamSelectedProviderWithFailover = async function* (rung) { yield* rung.open(new AbortController().signal); };
  return h;
}
const credentials = (disabled = []) => {
  globalThis[CRED_SLOT] = { getDisabledProviders: () => disabled, anyVisionProviderConfigured: () => true, anyLocalVisionProviderConfigured: () => true };
};
const hasImage = (body) => JSON.stringify(body?.messages ?? '').includes('image_url') || JSON.stringify(body ?? '').includes('base64');

describe('"Keep screenshots on this device" with a local custom endpoint selected', () => {
  let endpoint;
  beforeEach(() => { credentials(); setScopes({}); setMode('private_vision'); });
  afterEach(async () => { await endpoint?.stop(); endpoint = null; setMode('vision_first'); });

  test('it reads images: the endpoint answers, with the screenshot, and nothing else is asked', async () => {
    endpoint = fakeEndpoint({ reply: 'A two-sum function.' });
    const h = helperWith(provider(await endpoint.start()));
    const out = await ask(h, 'what is on my screen?', [png]);
    assert.notEqual(out, PRIVATE_VISION_NO_LOCAL_MESSAGE, 'refused although the selected endpoint is on this machine and reads images');
    assert.equal(out, 'A two-sum function.');
    assert.equal(endpoint.requests.length, 1);
    assert.equal(hasImage(endpoint.requests[0].body), true, 'the screenshot must be in the request');
    assert.deepEqual(h.cloud, [], 'no cloud adapter and no Ollama');
  });
  test('a HOSTED endpoint stays refused, and no request is made', async () => {
    endpoint = fakeEndpoint();
    await endpoint.start();
    const h = helperWith(provider('https://api.example.com'));
    assert.equal(await ask(h, 'what is on my screen?', [png]), PRIVATE_VISION_NO_LOCAL_MESSAGE);
    assert.equal(endpoint.requests.length, 0);
    assert.deepEqual(h.cloud, []);
  });
  test('a local endpoint whose template cannot carry an image stays refused', async () => {
    endpoint = fakeEndpoint();
    const h = helperWith(provider(await endpoint.start(), TEXT_ONLY_BODY));
    assert.equal(await ask(h, 'what is on my screen?', [png]), PRIVATE_VISION_NO_LOCAL_MESSAGE);
    assert.equal(endpoint.requests.length, 0);
  });
  test('the provider is switched off: refused', async () => {
    endpoint = fakeEndpoint();
    credentials(['custom']);
    const h = helperWith(provider(await endpoint.start()));
    assert.equal(await ask(h, 'what is on my screen?', [png]), PRIVATE_VISION_NO_LOCAL_MESSAGE);
    assert.equal(endpoint.requests.length, 0);
  });
  test('the endpoint fails: an error is shown, and nothing falls through to the cloud', async () => {
    endpoint = fakeEndpoint({ status: 500 });
    const h = helperWith(provider(await endpoint.start()));
    const out = await ask(h, 'what is on my screen?', [png]);
    assert.match(out, /Custom Provider|custom provider/);
    assert.match(out, /500|Error/);
    assert.equal(endpoint.requests.length, 1);
    assert.deepEqual(h.cloud, [], 'a failed local answer must not be retried on a cloud provider in this mode');
  });
  test('a text turn in that mode is unaffected', async () => {
    endpoint = fakeEndpoint({ reply: 'hello back' });
    const h = helperWith(provider(await endpoint.start()));
    assert.equal(await ask(h, 'hello', undefined), 'hello back');
    assert.equal(hasImage(endpoint.requests[0].body), false);
  });
});

test('the decision names the local destination, and never offers a custom endpoint to the Ollama-only callers', async () => {
  // The three non-streaming callers dispatch to callOllama on `localAvailable`.
  // With a custom endpoint selected that must stay false, or they would send
  // the screenshot to an Ollama the user did not select.
  globalThis[CRED_SLOT] = { getDisabledProviders: () => [], anyVisionProviderConfigured: () => true, anyLocalVisionProviderConfigured: () => true };
  setScopes({}); setMode('private_vision');
  const h = helperWith(provider('http://127.0.0.1:9'));
  const local = await h.resolveOutboundVisionDecision([png], true);
  assert.equal(local.decision.action, 'local_only');
  assert.equal(local.localTarget, 'custom');
  assert.equal(local.localAvailable, false);
  const hosted = await helperWith(provider('https://api.example.com')).resolveOutboundVisionDecision([png], true);
  assert.deepEqual([hosted.localTarget, hosted.localAvailable], [null, false]);
  setMode('vision_first');
  const open = await h.resolveOutboundVisionDecision([png], true);
  assert.deepEqual([open.decision.action, open.localTarget, open.localAvailable], ['allow', null, false]);
});

test('the refusal no longer points only at Ollama: a local endpoint that reads images is an answer too', () => {
  assert.match(PRIVATE_VISION_NO_LOCAL_MESSAGE, /not sent anywhere/i);
  assert.match(PRIVATE_VISION_NO_LOCAL_MESSAGE, /Ollama/);
  assert.match(PRIVATE_VISION_NO_LOCAL_MESSAGE, /local endpoint that reads images/i);
});

test('PINNED DESIGN: the keep-on-device answer is sent as the Ollama one is — the base prompt and the raw question, before prompt assembly', async () => {
  // Both local branches dispatch BEFORE retrieval, document grounding and the
  // governed context pack are assembled (2026-10-01 review, accepted: the mode
  // used to refuse here, and the Ollama branch has always worked this way). A
  // screenshot question in this mode is therefore answered from the screenshot
  // and the question alone. Moving both branches below prompt assembly is a
  // separate change; this test makes any such change a deliberate one.
  globalThis[CRED_SLOT] = { getDisabledProviders: () => [], anyVisionProviderConfigured: () => true, anyLocalVisionProviderConfigured: () => true };
  setScopes({}); setMode('private_vision');
  const endpoint = fakeEndpoint();
  try {
    const h = helperWith(provider(await endpoint.start()));
    await ask(h, 'what is on my screen?', [png]);
    const [system, user] = endpoint.requests[0].body.messages;
    assert.match(system.content, /^SYS/, 'the caller\'s system prompt (plus the language line), not an assembled one');
    assert.match(JSON.stringify(user.content), /what is on my screen\?/);
  } finally { await endpoint.stop(); setMode('vision_first'); }
});
