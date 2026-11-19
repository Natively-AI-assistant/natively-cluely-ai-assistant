// 2026-11-19 (Evin). A Pro pack moves the AI and speech-to-text to Natively
// API by itself, once per pack key, and puts them back when the pack is gone.
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
  planPackSwitch, packRestoreChange, reconcilePackSwitch, ON_DEVICE_STT,
} from '../packs/packNativelySwitch.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, rel), 'utf8');

const packFacts = (over = {}) => ({
  licencePremium: true,
  licenceProvider: 'natively_api',
  licenceIsPack: true,
  keyId: 'k1',
  memory: null,
  savedModel: 'groq/llama',
  liveModel: 'groq/llama',
  sttProvider: 'deepgram',
  aiStaysWithUser: false,
  ...over,
});

test('a pack on the user\'s own AI and speech-to-text: both move, the old values are remembered', () => {
  assert.deepEqual(planPackSwitch(packFacts()), {
    kind: 'switch', keyId: 'k1', ai: true, stt: true,
    prev: { defaultModel: 'groq/llama', sttProvider: 'deepgram' },
  });
});

test('only what is off Natively API moves', () => {
  const p = planPackSwitch(packFacts({ savedModel: 'natively', liveModel: 'natively' }));
  assert.equal(p.ai, false);
  assert.equal(p.stt, true);
  assert.deepEqual(p.prev, { sttProvider: 'deepgram' });
  // Already all on Natively API: still recorded, so a later own choice is left alone.
  const all = planPackSwitch(packFacts({ savedModel: 'natively', liveModel: 'natively', sttProvider: 'natively' }));
  assert.equal(all.kind, 'switch');
  assert.equal(all.ai || all.stt, false);
});

test('the overlay picker\'s live model off Natively API counts, the saved one is what is remembered', () => {
  const p = planPackSwitch(packFacts({ savedModel: 'natively', liveModel: 'gpt-5', sttProvider: 'natively' }));
  assert.equal(p.ai, true);
  assert.deepEqual(p.prev, {});
});

test('once per pack key: a user who moved back is left alone', () => {
  const memory = { keyId: 'k1', prev: { defaultModel: 'groq/llama' } };
  assert.deepEqual(planPackSwitch(packFacts({ memory })), { kind: 'none' });
});

test('a new pack key switches again and keeps the settings from before the first switch', () => {
  const memory = { keyId: 'old', prev: { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastMode: true } };
  const p = planPackSwitch(packFacts({ keyId: 'new', memory, savedModel: 'natively', liveModel: 'natively', sttProvider: 'natively' }));
  assert.equal(p.kind, 'switch');
  assert.deepEqual(p.prev, { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastMode: true });
  // ...but a value the user changed since is what is remembered now.
  const q = planPackSwitch(packFacts({ keyId: 'new', memory, savedModel: 'claude-sonnet-5-5', liveModel: 'claude-sonnet-5-5', sttProvider: 'natively' }));
  assert.equal(q.prev.defaultModel, 'claude-sonnet-5-5');
});

test('nothing moves while the AI or speech-to-text stays on this computer or the user\'s own endpoint', () => {
  assert.deepEqual(planPackSwitch(packFacts({ aiStaysWithUser: true })), { kind: 'none' });
  for (const stt of ON_DEVICE_STT) {
    assert.deepEqual(planPackSwitch(packFacts({ sttProvider: stt })), { kind: 'none' }, stt);
  }
});

test('no key, no switch; not a pack, no switch', () => {
  assert.deepEqual(planPackSwitch(packFacts({ keyId: null })), { kind: 'none' });
  assert.deepEqual(planPackSwitch(packFacts({ licenceIsPack: false })), { kind: 'none' });
  assert.deepEqual(planPackSwitch(packFacts({ licencePremium: false })), { kind: 'none' });
});

test('the pack gone: restore; a Natively API plan took over: keep Natively API, forget', () => {
  const memory = { keyId: 'k1', prev: { defaultModel: 'groq/llama' } };
  assert.deepEqual(planPackSwitch(packFacts({ memory, licencePremium: false, licenceIsPack: false })), { kind: 'restore', prev: memory.prev });
  // A lifetime / Dodo licence on the user's own keys: their settings come back.
  assert.equal(planPackSwitch(packFacts({ memory, licenceProvider: 'dodo', licenceIsPack: false })).kind, 'restore');
  assert.deepEqual(planPackSwitch(packFacts({ memory, licenceIsPack: false })), { kind: 'forget' });
});

test('restore puts back only what is still on Natively API', () => {
  const prev = { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastMode: true };
  assert.deepEqual(
    packRestoreChange(prev, { defaultModel: 'natively', sttProvider: 'natively', fastMode: false }),
    { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastMode: true },
  );
  assert.deepEqual(
    packRestoreChange(prev, { defaultModel: 'gpt-5', sttProvider: 'soniox', fastMode: true }),
    {},
  );
  // Fast Response Mode never changed by the switch: not touched.
  assert.deepEqual(packRestoreChange({ defaultModel: 'x' }, { defaultModel: 'natively', sttProvider: 'natively', fastMode: false }), { defaultModel: 'x' });
});

