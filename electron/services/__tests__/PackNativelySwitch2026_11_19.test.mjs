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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  const memory = { keyId: 'old', prev: { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastModel: null } };
  const p = planPackSwitch(packFacts({ keyId: 'new', memory, savedModel: 'natively', liveModel: 'natively', sttProvider: 'natively' }));
  assert.equal(p.kind, 'switch');
  assert.deepEqual(p.prev, { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastModel: null });
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
  const prev = { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastModel: null };
  assert.deepEqual(
    packRestoreChange(prev, { defaultModel: 'natively', sttProvider: 'natively', fastModel: 'natively' }),
    { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastModel: null },
  );
  assert.deepEqual(
    packRestoreChange(prev, { defaultModel: 'gpt-5', sttProvider: 'soniox', fastModel: 'gpt-5' }),
    {},
  );
  // Fast Response never changed by the switch: not touched.
  assert.deepEqual(packRestoreChange({ defaultModel: 'x' }, { defaultModel: 'natively', sttProvider: 'natively', fastModel: 'natively' }), { defaultModel: 'x' });
});

function fakeDeps(state, over = {}) {
  const calls = [];
  const deps = {
    facts: () => packFacts({
      memory: state.memory, savedModel: state.defaultModel, liveModel: state.defaultModel, sttProvider: state.sttProvider, ...state.facts,
    }),
    fastModel: () => state.fastModel,
    savedModel: () => state.defaultModel,
    sttProvider: () => state.sttProvider,
    write: (change, memory) => {
      calls.push(['write', change, memory]);
      if (state.refuse) return false;
      if (change.defaultModel !== undefined) state.defaultModel = change.defaultModel;
      if (change.sttProvider !== undefined) state.sttProvider = change.sttProvider;
      if ('fastModel' in change) state.fastModel = change.fastModel;
      state.memory = memory;
      return true;
    },
    beforeChange: () => calls.push(['beforeChange']),
    applyModel: () => calls.push(['applyModel']),
    fastFamilyNow: () => (state.defaultModel === 'natively' && state.fastModel !== 'natively' ? state.fastOn : null),
    applyStt: async () => { calls.push(['applyStt']); },
    log: () => {},
    ...over,
  };
  return { deps, calls };
}

test('switch, then the pack ends: everything comes back as it was', async () => {
  const state = { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastModel: null, fastOn: 'groq', memory: null };
  const { deps, calls } = fakeDeps(state);
  assert.equal(await reconcilePackSwitch(deps), 'switched');
  assert.equal(state.defaultModel, 'natively');
  assert.equal(state.sttProvider, 'natively');
  // Fast Response on Auto would have picked the user's Groq: moved too.
  assert.equal(state.fastModel, 'natively');
  assert.deepEqual(state.memory, { keyId: 'k1', prev: { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastModel: null } });
  assert.equal(calls[0][0], 'beforeChange', 'the pack clock bills up to the switch first');
  assert.ok(calls.some((c) => c[0] === 'applyStt'));

  // Called again: nothing more.
  assert.equal(await reconcilePackSwitch(deps), null);

  state.facts = { licencePremium: false, licenceIsPack: false };
  assert.equal(await reconcilePackSwitch(deps), 'restored');
  assert.equal(state.defaultModel, 'groq/llama');
  assert.equal(state.sttProvider, 'deepgram');
  assert.equal(state.fastModel, null);
  assert.equal(state.memory, null);
});

test('Fast Response off or already on Natively API: left as it is', async () => {
  const state = { defaultModel: 'gpt-5', sttProvider: 'natively', fastModel: 'gpt-5-mini', fastOn: null, memory: null };
  const { deps } = fakeDeps(state);
  assert.equal(await reconcilePackSwitch(deps), 'switched');
  assert.equal(state.fastModel, 'gpt-5-mini');
  assert.equal('fastModel' in state.memory.prev, false);
});

test('a refused save moves nothing and is tried again next time', async () => {
  const state = { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastModel: null, fastOn: null, memory: null, refuse: true };
  const { deps, calls } = fakeDeps(state);
  assert.equal(await reconcilePackSwitch(deps), null);
  assert.equal(state.defaultModel, 'groq/llama');
  assert.equal(calls.some((c) => c[0] === 'applyModel' || c[0] === 'applyStt'), false);
  state.refuse = false;
  assert.equal(await reconcilePackSwitch(deps), 'switched');
});

test('a throwing dependency never escapes', async () => {
  const state = { defaultModel: 'groq/llama', sttProvider: 'deepgram', fastModel: null, memory: null };
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
  assert.match(body, /reconcilePackSwitchNow\(\);/);
  assert.match(src, /setInterval\(\(\) => \{ proWatch\.check\(\); reconcilePackSwitchNow\(\); \}, PRO_WATCH_EVERY_MS\)/);
  assert.match(src, /proWatch\.check\(\);\s*\n\s*reconcilePackSwitchNow\(\);\s*\n\s*checkProNow = \(\) => \{/);
  // An unreadable licence is not "no licence".
  assert.match(src, /const licence = storedLicenceFacts\(\);\s*\n\s*if \(!licence\) return;/);
});

test('a cleared or refused key puts the pack\'s remembered settings back before the fallbacks', () => {
  const src = read('../CredentialsManager.ts');
  const at = src.indexOf('private applyNativelyAutoDefaultRevert(');
  const body = src.slice(at, at + 1200);
  const memo = body.indexOf('this.putBackPackSwitch(reason, changed);');
  const fallback = body.indexOf("this.credentials.defaultModel = 'gemini-3.1-flash-lite'");
  assert.ok(memo > 0 && fallback > memo, 'the pack memory is put back before the Gemini fallback');
  const put = src.slice(src.indexOf('private putBackPackSwitch('), src.indexOf('private putBackPackSwitch(') + 1400);
  assert.match(put, /this\.credentials\.nativelyPackSwitch = undefined;/);
  assert.match(put, /prev\.defaultModel && this\.credentials\.defaultModel === 'natively'/);
  assert.match(src, /changed\.defaultModel \|\| changed\.sttProvider \|\| hadPackSwitch\) this\.saveCredentials\(\)/);
  // One save for the settings and the memory.
  assert.match(src, /public applyNativelyPackSwitch\(/);
});
