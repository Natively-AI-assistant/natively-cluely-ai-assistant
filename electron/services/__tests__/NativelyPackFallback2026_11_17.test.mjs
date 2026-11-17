// 2026-11-17 (Evin). One app, two Natively keys: the server keeps packs and
// monthly/yearly plans on separate keys, and the app holds both. The plan's key
// is the saved key; a pack key pasted beside it is held, and takes over while
// the plan's allowance is used up, until the plan refills or the pack ends.
//
// The controller is pure (every dependency injected), so these tests are the
// behaviour macOS and Windows both get: nothing in it, or in its wiring, branches
// on the operating system. Physical runs on both are still owed for the voice
// pipeline rebuild and the Settings row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  createNativelyPackFallback, decideKeySlot, familyOf, isPlanAllowanceRefusal, UNKNOWN_REFILL_HOLD_MS,
} from '../packs/nativelyPackFallback.ts';
import { createPackMeetingClock, TICK_INTERVAL_MS } from '../packs/PackMeetingClock.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(__dirname, '..', '..', '..', rel), 'utf8');

const MAIN = 'natively_sk_' + 'm'.repeat(40);
const PACK = 'natively_sk_' + 'p'.repeat(40);
const NOW = Date.parse('2026-11-17T12:00:00Z');
const REFILL = '2026-12-01T00:00:00.000Z';

const maxUsage = { ok: true, plan: 'max', billing_period: 'monthly', quota_resets_at: REFILL };
const heavyUsage = { ok: true, plan: 'pack_heavy', billing_period: 'pack', pack: { ended: false } };

function world(over = {}) {
  let now = over.now ?? NOW;
  const store = { main: 'main' in over ? over.main : MAIN, pack: 'pack' in over ? over.pack : PACK, until: over.until };
  const usage = { [MAIN]: maxUsage, [PACK]: heavyUsage, ...(over.usage || {}) };
  const resyncs = [];
  const notes = [];
  const timers = [];
  const fetched = [];
  const fb = createNativelyPackFallback({
    getMainKey: () => store.main,
    getPackKey: () => store.pack,
    getInUseUntil: () => store.until,
    setInUseUntil: (iso) => { store.until = iso || undefined; },
    fetchUsage: async (key) => {
      fetched.push(key);
      const u = usage[key];
      if (u === 'throw') throw new Error('offline');
      return u ?? { ok: false, error: 'invalid_key', status: 401 };
    },
    resync: async (reason) => { resyncs.push(reason); },
    notify: (s) => notes.push(s),
    isPlaceholderKey: (k) => k === '__trial__',
    now: () => now,
    schedule: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return () => { t.live = false; }; },
    log: { log() {}, warn() {} },
  });
  return { fb, store, usage, resyncs, notes, timers, fetched, advance: (ms) => { now += ms; } };
}

test('which refusals mean "the plan is used up"', () => {
  for (const code of ['ai_quota_exceeded', 'transcription_quota_exceeded', 'quota_exceeded', 'plan_limit']) assert.equal(isPlanAllowanceRefusal(code), true, code);
  for (const code of ['subscription_inactive', 'rate_limited', 'lifetime_exceeded', '', null]) assert.equal(isPlanAllowanceRefusal(code), false, String(code));
  assert.equal(familyOf({ plan: 'pack_light' }), 'pack');
  assert.equal(familyOf({ plan: 'max', billing_period: 'yearly' }), 'subscription');
  assert.equal(familyOf({}), null);
});

test('where a pasted key goes', () => {
  const d = (newUsage, mainUsage, extra = {}) => decideKeySlot({ newKey: 'NEW', mainKey: MAIN, packKey: undefined, newUsage, mainUsage, ...extra });
  assert.equal(d(heavyUsage, maxUsage), 'pack', 'a pack beside a live plan is held');
  assert.equal(d(maxUsage, heavyUsage), 'swap', 'a plan over a live pack holds the pack');
  assert.equal(d(maxUsage, { ...heavyUsage, pack: { ended: true } }), 'main', 'an ended pack is simply replaced');
  assert.equal(d(maxUsage, maxUsage), 'main', 'plan over plan: replaced, as before');
  assert.equal(d(heavyUsage, heavyUsage), 'main', 'pack over pack: replaced, as before');
  assert.equal(d({ ok: false }, maxUsage), 'main', 'a refused key: the save reports it, as before');
  assert.equal(d(heavyUsage, { ok: false }), 'main', 'a saved key that no longer works is replaced');
  assert.equal(decideKeySlot({ newKey: PACK, mainKey: MAIN, packKey: PACK, newUsage: null, mainUsage: null }), 'same');
  assert.equal(decideKeySlot({ newKey: 'NEW', mainKey: undefined, newUsage: heavyUsage, mainUsage: null }), 'main', 'no saved key');
  assert.equal(decideKeySlot({ newKey: 'NEW', mainKey: '__trial__', mainIsPlaceholder: true, newUsage: heavyUsage, mainUsage: null }), 'main', 'a trial is not a plan');
});

