// Text read off a screenshot that was KEPT ON THIS DEVICE never goes to a cloud model.
//
// THE LEAK (privacy audit, 2026-10-01). "Keep screenshots on this device" was
// enforced on image BYTES only. The text a local model read off such a
// screenshot was stored like any other screen text — in the conversation ring
// and in the description cache — and then travelled as plain prose:
//   1. the user switches to a cloud model in the same session, and every later
//      turn carries `[screen attached that turn] <the screen's text>`;
//   2. a cached description is recorded against a later turn and sent on;
//   3. Direct Assist renders cached descriptions into the history it sends.
//
// THE RULE. A description made while that setting is on carries a mark, in the
// text itself, so it cannot be separated from it by any store or path:
//   • history shows it only when the selected provider is on this device;
//     otherwise a short note stands in for it (never a silent gap — that is
//     what makes a model deny a screenshot was ever sent);
//   • the last boundary before any cloud provider refuses a payload carrying it.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'on-device-screen-'));
const require = createRequire(import.meta.url);
const root = process.cwd();
const dist = (p) => path.join(root, 'dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => process.env.NATIVELY_TEST_USERDATA, getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false },
    BrowserWindow: { getAllWindows: () => [] } },
};
const base = dist('context-intelligence');
const store = await import(pathToFileURL(path.join(base, 'question/conversation-state-store.js')).href);
const { buildV3Prompt } = await import(pathToFileURL(path.join(base, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(pathToFileURL(path.join(base, 'contracts/flag.js')).href);
const { renderHistory } = require(path.join(base, 'question/history-render.js'));
const OD = require(path.join(base, 'question/on-device-screen.js'));
const { composeScreenDescription } = require(dist('services/screen/screenDescription.js'));
const { LLMHelper } = require(dist('LLMHelper.js'));
process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1';

const SECRET = 'orbit-router';
const SCREEN = `VS Code on graph.py; sidebar shows project ${SECRET} with 12 files.`;
const result = (extra = {}) => ({ status: 'available', source: 'vision_extract', screenType: 'code', attempts: [], confidence: 0.9, imagePaths: [], capturedAt: 1, durationMs: 1, warnings: [], visibleSummary: SCREEN, ...extra });
const selection = (onDevice) => { globalThis.__nativelyGetLLMHelper = () => ({ selectionStaysOnDevice: () => onDevice }); };
afterEach(() => { delete globalThis.__nativelyGetLLMHelper; });

describe('the mark', () => {
  test('a description made while screenshots are kept on this device carries it; any other does not', () => {
    const kept = composeScreenDescription(result({ keptOnDevice: true }));
    assert.ok(kept.startsWith(OD.ON_DEVICE_SCREEN_MARK), kept.slice(0, 80));
    assert.match(kept, new RegExp(SECRET));
    assert.equal(OD.hasOnDeviceScreenText(kept), true);
    const sent = composeScreenDescription(result());
    assert.equal(OD.hasOnDeviceScreenText(sent), false);
    assert.equal(composeScreenDescription(result({ keptOnDevice: true, status: 'failed' })), '', 'nothing to describe: no mark either');
  });
  test('marking is idempotent, and empty text stays empty', () => {
    const once = OD.markOnDeviceScreenText(SCREEN);
    assert.equal(OD.markOnDeviceScreenText(once), once);
    assert.equal(OD.markOnDeviceScreenText(''), '');
    assert.equal(OD.markOnDeviceScreenText('   '), '');
  });
  test('the mark survives the ring\'s caps: a very long marked description is still recognised', () => {
    const S = 'od-cap';
    store.clearConversationState(S);
    store.recordAnswerSummary(S, 'An answer.', OD.markOnDeviceScreenText('x'.repeat(50_000)), 'q?');
    assert.equal(OD.hasOnDeviceScreenText(store.getConversationState(S).turns[0].screen), true);
  });
});

describe('history rendering', () => {
  const turns = [
    { q: 'what is wrong with this code?', a: 'Line 14 fails.', screen: OD.markOnDeviceScreenText(SCREEN) },
    { q: 'and this slide?', a: 'It is a roadmap.', screen: 'A roadmap slide titled Q4 plans.' },
    { q: 'thanks', a: 'You are welcome.' },
  ];
  const opts = { budgetChars: 20_000, digestBudgetChars: 20_000, screenBudgetChars: 20_000, screensDenied: false };
  test('by default (the destination is not known to be on this device) the kept text is replaced by a note', () => {
    const out = renderHistory(turns, opts);
    assert.ok(!out.text.includes(SECRET), 'kept-on-device screen text was rendered');
    assert.ok(!OD.hasOnDeviceScreenText(out.text), 'the mark must not appear without its text');
    assert.ok(out.text.includes(OD.ON_DEVICE_SCREEN_WITHHELD), 'no note: the model would deny a screenshot was sent');
    assert.equal(out.screenWithheld, true);
    assert.match(out.text, /Line 14 fails\./, 'the answer of that turn is still there');
    assert.match(out.text, /A roadmap slide titled Q4 plans\./, 'screen text that was NOT kept on device is unaffected');
  });
  test('when the turn stays on this device the text is rendered, with its mark', () => {
    const out = renderHistory(turns, { ...opts, onDeviceScreens: true });
    assert.match(out.text, new RegExp(SECRET));
    assert.equal(OD.hasOnDeviceScreenText(out.text), true, 'the mark travels with the text, for the last boundary');
    assert.ok(!out.text.includes(OD.ON_DEVICE_SCREEN_WITHHELD));
  });
  test('the recall tier follows the same rule', () => {
    const many = [turns[0], ...Array.from({ length: 30 }, (_, i) => ({ q: `filler question ${i}`, a: `filler answer ${i} `.repeat(40) }))];
    const tight = { budgetChars: 1500, digestBudgetChars: 1500, screenBudgetChars: 20_000, screensDenied: false, query: 'what was the project name in graph.py?', recallBudgetChars: 6000 };
    const cloud = renderHistory(many, tight);
    assert.ok(!cloud.text.includes(SECRET));
    const local = renderHistory(many, { ...tight, onDeviceScreens: true });
    assert.ok(local.recalledCount === 0 || local.text.includes(SECRET) || !local.text.includes('graph.py'), 'recalled on device: with its text');
  });
  test('the screenshots scope still withholds everything, with no note about the device', () => {
    const out = renderHistory(turns, { ...opts, screensDenied: true, onDeviceScreens: true });
    assert.ok(!out.text.includes(SECRET) && !out.text.includes('roadmap slide'));
  });
});

describe('through the prompt builder: the same conversation, two selections', () => {
  const turn = (sessionId, question, n) => buildV3Prompt({
    surface: 'manual-chat', pathTag: 'ipc', question, modeTemplateType: 'general',
    requestId: `od-${n}`, requestSequence: n, scope: { userId: 'local', sessionId },
  });
  async function followUp(sid) {
    store.clearConversationState(sid);
    await turn(sid, 'What is wrong with this code?', 1);
    store.recordAnswerSummary(sid, 'Line 14 fails because visited is a list.', composeScreenDescription(result({ keptOnDevice: true })));
    return turn(sid, 'What was the project name in that screenshot?', 2);
  }
  test('a CLOUD model is selected: the screen text is not in the prompt; a note is', async () => {
    selection(false);
    const t2 = await followUp('od-cloud');
    const all = `${t2.system ?? ''}\n${t2.user ?? ''}`;
    assert.ok(!all.includes(SECRET), 'LEAK: text read off a kept-on-device screenshot is in a prompt for a cloud model');
    assert.ok(!OD.hasOnDeviceScreenText(all));
    assert.ok(all.includes(OD.ON_DEVICE_SCREEN_WITHHELD));
    assert.match(all, /Line 14 fails because visited is a list\./, 'the rest of the conversation is intact');
  });
  test('nothing can say where the turn goes (no helper): withheld — it fails closed', async () => {
    delete globalThis.__nativelyGetLLMHelper;
    const t2 = await followUp('od-unknown');
    assert.ok(!`${t2.system ?? ''}\n${t2.user ?? ''}`.includes(SECRET));
  });
  test('a LOCAL model is selected: the follow-up can still read the earlier screen', async () => {
    selection(true);
    const t2 = await followUp('od-local');
    assert.match(t2.user, new RegExp(SECRET), 'an Ollama user asking about an earlier screen must still get it');
    assert.equal(OD.hasOnDeviceScreenText(t2.user), true);
  });
});

describe('where a turn goes: selectionStaysOnDevice', () => {
  const h = (state) => Object.assign(Object.create(LLMHelper.prototype), { useOllama: false, customProvider: null, activeCurlProvider: null, currentModelId: 'gemini-3.8-flash', ollamaUrl: 'http://127.0.0.1:11434', ...state });
  const curl = (url) => ({ id: 'c', name: 'c', curlCommand: `curl ${url} -d '{"q":"{{TEXT}}"}'` });
  test('Ollama on this machine or network: yes; on another machine: no', () => {
    assert.equal(h({ useOllama: true }).selectionStaysOnDevice(), true);
    assert.equal(h({ useOllama: true, ollamaUrl: 'http://192.168.1.20:11434' }).selectionStaysOnDevice(), true);
    assert.equal(h({ useOllama: true, ollamaUrl: 'https://ollama.example.com' }).selectionStaysOnDevice(), false);
  });
  test('a custom or cURL endpoint: by its host', () => {
    assert.equal(h({ customProvider: curl('http://localhost:1234/v1/chat') }).selectionStaysOnDevice(), true);
    assert.equal(h({ customProvider: curl('https://api.example.com/v1/chat') }).selectionStaysOnDevice(), false);
    assert.equal(h({ activeCurlProvider: curl('http://127.0.0.1:9000/gen') }).selectionStaysOnDevice(), true);
    assert.equal(h({ activeCurlProvider: curl('https://llm.example.com/gen') }).selectionStaysOnDevice(), false);
  });
  test('any cloud model: no — including a leftover local flag behind a hosted custom provider', () => {
    assert.equal(h({}).selectionStaysOnDevice(), false);
    assert.equal(h({ useOllama: true, customProvider: curl('https://api.example.com/v1/chat') }).selectionStaysOnDevice(), false, 'the custom provider is the selection');
  });
});

describe('the last boundary before a cloud provider', () => {
  const marked = `# Conversation so far.\n[screen attached that turn] ${OD.markOnDeviceScreenText(SCREEN)}\n\nWhat was the project name?`;
  const plain = `# Conversation so far.\n[screen attached that turn] ${SCREEN}\n\nWhat was the project name?`;
  const helper = (state = {}) => Object.assign(Object.create(LLMHelper.prototype), {
    useOllama: false, customProvider: null, activeCurlProvider: null, isProviderDisabled: () => false,
    getProviderScopePolicy: () => ({}), scopesForPayload: () => [], ...state,
  });
  const curl = (url) => ({ id: 'c', name: 'c', curlCommand: `curl ${url} -d '{"q":"{{TEXT}}"}'` });
  for (const provider of ['openai', 'claude', 'gemini', 'groq', 'deepseek', 'natively', 'openrouter', 'fluxion', 'agentrouter', 'litellm', 'ninerouter', 'nvidia_nim', 'codex', 'antigravity']) {
    test(`${provider}: a payload carrying kept-on-device screen text is refused`, () => {
      assert.throws(() => helper().assertOutboundScopes(provider, marked), (e) => e.name === 'VisionPolicyError' && /kept on this device/i.test(e.userMessage), provider);
      assert.doesNotThrow(() => helper().assertOutboundScopes(provider, plain), 'screen text that was not kept on device passes as before');
    });
  }
  test('a custom or cURL endpoint: refused when hosted, allowed when it is on this device', () => {
    assert.throws(() => helper({ customProvider: curl('https://api.example.com/v1') }).assertOutboundScopes('custom_provider', marked));
    assert.doesNotThrow(() => helper({ customProvider: curl('http://localhost:1234/v1') }).assertOutboundScopes('custom_provider', marked));
    assert.throws(() => helper({ activeCurlProvider: curl('https://llm.example.com/gen') }).assertOutboundScopes('custom_curl', marked));
    assert.doesNotThrow(() => helper({ activeCurlProvider: curl('http://127.0.0.1:9000/gen') }).assertOutboundScopes('custom_curl', marked));
  });
  test('a local selection\'s cloud helpers are not offered the turn: no Background Model pick, no cloud spare', () => {
    const h = helper({ isLocalOnlyMode: false, hasNatively: () => true, client: {}, groqClient: {} });
    assert.deepEqual(h.buildTextSpareRungs(marked, 'sys', 0).map((r) => r.id), [], 'a spare would only be refused at the boundary: do not offer it');
    assert.ok(h.buildTextSpareRungs(plain, 'sys', 0).length > 0, 'control: spares exist for an ordinary turn');
    let asked = false;
    const f = helper({ fastPickForTextTurn: () => { asked = true; return null; } });
    assert.equal(f.openFastModelStream(marked, undefined, undefined), null);
    assert.equal(asked, false, 'the pick is not even consulted');
  });
});

describe('Direct Assist', () => {
  const { DirectAssistError } = require(dist('direct-assist/types.js'));
  const marked = `<recent_transcript>\n[screen attached that turn] ${OD.markOnDeviceScreenText(SCREEN)}\n</recent_transcript>\nCURRENT REQUEST: what was the project name?`;
  const curl = (url) => ({ id: 'c', name: 'c', curlCommand: `curl ${url} -d '{"q":"{{TEXT}}"}'`, responsePath: 'text' });
  function helper(state = {}) {
    const sent = [];
    const h = Object.assign(Object.create(LLMHelper.prototype), {
      useOllama: false, customProvider: null, activeCurlProvider: null, configuredCustomProviders: [], isLocalOnlyMode: false,
      ollamaUrl: 'http://127.0.0.1:11434', ollamaVisionCache: new Map(), ninerouterVisionModels: new Set(),
      isProviderDisabled: () => false, assertOutboundImagesAllowed: () => {}, getDeniedOutboundScopes: () => [],
      inferEmbeddedMessageScopes: () => [], assertOutboundScopes: () => {}, getProviderScopePolicy: () => ({}),
      ...state,
    });
    for (const name of ['streamWithGeminiModel', 'streamWithOpenai', 'streamWithOpenRouter', 'streamWithNatively', 'streamWithOllama', 'streamWithAntigravity', 'streamWithCodexCli', 'streamWithCustom']) {
      h[name] = async function* (...args) { sent.push(name); yield 'answer'; };
    }
    return { h, sent };
  }
  const drive = async (h, provider, model, custom = null) => {
    const out = [];
    for await (const p of h.streamDirectAssistFrozen({ requestId: 'r', selection: { provider, model }, systemPrompt: 's', userPrompt: marked, imagePaths: [] }, custom, null)) out.push(p);
    return out.join('');
  };
  for (const [provider, model, adapter] of [['gemini', 'gemini-3.8-flash', 'streamWithGeminiModel'], ['openai', 'gpt-5.5', 'streamWithOpenai'], ['natively', 'natively', 'streamWithNatively'], ['antigravity', 'antigravity:claude-opus-5', 'streamWithAntigravity'], ['codex-cli', 'gpt-5.5', 'streamWithCodexCli']]) {
    test(`${provider}: a request whose history carries kept-on-device screen text is refused before the adapter`, async () => {
      const { h, sent } = helper();
      await assert.rejects(() => drive(h, provider, model), (e) => /kept on this device/i.test(e.message));
      assert.deepEqual(sent, [], `LEAK: ${adapter} was called`);
    });
  }
  test('Ollama on this machine answers it; Ollama on another machine does not', async () => {
    const local = helper({ useOllama: true });
    assert.equal(await drive(local.h, 'ollama', 'llava:7b'), 'answer');
    assert.deepEqual(local.sent, ['streamWithOllama']);
    const remote = helper({ useOllama: true, ollamaUrl: 'https://ollama.example.com' });
    await assert.rejects(() => drive(remote.h, 'ollama', 'llava:7b'), /kept on this device/i);
    assert.deepEqual(remote.sent, []);
  });
  test('a custom endpoint: on this device yes, hosted no', async () => {
    const local = helper();
    assert.equal(await drive(local.h, 'custom', 'c', curl('http://localhost:1234/v1')), 'answer');
    const hosted = helper();
    await assert.rejects(() => drive(hosted.h, 'custom', 'c', curl('https://api.example.com/v1')), /kept on this device/i);
    assert.deepEqual(hosted.sent, []);
  });
});

describe('the screen-reading service says when a result was read under "keep on this device"', () => {
  const { ScreenUnderstandingService } = require(dist('services/screen/ScreenUnderstandingService.js'));
  const { renderDigitsPng } = require(dist('llm/visionTestImage.js'));
  const png = path.join(process.env.NATIVELY_TEST_USERDATA, 'svc.png');
  const localRung = { id: 'custom', displayName: 'Local', modelId: 'm', isLocal: true, isConfigured: true, supportsVision: true, scopeAllowsScreenshots: true, hint: 'custom',
    invoke: async () => JSON.stringify({ visibleSummary: SCREEN, extractedText: SCREEN }) };
  let n = 0;
  const understand = (mode) => {
    fs.writeFileSync(png, renderDigitsPng(String(4000 + ++n)));
    const svc = new ScreenUnderstandingService();
    return svc.understand({ imagePaths: [png], userAction: 'transcribe', transcript: 'q', screenUnderstandingMode: mode,
      providerPolicy: { allowScreenshots: true, localOnly: mode === 'private_vision', __providersOverride: [localRung] } });
  };
  test('private_vision: flagged, so its composed text is marked; vision_first: neither', async () => {
    const kept = await understand('private_vision');
    assert.equal(kept.status, 'available', JSON.stringify(kept.warnings));
    assert.equal(kept.keptOnDevice, true);
    assert.ok(composeScreenDescription(kept).startsWith(OD.ON_DEVICE_SCREEN_MARK));
    const sent = await understand('vision_first');
    assert.equal(sent.status, 'available');
    assert.equal(sent.keptOnDevice, undefined);
    assert.equal(OD.hasOnDeviceScreenText(composeScreenDescription(sent)), false);
  });
});
