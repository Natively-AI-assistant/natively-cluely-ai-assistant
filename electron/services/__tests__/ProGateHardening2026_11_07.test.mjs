// The 2026-11-07 review of "Pro cannot be used without a subscription or key":
//   1. Pro modes and Profile Intelligence are asked about Pro on every READ, not
//      only when switched on (a mode written into natively.db, or left on after
//      a licence or trial ended, kept shaping answers).
//   2. A licence the seller has not confirmed for 14 days locks Pro, so blocking
//      the seller's host no longer keeps a refunded licence forever. Legacy
//      licences (no provider) are asked of both sellers.
//   4/5/6. A held licence is not "licensed" for the trial wipe; whatever ends
//      Pro (a trial ending, a revocation during a trial) stands the switches down.
//   7. The trial clock no longer writes the credential store inside the Pro check.
//   8. Locked, the MCP server and the local API do not listen, and the MCP token
//      stays in main; they follow Pro back.
//   9. One refusal shape, and every IPC channel under a Pro prefix is listed as
//      Pro (and checks) or free.
// No platform branches: the licence and credential stores hide Keychain / DPAPI
// behind the shared electron/native stubs; servers listen on loopback either way.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const DIST = path.join(REPO, 'dist-electron');
const PREMIUM = path.join(DIST, 'premium/electron/services/LicenseManager.js');
const hasPremium = fs.existsSync(PREMIUM);
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const DAY = 24 * 60 * 60 * 1000;

// ── 9. one refusal, every channel classified ─────────────────────────────

