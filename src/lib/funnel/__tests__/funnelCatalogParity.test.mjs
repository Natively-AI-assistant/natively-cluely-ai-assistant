// The funnel catalogue exists twice: here, and in natively-api
// (lib/funnelCatalog.js). The server refuses an event it does not know and the
// app then drops it for good, so the two must say the same thing. These tests
// are what notices when they stop.
//
// Also pins the catalogue to the app's own lists (the cards, the checkout
// products) so adding a card or a product without telling the funnel fails
// here rather than silently reporting nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as client from '../funnelCatalog.mjs';
import { CARDS, OUTCOMES } from '../../cards/cardPolicy.mjs';
import { CHECKOUT_PRODUCT_BY_DODO_ID } from '../checkoutLinks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');

/**
 * natively-api is a submodule. It is present in a normal checkout; in a git
 * worktree the directory is empty, so fall back to the main checkout's copy
 * (found through the shared git directory).
 */
function findServerCatalog() {
  const rel = path.join('natively-api', 'lib', 'funnelCatalog.js');
  const local = path.join(ROOT, rel);
  if (fs.existsSync(local)) return local;
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const main = path.join(path.dirname(common), rel);
    if (fs.existsSync(main)) return main;
  } catch { /* not a git checkout */ }
  return null;
}

const SERVER_PATH = findServerCatalog();
const skip = SERVER_PATH ? false : 'natively-api/lib/funnelCatalog.js not found (submodule not checked out)';

test('the app and the server export the same catalogue', { skip }, async () => {
  const server = await import(pathToFileURL(SERVER_PATH).href);
  for (const name of ['FUNNEL_CATALOG', 'ENTITLEMENTS', 'CHECKOUT_PRODUCTS', 'SURFACES', 'CARD_IDS', 'CARD_OUTCOMES', 'FUNNEL_EVENT_NAMES', 'FUNNEL_INT_MAX']) {
    assert.deepEqual(client[name], server[name], `${name} differs between src/lib/funnel/funnelCatalog.mjs and natively-api/lib/funnelCatalog.js`);
  }
});

test('below the header the two files are the same text', { skip }, () => {
  const marker = '/** What the install can do right now';
  const body = (file) => { const t = fs.readFileSync(file, 'utf8'); const i = t.indexOf(marker); assert.ok(i > 0, `${file} lost its marker`); return t.slice(i); };
  assert.equal(body(path.join(HERE, '..', 'funnelCatalog.mjs')), body(SERVER_PATH));
});

test('both validators give the same verdict on the same input', { skip }, async () => {
  const server = await import(pathToFileURL(SERVER_PATH).href);
  const cases = [
    ['checkout_opened', { product: 'api_pro', surface: 'trial_card', opened: true }],
    ['checkout_opened', { product: 'nope' }],
    ['card', { id: 'trial_promo', outcome: 'acted' }],
    ['card', { id: 'trial_promo', outcome: 'clicked' }],
    ['key_entered', { kind: 'api_key', result: 'ok', mins_since_byok_exit: 3 }],
    ['meeting_ended', { minutes: -1 }],
    ['unknown', {}],
    ['app_first_run', undefined],
  ];
  for (const [name, props] of cases) {
    assert.deepEqual(client.checkFunnelProps(name, props), server.checkFunnelProps(name, props), `${name} ${JSON.stringify(props)}`);
  }
});

test('every card the app can raise is in the catalogue, with every outcome', () => {
  assert.deepEqual([...client.CARD_IDS].sort(), Object.keys(CARDS).sort(),
    'a card was added to or removed from cardPolicy.mjs: update CARD_IDS in BOTH catalogue files, server first');
  assert.deepEqual([...client.CARD_OUTCOMES], [...OUTCOMES]);
});

test('every product a checkout link can name is in the catalogue', () => {
  assert.deepEqual([...new Set(Object.values(CHECKOUT_PRODUCT_BY_DODO_ID))].sort(), [...client.CHECKOUT_PRODUCTS].sort());
});

test('every property rule is an enum, int or bool: no field can hold free text', () => {
  for (const [name, spec] of Object.entries(client.FUNNEL_CATALOG)) {
    for (const [key, rule] of Object.entries(spec)) {
      const ok = rule === 'int' || rule === 'bool' || (Array.isArray(rule) && rule.every((v) => /^[a-z0-9_]{1,40}$/.test(v)));
      assert.ok(ok, `${name}.${key}`);
    }
  }
});

// ── The envelope ─────────────────────────────────────────────────────────────
//
// The catalogue agreeing is not the whole contract: the server also checks the
// envelope (ids, timestamps, version, platform). So every event type is built
// by the REAL client and handed to the REAL server validator.