test('slotForSave asks the server about both keys', async () => {
  const w = world({ pack: undefined, usage: { NEWPACK: heavyUsage } });
  assert.equal(await w.fb.slotForSave('NEWPACK'), 'pack');
  assert.deepEqual(w.fetched.sort(), [MAIN, 'NEWPACK'].sort());
  const t = world({ main: '__trial__', pack: undefined });
  assert.equal(await t.fb.slotForSave(PACK), 'main');
  assert.equal(t.fetched.length, 0, 'a trial never asks');
});

test('the plan used up: the held pack takes over until the plan refills', async () => {
  const w = world();
  await w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  assert.equal(w.store.until, REFILL);
  assert.deepEqual(w.resyncs, ['plan used up']);
  assert.deepEqual(w.notes.map((n) => [n.inUse, n.until, n.reason]), [[true, REFILL, 'plan_used_up']]);
  assert.equal(w.timers.filter((t) => t.live).length, 1, 'a timer for the way back');
  assert.ok(w.timers[0].ms <= 6 * 3600_000, 'long waits re-arm, never overflow setTimeout');
  // a second refusal (the other voice channel, the AI) while in use changes nothing
  await w.fb.onPlanLimit({ code: 'transcription_quota_exceeded', onTrial: false });
  assert.equal(w.resyncs.length, 1);
});

test('two refusals at once switch once', async () => {
  const w = world();
  await Promise.all([
    w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false }),
    w.fb.onPlanLimit({ code: 'transcription_quota_exceeded', onTrial: false }),
  ]);
  assert.equal(w.resyncs.length, 1);
});

test('nothing switches for a trial, another error, no held pack, a trial key, or a dead pack', async () => {
  for (const [over, limit] of [
    [{}, { code: 'ai_quota_exceeded', onTrial: true }],
    [{}, { code: 'subscription_inactive', onTrial: false }],
    [{ pack: undefined }, { code: 'ai_quota_exceeded', onTrial: false }],
    [{ main: '__trial__' }, { code: 'ai_quota_exceeded', onTrial: false }],
    [{ usage: { [PACK]: { ok: false, error: 'subscription_inactive', status: 403 } } }, { code: 'ai_quota_exceeded', onTrial: false }],
    [{ usage: { [PACK]: { ...heavyUsage, pack: { ended: true } } } }, { code: 'ai_quota_exceeded', onTrial: false }],
  ]) {
    const w = world(over);
    await w.fb.onPlanLimit(limit);
    assert.equal(w.store.until, undefined, JSON.stringify(over));
    assert.equal(w.resyncs.length, 0);
  }
});

test('an unknown refill time holds the pack for a day, then looks again', async () => {
  const w = world({ usage: { [MAIN]: 'throw' } });
  await w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  assert.equal(Date.parse(w.store.until), NOW + UNKNOWN_REFILL_HOLD_MS);
});

test('back to the plan\'s key: refilled, pack ended, pack key removed', async () => {
  const w = world();
  await w.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  w.advance(Date.parse(REFILL) - NOW + 1);
  await w.fb.check('timer');
  assert.equal(w.store.until, undefined);
  assert.deepEqual(w.resyncs, ['plan used up', 'plan key back: plan refilled']);
  assert.equal(w.notes.at(-1).inUse, false);

  const e = world();
  await e.fb.onPlanLimit({ code: 'ai_quota_exceeded', onTrial: false });
  await e.fb.check('pack_ended');
  assert.equal(e.store.until, undefined, 'the pack clock says the pack ended');

  const r = world({ until: REFILL, pack: undefined });
  await r.fb.check('remove');
  assert.equal(r.resyncs.at(-1), 'plan key back: pack key removed');
});

test('after a restart: a still-good pack stays in use; a refused one ends; an outage changes nothing', async () => {
  const keep = world({ until: REFILL });
  await keep.fb.start();
  assert.equal(keep.store.until, REFILL);
  assert.equal(keep.resyncs.length, 0);
  assert.equal(keep.timers.filter((t) => t.live).length, 1);

  const refused = world({ until: REFILL, usage: { [PACK]: { ok: false, error: 'subscription_inactive', status: 403 } } });
  await refused.fb.start();
  assert.equal(refused.store.until, undefined);

  for (const flaky of [{ ok: false, error: 'network_error' }, { ok: false, error: 'rate_limited', status: 429 }, 'throw']) {
    const w = world({ until: REFILL, usage: { [PACK]: flaky } });
    await w.fb.start();
    assert.equal(w.store.until, REFILL, JSON.stringify(flaky));
  }
});

