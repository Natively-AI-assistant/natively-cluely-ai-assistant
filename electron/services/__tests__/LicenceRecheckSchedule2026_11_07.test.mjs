// The licence server is asked at launch, every 6 hours, on wake and after a
// usage read without Pro (services/licenceRecheck.ts), and a Dodo key the server
// stops accepting locks Pro without deleting the licence, so a key Dodo enables
// again (a held renewal that cleared) restores it (premium LicenseManager).
//
// Before this, the only caller of the server check was a renderer fallback that
// ran when the LOCAL read failed: refunded, expired and cancelled licences kept
// Pro on the device indefinitely.
//
// No platform branches: timers and the check are injected; LicenseManager runs
// on the shared electron/native stubs (Keychain / DPAPI hidden behind them).

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
const sched = require(path.join(REPO, 'dist-electron/electron/services/licenceRecheck.js'));

// ── the schedule ──────────────────────────────────────────────────────────

function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    pending: () => timers.size,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      t = end;
    },
  };
}

describe('licence re-check schedule', () => {
  test('first check shortly after launch, then every 6 hours', async () => {
    const clock = fakeClock();
    const reasons = [];
    const s = sched.startLicenceRecheck({ ...clock, run: async (r) => { reasons.push(r); } });
    await clock.advance(sched.FIRST_CHECK_DELAY_MS - 1);
    assert.deepEqual(reasons, [], 'nothing on the startup path');
    await clock.advance(1);
    assert.deepEqual(reasons, ['launch']);
    await clock.advance(sched.RECHECK_EVERY_MS);
    await clock.advance(sched.RECHECK_EVERY_MS);
    assert.deepEqual(reasons, ['launch', 'interval', 'interval']);
    s.stop();
    assert.equal(clock.pending(), 0, 'stop clears every timer');
    await clock.advance(sched.RECHECK_EVERY_MS * 3);
    assert.equal(reasons.length, 3);
  });

  test('wake and usage triggers are spaced at least 10 minutes apart', async () => {
    const clock = fakeClock();
    const reasons = [];
    const s = sched.startLicenceRecheck({ ...clock, run: async (r) => { reasons.push(r); } });
    await clock.advance(sched.FIRST_CHECK_DELAY_MS);
    await s.trigger('resume');
    assert.deepEqual(reasons, ['launch'], 'a wake right after launch shares its answer');
    await clock.advance(sched.MIN_GAP_MS);
    await s.trigger('usage');
    await s.trigger('usage');
    assert.deepEqual(reasons, ['launch', 'usage']);
    s.stop();
  });

  test('one check at a time, and a failing check keeps the schedule alive', async () => {
    const clock = fakeClock();
    let calls = 0;
    let release;
    const s = sched.startLicenceRecheck({
      ...clock,
      log: { log() {}, warn() {} },
      run: async () => {
        calls++;
        if (calls === 1) await new Promise((r) => { release = r; });
        if (calls === 2) throw new Error('server down');
      },
    });
    await clock.advance(sched.FIRST_CHECK_DELAY_MS);
    await clock.advance(sched.MIN_GAP_MS);
    void s.trigger('usage');
    assert.equal(calls, 1, 'a trigger while a check runs joins it');
    release();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await clock.advance(sched.RECHECK_EVERY_MS);
    assert.equal(calls, 2);
    await clock.advance(sched.RECHECK_EVERY_MS);
    assert.equal(calls, 3, 'the throw did not end the 6-hour cycle');
    s.stop();
  });

  test('usage answers that are a reason to ask', () => {
    const lost = (a) => sched.usageSuggestsProLost(a);
    assert.equal(lost({ ok: true, plan: 'standard' }), true);
    for (const plan of ['pro', 'max', 'ultra', 'trial', 'pack_light', 'Ultra', undefined]) {
      assert.equal(lost({ ok: true, plan }), false, `plan ${plan}`);
    }
    for (const error of ['subscription_inactive', 'key_not_found', 'invalid_key_format']) {
      assert.equal(lost({ ok: false, error }), true, error);
    }
    for (const error of ['account_suspended', 'ip_blocked', 'rate_limited', 'server_error', 'request_failed', undefined]) {
      assert.equal(lost({ ok: false, error }), false, `${error}`);
    }
  });

  test('the app wires it: launch schedule, wake through main, usage reads', () => {
    const ipc = fs.readFileSync(path.join(REPO, 'electron/ipcHandlers.ts'), 'utf8');
    const main = fs.readFileSync(path.join(REPO, 'electron/main.ts'), 'utf8');
    assert.match(ipc, /startLicenceRecheck\(\{\s*run: async \(\) => \{\s*await runLicenceRecheck\(\);/);
    assert.match(ipc, /getTrialToken\(\) && !trialTimeIsUp\(\)\) await pollTrialStatus\(\)/);
    assert.match(ipc, /usageSuggestsProLost\(answer\)\) triggerLicenceRecheck\('usage'\)/);
    assert.match(ipc, /askLicenceIf\(\{ ok: false, error: body\?\.error \}\)/);
    assert.match(ipc, /askLicenceIf\(\{ ok: true, plan: data\?\.plan \}\)/);
    const resume = main.indexOf("powerMonitor.on('resume'");
    assert.ok(resume > 0);
    assert.match(main.slice(resume, resume + 600), /triggerLicenceRecheck\('resume'\)/);
  });
});

// ── LicenseManager: Dodo answers ──────────────────────────────────────────

const PREMIUM = path.join(REPO, 'dist-electron/premium/electron/services/LicenseManager.js');
const hasPremium = fs.existsSync(PREMIUM);

describe('Dodo licence: lock on an invalid key, restore when it is valid again', { skip: !hasPremium && 'premium module not built' }, () => {
  const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-licence-hold-'));
  const LICENSE_PATH = path.join(USER_DATA, 'license.enc');
  const electronStub = path.join(HERE, '__electron_license_stub.mjs');
  const nativeStub = path.join(HERE, '__native_module_stub.cjs');
  let LicenseManager;
  let native;
  let HWID;
  const originalResolve = Module._resolveFilename;

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
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  });
  beforeEach(() => {
    fs.rmSync(LICENSE_PATH, { force: true });
    fs.rmSync(LICENSE_PATH + '.tmp', { force: true });
    native.reset();
  });

  const write = (extra = {}) => fs.writeFileSync(LICENSE_PATH, Buffer.from(`ENC:${JSON.stringify({
    key: 'dodo-yearly-key', hwid: HWID, activatedAt: new Date().toISOString(), provider: 'dodo', instanceId: 'lki_1', plan: 'yearly', ...extra,
  })}`, 'utf8'));
  const stored = () => JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8').slice(4));
  const fresh = () => {
    delete globalThis.__nativelyLicenseManagerV1__;
    LicenseManager.instance = undefined;
    return LicenseManager.getInstance();
  };

  test('REVOKED locks Pro now and at the next launch, but keeps the licence', async () => {
    write();
    fs.writeFileSync(LICENSE_PATH + '.tmp', fs.readFileSync(LICENSE_PATH));
    const mgr = fresh();
    assert.equal(mgr.isPremium(), true, 'precondition');
    native.validateDodo = 'REVOKED';
    assert.equal(await mgr.isPremiumAsync(), false);
    assert.equal(mgr.isPremium(), false);
    assert.equal(mgr.getLicenseDetails().isPremium, false);
    assert.ok(stored().revokedAt, 'held, not deleted');
    assert.equal(stored().key, 'dodo-yearly-key');
    assert.equal(fs.existsSync(LICENSE_PATH + '.tmp'), false, 'no unmarked copy left to rename back');
    const next = fresh();
    assert.equal(next.isPremium(), false, 'the next launch starts locked, before any network');
    assert.equal(next.getLicenseDetails().isPremium, false);
  });

  test('a held key that Dodo accepts again restores Pro', async () => {
    write({ revokedAt: new Date().toISOString() });
    const mgr = fresh();
    assert.equal(mgr.isPremium(), false);
    native.validateDodo = 'OK';
    assert.equal(await mgr.isPremiumAsync(), true);
    assert.equal(mgr.isPremium(), true);
    assert.equal(stored().revokedAt, undefined);
    assert.equal(fresh().isPremium(), true);
  });

  test('no answer keeps whatever is on disk: valid stays valid, held stays locked', async () => {
    for (const answer of ['ERR:dodo:network:HTTP 429', 'ERR:dodo:network:HTTP 503', 'ERR:dodo:validate unexpected state (HTTP 302)', new Error('binding')]) {
      write();
      let mgr = fresh();
      native.validateDodo = answer;
      assert.equal(await mgr.isPremiumAsync(), true, `valid licence, ${answer}`);
      assert.equal(stored().revokedAt, undefined);

      write({ revokedAt: new Date().toISOString() });
      mgr = fresh();
      assert.equal(await mgr.isPremiumAsync(), false, `held licence, ${answer}`);
      assert.equal(mgr.isPremium(), false);
    }
  });

  test('a held Dodo licence does not block an API-plan activation', async () => {
    write({ revokedAt: new Date().toISOString() });
    const mgr = fresh();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => ({ ok: true, has_pro: true, plan: 'pro' }) });
    try {
      const res = await mgr.activateWithApiKey('natively_sk_new');
      assert.notEqual(res.skipped, true, 'the held licence protected nothing');
      assert.equal(res.success, true);
    } finally {
      globalThis.fetch = previousFetch;
    }
    assert.equal(stored().provider, 'natively_api');
    assert.equal(mgr.isPremium(), true);
  });

  test('deactivate still removes a held licence', async () => {
    write({ revokedAt: new Date().toISOString() });
    const mgr = fresh();
    await mgr.deactivate();
    assert.equal(fs.existsSync(LICENSE_PATH), false);
  });
});

test('the Rust validate keeps rate limits and Dodo outages from reading as revoked', () => {
  const rs = fs.readFileSync(path.join(REPO, 'native-module/src/license.rs'), 'utf8');
  const at = rs.indexOf('impl Task for ValidateDodoTask');
  const body = rs.slice(at, rs.indexOf('fn resolve', at));
  const transient = body.indexOf('status == 429 || status >= 500');
  const revoked = body.indexOf('return Ok("REVOKED".to_string())');
  assert.ok(transient > 0 && revoked > 0);
  assert.ok(transient < revoked, 'the 429/5xx branch must come before REVOKED');
  assert.match(body.slice(transient, revoked), /ERR:dodo:network:HTTP/);
  assert.doesNotMatch(body, /status >= 400 \|\| !valid/);
});
