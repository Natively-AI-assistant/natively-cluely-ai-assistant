// Three ways Pro outlived what paid for it, closed 2026-11-07:
//   1. Gumroad lifetime licences were never re-checked, and activation read
//      only `success`, which Gumroad answers for a refunded purchase too.
//   2. A Natively API key on a payment hold (403 account_suspended) kept Pro
//      for as long as the hold lasted. It now locks, keeping the licence, and
//      comes back when the payment clears.
//   3. A trial ended by the computer's clock alone: winding it back kept Pro on.
//      services/trialClock.ts never runs backwards, and a trial the server
//      called over stays over.
// No platform branches: fetch, timers and the clocks are injected; LicenseManager
// runs on the shared electron/native stubs (Keychain / DPAPI hidden behind them).

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const DIST = path.join(REPO, 'dist-electron');
const POLICY = path.join(DIST, 'premium/electron/services/licenseVerifyPolicy.js');
const PREMIUM = path.join(DIST, 'premium/electron/services/LicenseManager.js');
const hasPremium = fs.existsSync(PREMIUM);

// ── Gumroad's answers ─────────────────────────────────────────────────────

describe('Gumroad verify answers', { skip: !hasPremium && 'premium module not built' }, () => {
  let classify;
  before(async () => { ({ classifyGumroadVerify: classify } = await import(POLICY)); });
  const ok = (purchase = {}) => ({ success: true, purchase: { refunded: false, chargebacked: false, disputed: false, dispute_won: false, subscription_ended_at: null, subscription_failed_at: null, ...purchase } });

  test('a clean purchase is active', () => {
    assert.equal(classify(200, ok()).decision, 'active');
    assert.equal(classify(200, ok({ disputed: true, dispute_won: true })).decision, 'active', 'a won dispute is fine');
    assert.equal(classify(200, ok({ subscription_cancelled_at: '2026-01-01' })).decision, 'active', 'cancelled but not ended: still paid for');
  });

  test('a reversed purchase locks', () => {
    for (const p of [{ refunded: true }, { chargebacked: true }, { disputed: true }, { subscription_ended_at: '2026-01-01' }, { subscription_failed_at: '2026-01-01' }]) {
      assert.equal(classify(200, ok(p)).decision, 'revoke', JSON.stringify(p));
    }
    assert.equal(classify(404, { success: false, message: 'That license does not exist for the provided product.' }).decision, 'revoke');
  });

  test('no answer keeps it', () => {
    assert.equal(classify(0, null).decision, 'keep');
    assert.equal(classify(429, { success: false }).decision, 'keep');
    assert.equal(classify(503, null).decision, 'keep');
    assert.equal(classify(200, null).decision, 'keep');
    assert.equal(classify(400, { success: false }).decision, 'keep');
  });
});

// ── LicenseManager ────────────────────────────────────────────────────────

