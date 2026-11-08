/**
 * A signed-in Codex or Antigravity model writes the screen record when nothing
 * else can (issue #647, 2026-10-24).
 *
 * Both sign in with OAuth, so the vision registry had no rung for either. A
 * user whose only provider was one of them got the screenshot answered (the
 * streaming chain seats both) but every record ended `all_vision_failed`, so no
 * follow-up could quote that screen.
 *
 * The rule, mirroring the Ollama record (Evin, 2026-10-01): cloud providers
 * first; Codex / Antigravity only when none of them produced a record, by the
 * streaming chain's own availability rule; never in the 6 s pre-pass; never
 * under "Keep screenshots on this device".
 *
 * No network: the Codex and Antigravity adapters are replaced and their
 * arguments asserted.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helper, png, fakeCredentials, isolateSingletons, userData, dist, require, CRED_SLOT } from './fakeOllamaHarness.mjs';

const { getScreenUnderstandingService, OAUTH_RECORD_BUDGET_MS, CLOUD_RECORD_PER_PROVIDER_MS } = require(dist('services/screen/ScreenUnderstandingService.js'));
const { composeScreenDescription } = require(dist('services/screen/screenDescription.js'));
const { renderDigitsPng } = require(dist('llm/visionTestImage.js'));
isolateSingletons();

const SYSTEM = 'Extract what is on the screen.';

/** A helper whose selection is a Codex (or Antigravity) model, with both adapters recorded. */
function selectedHelper(currentModelId = 'codex-cli:gpt-6-luna', { reply = 'FATAL: disk quota exceeded (code E4012).' } = {}) {
  const h = helper('http://127.0.0.1:1', 'unused');
  Object.assign(h, { useOllama: false, currentModelId });
  h.isCodexAvailable = () => true;
  h.getSelectedCodexCliModel = () => 'gpt-6-luna';
  h.antigravityFallbackModel = () => (currentModelId.startsWith('antigravity:') ? currentModelId.slice('antigravity:'.length) : null);
  h.overrides = [];
  h.userVisionOverride = (provider, model) => { h.overrides.push([provider, model]); return undefined; };
  h.sent = [];
  h.streamWithCodexCli = async function* (userContent, systemPrompt, fastMode, imagePaths, signal, modelOverride, tuning) {
    h.sent.push({ adapter: 'codex', userContent, systemPrompt, imagePaths, signal, tuning });
    yield reply;
  };
  h.streamWithAntigravity = async function* (userPrompt, systemPrompt, imagePaths, signal, model) {
    h.sent.push({ adapter: 'antigravity', userPrompt, systemPrompt, imagePaths, signal, model });
    yield reply;
  };
  return h;
}

