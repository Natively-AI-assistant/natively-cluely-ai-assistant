// 2026-11-16 (Evin). A Pro pack gives Natively Pro only while the AI AND the
// speech-to-text both run on Natively API. Either on another provider: Pro is
// off, the pack still serves the Natively part (only that part's allowance is
// used) and the meeting hours do not count down. Switching back restores Pro.
//
// The rule is pure (no Electron, no process.platform), so these tests are the
// same on macOS and Windows: the provider ids come from CredentialsManager,
// which hides the Keychain / DPAPI storage difference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  packProBlock, packHoursCount, isPackLicence, PACK_LICENCE_PLANS, restoreAfterPackStandDown,
} from '../packs/packProRule.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pack = { licenceProvider: 'natively_api', licencePlan: 'pack_light' };

test('a pack on Natively API for both keeps Pro', () => {
  assert.equal(packProBlock({ ...pack, defaultModel: 'natively', sttProvider: 'natively' }), null);
  assert.equal(packProBlock({ ...pack, licencePlan: 'pack_heavy', defaultModel: 'natively', sttProvider: 'natively' }), null);
});

// Any provider that is not Natively API, not a list of named ones (Evin: "that
// was an example, any other provider I meant").
const OTHER_STT = ['deepgram', 'soniox', 'elevenlabs', 'openai', 'groq', 'google', 'azure', 'ibmwatson', 'qwen', 'nvidia_nim', 'local-whisper', 'apple-speech', 'none'];
const OTHER_AI = ['gemini-3.1-flash-lite', 'gpt-5', 'claude-sonnet-5-5', 'deepseek-flash', 'llama3:8b', '6b1c9a7e-custom-provider-uuid', 'curl-provider-id', ''];

test('Natively AI + any other STT: Pro off, blamed on speech-to-text', () => {
  for (const stt of OTHER_STT) assert.equal(packProBlock({ ...pack, defaultModel: 'natively', sttProvider: stt }), 'stt', stt);
});

test('Natively STT + any other AI: Pro off, blamed on the AI', () => {
  for (const ai of OTHER_AI) assert.equal(packProBlock({ ...pack, defaultModel: ai, sttProvider: 'natively' }), 'ai', ai);
});

test('Fast Response on the user\'s own provider counts as the AI being off Natively API', () => {
  for (const family of ['groq', 'openai', 'claude', 'gemini', 'deepseek', 'openrouter', 'codex']) {
    assert.equal(packProBlock({ ...pack, defaultModel: 'natively', fastFamily: family, sttProvider: 'natively' }), 'ai', family);
    assert.equal(packHoursCount('natively', 'natively', family), false, family);
  }
  // Off, or answering on Natively API itself: Pro stays.
  for (const family of [null, undefined, 'natively']) {
    assert.equal(packProBlock({ ...pack, defaultModel: 'natively', fastFamily: family, sttProvider: 'natively' }), null, String(family));
    assert.equal(packHoursCount('natively', 'natively', family), true, String(family));
  }
});

test('both on other providers: Pro off for both', () => {
  assert.equal(packProBlock({ ...pack, defaultModel: 'gpt-5', sttProvider: 'soniox' }), 'both');
  assert.equal(packProBlock({ ...pack, defaultModel: null, sttProvider: undefined }), 'both');
});

test('only a pack licence is affected', () => {
  for (const plan of ['pro', 'max', 'ultra', 'lifetime', undefined]) {
    assert.equal(packProBlock({ licenceProvider: 'natively_api', licencePlan: plan, defaultModel: 'gpt-5', sttProvider: 'deepgram' }), null, String(plan));
  }
  // A Dodo or Gumroad licence is never a pack, whatever its plan field says.
  assert.equal(packProBlock({ licenceProvider: 'dodo', licencePlan: 'pack_light', defaultModel: 'gpt-5', sttProvider: 'deepgram' }), null);
  assert.equal(isPackLicence('natively_api', 'pack_heavy'), true);
  assert.equal(isPackLicence('gumroad', 'pack_heavy'), false);
});

test('the hours count only with both on Natively API', () => {
  assert.equal(packHoursCount('natively', 'natively'), true);
  for (const stt of OTHER_STT) assert.equal(packHoursCount('natively', stt), false, stt);
  for (const ai of OTHER_AI) assert.equal(packHoursCount(ai, 'natively'), false, ai);
  assert.equal(packHoursCount(undefined, undefined), false);
});

