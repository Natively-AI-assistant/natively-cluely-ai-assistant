// Profile Intelligence (knowledge mode) is Pro or trial. Two ways a licence
// that ended kept it on:
//   1. launch restored knowledgeMode from settings without asking proAccess, so
//      a subscription that lapsed while the app was closed (no in-app
//      Deactivate) kept the résumé and JD in every answer;
//   2. the startup re-check (license:check-premium-async) removed a revoked
//      licence file but left knowledge mode and the premium mode running for the
//      rest of the session.
// recheckLicence is the pure part of (2); the wiring of both is checked in source.
// No platform branches: LicenseManager hides Keychain / DPAPI storage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { recheckLicence } = require(path.join(REPO, 'dist-electron/electron/services/proAccess.js'));

const licence = (before, after) => ({
  isPremium: () => (typeof before === 'function' ? before() : before),
  isPremiumAsync: async () => (typeof after === 'function' ? after() : after),
});

test('a licence the server revokes stands the Pro features down', async () => {
  let lost = 0;
  const res = await recheckLicence(licence(true, false), { stillAllowed: () => false, onLost: () => { lost++; } });
  assert.equal(res, false);
  assert.equal(lost, 1);
});

test('a licence that is still good, or never existed, stands nothing down', async () => {
  for (const [before, after] of [[true, true], [false, false]]) {
    let lost = 0;
    const res = await recheckLicence(licence(before, after), { stillAllowed: () => false, onLost: () => { lost++; } });
    assert.equal(res, after);
    assert.equal(lost, 0, `before=${before} after=${after}`);
  }
});

test('a trial still running keeps the features after the licence goes', async () => {
  let lost = 0;
  await recheckLicence(licence(true, false), { stillAllowed: () => true, onLost: () => { lost++; } });
  assert.equal(lost, 0);
});

test('a held licence that is valid again is announced as restored', async () => {
  let restored = 0; let lost = 0;
  const res = await recheckLicence(licence(false, true), { stillAllowed: () => false, onLost: () => { lost++; }, onRestored: () => { restored++; } });
  assert.equal(res, true);
  assert.equal(restored, 1);
  assert.equal(lost, 0);
  restored = 0;
  await recheckLicence(licence(true, true), { stillAllowed: () => false, onLost: () => {}, onRestored: () => { restored++; } });
  assert.equal(restored, 0, 'a licence that never lapsed is not "restored"');
});

test('failures read as no licence and never throw', async () => {
  let lost = 0;
  const boom = () => { throw new Error('read failed'); };
  assert.equal(await recheckLicence(licence(true, boom), { stillAllowed: () => false, onLost: () => { lost++; } }), false);
  assert.equal(lost, 0, 'a failed server check is not a revocation');
  assert.equal(await recheckLicence(licence(boom, false), { stillAllowed: () => false, onLost: () => { lost++; } }), false);
  assert.equal(await recheckLicence(licence(true, false), { stillAllowed: boom, onLost: () => { lost++; } }), false);
  assert.equal(lost, 1, 'an unreadable trial counts as no access');
  assert.equal(await recheckLicence(licence(true, false), { stillAllowed: () => false, onLost: boom }), false);
});

test('launch restores knowledge mode only with Pro or a trial', () => {
  const main = fs.readFileSync(path.join(REPO, 'electron/main.ts'), 'utf8');
  const at = main.indexOf("this.knowledgeOrchestrator.setKnowledgeMode(true)");
  assert.ok(at > 0);
  const before = main.slice(Math.max(0, at - 1200), at);
  assert.match(before, /profileAllowed = isProOrTrialActive\(\)/);
  assert.match(before, /if \(sm\.get\('knowledgeMode'\) && profileAllowed\) \{\s*$/);
});

test('the startup licence re-check goes through recheckLicence and turns knowledge mode off', () => {
  const ipc = fs.readFileSync(path.join(REPO, 'electron/ipcHandlers.ts'), 'utf8');
  const start = ipc.indexOf('const runLicenceRecheck = async');
  assert.ok(start > 0);
  const body = ipc.slice(start, ipc.indexOf("safeHandle('license:deactivate'", start));
  assert.match(body, /safeHandle\('license:check-premium-async', async \(\) => runLicenceRecheck\(\)\)/);
  assert.match(body, /recheckLicence\(lm, \{/);
  assert.match(body, /stillAllowed: isProOrTrialActive/);
  assert.match(body, /setKnowledgeMode\(false\)/);
  assert.match(body, /clearActiveModeOnLicenseLoss\(\)/);
  assert.match(body, /'license-status-changed', \{ isPremium \}/);
  assert.match(body, /tell\(false\)/);
  assert.match(body, /onRestored: \(\) => tell\(true\)/);
  assert.match(body, /startLicenceRecheck\(\{/);
});
