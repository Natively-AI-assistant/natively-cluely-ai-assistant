// The two Antigravity checks that need no loopback callback port, kept out of
// AntigravityService.test.mjs because node --test runs FILES in parallel and
// two suites racing for 127.0.0.1:51121 fail with "callback port is busy".
//
//   1. A shape assertion on the captured live response.
//   2. An opt-in live check against Google — the only test in this repo that
//      can notice Google changing its tier policy. Mocks assert OUR side of the
//      wire; they cannot assert that the other side still agrees.
//
// The sign-in flow driven against this same response lives in
// AntigravityService.test.mjs, next to the harness it needs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LIVE_LOAD_CODE_ASSIST } from './fixtures/antigravityLiveTiers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const fakeElectron = { shell: { openExternal: async () => undefined } };
const originalModuleLoad = Module._load;
Module._load = function patchedModuleLoad(request, parent, isMain) {
  if (request === 'electron') return fakeElectron;
  return originalModuleLoad.call(this, request, parent, isMain);
};

async function loadService() {
  const built = path.join(root, 'dist-electron/electron/services/AntigravityService.js');
  assert.ok(fs.existsSync(built), `compiled AntigravityService is missing: ${built}`);
  return import(pathToFileURL(built).href);
}

test('Google offers this client no free tier, and the only tier left demands a caller-supplied project', () => {
  const free = LIVE_LOAD_CODE_ASSIST.ineligibleTiers.find((t) => t.tierId === 'free-tier');
  assert.ok(free, 'free-tier must appear under ineligibleTiers in the captured response');
  assert.equal(free.reasonCode, 'UNSUPPORTED_CLIENT');

  // The whole failure in two assertions: nothing about the user's account is
  // wrong, and no amount of retrying can produce a project the client never sends.
  const dflt = LIVE_LOAD_CODE_ASSIST.allowedTiers.find((t) => t.isDefault);
  assert.equal(dflt.id, 'standard-tier');
  assert.equal(dflt.userDefinedCloudaicompanionProject, true);
});

// ── Opt-in live check ───────────────────────────────────────────────────────
//   RUN_ANTIGRAVITY_LIVE=1 ANTIGRAVITY_REFRESH_TOKEN=... npm run test:antigravity:live
// Skipped cleanly by default, same gate style as NativelyApiE2E.test.mjs.
const LIVE = process.env.RUN_ANTIGRAVITY_LIVE === '1';
const REFRESH = process.env.ANTIGRAVITY_REFRESH_TOKEN ?? '';

describe('Antigravity live tier check', {
  skip: !LIVE || !REFRESH
    ? 'skip: set RUN_ANTIGRAVITY_LIVE=1 and ANTIGRAVITY_REFRESH_TOKEN to enable'
    : false,
}, () => {
  test('Google still offers this client a tier that can onboard', async () => {
    const mod = await loadService();
    const token = await fetch(mod.ANTIGRAVITY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: mod.ANTIGRAVITY_CLIENT_ID,
        client_secret: mod.ANTIGRAVITY_CLIENT_SECRET,
        refresh_token: REFRESH,
        grant_type: 'refresh_token',
      }),
    }).then((r) => r.json());
    assert.ok(token.access_token, `token refresh failed: ${JSON.stringify(token).slice(0, 200)}`);

    const response = await fetch(`${mod.ANTIGRAVITY_PROD_ENDPOINT}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: { ...mod.antigravitySetupHeaders(token.access_token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } }),
    });
    assert.equal(response.status, 200, `loadCodeAssist HTTP ${response.status}`);
    const body = await response.json();
    // Printed unconditionally: when this fails, the tier list IS the diagnosis.
    console.log('[live] loadCodeAssist tiers:', JSON.stringify({
      cloudaicompanionProject: body.cloudaicompanionProject ?? null,
      allowedTiers: body.allowedTiers ?? null,
      ineligibleTiers: body.ineligibleTiers ?? null,
    }));

    // "Can onboard" means a project already exists, or the default tier does not
    // demand one from the caller. Anything else and sign-in cannot complete.
    const dflt = (body.allowedTiers ?? []).find((t) => t?.isDefault);
    const usable = Boolean(body.cloudaicompanionProject)
      || Boolean(dflt && dflt.userDefinedCloudaicompanionProject !== true);
    assert.ok(usable,
      'Google offers this client no tier that can onboard without a caller-supplied project — '
      + `ineligible: ${JSON.stringify(body.ineligibleTiers)}`);
  });
});

test.after(() => { Module._load = originalModuleLoad; });
