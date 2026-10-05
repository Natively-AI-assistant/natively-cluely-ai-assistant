// A speech model picked in Settings > Audio reaches the session that transcribes.
//
// 2026-09-26. Deepgram and OpenAI gained a model choice (sttModelCatalog.ts),
// and the existing Groq choice was found to do nothing: RestSTT applied the
// override in its constructor only, then main.ts set the language right after
// construction, which rebuilt the config from PROVIDER_CONFIGS and dropped it.
// Every Groq session ran whisper-large-v3-turbo whatever was picked. A source
// grep could not have caught that, so these run the compiled classes
// (dist-electron, like SttEndpointLatency) and read what they would send.
//
// Live-checked the same day against Deepgram's v1 listen endpoint with the
// app's own connect options: every catalogued model transcribed; Nova-2
// Meeting + `multi` and Nova-3 Medical + `fr` answered 400 — which is why an
// English-only model is always sent English.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const distDir = path.resolve(repoRoot, 'dist-electron/electron/audio');
const load = (f) => require(path.join(distDir, f));
const src = (f) => fs.readFileSync(path.join(repoRoot, f), 'utf8');

describe('the model catalogue', () => {
  const cat = load('sttModelCatalog.js');

  test('resolves a stored id, and falls back to the default for anything else', () => {
    assert.equal(cat.resolveSttModel('deepgram', 'nova-2'), 'nova-2');
    assert.equal(cat.resolveSttModel('deepgram', undefined), 'nova-3');
    assert.equal(cat.resolveSttModel('deepgram', 'flux-general-en'), 'nova-3', 'Flux is /v2/listen, not a model swap');
    assert.equal(cat.resolveSttModel('openai', 'gpt-4o-mini-transcribe'), 'gpt-4o-mini-transcribe');
    assert.equal(cat.resolveSttModel('openai', 'whisper-1'), 'gpt-live-transcribe');
  });

  test('OpenAI offers exactly the models OpenAIStreamingSTT can drive', () => {
    const ws = src('electron/audio/OpenAIStreamingSTT.ts').match(/const WS_MODELS = \[([^\]]+)\]/);
    assert.ok(ws, 'WS_MODELS not found');
    const ladder = ws[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).map((x) => (x === 'LIVE_WS_MODEL' ? 'gpt-live-transcribe' : x));
    assert.deepEqual(cat.STT_MODEL_CATALOG.openai.models.map((m) => m.id), ladder);
  });

  test('English-only Deepgram models are flagged', () => {
    assert.equal(cat.isEnglishOnlySttModel('deepgram', 'nova-3-medical'), true);
    assert.equal(cat.isEnglishOnlySttModel('deepgram', 'nova-2-meeting'), true);
    assert.equal(cat.isEnglishOnlySttModel('deepgram', 'nova-3'), false);
  });
});

describe('Groq: the picked model survives what main.ts does after construction', () => {
  const { RestSTT } = load('RestSTT.js');

  test('setRecognitionLanguage and setApiKey keep the override', () => {
    const stt = new RestSTT('groq', 'k', 'whisper-large-v3');
    stt.setRecognitionLanguage('english-us');
    assert.equal(stt.config.model, 'whisper-large-v3');
    stt.setApiKey('k2');
    assert.equal(stt.config.model, 'whisper-large-v3');
    stt.setRecognitionLanguage('auto');
    assert.equal(stt.config.model, 'whisper-large-v3');
  });

  test('with no override the provider default stays', () => {
    const stt = new RestSTT('groq', 'k');
    stt.setRecognitionLanguage('english-us');
    assert.equal(stt.config.model, 'whisper-large-v3-turbo');
  });
});

describe('Deepgram: the session is built with the picked model', () => {
  const { DeepgramStreamingSTT } = load('DeepgramStreamingSTT.js');

  test('the constructor takes it; an unknown one falls back to Nova-3', () => {
    assert.equal(new DeepgramStreamingSTT('k').model, 'nova-3');
    assert.equal(new DeepgramStreamingSTT('k', 'nova-2').model, 'nova-2');
    assert.equal(new DeepgramStreamingSTT('k', 'nova-9').model, 'nova-3');
  });

  test('an English-only model is never sent multi or another language', () => {
    const med = new DeepgramStreamingSTT('k', 'nova-3-medical');
    med.setRecognitionLanguage('auto');
    assert.equal(med.connectLanguage(), 'en');
    med.setRecognitionLanguage('french');
    assert.equal(med.connectLanguage(), 'en');
    const nova3 = new DeepgramStreamingSTT('k', 'nova-3');
    nova3.setRecognitionLanguage('auto');
    assert.equal(nova3.connectLanguage(), 'multi');
    nova3.setRecognitionLanguage('french');
    assert.equal(nova3.connectLanguage(), 'fr');
  });

  test('the connect options carry the instance model, not a literal', () => {
    const dg = src('electron/audio/DeepgramStreamingSTT.ts');
    const opts = dg.slice(dg.indexOf('deepgram.listen.live({'), dg.indexOf('});', dg.indexOf('deepgram.listen.live({')));
    assert.match(opts, /model: this\.model,/);
    assert.match(opts, /language: this\.connectLanguage\(\),/);
  });
});

describe('OpenAI: the ladder starts at the picked model', () => {
  const { OpenAIStreamingSTT } = load('OpenAIStreamingSTT.js');

  test('preferred model → ladder start', () => {
    assert.equal(new OpenAIStreamingSTT('sk').preferredModelIndex, 0);
    assert.equal(new OpenAIStreamingSTT('sk', undefined, 'gpt-4o-transcribe').preferredModelIndex, 1);
    assert.equal(new OpenAIStreamingSTT('sk', undefined, 'gpt-4o-mini-transcribe').preferredModelIndex, 2);
    assert.equal(new OpenAIStreamingSTT('sk', undefined, 'bogus').preferredModelIndex, 0);
  });
});

describe('wiring: main, IPC and the key test use the stored model', () => {
  test('main.ts hands each session its stored model', () => {
    const main = src('electron/main.ts');
    assert.match(main, /new DeepgramStreamingSTT\(apiKey, CredentialsManager\.getInstance\(\)\.getSttModel\('deepgram'\)\)/);
    assert.match(main, /new OpenAIStreamingSTT\(apiKey, baseUrl, CredentialsManager\.getInstance\(\)\.getSttModel\('openai'\)\)/);
  });

  test('set-stt-model validates, reports the save, rebuilds and broadcasts', () => {
    const ipc = src('electron/ipcHandlers.ts');
    const start = ipc.indexOf("safeHandle('set-stt-model'");
    assert.ok(start > -1, 'set-stt-model handler missing');
    const body = ipc.slice(start, ipc.indexOf('\n  });', start));
    assert.match(body, /isSttModelProvider\(provider\) \|\| !isSttModel\(provider, model\)/);
    assert.match(body, /if \(!persisted\) return \{ success: false/);
    assert.match(body, /reconfigureSttProvider\(\)/);
    assert.match(body, /broadcastCredentialsChanged\(\)/);
  });

  test('the Deepgram and Groq key tests use the models sessions will use', () => {
    const ipc = src('electron/ipcHandlers.ts');
    assert.doesNotMatch(ipc, /listen\?model=nova-2/, 'the key test used to probe nova-2 while sessions ran nova-3');
    assert.match(ipc, /getSttModel\('deepgram'\)\)\}&encoding=linear16/);
    assert.match(ipc, /provider === 'groq' \? GroqCM\.getInstance\(\)\.getGroqSttModel\(\) : 'whisper-1'/);
  });
});