describe('LLMHelper.getOAuthRecordReader', () => {
  beforeEach(() => fakeCredentials());

  test('Codex selected and signed in: Codex, with the selected model', () => {
    const h = selectedHelper();
    assert.deepEqual(h.getOAuthRecordReader(), { family: 'codex-cli', model: 'gpt-6-luna' });
    assert.deepEqual(h.overrides, [['codex-cli', 'gpt-6-luna']], '"Reads images" is asked about the model that would read it');
  });
  test('Antigravity selected: Antigravity, with the routed model id', () => {
    const h = selectedHelper('antigravity:gemini-3-pro');
    assert.deepEqual(h.getOAuthRecordReader(), { family: 'antigravity', model: 'antigravity:gemini-3-pro' });
  });
  test('no reader when it cannot or may not read the screenshot', () => {
    const cases = {
      'Codex signed out or switched off': (h) => { h.isCodexAvailable = () => false; },
      'local-only mode': (h) => { h.isLocalOnlyMode = true; },
      '"Reads images: Off" for that model': (h) => { h.userVisionOverride = () => false; },
      'a vendor model is selected and Codex is signed out': (h) => { h.currentModelId = 'gemini-3.8-flash'; h.isCodexAvailable = () => false; },
    };
    for (const [name, arrange] of Object.entries(cases)) {
      const h = selectedHelper();
      arrange(h);
      assert.equal(h.getOAuthRecordReader(), null, name);
    }
    const ag = selectedHelper('antigravity:gemini-3-pro');
    ag.antigravityFallbackModel = () => null;
    ag.isCodexAvailable = () => false;
    assert.equal(ag.getOAuthRecordReader(), null, 'Antigravity signed out, Codex too');
  });
  test('the streaming chain\'s rule, not the selection: a signed-in Codex reads it for a text-only selection', () => {
    // Code review, 2026-10-24: a DeepSeek / Groq text model selected with Codex
    // signed in has its screenshot ANSWERED by Codex (the streaming chain seats
    // it whenever available), so the record must not be left empty either.
    const h = selectedHelper('deepseek-chat');
    assert.deepEqual(h.getOAuthRecordReader(), { family: 'codex-cli', model: 'gpt-6-luna' });
    h.isCodexAvailable = () => false;
    h.antigravityFallbackModel = () => 'gemini-3-pro';
    assert.deepEqual(h.getOAuthRecordReader(), { family: 'antigravity', model: 'antigravity:gemini-3-pro' }, 'Codex before Antigravity, then Antigravity');
  });
  test('an Ollama or custom selection still gets the signed-in Codex, as the answer does', () => {
    // Code review, 2026-10-24: buildVisionChain seats Codex for these selections
    // whenever local-only is off, and the record's own rule (2026-10-01) is a
    // cloud provider when one is available, else Ollama.
    for (const arrange of [(h) => { h.useOllama = true; }, (h) => { h.customProvider = { id: 'c' }; }]) {
      const h = selectedHelper('gemini-3.8-flash');
      arrange(h);
      assert.deepEqual(h.getOAuthRecordReader(), { family: 'codex-cli', model: 'gpt-6-luna' });
    }
  });
  test('the selection goes first: Antigravity selected with Codex also signed in', () => {
    assert.equal(selectedHelper('antigravity:gemini-3-pro').getOAuthRecordReader().family, 'antigravity');
  });
});

describe('runVisionRequest("selected_model")', () => {
  beforeEach(() => fakeCredentials());

  test('Codex: the image, the system prompt and the prompt reach the Codex adapter', async () => {
    const h = selectedHelper();
    const signal = new AbortController().signal;
    assert.match(await h.runVisionRequest('oauth_model', 'What is on the screen?', SYSTEM, png, { signal }), /E4012/);
    assert.equal(h.sent.length, 1);
    assert.deepEqual(
      { adapter: h.sent[0].adapter, userContent: h.sent[0].userContent, systemPrompt: h.sent[0].systemPrompt, imagePaths: h.sent[0].imagePaths },
      { adapter: 'codex', userContent: 'What is on the screen?', systemPrompt: SYSTEM, imagePaths: [png] },
    );
    assert.equal(h.sent[0].signal, signal, 'the chain\'s deadline reaches the request');
    // Code review, 2026-10-24: the user's own effort (high / xhigh) or a flex
    // tier would run a transcription past the record's time limit every time.
    assert.deepEqual(h.sent[0].tuning, { modelReasoningEffort: 'low', serviceTier: 'default' });
  });
  test('Antigravity: sent with the selected model', async () => {
    const h = selectedHelper('antigravity:gemini-3-pro');
    await h.runVisionRequest('oauth_model', 'u', SYSTEM, png, {});
    assert.equal(h.sent[0].adapter, 'antigravity');
    assert.equal(h.sent[0].model, 'antigravity:gemini-3-pro');
    assert.deepEqual(h.sent[0].imagePaths, [png]);
  });
  test('no reader: refused before anything is sent', async () => {
    const h = selectedHelper('gemini-3.8-flash');
    h.isCodexAvailable = () => false;
    await assert.rejects(() => h.runVisionRequest('oauth_model', 'u', SYSTEM, png, {}), /No signed-in model can read this screenshot/);
    assert.equal(h.sent.length, 0);
  });
  test('an adapter failure is thrown, never returned as the screen\'s text', async () => {
    const h = selectedHelper();
    h.streamWithCodexCli = async function* () { throw new Error('Codex upstream 503'); };
    await assert.rejects(() => h.runVisionRequest('oauth_model', 'u', SYSTEM, png, {}), /503/);
  });
});