function fakeDeps(state, over = {}) {
  const calls = [];
  const deps = {
    facts: () => packFacts({
      memory: state.memory, savedModel: state.defaultModel, liveModel: state.defaultModel, sttProvider: state.sttProvider, ...state.facts,
    }),
    savedModel: () => state.defaultModel,
    sttProvider: () => state.sttProvider,
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
    beforeChange: () => calls.push(['beforeChange']),
    applyModel: () => calls.push(['applyModel']),
    fastFamilyNow: () => (state.defaultModel === 'natively' && state.fastMode ? state.fastOn : null),
    applyStt: async () => { calls.push(['applyStt']); },
    // Tests confirm a gone pack at once unless they say otherwise.
    goneConfirmed: (gone) => gone && state.goneConfirmed !== false,
    log: () => {},
    ...over,
  };
  return { deps, calls };
}

test('switch, then the pack ends: everything comes back as it was', async () => {
  const state = { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastMode: true, fastOn: 'groq', memory: null };
  const { deps, calls } = fakeDeps(state);
  assert.equal(await reconcilePackSwitch(deps), 'switched');
  assert.equal(state.defaultModel, 'natively');
  assert.equal(state.sttProvider, 'natively');
  // Fast Response on Auto would have answered on the user's Groq: turned off.
  assert.equal(state.fastMode, false);
  assert.deepEqual(state.memory, { keyId: 'k1', prev: { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastMode: true } });
  assert.equal(calls[0][0], 'beforeChange', 'the pack clock bills up to the switch first');
  assert.ok(calls.some((c) => c[0] === 'applyStt'));

  // Called again: nothing more.
  assert.equal(await reconcilePackSwitch(deps), null);

  state.facts = { licencePremium: false, licenceIsPack: false };
  assert.equal(await reconcilePackSwitch(deps), 'restored');
  assert.equal(state.defaultModel, 'groq/llama');
  assert.equal(state.sttProvider, 'deepgram');
  assert.equal(state.fastMode, true);
  assert.equal(state.memory, null);
});

test('one unreadable licence read restores nothing: the pack must look gone twice', async () => {
  const state = { defaultModel: 'natively', sttProvider: 'natively', fastMode: false, memory: { keyId: 'k1', prev: { defaultModel: 'groq/llama', sttProvider: 'deepgram' } }, goneConfirmed: false, facts: { licencePremium: false, licenceIsPack: false } };
  const { deps } = fakeDeps(state);
  assert.equal(await reconcilePackSwitch(deps), null);
  assert.equal(state.defaultModel, 'natively');
  assert.ok(state.memory);
  state.goneConfirmed = true;
  assert.equal(await reconcilePackSwitch(deps), 'restored');
  assert.equal(state.defaultModel, 'groq/llama');
});

test('the pack over with nothing left on Natively API: only the memory goes, so a new pack on the same key switches again', async () => {
  // Review 2026-11-19: the memory used to stay, and every pack lands on the
  // customer's one pack key, so a second pack bought later switched nothing.
  const memory = { keyId: 'k1', prev: { defaultModel: 'groq/llama' } };
  const state = { defaultModel: 'gpt-5', sttProvider: 'soniox', fastMode: false, memory, facts: { licencePremium: false, licenceIsPack: false } };
  const { deps, calls } = fakeDeps(state);
  assert.equal(await reconcilePackSwitch(deps), 'forgot');
  assert.deepEqual(calls, [['write', {}, null]], 'nothing but the memory is written');
  assert.equal(state.memory, null);
  assert.equal(state.defaultModel, 'gpt-5');
  // Pack 2 on the same key: switched like the first.
  state.facts = {};
  assert.equal(await reconcilePackSwitch(deps), 'switched');
  assert.equal(state.defaultModel, 'natively');
  assert.equal(state.memory.keyId, 'k1');
});

test('goneConfirmed hears every run, so a pack seen again resets the count', async () => {
  const seen = [];
  const state = { defaultModel: 'natively', sttProvider: 'natively', fastMode: false, memory: { keyId: 'k1', prev: {} } };
  const { deps } = fakeDeps(state, { goneConfirmed: (g) => { seen.push(g); return false; } });
  await reconcilePackSwitch(deps);
  state.facts = { licencePremium: false, licenceIsPack: false };
  await reconcilePackSwitch(deps);
  assert.deepEqual(seen, [false, true]);
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
  const state = { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastMode: false, fastOn: null, memory: null, refuse: true };
  const { deps, calls } = fakeDeps(state);
  assert.equal(await reconcilePackSwitch(deps), null);
  assert.equal(state.defaultModel, 'groq/llama');
  assert.equal(calls.some((c) => c[0] === 'applyModel' || c[0] === 'applyStt'), false);
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
  const facts = src.slice(src.indexOf('const reconcilePackSwitchNow = (): void => {'), src.indexOf('const reconcilePackSwitchNow = (): void => {') + 3000);
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
  const put = src.slice(src.indexOf('private putBackPackSwitch('), src.indexOf('private putBackPackSwitch(') + 2200);
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
  // aiStaysWithUser: cloud keys move, Ollama and local-only do not.
  assert.equal(helper(null).aiStaysWithUser(), false);
  const ollama = helper(null); ollama.useOllama = true;
  assert.equal(ollama.aiStaysWithUser(), true);
  const local = helper(null); local.isLocalOnlyMode = true;
  assert.equal(local.aiStaysWithUser(), true);
});