describe('Pro IPC gate', () => {
  const gate = require(path.join(DIST, 'electron/services/proGate.js'));
  const ipc = read('electron/ipcHandlers.ts');

  /** channel → handler source, for every safeHandle in ipcHandlers. */
  const handlers = (() => {
    const out = new Map();
    const re = /safeHandle\(\s*['"]([^'"]+)['"]/g;
    const hits = [...ipc.matchAll(re)];
    hits.forEach((m, i) => {
      const end = i + 1 < hits.length ? hits[i + 1].index : ipc.length;
      out.set(m[1], (out.get(m[1]) ?? '') + ipc.slice(m.index, end));
    });
    return out;
  })();
  const underPrefix = [...handlers.keys()].filter((ch) => gate.PRO_IPC_PREFIXES.some((p) => ch.startsWith(p)));

  test('proRefusal is one shape: the code in error, the words in message', () => {
    assert.deepEqual(gate.proRefusal(), { success: false, error: 'pro_required', message: gate.PRO_REQUIRED_MESSAGE });
    assert.deepEqual(gate.proRefusal('Modes need Pro.', { packs: [] }), { packs: [], success: false, error: 'pro_required', message: 'Modes need Pro.' });
    assert.equal(gate.proRefusal(undefined, { success: true }).success, false, 'extra fields cannot turn it into a success');
  });

  test('every channel under a Pro prefix is listed once, as Pro or as free', () => {
    assert.ok(underPrefix.length > 50, `found ${underPrefix.length}`);
    const pro = new Set(gate.PRO_IPC_CHANNELS);
    const free = new Set(gate.FREE_IPC_CHANNELS);
    const unlisted = underPrefix.filter((ch) => !pro.has(ch) && !free.has(ch));
    assert.deepEqual(unlisted, [], 'a new channel: add it to PRO_IPC_CHANNELS (and gate it) or FREE_IPC_CHANNELS in electron/services/proGate.ts');
    assert.deepEqual([...pro].filter((ch) => free.has(ch)), [], 'listed as both');
    assert.deepEqual([...pro, ...free].filter((ch) => !handlers.has(ch)), [], 'listed but no longer registered');
    assert.deepEqual(Object.keys(gate.PRO_CHANNELS_REFUSING_OTHERWISE).filter((ch) => !pro.has(ch)), [], 'an exception that is not a Pro channel');
  });

  test('every Pro channel asks isProOrTrialActive and refuses with proRefusal', () => {
    for (const ch of gate.PRO_IPC_CHANNELS) {
      const body = handlers.get(ch) ?? '';
      assert.match(body, /isProOrTrialActive\b/, `${ch} does not check Pro`);
      if (gate.PRO_CHANNELS_REFUSING_OTHERWISE[ch]) continue;
      assert.match(body, /proRefusal\(/, `${ch} does not refuse with proRefusal`);
    }
  });

  test('no handler refuses Pro the old ways', () => {
    assert.doesNotMatch(ipc, /Pro license required/);
    assert.doesNotMatch(ipc, /error:\s*'pro_required'/);
  });

  test('screens that show the refusal as text show its words', async () => {
    const { failureText, isProRefusal } = await import(pathToFileURL(path.join(REPO, 'src/lib/proRefusal.mjs')).href);
    assert.equal(failureText(gate.proRefusal('Role Insight is Pro.'), 'x'), 'Role Insight is Pro.');
    assert.match(failureText({ success: false, error: 'pro_required' }, 'x'), /Natively Pro/);
    assert.equal(failureText({ success: false, error: 'disk full' }, 'x'), 'disk full');
    assert.equal(failureText(null, 'fallback'), 'fallback');
    assert.equal(isProRefusal({ error: 'pro_required' }), true);
    for (const [file, n] of [['src/components/OwnAnswersSection.tsx', 3], ['src/components/ProfileIntelligenceSettings.tsx', 3], ['premium/src/RoleInsightPanel.tsx', 2]]) {
      assert.equal((read(file).match(/failureText\(/g) ?? []).length, n, file);
    }
  });
});

// ── 1. Pro modes and Profile Intelligence, asked on every read ───────────

describe('Pro modes and Profile Intelligence are checked when an answer reads them', () => {
  const modes = require(path.join(DIST, 'electron/services/ModesManager.js'));
  after(() => modes.setModesProAccessCheck(null));

  test('a Pro mode is locked without Pro; General and custom modes never are', () => {
    let allowed = false;
    modes.setModesProAccessCheck(() => allowed);
    assert.equal(modes.modeLockedWithoutPro({ templateType: 'technical-interview' }), true);
    assert.equal(modes.modeLockedWithoutPro({ templateType: 'general' }), false);
    assert.equal(modes.modeLockedWithoutPro(null), false);
    allowed = true;
    assert.equal(modes.modeLockedWithoutPro({ templateType: 'sales' }), false);
    modes.setModesProAccessCheck(() => { throw new Error('licence read failed'); });
    assert.equal(modes.modeLockedWithoutPro({ templateType: 'sales' }), true, 'a failed check is no access');
    modes.setModesProAccessCheck(null);
    assert.equal(modes.modeLockedWithoutPro({ templateType: 'sales' }), false, 'unwired (tests, harnesses): nothing withheld');
  });

  test('every way an answer reads the active mode goes through the check', () => {
    const src = read('electron/services/ModesManager.ts');
    const fn = (name) => src.slice(src.indexOf(`public ${name}(`) >= 0 ? src.indexOf(`public ${name}(`) : src.indexOf(`private ${name}(`)).split('\n    }\n')[0];
    assert.match(fn('getActiveMode'), /modeLockedWithoutPro\(mode\) \? null : mode/);
    assert.match(fn('resolveMode'), /modeLockedWithoutPro\(pinned\) \? null : pinned/);
    const info = fn('getActiveModeInfo');
    assert.match(info, /if \(store\.valid\) return modeLockedWithoutPro\(store\.info\) \? null : store\.info/);
    assert.match(info, /return modeLockedWithoutPro\(store\.info\) \? null : store\.info;/);
    assert.match(info, /store\.filledLocked && !modeLockedWithoutPro\(store\.info\)\) store\.valid = false/, 'a cache filled while locked refills when Pro is back');
  });

  test('knowledge mode reads as off without Pro, and comes back with it', { skip: !hasPremium && 'premium module not built' }, () => {
    const { KnowledgeOrchestrator } = require(path.join(DIST, 'premium/electron/knowledge/KnowledgeOrchestrator.js'));
    const resume = { id: 1, type: 'resume', structured_data: { identity: { name: 'A' }, skills: [], experience: [], projects: [], education: [], achievements: [], certifications: [], leadership: [] } };
    const db = {
      initializeSchema() {}, getDocumentByType(t) { return t === 'resume' ? resume : null; },
      getAllNodes() { return []; }, getNodeCount() { return 0; }, getIntro() { return null; },
      getGapAnalysis() { return null; }, getNegotiationScript() { return null; },
      getMockQuestions() { return null; }, getCultureMappings() { return null; },
    };
    const o = new KnowledgeOrchestrator(db);
    o.setKnowledgeMode(true);
    let allowed = true;
    KnowledgeOrchestrator.setProAccessCheck(() => allowed);
    try {
      assert.equal(o.isKnowledgeMode(), true);
      allowed = false;
      assert.equal(o.isKnowledgeMode(), false);
      assert.equal(o.isKnowledgeModeSwitchedOn(), true, 'the switch is kept');
      allowed = true;
      assert.equal(o.isKnowledgeMode(), true);
    } finally {
      KnowledgeOrchestrator.setProAccessCheck(null);
    }
  });

  test('the app wires both checks at startup', () => {
    const ipc = read('electron/ipcHandlers.ts');
    assert.match(ipc, /setModesProAccessCheck\(isProOrTrialActive\)/);
    assert.match(ipc, /KnowledgeOrchestrator\.setProAccessCheck\(isProOrTrialActive\)/);
  });
});

// ── 4/5/6/8. what follows Pro outside the per-use checks ─────────────────

describe('when Pro ends', () => {
  const { createProWatch } = require(path.join(DIST, 'electron/services/licenceRecheck.js'));
  const ipc = read('electron/ipcHandlers.ts');

  test('the Pro watch reports each flip once, never the first reading', () => {
    let allowed = true;
    const seen = [];
    const watch = createProWatch(() => allowed, (now) => seen.push(now));
    watch.check(); watch.check();
    allowed = false; watch.check(); watch.check();
    allowed = true; watch.check();
    assert.deepEqual(seen, [false, true]);
    const throwing = createProWatch(() => { throw new Error('read failed'); }, (now) => seen.push(now));
    throwing.check();
    assert.deepEqual(seen, [false, true], 'a failed read is no Pro, and the first reading is never a flip');
  });

  test('stand-down runs on a trial ending, after every licence check and on the watch', () => {
    const settle = ipc.slice(ipc.indexOf('const settleExpiredTrial = ('), ipc.indexOf('// ── Genie snapshots'));
    assert.match(settle, /standDownIfNoPro\('trial ended'\)/);
    const stand = ipc.slice(ipc.indexOf('const standDownIfNoPro = '), ipc.indexOf('* Stand the runtime down when a trial'));
    assert.match(stand, /if \(isProOrTrialActive\(\)\) return false;/);
    assert.match(stand, /isKnowledgeModeSwitchedOn/);
    assert.match(stand, /modeNeedsPro\(ModesManager\.getInstance\(\)\.getStoredActiveMode\(\)\)/);
    assert.match(ipc, /proWatch\.check\(\);\s*if \(standDownIfNoPro\('licence check'\)\)/);
    assert.match(ipc, /createProWatch\(isProOrTrialActive, \(allowed\) => \{[\s\S]{0,200}standDownIfNoPro\('Pro gone'\)[\s\S]{0,200}syncConnectorServersWithPro\(\)/);
  });

  test('a held licence is not "licensed" for the expired-trial decisions', () => {
    const fn = ipc.slice(ipc.indexOf('const isLicensed = ()'), ipc.indexOf('// ── Funnel telemetry'));
    assert.match(fn, /storedLicenceState\(\)/);
    assert.match(fn, /if \(state === 'held' \|\| state === 'none'\) return false;/);
    assert.match(fn, /if \(state === 'unreadable'\) return true;/);
  });

  test('the MCP server does not start locked, and its token stays in main', () => {
    const out = read('electron/services/outputs/outputsIpc.ts');
    const start = out.slice(out.indexOf('export function startMcpServerIfEnabled'), out.indexOf('export async function syncConnectorServersWithPro'));
    assert.match(start, /if \(!checkAllowed\(mcpGate\)\) \{/);
    const status = out.slice(out.indexOf('function mcpStatus()'), out.indexOf('async function startMcp()'));
    assert.match(status, /s\.token && s\.enabled && unlocked \? \{ token: s\.token \}/);
    assert.match(status, /port && s\.enabled && s\.token && unlocked \?/);
  });
});

describe('the local API listens only with Pro', () => {
  const OUT = path.join(DIST, 'electron/services/outputs');
  const localApiIpc = require(path.join(OUT, 'localApiIpc.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-localapi-pro-'));
  after(async () => { await localApiIpc.stopLocalApi(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('locked it stops; Pro back, it starts again', async () => {
    const allowed = { on: true };
    const handlers = new Map();
    localApiIpc.registerLocalApiIpc({
      safeHandle: (ch, fn) => handlers.set(ch, fn),
      guard: (_f, fn) => async (e, ...a) => fn(e, ...a),
      userDataDir: dir,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(`ENC1${Buffer.from(s, 'utf8').toString('base64')}`, 'utf8'),
        decryptString: (b) => Buffer.from(b.toString('utf8').slice(4), 'base64').toString('utf8'),
      },
      source: { listMeetings: () => [], getMeeting: () => null, searchTranscript: () => [], attendeeCount: () => 0 },
      connectorsAllowed: () => allowed.on,
    });
    await localApiIpc.startLocalApiIfKeys();
    const made = await handlers.get('connectors:apikey-create')({ sender: {} }, { description: 'script', expiresInDays: 30 });
    assert.equal(made.ok, true, made.message);
    assert.equal(localApiIpc.localApiStatus().running, true);
    allowed.on = false;
    await localApiIpc.syncLocalApiWithPro();
    assert.equal(localApiIpc.localApiStatus().running, false);
    allowed.on = true;
    await localApiIpc.syncLocalApiWithPro();
    assert.equal(localApiIpc.localApiStatus().running, true);
  });
});

// ── 7. no credential write inside the Pro check ──────────────────────────

test('the trial clock and the trial-ended mark write on the next tick, not inside the Pro check', () => {
  const cm = read('electron/services/CredentialsManager.ts');
  const pick = (name) => cm.slice(cm.indexOf(`public ${name}(`), cm.indexOf('\n    }\n', cm.indexOf(`public ${name}(`)));
  for (const name of ['markTrialEnded', 'setTrialClockMs']) {
    assert.doesNotMatch(pick(name), /this\.saveCredentials\(\)/, name);
    assert.match(pick(name), /this\.saveSoon\(/, name);
  }
  const soon = cm.slice(cm.indexOf('private saveSoon('), cm.indexOf('\n    }\n', cm.indexOf('private saveSoon(')));
  assert.match(soon, /setTimeout\(\(\) => \{[\s\S]*this\.saveCredentials\(\)/);
});

// ── 2. the offline limit, and legacy licences ────────────────────────────

describe('LicenseManager: offline limit and legacy licences', { skip: !hasPremium && 'premium module not built' }, () => {
  const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-licence-offline-'));
  const LICENSE_PATH = path.join(USER_DATA, 'license.enc');
  const electronStub = path.join(HERE, '__electron_license_stub.mjs');
  const nativeStub = path.join(HERE, '__native_module_stub.cjs');
  const originalResolve = Module._resolveFilename;
  const originalFetch = globalThis.fetch;
  let LicenseManager; let mod; let native; let HWID;
  let answers = [];

  before(async () => {
    process.env.NATIVELY_TEST_USERDATA = USER_DATA;
    ({ HWID, control: native } = require(nativeStub));
    Module._resolveFilename = function (request, ...rest) {
      if (request === 'electron') return electronStub;
      if (typeof request === 'string' && request.endsWith('.node')) return nativeStub;
      return originalResolve.call(this, request, ...rest);
    };
    mod = await import(PREMIUM);
    ({ LicenseManager } = mod);
  });
  after(() => {
    Module._resolveFilename = originalResolve;
    globalThis.fetch = originalFetch;
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  });
  beforeEach(() => {
    fs.rmSync(LICENSE_PATH, { force: true });
    native.reset();
    answers = [];
    globalThis.fetch = async () => {
      const next = answers.shift();
      if (!next || next instanceof Error) throw next ?? new Error('offline');
      return { status: next.status, ok: next.status < 300, json: async () => next.json };
    };
  });

  const iso = (ms) => new Date(ms).toISOString();
  const write = (payload) => fs.writeFileSync(LICENSE_PATH, Buffer.from(`ENC:${JSON.stringify({ key: 'KEY-1', hwid: HWID, activatedAt: iso(Date.now() - 400 * DAY), ...payload })}`, 'utf8'));
  const stored = () => JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8').slice(4));
  const fresh = () => {
    delete globalThis.__nativelyLicenseManagerV1__;
    LicenseManager.instance = undefined;
    return LicenseManager.getInstance();
  };

  test('offlineTooLong: 14 days from the last confirmation, measured to the furthest time seen', () => {
    const now = Date.parse('2026-11-07T12:00:00Z');
    assert.equal(mod.offlineTooLong({}, now), false, 'no confirmation yet: the limit has not started');
    assert.equal(mod.offlineTooLong({ verifiedAt: iso(now - 13 * DAY) }, now), false);
    assert.equal(mod.offlineTooLong({ verifiedAt: iso(now - 15 * DAY) }, now), true);
    assert.equal(mod.offlineTooLong({ verifiedAt: iso(now - 15 * DAY), seenAt: iso(now) }, now - 30 * DAY), true, 'winding the clock back does not reset it');
  });

  test('past the limit with the seller unreachable: Pro locked, licence kept; an answer restores it', async () => {
    write({ provider: 'dodo', verifiedAt: iso(Date.now() - 15 * DAY) });
    native.validateDodo = 'ERR:dodo:network:timeout';
    let mgr = fresh();
    assert.equal(mgr.isPremium(), false, 'launch starts locked');
    assert.equal(mgr.storedLicenceState(), 'held');
    assert.equal(await mgr.isPremiumAsync(), false);
    assert.equal(stored().revokedAt, undefined, 'not held as revoked, only unconfirmed');

    native.validateDodo = 'OK';
    mgr = fresh();
    assert.equal(await mgr.isPremiumAsync(), true);
    assert.ok(Date.now() - Date.parse(stored().verifiedAt) < 60_000, 'confirmation recorded');
    assert.equal(fresh().isPremium(), true);
  });

  test('inside the limit, unreachable keeps Pro; a licence from before the limit starts it', async () => {
    write({ provider: 'dodo', verifiedAt: iso(Date.now() - 3 * DAY) });
    native.validateDodo = 'ERR:dodo:network:timeout';
    assert.equal(await fresh().isPremiumAsync(), true);

    write({ provider: 'dodo' });
    assert.equal(await fresh().isPremiumAsync(), true, 'an old licence is not locked on the spot');
    assert.ok(stored().verifiedAt, 'its 14 days start now');
  });

  test('the same limit applies to Gumroad and Natively API licences', async () => {
    write({ provider: 'gumroad', verifiedAt: iso(Date.now() - 20 * DAY) });
    answers = [new Error('offline')];
    assert.equal(await fresh().isPremiumAsync(), false);
    write({ key: 'natively_sk_x', hwid: '', provider: 'natively_api', plan: 'pro', verifiedAt: iso(Date.now() - 20 * DAY) });
    answers = [{ status: 503, json: undefined }];
    assert.equal(await fresh().isPremiumAsync(), false);
  });

  test('activation records the confirmation', async () => {
    native.verifyDodo = 'OK:lki_1';
    const res = await fresh().activateLicense('DODO-KEY');
    assert.equal(res.success, true, res.error);
    assert.ok(stored().verifiedAt);
  });

  test('a legacy licence is asked of both sellers; the one that knows it becomes its provider', async () => {
    write({});
    answers = [{ status: 200, json: { success: true, purchase: { refunded: false } } }];
    assert.equal(await fresh().isPremiumAsync(), true);
    assert.equal(stored().provider, 'gumroad');

    write({});
    answers = [{ status: 404, json: { success: false } }, { status: 404, json: { success: false } }];
    native.validateDodo = 'OK';
    assert.equal(await fresh().isPremiumAsync(), true);
    assert.equal(stored().provider, 'dodo');
  });

  test('a legacy licence neither seller stands behind is held; no answer keeps it', async () => {
    write({});
    answers = [{ status: 404, json: { success: false } }, { status: 404, json: { success: false } }];
    native.validateDodo = 'REVOKED';
    assert.equal(await fresh().isPremiumAsync(), false);
    assert.ok(stored().revokedAt);

    write({});
    answers = [new Error('offline')];
    native.validateDodo = 'ERR:dodo:network:timeout';
    assert.equal(await fresh().isPremiumAsync(), true);
  });

  test('storedLicenceState tells held from unreadable from none', () => {
    const mgr = fresh();
    assert.equal(mgr.storedLicenceState(), 'none');
    write({ provider: 'dodo', verifiedAt: iso(Date.now()) });
    assert.equal(mgr.storedLicenceState(), 'valid');
    write({ provider: 'dodo', revokedAt: iso(Date.now()) });
    assert.equal(mgr.storedLicenceState(), 'held');
    write({ provider: 'dodo', hwid: 'b'.repeat(64) });
    assert.equal(mgr.storedLicenceState(), 'unreadable', 'another device: it may be real, this session cannot tell');
  });
});