test('the pack clock follows a key change mid-meeting: plan time unbilled, pack time billed to the pack', async () => {
  let key = MAIN;
  let now = 1_000_000;
  const sent = [];
  const timers = [];
  const clock = createPackMeetingClock({
    getApiKey: () => key,
    postTick: async (k, body) => {
      sent.push({ key: k, ...body });
      return k === PACK
        ? { status: 200, body: { ok: true, metered: true, pack: { ended: false } } }
        : { status: 200, body: { ok: true, metered: false } };
    },
    now: () => now,
    every: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return () => { t.live = false; }; },
    newMeetingId: (() => { let i = 0; return () => `mtg_${++i}`; })(),
    onPackEnded: () => {},
    log: { log() {}, warn() {} },
  });
  const settle = () => new Promise((r) => setImmediate(r));
  const tick = async () => { now += TICK_INTERVAL_MS; for (const t of timers) if (t.live) t.fn(); await settle(); await settle(); };

  clock.meetingStarted();
  await tick();                          // the plan's key: the server says "not a pack"
  assert.deepEqual(sent.map((s) => s.key), [MAIN]);
  await tick();
  assert.equal(sent.length, 1, 'a plan key is not metered after the first answer');

  key = PACK;                            // the plan ran out; the pack takes over
  clock.keyChanged();
  await tick();
  assert.equal(sent.at(-1).key, PACK, w(sent));
  assert.equal(sent.at(-1).seconds, 60);
  assert.notEqual(sent.at(-1).meeting_id, sent[0].meeting_id, 'a new meeting record on the pack');

  key = MAIN;                            // refilled mid-meeting
  clock.keyChanged();
  const before = sent.filter((s) => s.key === PACK).length;
  await tick(); await tick();
  assert.equal(sent.filter((s) => s.key === PACK).length, before, 'no pack time after the plan is back');

  await clock.meetingEnded();
  key = PACK;
  clock.keyChanged();
  assert.equal(timers.filter((t) => t.live).length, 0, 'no meeting, nothing to start');
});
const w = (x) => JSON.stringify(x);

test('wiring: one key in use for everything, chosen in one place', () => {
  const cm = read('electron/services/CredentialsManager.ts');
  assert.match(cm, /public getNativelyApiKey\(now: number = Date\.now\(\)\): string \| undefined \{\n\s+return this\.isNativelyPackInUse\(now\) \? this\.credentials\.nativelyPackApiKey : this\.credentials\.nativelyApiKey;/);
  assert.match(cm, /nativelyPackApiKey\?: string;/);

  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /onNativelyPlanLimit\(\(limit\) => \{ void packFallback\.onPlanLimit\(limit\); \}\);/);
  assert.match(ipc, /const slot = await packFallback\.slotForSave\(pastedKey\);/);
  assert.match(ipc, /const routed = await routePastedNativelyKey\(cm, apiKey\);[^\n]*\n\s+if \(routed\.done\) return routed\.done;\n\s+apiKey = routed\.apiKey;/);
  assert.match(ipc, /packMeetingClockIfStarted\(\)\?\.keyChanged\(\);/);
  assert.match(ipc, /await appState\.reconfigureSttProvider\(\);/);
  assert.match(ipc, /getMainNativelyApiKey\(\);\n\s+if \(!key\) return \{ ok: false, error: 'no_key' \};\n\s+const res = await fetch\(`\$\{NATIVELY_API_BASE\}\/v1\/upgrade-link`/, 'plan purchases are signed with the saved key');
  assert.match(ipc, /safeHandle\('get-natively-pack-key'/);
  assert.match(ipc, /safeHandle\('remove-natively-pack-key'/);
  // the pack key itself never crosses to the renderer, only its last four
  assert.match(ipc, /last4: pack \? pack\.slice\(-4\) : null,/);

  const stt = read('electron/audio/NativelyProSTT.ts');
  assert.match(stt, /msg\.error === 'transcription_quota_exceeded' && this\.apiKey !== TRIAL_SENTINEL_KEY\) \{\n\s+emitNativelyPlanLimit\(\{ code: 'transcription_quota_exceeded', onTrial: false \}\);/);

  const wiring = read('electron/services/packs/packClockWiring.ts');
  assert.match(wiring, /currentNativelyPackFallback\(\)\?\.check\('pack_ended'\)/);
  assert.match(wiring, /Symbol\.for\('natively\.packMeetingClock'\)/);

  const panel = read('src/components/settings/NativelyApiSettings.tsx');
  assert.match(panel, /getNativelyUsage\(force, 'main'\)/);
  assert.match(panel, /data-held-pack/);
});