describe('LicenseManager: Gumroad re-check and the Natively API payment hold', { skip: !hasPremium && 'premium module not built' }, () => {
  const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-licence-gumroad-'));
  const LICENSE_PATH = path.join(USER_DATA, 'license.enc');
  const electronStub = path.join(HERE, '__electron_license_stub.mjs');
  const nativeStub = path.join(HERE, '__native_module_stub.cjs');
  const originalResolve = Module._resolveFilename;
  const originalFetch = globalThis.fetch;
  let LicenseManager; let native; let HWID;
  let calls = [];
  /** Queue of answers, one per fetch; a function is called with (url, init). */
  let answers = [];

  before(async () => {
    process.env.NATIVELY_TEST_USERDATA = USER_DATA;
    ({ HWID, control: native } = require(nativeStub));
    Module._resolveFilename = function (request, ...rest) {
      if (request === 'electron') return electronStub;
      if (typeof request === 'string' && request.endsWith('.node')) return nativeStub;
      return originalResolve.call(this, request, ...rest);
    };
    ({ LicenseManager } = await import(PREMIUM));
  });
  after(() => {
    Module._resolveFilename = originalResolve;
    globalThis.fetch = originalFetch;
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  });
  beforeEach(() => {
    fs.rmSync(LICENSE_PATH, { force: true });
    fs.rmSync(LICENSE_PATH + '.tmp', { force: true });
    native.reset();
    calls = [];
    answers = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? String(init.body) : '' });
      const next = answers.shift();
      if (!next) throw new Error(`unexpected fetch ${url}`);
      if (next instanceof Error) throw next;
      const { status, json } = typeof next === 'function' ? next(url, init) : next;
      return { status, ok: status >= 200 && status < 300, json: async () => { if (json === undefined) throw new Error('no json'); return json; } };
    };
  });

  const write = (payload) => fs.writeFileSync(LICENSE_PATH, Buffer.from(`ENC:${JSON.stringify({ hwid: HWID, activatedAt: new Date().toISOString(), ...payload })}`, 'utf8'));
  const stored = () => JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8').slice(4));
  const fresh = () => {
    delete globalThis.__nativelyLicenseManagerV1__;
    LicenseManager.instance = undefined;
    return LicenseManager.getInstance();
  };
  const gumroad = (purchase = {}) => ({ status: 200, json: { success: true, purchase: { refunded: false, chargebacked: false, disputed: false, ...purchase } } });
  const notFound = { status: 404, json: { success: false, message: 'That license does not exist for the provided product.' } };

  test('a valid Gumroad licence stays Pro, asked without counting a use', async () => {
    write({ key: 'GUM-KEY', provider: 'gumroad' });
    answers = [gumroad()];
    const mgr = fresh();
    assert.equal(await mgr.isPremiumAsync(), true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /api\.gumroad\.com\/v2\/licenses\/verify/);
    assert.match(calls[0].body, /increment_uses_count=false/);
    assert.match(calls[0].body, /license_key=GUM-KEY/);
  });

  test('a refunded Gumroad purchase locks Pro and keeps the licence; a won dispute restores it', async () => {
    write({ key: 'GUM-KEY', provider: 'gumroad' });
    answers = [gumroad({ refunded: true })];
    let mgr = fresh();
    assert.equal(await mgr.isPremiumAsync(), false);
    assert.equal(mgr.isPremium(), false);
    assert.ok(stored().revokedAt);
    assert.equal(fresh().isPremium(), false, 'locked from the next launch on');

    answers = [gumroad({ disputed: true, dispute_won: true })];
    mgr = fresh();
    assert.equal(await mgr.isPremiumAsync(), true);
    assert.equal(stored().revokedAt, undefined);
  });

  test('a key known to the legacy product is asked there too; unknown to both locks', async () => {
    write({ key: 'GUM-OLD', provider: 'gumroad' });
    answers = [notFound, gumroad()];
    assert.equal(await fresh().isPremiumAsync(), true);
    assert.equal(calls.length, 2);
    assert.match(calls[1].body, /product_id=mzhzpt/);

    answers = [notFound, notFound];
    assert.equal(await fresh().isPremiumAsync(), false);
    assert.ok(stored().revokedAt);
  });

  test('Gumroad unreachable or busy keeps a valid licence valid', async () => {
    for (const answer of [new Error('offline'), { status: 429, json: {} }, { status: 502, json: undefined }]) {
      write({ key: 'GUM-KEY', provider: 'gumroad' });
      answers = [answer];
      assert.equal(await fresh().isPremiumAsync(), true, String(answer?.status ?? answer));
      assert.equal(stored().revokedAt, undefined);
    }
  });

  test('activation refuses a Gumroad key whose purchase was refunded', async () => {
    native.verifyDodo = 'ERR:dodo:invalid';
    native.verifyGumroad = 'OK';
    answers = [gumroad({ refunded: true })];
    const res = await fresh().activateLicense('GUM-REFUNDED');
    assert.equal(res.success, false);
    assert.match(res.error, /refunded/);
    assert.equal(fs.existsSync(LICENSE_PATH), false);
  });

  test('a Natively API key on a payment hold locks Pro, keeps the licence, and comes back', async () => {
    write({ key: 'natively_sk_held', provider: 'natively_api', hwid: '', plan: 'pro' });
    answers = [{ status: 403, json: { ok: false, error: 'account_suspended' } }];
    let mgr = fresh();
    assert.equal(mgr.isPremium(), true, 'precondition');
    assert.equal(await mgr.isPremiumAsync(), false);
    assert.equal(mgr.isPremium(), false);
    assert.equal(mgr.getLicenseDetails().isPremium, false);
    assert.ok(stored().revokedAt, 'kept, held');

    answers = [{ status: 503, json: undefined }];
    mgr = fresh();
    assert.equal(await mgr.isPremiumAsync(), false, 'a blip does not lift the hold');

    answers = [{ status: 200, json: { ok: true, has_pro: true, plan: 'pro' } }];
    mgr = fresh();
    assert.equal(await mgr.isPremiumAsync(), true, 'payment cleared');
    assert.equal(stored().revokedAt, undefined);
  });

  test('a lapsed Natively API subscription still removes the licence', async () => {
    write({ key: 'natively_sk_gone', provider: 'natively_api', hwid: '', plan: 'pro' });
    answers = [{ status: 403, json: { ok: false, error: 'subscription_inactive' } }];
    assert.equal(await fresh().isPremiumAsync(), false);
    assert.equal(fs.existsSync(LICENSE_PATH), false);
  });
});

// ── the trial clock ───────────────────────────────────────────────────────

const clockMod = require(path.join(DIST, 'electron/services/trialClock.js'));

function store(startedAt, saved) {
  const s = { startedAt, saved, writes: 0 };
  return {
    s,
    api: { startedAt: () => s.startedAt, load: () => s.saved, save: (ms) => { s.saved = ms; s.writes++; } },
  };
}