test('every event the client can build is accepted by the server validator, on both platforms', { skip }, async () => {
  const { createFunnelClient } = await import('../funnelClient.mjs');
  const server = await import(pathToFileURL(path.join(path.dirname(SERVER_PATH), 'funnel.js')).href);
  const sample = (rule) => (rule === 'int' ? 7 : rule === 'bool' ? true : rule[0]);
  for (const platform of ['darwin', 'win32']) {
    let file = null;
    let n = 0;
    let now = Date.parse('2026-10-01T12:00:00Z');
    const c = createFunnelClient({
      load: () => file, save: (t) => { file = t; return true; },
      fetchImpl: async () => ({}), endpoint: 'x', now: () => now,
      newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      installId: () => '3F2B8C1E-9A4D-4E6F-8B2A-1C3D5E7F9A0B',
      appVersion: () => '2.9.2-beta.1+build.7', platform,
      appSessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      isEnabled: () => true, getEntitlement: () => 'trial_expired',
    });
    for (const [name, spec] of Object.entries(client.FUNNEL_CATALOG)) {
      now += 5000;
      const props = Object.fromEntries(Object.entries(spec).map(([k, rule]) => [k, sample(rule)]));
      assert.equal(c.track(name, props), 'queued', name);
    }
    const events = JSON.parse(file).events;
    assert.equal(events.length, client.FUNNEL_EVENT_NAMES.length);
    // Judged at the moment the client built them: the server refuses an event
    // that claims a time outside its window, and "now" must not be the wall clock.
    const verdict = server.validateFunnelBatch({ events }, now);
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.rejected, [], `the server refused events a ${platform} client built`);
    assert.equal(verdict.rows.length, events.length);
    for (const row of verdict.rows) {
      assert.equal(row.source, 'client');
      assert.equal(row.platform, platform);
      assert.equal(row.install_id, '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b');
    }
  }
});

test('the app drops an event before the server would refuse it for age', { skip }, async () => {
  const { FUNNEL_MAX_AGE_MS, FUNNEL_BATCH } = await import('../funnelClient.mjs');
  const server = await import(pathToFileURL(path.join(path.dirname(SERVER_PATH), 'funnel.js')).href);
  // Otherwise an event the app still believes is worth sending would be
  // rejected, and dropped, for being exactly as old as the app allows.
  assert.ok(FUNNEL_MAX_AGE_MS < server.MAX_FUNNEL_EVENT_AGE_MS);
  assert.ok(FUNNEL_BATCH <= server.MAX_FUNNEL_EVENTS_PER_REQUEST, 'one client batch must fit one server request');
});

test('one client batch fits inside an install\'s daily allowance on the server', { skip }, async () => {
  const { FUNNEL_BATCH } = await import('../funnelClient.mjs');
  const guard = await import(pathToFileURL(path.join(path.dirname(SERVER_PATH), 'funnelGuard.js')).href);
  assert.ok(FUNNEL_BATCH <= guard.FUNNEL_LIMIT_DEFAULTS.eventsPerInstallPerDay);
});

test('every request the client builds passes the server\'s one-install rule, even from a mixed queue', { skip }, async () => {
  const { createFunnelClient } = await import('../funnelClient.mjs');
  const server = await import(pathToFileURL(path.join(path.dirname(SERVER_PATH), 'funnel.js')).href);
  const ids = ['3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
  let file = null; let n = 0; let turn = 0;
  let now = Date.parse('2026-10-01T12:00:00Z');
  const verdicts = [];
  const c = createFunnelClient({
    load: () => file, save: (t) => { file = t; return true; },
    fetchImpl: async (_url, init) => { verdicts.push(server.validateFunnelBatch(JSON.parse(init.body), now)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; },
    endpoint: 'x', now: () => now, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    installId: () => ids[turn++ % ids.length], appVersion: () => '2.9.2', platform: 'win32', isEnabled: () => true,
  });
  for (let i = 0; i < 9; i++) { now += 3000; assert.equal(c.track('trial_expired'), 'queued'); }
  for (let i = 0; i < 5 && c.pending(); i++) await c.dispatchOnce();
  assert.equal(c.pending(), 0);
  assert.equal(verdicts.length, 3, 'one request per install id');
  for (const v of verdicts) assert.deepEqual([v.ok, v.rows.length, v.rejected.length], [true, 3, 0]);
});

test('the checkout parameters the app adds are the ones the server reads', { skip }, async () => {
  const { tagCheckoutUrl } = await import('../checkoutLinks.mjs');
  const server = await import(pathToFileURL(path.join(path.dirname(SERVER_PATH), 'funnel.js')).href);
  const install = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
  const url = new URL(tagCheckoutUrl('https://checkout.dodopayments.com/buy/pdt_0NcM7JElX4Af6LNVFS1Yf', { installId: install, surface: 'modes_settings' }).url);
  // Dodo's documentation does not say whether `metadata_` is kept on the way
  // back, so the server must read the same three values either way.
  const kept = Object.fromEntries(url.searchParams);
  const stripped = Object.fromEntries([...url.searchParams].map(([k, v]) => [k.replace(/^metadata_/, ''), v]));
  for (const metadata of [kept, stripped]) {
    assert.deepEqual(server.readCheckoutAttribution(metadata), { install_id: install, surface: 'modes_settings', product: 'api_max' });
  }
});