describe('the screen record through the service', () => {
  let h; let n = 0;
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
  const use = (helperInstance) => { h = helperInstance; globalThis.__nativelyGetLLMHelper = () => h; };
  const understand = (userAction, mode = 'vision_first') => {
    const shot = path.join(userData, `selected-record-${++n}.png`);
    fs.writeFileSync(shot, renderDigitsPng(String(3000 + n)));          // a new image each time: no cache hit
    return svc.understand({ imagePaths: [shot], userAction, transcript: 'q', screenUnderstandingMode: mode, providerPolicy: { allowScreenshots: true, localOnly: mode === 'private_vision' } });
  };
  /** Records which rungs were asked; the cloud rungs answer with `cloud`. */
  const routeCloud = (cloud) => {
    const asked = [];
    const real = h.runVisionRequest;
    h.runVisionRequest = function (id, ...rest) {
      asked.push(id);
      return id === 'oauth_model' ? real.call(this, id, ...rest) : cloud();
    };
    return asked;
  };
  beforeEach(() => { cloudKeys([]); svc.rungHealth.clear(); });
  afterEach(() => { delete globalThis.__nativelyGetLLMHelper; });

  test('Codex is the only provider: Codex writes the record (issue #647)', async () => {
    use(selectedHelper());
    const result = await understand('transcribe');
    assert.equal(result.status, 'available');
    assert.equal(result.providerUsed, 'oauth_model');
    assert.match(composeScreenDescription(result), /E4012/, 'the text a later turn will quote');
    assert.equal(h.sent[0].adapter, 'codex');
  });
  test('Antigravity is the only provider: Antigravity writes it', async () => {
    use(selectedHelper('antigravity:gemini-3-pro'));
    assert.equal((await understand('transcribe')).providerUsed, 'oauth_model');
    assert.equal(h.sent[0].adapter, 'antigravity');
  });
  test('a cloud provider is available: it writes the record, and the selected model is not asked', async () => {
    use(selectedHelper());
    cloudKeys(['gemini']);
    const asked = routeCloud(() => Promise.resolve('Cloud transcription of the screen.'));
    const result = await understand('transcribe');
    assert.equal(result.providerUsed, 'gemini_flash_lite');
    assert.ok(!asked.includes('oauth_model'), `asked: ${asked}`);
    assert.equal(h.sent.length, 0);
  });
  test('every cloud provider fails: the selected model still writes it, with its own time limit', async () => {
    use(selectedHelper());
    cloudKeys(['gemini']);
    routeCloud(() => Promise.reject(Object.assign(new Error('503 unavailable'), { status: 503 })));
    const armed = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...rest) => { if (typeof ms === 'number' && ms >= 1000) armed.push(ms); return realSetTimeout(fn, ms, ...rest); };
    let result;
    try { result = await understand('transcribe'); } finally { globalThis.setTimeout = realSetTimeout; }
    assert.equal(result.providerUsed, 'oauth_model');
    assert.ok(OAUTH_RECORD_BUDGET_MS > 6000, String(OAUTH_RECORD_BUDGET_MS));
    assert.ok(armed.some((ms) => ms > CLOUD_RECORD_PER_PROVIDER_MS && ms <= OAUTH_RECORD_BUDGET_MS), `no attempt was armed with the record budget: ${armed}`);
    // The cloud rungs run first, in their own record stage (2026-11-06: no
    // longer the pre-pass's 6 s — CLOUD_RECORD_PER_PROVIDER_MS a rung).
    const cloudAttempts = armed.filter((ms) => ms <= CLOUD_RECORD_PER_PROVIDER_MS);
    assert.ok(cloudAttempts.length > 0, `the cloud rungs ran inside the cloud record stage: ${armed}`);
  });
  test('the PRE-PASS never asks the selected model: it runs before the answer, inside 6 seconds', async () => {
    use(selectedHelper());
    for (const action of ['what_to_say', 'what_to_answer', 'manual_use_screen']) {
      const result = await understand(action);
      assert.notEqual(result.status, 'available', action);
    }
    assert.equal(h.sent.length, 0);
  });
  test('Codex fails: the record says the provider failed, not that none is configured', async () => {
    // Code review, 2026-10-24: each stage's result replaced the last, and the
    // unconfigured Ollama stage after Codex reported 'no_vision_provider'.
    use(selectedHelper());
    h.streamWithCodexCli = async function* () { throw new Error('Codex upstream 503'); };
    const result = await understand('transcribe');
    assert.notEqual(result.status, 'available');
    assert.equal(result.failureReason, 'all_vision_failed');
  });
  test('a Codex failure does not keep Antigravity from writing the next record', async () => {
    // Code review, 2026-10-24: one rung id for both families; the breaker a
    // Codex timeout opens must not skip a different reader.
    use(selectedHelper());
    h.streamWithCodexCli = async function* () { throw new Error('Codex upstream 503'); };
    assert.notEqual((await understand('transcribe')).status, 'available');
    h.isCodexAvailable = () => false;
    h.antigravityFallbackModel = () => 'gemini-3-pro';
    const result = await understand('transcribe');
    assert.equal(result.providerUsed, 'oauth_model', `skipped: ${JSON.stringify(result.attempts ?? '')}`);
    assert.equal(h.sent.at(-1).adapter, 'antigravity');
  });
  test('the same reader that just failed is still cooled down', async () => {
    use(selectedHelper());
    h.streamWithCodexCli = async function* () { throw new Error('Codex upstream 503'); };
    await understand('transcribe');
    let calls = 0;
    h.streamWithCodexCli = async function* () { calls++; yield 'A screen.'; };
    await understand('transcribe');
    assert.equal(calls, 0, 'a reader that just failed is skipped for its cooldown');
  });
  test('the provider list: absent from the pre-pass, ahead of Ollama in the record', () => {
    const { buildVisionProviders } = require(dist('services/screen/VisionProviderRegistry.js'));
    use(selectedHelper());
    assert.ok(!buildVisionProviders({ mode: 'vision_first', purpose: 'prepass' }).some((p) => p.id === 'oauth_model'));
    const ids = buildVisionProviders({ mode: 'vision_first', purpose: 'record' }).map((p) => p.id);
    assert.ok(ids.indexOf('oauth_model') >= 0 && ids.indexOf('oauth_model') < ids.indexOf('ollama'), ids.join(','));
  });
  test('late rungs that cannot run are still named in the record ledger, as skipped', async () => {
    use(selectedHelper());
    const result = await understand('transcribe');
    const ollama = (result.attempts ?? []).find((a) => a.provider === 'ollama');
    assert.ok(Array.isArray(result.attempts), 'the result carries the attempt ledger');
    assert.ok(ollama?.skipped, JSON.stringify(result.attempts));
  });
  test('the ledger names the model without a doubled prefix', async () => {
    const { buildVisionProviders } = require(dist('services/screen/VisionProviderRegistry.js'));
    use(selectedHelper('antigravity:gemini-3-pro'));
    const rung = buildVisionProviders({ mode: 'vision_first', purpose: 'record' }).find((p) => p.id === 'oauth_model');
    assert.equal(rung.displayName, 'Antigravity (gemini-3-pro)');
  });
  test('automatic screen-share snapshots keep off the Codex / Antigravity quota', async () => {
    // Code review, 2026-10-24: frames every 10-30 s of other people's screens
    // would share a rate-limited personal account with the live answers.
    use(selectedHelper());
    const shot = path.join(userData, `selected-record-${++n}.png`);
    fs.writeFileSync(shot, renderDigitsPng(String(3000 + n)));
    const result = await svc.understand({ imagePaths: [shot], userAction: 'transcribe', allowOAuthRecord: false, transcript: 'q', screenUnderstandingMode: 'vision_first', providerPolicy: { allowScreenshots: true } });
    assert.notEqual(result.status, 'available');
    assert.equal(h.sent.length, 0);
  });
  test('"Keep screenshots on this device": Codex is a cloud send and is never asked', async () => {
    use(selectedHelper());
    await understand('transcribe', 'private_vision');
    assert.equal(h.sent.length, 0);
  });
});