describe('trial clock', () => {
  const START = Date.parse('2026-11-07T10:00:00Z');
  const EXPIRES = new Date(START + 30 * 60_000).toISOString();

  test('winding the computer clock back does not stretch the trial', () => {
    let wall = START; let mono = 0;
    const { api } = store(new Date(START).toISOString(), undefined);
    const clock = clockMod.createTrialClock(api, { wallNow: () => wall, monoNow: () => mono });
    wall += 10 * 60_000; mono += 10 * 60_000;
    assert.equal(clock.now(), START + 10 * 60_000);
    wall -= 24 * 60 * 60_000; // wound back a day
    mono += 5 * 60_000;
    assert.equal(clock.now(), START + 15 * 60_000, 'monotonic time still counts');
    mono += 15 * 60_000;
    assert.equal(clockMod.trialIsOver({ token: 't', expiresAt: EXPIRES }, clock.now()), true, '30 minutes of app time ends it');
  });

  test('a restart resumes from the furthest saved reading', () => {
    let wall = START; let mono = 0;
    const st = store(new Date(START).toISOString(), undefined);
    let clock = clockMod.createTrialClock(st.api, { wallNow: () => wall, monoNow: () => mono, saveEveryMs: 1 });
    wall += 20 * 60_000; mono += 20 * 60_000;
    clock.now();
    assert.equal(st.s.saved, START + 20 * 60_000);
    // Quit, wind the clock back an hour, relaunch: monotonic restarts at 0.
    wall = START - 60 * 60_000; mono = 0;
    clock = clockMod.createTrialClock(st.api, { wallNow: () => wall, monoNow: () => mono, saveEveryMs: 1 });
    assert.equal(clock.now(), START + 20 * 60_000);
    mono = 10 * 60_000;
    assert.ok(clockMod.trialIsOver({ token: 't', expiresAt: EXPIRES }, clock.now()));
  });

  test('a server time moves it forward, never back', () => {
    let wall = START; const mono = 0;
    const { api } = store(new Date(START).toISOString(), undefined);
    const clock = clockMod.createTrialClock(api, { wallNow: () => wall, monoNow: () => mono });
    wall = START - 5 * 24 * 60 * 60_000;
    clock.observe(START + 29 * 60_000);
    assert.equal(clock.now(), START + 29 * 60_000);
    clock.observe(START);
    assert.equal(clock.now(), START + 29 * 60_000);
    assert.equal(clockMod.serverNowFromStatus({ expires_at: EXPIRES, remaining_ms: 60_000 }), START + 29 * 60_000);
    assert.equal(clockMod.serverNowFromStatus({ expires_at: EXPIRES, remaining_ms: 0 }), undefined);
    assert.equal(clockMod.serverNowFromStatus({}), undefined);
  });

  test('a new trial starts its own clock', () => {
    let wall = START; let mono = 0;
    const st = store(new Date(START).toISOString(), START + 40 * 60_000);
    const clock = clockMod.createTrialClock(st.api, { wallNow: () => wall, monoNow: () => mono });
    assert.equal(clock.now(), START + 40 * 60_000);
    const NEXT = START + 90 * 24 * 60 * 60_000;
    st.s.startedAt = new Date(NEXT).toISOString();
    st.s.saved = NEXT;
    wall = NEXT + 1000;
    assert.equal(clock.now(), NEXT + 1000);
  });

  test('no trial, no expiry or a trial marked ended is over', () => {
    const now = START;
    assert.equal(clockMod.trialIsOver({}, now), true);
    assert.equal(clockMod.trialIsOver({ token: 't' }, now), true);
    assert.equal(clockMod.trialIsOver({ token: 't', expiresAt: EXPIRES, endedAt: new Date(now).toISOString() }, now), true);
    assert.equal(clockMod.trialIsOver({ token: 't', expiresAt: EXPIRES }, now), false);
  });

  test('the app judges the trial by it everywhere', () => {
    const access = fs.readFileSync(path.join(REPO, 'electron/services/proAccess.ts'), 'utf8');
    assert.match(access, /return !trialTimeIsUp\(\);/);
    assert.doesNotMatch(access, /getTime\(\) > Date\.now\(\)/);
    const ipc = fs.readFileSync(path.join(REPO, 'electron/ipcHandlers.ts'), 'utf8');
    const trialDateCompares = [...ipc.matchAll(/new Date\([^)]*[Tt]rial[^)]*\)!?\.getTime\(\)\s*[<>]=?\s*Date\.now\(\)|new Date\((?:localExpiry|expiresAt|byokExpiresAt)!?\)\.getTime\(\)\s*[<>]=?\s*Date\.now\(\)/g)];
    assert.deepEqual(trialDateCompares.map((m) => m[0]), [], 'a trial expiry compared with the computer clock alone');
    assert.match(ipc, /if \(data\?\.expired\) \{[\s\S]{0,200}cm\.markTrialEnded\?\.\(\)/);
    assert.match(ipc, /getTrialClock\(\)\.observe\(serverNow\)/);
    const creds = fs.readFileSync(path.join(REPO, 'electron/services/CredentialsManager.ts'), 'utf8');
    const setter = creds.slice(creds.indexOf('public setTrialToken('), creds.indexOf('public clearTrialToken('));
    assert.match(setter, /delete this\.credentials\.trialEndedAt/);
    assert.match(setter, /this\.credentials\.trialClockMs = startedMs/);
  });
});
