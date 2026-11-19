// 2026-11-19 (Evin). A Natively key (a pack's, or a monthly / yearly / Standard
// plan's) moves the AI, speech-to-text, the reranker and pinned embeddings to
// Natively API, once per key, and the pack's are put back when it is over.
// Funnel 11-16..19: 13 of 15 pack buyers on their own AI were paywalled while
// their pack was valid, because the pack rule (packProRule.ts) gives Pro only on
// Natively API and buying a pack switched nothing.
//
// The planner and its applier are pure (no Electron, no process.platform), so
// these tests are the same on macOS and Windows: the settings come from
// CredentialsManager, which hides the Keychain / DPAPI storage difference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  planPackSwitch, packRestoreChange, reconcilePackSwitch,
} from '../packs/packNativelySwitch.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, rel), 'utf8');

const packFacts = (over = {}) => ({
  licencePremium: true,
  licenceProvider: 'natively_api',
  licenceIsPack: true,
  keyId: 'k1',
  mainKeyId: 'k1',
  memory: null,
  savedModel: 'groq/llama',
  liveModel: 'groq/llama',
  sttProvider: 'deepgram',
  rerankerProvider: 'jina',
  embedding: { mode: 'manual', provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
  documentsStayLocal: false,
  aiReady: true,
  ...over,
});
// A plan key: no pack licence (a Standard plan has none; Pro has a plan licence).
const planFacts = (over = {}) => packFacts({ licenceIsPack: false, licenceProvider: null, licencePremium: false, ...over });
const EMB = { mode: 'manual', provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 };

test('a pack: AI, speech-to-text, reranker and pinned embeddings move; the old values are remembered', () => {
  assert.deepEqual(planPackSwitch(packFacts()), {
    kind: 'switch', keyId: 'k1', pack: true, liveCheck: false, ai: true, stt: true, reranker: true, embedding: true,
    prev: { defaultModel: 'groq/llama', sttProvider: 'deepgram', rerankerProvider: 'jina', embedding: EMB },
  });
});

test('a plan key (monthly, yearly, Standard) switches too, after asking the server (Evin, 2026-11-19)', () => {
  const p = planPackSwitch(planFacts());
  assert.equal(p.kind, 'switch');
  assert.equal(p.pack, false);
  assert.equal(p.liveCheck, true);
  assert.equal(p.ai && p.stt && p.reranker && p.embedding, true);
});

test('only what is off Natively API moves; embeddings on auto already prefer it', () => {
  const p = planPackSwitch(packFacts({ savedModel: 'natively', liveModel: 'natively', rerankerProvider: 'natively', embedding: { mode: 'auto' } }));
  assert.equal(p.ai || p.reranker || p.embedding, false);
  assert.equal(p.stt, true);
  assert.deepEqual(p.prev, { sttProvider: 'deepgram' });
  // No reranker chosen yet: remembered as local, the app default.
  assert.equal(planPackSwitch(packFacts({ rerankerProvider: null })).prev.rerankerProvider, 'local');
});

test('privacy keeps documents on this device: the reranker and embeddings stay', () => {
  const p = planPackSwitch(packFacts({ documentsStayLocal: true }));
  assert.equal(p.reranker || p.embedding, false);
  assert.equal(p.ai && p.stt, true);
  assert.equal('rerankerProvider' in p.prev || 'embedding' in p.prev, false);
});

test('the overlay picker\'s live model off Natively API counts, the saved one is what is remembered', () => {
  const p = planPackSwitch(packFacts({ savedModel: 'natively', liveModel: 'gpt-5', sttProvider: 'natively' }));
  assert.equal(p.ai, true);
  assert.equal('defaultModel' in p.prev, false);
});

test('once per key: a user who moved back is left alone, until they enter the key again', () => {
  const memory = { keyId: 'k1', prev: { defaultModel: 'groq/llama' } };
  assert.deepEqual(planPackSwitch(planFacts({ memory })), { kind: 'none' });
  assert.deepEqual(planPackSwitch(packFacts({ memory, pack: true })), { kind: 'none' });
  const again = planPackSwitch(planFacts({ memory, entered: true, savedModel: 'claude-sonnet-5-5', liveModel: 'claude-sonnet-5-5' }));
  assert.equal(again.kind, 'switch');
  assert.equal(again.prev.defaultModel, 'claude-sonnet-5-5');
});

test('a new key switches again and keeps the settings from before the first switch', () => {
  const memory = { keyId: 'old', prev: { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastMode: true, rerankerProvider: 'jina', embedding: EMB } };
  const p = planPackSwitch(packFacts({ keyId: 'new', mainKeyId: 'new', memory, savedModel: 'natively', liveModel: 'natively', sttProvider: 'natively', rerankerProvider: 'natively', embedding: { mode: 'auto' } }));
  assert.equal(p.kind, 'switch');
  assert.deepEqual(p.prev, memory.prev);
  const q = planPackSwitch(packFacts({ keyId: 'new', mainKeyId: 'new', memory, savedModel: 'claude-sonnet-5-5', liveModel: 'claude-sonnet-5-5', sttProvider: 'natively' }));
  assert.equal(q.prev.defaultModel, 'claude-sonnet-5-5');
});

test('local and self-hosted setups move too', () => {
  for (const stt of ['local-whisper', 'apple-speech']) {
    const p = planPackSwitch(packFacts({ sttProvider: stt, savedModel: 'ollama-llama3.2', liveModel: 'ollama-llama3.2' }));
    assert.equal(p.ai && p.stt, true, stt);
    assert.equal(p.prev.defaultModel, 'ollama-llama3.2');
    assert.equal(p.prev.sttProvider, stt);
  }
  assert.deepEqual(planPackSwitch(packFacts({ aiReady: false })), { kind: 'none' });
});

test('no key (or the trial), no switch', () => {
  assert.deepEqual(planPackSwitch(packFacts({ keyId: null })), { kind: 'none' });
  assert.deepEqual(planPackSwitch(planFacts({ keyId: null })), { kind: 'none' });
});

test('a pack over: put back; a plan carrying on: keep Natively API, forget', () => {
  const memory = { keyId: 'k1', prev: { defaultModel: 'groq/llama' }, pack: true };
  assert.deepEqual(planPackSwitch(planFacts({ memory })), { kind: 'restore', keyId: 'k1', prev: memory.prev });
  // A lifetime / Dodo licence on the user's own keys: their settings come back.
  assert.equal(planPackSwitch(planFacts({ memory, licencePremium: true, licenceProvider: 'dodo' })).kind, 'restore');
  // A Natively plan licence, or a plan key saved beside the pack: forget.
  assert.deepEqual(planPackSwitch(planFacts({ memory, licencePremium: true, licenceProvider: 'natively_api' })), { kind: 'forget' });
  assert.deepEqual(planPackSwitch(planFacts({ memory, mainKeyId: 'plan' })), { kind: 'forget' });
  // A plan key's memory is never put back by the watch: only a cleared or refused key does that.
  assert.deepEqual(planPackSwitch(planFacts({ memory: { keyId: 'k1', prev: { defaultModel: 'groq/llama' } } })), { kind: 'none' });
});

test('restore puts back only what is still on Natively API', () => {
  const prev = { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastMode: true, rerankerProvider: 'jina', embedding: EMB };
  assert.deepEqual(
    packRestoreChange(prev, { defaultModel: 'natively', sttProvider: 'natively', fastMode: false, rerankerProvider: 'natively', embedding: { mode: 'auto' } }),
    prev,
  );
  assert.deepEqual(
    packRestoreChange(prev, { defaultModel: 'gpt-5', sttProvider: 'soniox', fastMode: true, rerankerProvider: 'voyage', embedding: { mode: 'manual', provider: 'gemini' } }),
    {},
  );
  assert.deepEqual(packRestoreChange({ defaultModel: 'x' }, { defaultModel: 'natively', sttProvider: 'natively', fastMode: false }), { defaultModel: 'x' });
});

function fakeDeps(state, over = {}) {
  const calls = [];
  const deps = {
    facts: () => (state.plan ? planFacts : packFacts)({
      memory: state.memory, savedModel: state.defaultModel, liveModel: state.defaultModel, sttProvider: state.sttProvider,
      rerankerProvider: state.reranker ?? 'natively', embedding: state.embedding ?? { mode: 'auto' }, entered: state.entered, ...state.facts,
    }),
    savedModel: () => state.defaultModel,
    sttProvider: () => state.sttProvider,
    rerankerProvider: () => state.reranker ?? 'natively',
    embedding: () => state.embedding ?? { mode: 'auto' },
    write: (change, memory) => {
      calls.push(['write', change, memory]);
      if (state.refuse) return false;
      if (change.defaultModel !== undefined) state.defaultModel = change.defaultModel;
      if (change.sttProvider !== undefined) state.sttProvider = change.sttProvider;
      state.memory = memory;
      return true;
    },
    fastModeOn: () => state.fastMode,
    setFastMode: (on) => { calls.push(['setFastMode', on]); if (state.refuseFast) return false; state.fastMode = on; return true; },
    setReranker: (p) => { calls.push(['setReranker', p]); state.reranker = p; return true; },
    setEmbedding: async (c) => { calls.push(['setEmbedding', c]); state.embedding = c; return true; },
    beforeChange: () => calls.push(['beforeChange']),
    applyModel: () => calls.push(['applyModel']),
    fastFamilyNow: () => (state.defaultModel === 'natively' && state.fastMode ? state.fastOn : null),
    applyStt: async () => { calls.push(['applyStt']); },
    keyState: async () => { calls.push(['keyState']); return state.keyState === undefined ? { live: true, usedUp: new Set() } : state.keyState; },
    meetingActive: () => !!state.meeting,
    // Tests confirm a gone pack at once unless they say otherwise.
    goneConfirmed: (gone) => gone && state.goneConfirmed !== false,
    log: () => {},
    ...over,
  };
  return { deps, calls };
}

test('a pack: everything moves, then the pack ends: everything comes back, the key marked ended', async () => {
  const state = { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastMode: true, fastOn: 'groq', memory: null, reranker: 'jina', embedding: EMB };
  const { deps, calls } = fakeDeps(state);
  assert.equal(await reconcilePackSwitch(deps), 'switched');
  assert.equal(state.defaultModel, 'natively');
  assert.equal(state.sttProvider, 'natively');
  assert.equal(state.reranker, 'natively');
  assert.deepEqual(state.embedding, { mode: 'auto' });
  assert.equal(state.fastMode, false);
  assert.deepEqual(state.memory, { keyId: 'k1', pack: true, prev: { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastMode: true, rerankerProvider: 'jina', embedding: EMB } });
  assert.equal(calls[0][0], 'beforeChange', 'the pack clock bills up to the switch first');
  assert.equal(calls.some((c) => c[0] === 'keyState'), false, 'a pack licence is not asked about again');

  assert.equal(await reconcilePackSwitch(deps), null, 'called again: nothing more');

  state.facts = { licencePremium: false, licenceIsPack: false };
  assert.equal(await reconcilePackSwitch(deps), 'restored');
  assert.equal(state.defaultModel, 'groq/llama');
  assert.equal(state.sttProvider, 'deepgram');
  assert.equal(state.reranker, 'jina');
  assert.deepEqual(state.embedding, EMB);
  assert.equal(state.fastMode, true);
  assert.deepEqual(state.memory, { keyId: 'k1', prev: {}, pack: true, ended: true });
});

test('a pack-only key after its pack ended is not switched again (no put-back / switch loop); a new pack on it is', async () => {
  const state = { defaultModel: 'gpt-5', sttProvider: 'soniox', fastMode: false, reranker: 'local', memory: { keyId: 'k1', prev: {}, pack: true, ended: true }, facts: { licencePremium: false, licenceIsPack: false } };
  const { deps, calls } = fakeDeps(state);
  assert.equal(await reconcilePackSwitch(deps), null);
  assert.equal(await reconcilePackSwitch(deps), null);
  assert.equal(calls.length, 0);
  assert.equal(state.defaultModel, 'gpt-5');
  // Pack 2 lands on the same key.
  state.facts = {};
  assert.equal(await reconcilePackSwitch(deps), 'switched');
  assert.equal(state.defaultModel, 'natively');
  assert.deepEqual(state.memory.prev, { defaultModel: 'gpt-5', sttProvider: 'soniox', rerankerProvider: 'local' });
});

test('the pack over with nothing left on Natively API: only the memory is marked ended', async () => {
  const state = { defaultModel: 'gpt-5', sttProvider: 'soniox', fastMode: false, reranker: 'jina', memory: { keyId: 'k1', prev: { defaultModel: 'groq/llama' }, pack: true }, facts: { licencePremium: false, licenceIsPack: false } };
  const { deps, calls } = fakeDeps(state);
  assert.equal(await reconcilePackSwitch(deps), 'forgot');
  assert.deepEqual(calls, [['write', {}, { keyId: 'k1', prev: {}, pack: true, ended: true }]]);
});

test('one unreadable licence read restores nothing: the pack must look gone twice', async () => {
  const state = { defaultModel: 'natively', sttProvider: 'natively', fastMode: false, memory: { keyId: 'k1', pack: true, prev: { defaultModel: 'groq/llama', sttProvider: 'deepgram' } }, goneConfirmed: false, facts: { licencePremium: false, licenceIsPack: false } };
  const { deps } = fakeDeps(state);
  assert.equal(await reconcilePackSwitch(deps), null);
  assert.equal(state.defaultModel, 'natively');
  state.goneConfirmed = true;
  assert.equal(await reconcilePackSwitch(deps), 'restored');
  assert.equal(state.defaultModel, 'groq/llama');
});

test('goneConfirmed hears every run, so a pack seen again resets the count', async () => {
  const seen = [];
  const state = { defaultModel: 'natively', sttProvider: 'natively', fastMode: false, memory: { keyId: 'k1', pack: true, prev: {} } };
  const { deps } = fakeDeps(state, { goneConfirmed: (g) => { seen.push(g); return false; } });
  await reconcilePackSwitch(deps);
  state.facts = { licencePremium: false, licenceIsPack: false };
  await reconcilePackSwitch(deps);
  assert.deepEqual(seen, [false, true]);
});

test('a plan key: asked about first; live moves everything, waiting for a running meeting in the background', async () => {
  const state = { plan: true, defaultModel: 'gpt-5', sttProvider: 'deepgram', fastMode: false, reranker: 'jina', embedding: EMB, memory: null, meeting: true };
  const { deps, calls } = fakeDeps(state);
  assert.equal(await reconcilePackSwitch(deps), null, 'a meeting is running: wait');
  assert.equal(calls.length, 0);
  state.meeting = false;
  assert.equal(await reconcilePackSwitch(deps), 'switched');
  assert.ok(calls.findIndex((c) => c[0] === 'keyState') < calls.findIndex((c) => c[0] === 'write'));
  assert.equal(state.defaultModel, 'natively');
  assert.equal(state.reranker, 'natively');
  assert.equal(state.memory.pack, undefined);
});

test('a plan key entered by the user moves now, even mid-meeting', async () => {
  const state = { plan: true, entered: true, defaultModel: 'gpt-5', sttProvider: 'deepgram', fastMode: false, memory: null, meeting: true };
  assert.equal(await reconcilePackSwitch(fakeDeps(state).deps), 'switched');
  assert.equal(state.sttProvider, 'natively');
});

test('a refused key, a pack that is over, or no answer: nothing moves', async () => {
  for (const keyState of [{ live: false }, null]) {
    const state = { plan: true, defaultModel: 'gpt-5', sttProvider: 'deepgram', fastMode: false, memory: null, keyState };
    assert.equal(await reconcilePackSwitch(fakeDeps(state).deps), null);
    assert.equal(state.defaultModel, 'gpt-5');
    assert.equal(state.memory, null);
  }
});

test('an allowance already run out stays where it is, and is not remembered', async () => {
  const state = { plan: true, defaultModel: 'gpt-5', sttProvider: 'deepgram', fastMode: false, reranker: 'jina', embedding: EMB, memory: null,
    keyState: { live: true, usedUp: new Set(['voice', 'knowledge']) } };
  assert.equal(await reconcilePackSwitch(fakeDeps(state).deps), 'switched');
  assert.equal(state.defaultModel, 'natively');
  assert.equal(state.sttProvider, 'deepgram');
  assert.equal(state.reranker, 'jina');
  assert.deepEqual(state.embedding, EMB);
  assert.deepEqual(state.memory.prev, { defaultModel: 'gpt-5' });
});

test('Fast Response off, or answering on Natively API: left as it is', async () => {
  const off = { defaultModel: 'gpt-5', sttProvider: 'natively', fastMode: false, fastOn: 'groq', memory: null };
  assert.equal(await reconcilePackSwitch(fakeDeps(off).deps), 'switched');
  assert.equal(off.fastMode, false);
  assert.equal('fastMode' in off.memory.prev, false);
  const nat = { defaultModel: 'gpt-5', sttProvider: 'natively', fastMode: true, fastOn: 'natively', memory: null };
  assert.equal(await reconcilePackSwitch(fakeDeps(nat).deps), 'switched');
  assert.equal(nat.fastMode, true);
  assert.equal('fastMode' in nat.memory.prev, false);
});

test('Fast Response remembered before it is turned off; a refused toggle leaves it on but remembered', async () => {
  const state = { defaultModel: 'groq/llama', sttProvider: 'natively', fastMode: true, fastOn: 'groq', memory: null, refuseFast: true };
  const { deps, calls } = fakeDeps(state);
  assert.equal(await reconcilePackSwitch(deps), 'switched');
  assert.equal(state.fastMode, true);
  assert.equal(state.memory.prev.fastMode, true);
  const writes = calls.filter((c) => c[0] === 'write');
  const toggle = calls.findIndex((c) => c[0] === 'setFastMode');
  assert.ok(calls.indexOf(writes[1]) < toggle, 'the memory is saved before the mode is turned off');
});

test('a refused save moves nothing and is tried again next time', async () => {
  const state = { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastMode: false, fastOn: null, memory: null, refuse: true, reranker: 'jina' };
  const { deps, calls } = fakeDeps(state);
  assert.equal(await reconcilePackSwitch(deps), null);
  assert.equal(state.defaultModel, 'groq/llama');
  assert.equal(state.reranker, 'jina');
  assert.equal(calls.some((c) => ['applyModel', 'applyStt', 'setReranker', 'setEmbedding'].includes(c[0])), false);
  state.refuse = false;
  assert.equal(await reconcilePackSwitch(deps), 'switched');
});

test('a throwing dependency never escapes', async () => {
  const state = { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastMode: false, memory: null };
  const { deps } = fakeDeps(state, { applyStt: async () => { throw new Error('audio busy'); } });
  assert.equal(await reconcilePackSwitch(deps), null);
});

// ── wiring pins ────────────────────────────────────────────────────────────
test('ipcHandlers runs the switch at launch, on every Pro watch and in checkProNow', () => {
  const src = read('../../ipcHandlers.ts');
  assert.match(src, /require\('\.\/services\/packs\/packNativelySwitch'\)/);
  const at = src.indexOf('checkProNow = () => {');
  assert.ok(at > 0);
  const body = src.slice(at, at + 600);
  // The switch before the watch, everywhere: the watch then reads the moved
  // providers and never stands Pro down just to bring it back.
  assert.match(body, /reconcilePackSwitchNow\(\);\s*\n\s*proWatch\.check\(\);/);
  assert.match(src, /setInterval\(\(\) => \{ reconcilePackSwitchNow\(\); proWatch\.check\(\); \}, PRO_WATCH_EVERY_MS\)/);
  assert.match(src, /reconcilePackSwitchNow\(\);\s*\n\s*proWatch\.check\(\);\s*\n\s*checkProNow = \(\) => \{/);
  // A gone pack is put back only once it looked gone on two runs apart.
  assert.match(src, /return now - packGoneSince >= 20_000;/);
  // An unreadable licence is not "no licence".
  assert.match(src, /const licence = storedLicenceFacts\(\);\s*\n\s*if \(!licence\) return;/);
  // Nor is a credential store that cannot be read (a locked Keychain, DPAPI
  // unavailable): it reads the licence as none without throwing.
  assert.match(src, /if \(cm\.isCredentialStoreDegraded\?\.\(\) \|\| !safeStorage\?\.isEncryptionAvailable\?\.\(\)\) return;/);
  // The pack's own key, never the key in use (it flips to the plan key while
  // the licence stays the pack's, which would switch the same pack again).
  const facts = src.slice(src.indexOf('const reconcilePackSwitchNow = ('), src.indexOf('const reconcilePackSwitchNow = (') + 5000);
  assert.match(facts, /const key: string \| undefined = cm\.getNativelyPackApiKey\?\.\(\) \|\| cm\.getMainNativelyApiKey\?\.\(\);/);
  assert.doesNotMatch(facts, /cm\.getNativelyApiKey\(\)/);
});

test('a cleared or refused key puts the pack\'s remembered settings back before the fallbacks', () => {
  const src = read('../CredentialsManager.ts');
  const at = src.indexOf('private applyNativelyAutoDefaultRevert(');
  const body = src.slice(at, at + 1200);
  const memo = body.indexOf('this.putBackPackSwitch(reason, changed);');
  const fallback = body.indexOf("this.credentials.defaultModel = 'gemini-3.1-flash-lite'");
  assert.ok(memo > 0 && fallback > memo, 'the pack memory is put back before the Gemini fallback');
  const put = src.slice(src.indexOf('private putBackPackSwitch('), src.indexOf('private putBackPackSwitch(') + 4000);
  // The reranker and embeddings come back too, embeddings through the
  // Retrieval settings path after this save.
  assert.match(put, /current\.provider === 'natively' && settings\.set\('reranker', \{ \.\.\.current, provider: prev\.rerankerProvider \}\)/);
  assert.match(put, /this\.packEmbeddingListener\?\.\(prev\.embedding\)/);
  assert.match(put, /this\.credentials\.nativelyPackSwitch = undefined;/);
  assert.match(put, /prev\.defaultModel && this\.credentials\.defaultModel === 'natively'/);
  assert.match(put, /if \(!settings\.get\('groqFastTextMode'\) && settings\.set\('groqFastTextMode', true\)\) \{\s*\n\s*try \{ this\.packFastModeListener\?\.\(true\); \}/);
  // ...and ipcHandlers makes it live, as set-groq-fast-text-mode does.
  const ipc = read('../../ipcHandlers.ts');
  assert.match(ipc, /CredentialsManager\.getInstance\(\)\.setPackFastModeListener\(applyFastModeLive\)/);
  assert.match(ipc, /const applyFastModeLive = \(on: boolean\): void => \{\s*\n\s*appState\.processingHelper\?\.getLLMHelper\?\.\(\)\?\.setGroqFastTextMode\?\.\(on\);/);
  assert.match(src, /changed\.defaultModel \|\| changed\.sttProvider \|\| hadPackSwitch\) this\.saveCredentials\(\)/);
  // One save for the settings and the memory.
  assert.match(src, /public applyNativelyPackSwitch\(/);
});

// ── the real LLMHelper (built bundle; npm test builds it first) ─────────────
// The switch turns Fast Response Mode off when Auto would answer on the user's
// own Groq / Gemini key. Prove on the production classifiers that this is what
// clears the pack rule's Fast Response block.
const bundle = path.resolve(here, '../../../dist-electron/electron/LLMHelper.js');
test('real LLMHelper: Fast Response Mode off with the AI on Natively API reads as no other provider', { skip: !existsSync(bundle) && 'build:electron not run' }, () => {
  process.env.CODEX_HOME ||= mkdtempSync(path.join(os.tmpdir(), 'natively-codex-home-'));
  const require = createRequire(import.meta.url);
  const electronPath = require.resolve('electron');
  require.cache[electronPath] ||= {
    id: electronPath, filename: electronPath, loaded: true,
    exports: {
      app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
      safeStorage: { isEncryptionAvailable: () => false },
    },
  };
  const { LLMHelper } = require(bundle);
  const helper = (pick) => {
    const h = Object.create(LLMHelper.prototype);
    h.groqFastTextMode = true;
    h.isLocalOnlyMode = false;
    h.useOllama = false;
    h.currentModelId = 'natively';
    h._groqLocalDisabled = false;
    Object.defineProperty(h, 'fastModelId', { get: () => pick });
    for (const k of ['openaiClient', 'claudeClient', 'deepseekClient', 'groqClient', 'client',
      'openrouterClient', 'litellmClient', 'nvidiaNimClient', 'ninerouterClient']) h[k] = {};
    h.hasFluxionCredential = () => true;
    h.isCodexAvailable = () => true;
    h.codexCliConfig = { model: 'gpt-5.5' };
    return h;
  };
  // Auto with the user's own keys connected: answers on one of them, so the
  // pack rule blocks (the reason the switch touches Fast Response at all).
  const auto = helper(null).fastResponseFamilyNow();
  assert.ok(auto && auto !== 'natively', `Auto picked ${auto}`);
  // After the switch, Fast Response Mode off: nothing but Natively API answers.
  const off = helper(null); off.groqFastTextMode = false;
  assert.equal(off.fastResponseFamilyNow(), null);
  // Why not point it at Natively API instead: 'natively' is no Background Model
  // the picker offers (Settings would label it "not supported").
  assert.equal(LLMHelper.prototype.canDispatchFastModel.call(helper(null), 'natively'), false);
});