describe('wiring of the two callers that are not an answer', () => {
  // fileURLToPath, not URL.pathname: on Windows the pathname is "/D:/a/…" and
  // the join lands nowhere (CI, windows-latest, 2026-10-24).
  const src = (p) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../', p), 'utf8');
  test('screen-share snapshots pass allowOAuthRecord: false, and transcribeScreenForMemory forwards it', () => {
    assert.match(src('main.ts'), /transcribeScreenForMemory\(\[imagePath\], hint, \{ allowOAuthRecord: false \}\)/);
    assert.match(src('services/screen/screenTranscription.ts'), /allowOAuthRecord: options\.allowOAuthRecord/);
  });
  test('Notes › Attach image waits at most the pre-pass budget, then fills the description in later', () => {
    const body = src('ipcHandlers.ts').split("safeHandle('live-notes:attach-image'")[1].split('safeHandle(')[0];
    assert.match(body, /awaitDescriptionWithin\(/);
    assert.match(body, /SCREEN_UNDERSTANDING_TOTAL_BUDGET_MS/);
    assert.match(body, /notePendingImageDescription\(entry, late\.then\(/);
    assert.doesNotMatch(body, /await transcribeScreenForMemory/, 'the handler must not wait out the whole record');
    assert.ok(body.indexOf('try {') < body.indexOf("require('./services/screen/screenTranscription')"), 'a module that fails to load must not fail the attach');
  });
  test('the notes writer waits for pending descriptions before it reads them', () => {
    const mp = src('MeetingPersistence.ts');
    const wait = mp.indexOf('await awaitPendingImageDescriptions(metadata?.attachedImages)');
    assert.ok(wait > 0 && wait < mp.indexOf('attachedImagesBlockFor(metadata?.attachedImages)'));
  });
});

describe('awaitDescriptionWithin', () => {
  const { awaitDescriptionWithin } = require(dist('services/screen/screenTranscription.js'));
  const after = (ms, value, fail = false) => new Promise((res, rej) => setTimeout(() => (fail ? rej(new Error('x')) : res(value)), ms));

  test('in time: the text, trimmed', async () => {
    const { text, late } = await awaitDescriptionWithin(after(5, '  A chart.  '), 200);
    assert.equal(text, 'A chart.');
    assert.equal(await late, 'A chart.');
  });
  test('too slow: returns at the limit with null, and the late text still arrives', async () => {
    const started = Date.now();
    const { text, late } = await awaitDescriptionWithin(after(150, 'A slow chart.'), 30);
    assert.equal(text, null);
    assert.ok(Date.now() - started < 120, `waited ${Date.now() - started} ms`);
    assert.equal(await late, 'A slow chart.');
  });
  test('a failure or an empty description is null, never thrown', async () => {
    assert.equal((await awaitDescriptionWithin(after(5, '', true), 200)).text, null);
    assert.equal(await (await awaitDescriptionWithin(after(5, '', true), 200)).late, '');
    assert.equal((await awaitDescriptionWithin(after(5, '   '), 200)).text, null);
  });
});

describe('pending image descriptions', () => {
  const { notePendingImageDescription, awaitPendingImageDescriptions } = require(dist('services/screen/screenTranscription.js'));

  test('the notes writer gets the description that arrives after Attach image returned', async () => {
    const entry = { description: 'Image "a.png" (not described)' };
    notePendingImageDescription(entry, new Promise((r) => setTimeout(() => { entry.description = 'A whiteboard sketch.'; r('A whiteboard sketch.'); }, 40)));
    await awaitPendingImageDescriptions([entry, { description: 'other' }]);
    assert.equal(entry.description, 'A whiteboard sketch.');
  });
  test('nothing pending: returns at once', async () => {
    const started = Date.now();
    await awaitPendingImageDescriptions([{ description: 'x' }]);
    await awaitPendingImageDescriptions(undefined);
    assert.ok(Date.now() - started < 20);
  });
  test('a failed description is waited for, not thrown', async () => {
    const entry = {};
    notePendingImageDescription(entry, Promise.reject(new Error('x')));
    await awaitPendingImageDescriptions([entry]);
  });
});