// CI checks out only `premium`, not the server: there the parity check skips.
const SERVER_PLANS = path.join(here, '../../../natively-api/lib/plans.js');
test('pack plans match the server (natively-api lib/plans.js PACKS)', { skip: !existsSync(SERVER_PLANS) && 'natively-api not checked out' }, () => {
  const plans = readFileSync(SERVER_PLANS, 'utf8');
  const block = plans.slice(plans.indexOf('export const PACKS'), plans.indexOf('export const PACK_PLANS'));
  const names = [...block.matchAll(/^\s+(pack_\w+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(names, [...PACK_LICENCE_PLANS].sort());
});

test('every window is told the licence with the pack rule applied', () => {
  const ipc = readFileSync(path.join(here, '../../ipcHandlers.ts'), 'utf8');
  assert.match(ipc, /safeHandle\('license:check-premium', async \(\) => licencePremiumForWindows\(\)\)/);
  assert.match(ipc, /packProPaused: block/);
  // A provider change re-reads Pro at once, not 30 s later.
  for (const handler of ["'set-default-model'", "'set-model'", "'set-stt-provider'"]) {
    const at = ipc.indexOf(`safeHandle(${handler}`) >= 0 ? ipc.indexOf(`safeHandle(${handler}`) : ipc.indexOf(`${handler},`);
    assert.ok(at >= 0, handler);
    assert.ok(ipc.slice(at, at + 3000).includes('checkProNow()'), `${handler} re-checks Pro`);
  }
  const access = readFileSync(path.join(here, '../proAccess.ts'), 'utf8');
  assert.match(access, /if \(isLicencePremium\(\)\) return true;/);
});

// Switching back puts back what the stand-down switched off.
function restoreWorld(over = {}) {
  const st = { pro: true, packLicence: true, kSetting: true, kOn: false, saved: 'mode_interview', active: null, modes: ['mode_interview'], applied: [], cleared: 0, ok: true, ...over };
  const deps = {
    proActive: () => st.pro,
    packLicence: () => st.packLicence,
    knowledgeSetting: () => st.kSetting,
    knowledgeSwitchedOn: () => st.kOn,
    setKnowledge: (on) => { st.kOn = on; },
    savedModeId: () => st.saved,
    clearSavedModeId: () => { st.saved = null; st.cleared++; },
    activeModeId: () => st.active,
    modeExists: (id) => st.modes.includes(id),
    applyMode: async (id) => { st.applied.push(id); st.active = id; return { success: st.ok }; },
  };
  return { st, deps };
}

test('Pro back: Profile Intelligence and the Pro mode come back', async () => {
  const { st, deps } = restoreWorld();
  assert.deepEqual(await restoreAfterPackStandDown(deps), { knowledge: true, modeId: 'mode_interview' });
  assert.equal(st.kOn, true);
  assert.deepEqual(st.applied, ['mode_interview']);
  assert.equal(st.saved, null, 'used once');
  // A second flip back on does not apply it again.
  assert.deepEqual(await restoreAfterPackStandDown(deps), { knowledge: false, modeId: null });
  assert.deepEqual(st.applied, ['mode_interview']);
});

test('still no Pro: nothing is put back and the saved mode is kept', async () => {
  const { st, deps } = restoreWorld({ pro: false });
  assert.deepEqual(await restoreAfterPackStandDown(deps), { knowledge: false, modeId: null });
  assert.equal(st.kOn, false);
  assert.equal(st.saved, 'mode_interview');
});

test('Profile Intelligence the user switched off stays off', async () => {
  const { st, deps } = restoreWorld({ kSetting: false, saved: null });
  await restoreAfterPackStandDown(deps);
  assert.equal(st.kOn, false);
});

test('a mode picked since wins; a deleted mode is not put back', async () => {
  const picked = restoreWorld({ active: 'mode_general' });
  assert.equal((await restoreAfterPackStandDown(picked.deps)).modeId, null);
  assert.deepEqual(picked.st.applied, []);
  assert.equal(picked.st.saved, null);
  const gone = restoreWorld({ modes: [] });
  assert.equal((await restoreAfterPackStandDown(gone.deps)).modeId, null);
  assert.deepEqual(gone.st.applied, []);
});

test('Pro back from a plan or lifetime licence does not bring an old pack mode back', async () => {
  const { st, deps } = restoreWorld({ packLicence: false });
  const done = await restoreAfterPackStandDown(deps);
  assert.equal(done.modeId, null);
  assert.deepEqual(st.applied, []);
  assert.equal(st.saved, null, 'forgotten, so it cannot come back later either');
  assert.equal(done.knowledge, true, 'Profile Intelligence follows its own saved setting');
});

test('a failing dependency never throws', async () => {
  const { deps } = restoreWorld();
  deps.applyMode = async () => { throw new Error('db locked'); };
  assert.deepEqual(await restoreAfterPackStandDown(deps), { knowledge: true, modeId: null });
});

test('the stand-down saves the mode only for the pack rule, and the watch restores before telling windows', () => {
  const ipc = readFileSync(path.join(here, '../../ipcHandlers.ts'), 'utf8');
  const down = ipc.slice(ipc.indexOf('const standDownIfNoPro'), ipc.indexOf('const restorePackStandDown'));
  assert.match(down, /currentPackProBlock\(\) !== null/);
  assert.match(down, /set\('packProStandDownModeId', stored\?\.id && currentPackProBlock\(\) !== null \? stored\.id : null\)/);
  assert.match(ipc, /allowed \? restorePackStandDown\(\) : Promise\.resolve\(\)\)\.finally/);
  assert.match(ipc, /registeredHandlers.get\('modes:set-active'\)/);
});

test('the licence is read at most every 10 s on the Pro hot path, and only a pack reads settings', () => {
  const access = readFileSync(path.join(here, '../proAccess.ts'), 'utf8');
  assert.match(access, /const LICENCE_FACTS_MS = 10_000;/);
  const block = access.slice(access.indexOf('export function currentPackProBlock'), access.indexOf('export function licenceIsPack'));
  assert.match(block, /readLicenceFacts\(\)/);
  assert.doesNotMatch(block, /getLicenseDetails\(\)/);
  assert.ok(block.indexOf('isPackLicence(details.provider, details.plan)') < block.indexOf('credentials()'), 'non-pack licences stop before any settings read');
});

test('a provider switch bills the clock at the switch, and STT re-checks Pro before its rebuild', () => {
  const ipc = readFileSync(path.join(here, '../../ipcHandlers.ts'), 'utf8');
  assert.match(ipc, /getPackMeetingClock\(\)\.countsChanged\(\)/);
  const at = ipc.indexOf("'set-stt-provider',");
  const body = ipc.slice(at, at + 4000);
  assert.ok(body.indexOf('checkProNow()') < body.indexOf('await appState.reconfigureSttProvider()'));
  assert.match(ipc, /fastResponseFamilyNow/);
});
