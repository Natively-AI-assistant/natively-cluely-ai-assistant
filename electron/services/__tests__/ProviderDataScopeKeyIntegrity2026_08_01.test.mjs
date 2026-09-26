// FIX 1 (2026-08-01): the `code_execution` provider data scope was silently
// erased on every Privacy-panel write.
//
// The six scope keys were hand-maintained in three places. A SEVENTH scope,
// `code_execution`, is declared in SettingsManager and ENFORCED in
// llm/codeVerification/cloudRunner.ts (`policy?.code_execution !== false`) — but
// it was missing from the `allowedKeys` set in the `set-provider-data-scopes`
// handler, which persisted a whole-object REPLACEMENT. So the moment a user
// toggled any scope, a stored `code_execution: false` was deleted and sending
// model-generated code to the cloud runner silently re-enabled.
//
// The load-bearing test drives the REAL SettingsManager (a temp userData) and
// the REAL cloudRunner predicate — the function that decides whether code is
// sent to Piston. NATIVELY_CODE_EXECUTION_CLOUD is set to 'true' on purpose:
// without it `cloudExecutionEnabled()` short-circuits to false and the test
// would pass identically with or without the fix.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const dist = (p) => path.join(repoRoot, 'dist-electron/electron', p);
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const {
  PROVIDER_DATA_SCOPES, UI_PROVIDER_DATA_SCOPES, NON_UI_PROVIDER_DATA_SCOPES,
  isProviderDataScope, mergeProviderDataScopes,
} = require(dist('llm/ProviderRouter.js'));

// ── the merge ───────────────────────────────────────────────────────────────

describe('mergeProviderDataScopes', () => {
  test('a stored non-UI scope SURVIVES a write that does not mention it', () => {
    const merged = mergeProviderDataScopes({ code_execution: false, transcript: true }, { transcript: false });
    assert.equal(merged.code_execution, false, 'the enforced scope was erased by an unrelated toggle');
    assert.equal(merged.transcript, false);
  });

  test('unknown keys and non-boolean values are rejected', () => {
    const merged = mergeProviderDataScopes({}, { transcript: false, nonsense: true, screenshots: 'yes', __proto__: true });
    assert.deepEqual(merged, { transcript: false });
  });

  test('a scope can still be turned back ON (merge is not one-way)', () => {
    assert.equal(mergeProviderDataScopes({ transcript: false }, { transcript: true }).transcript, true);
    assert.equal(mergeProviderDataScopes({ code_execution: false }, { code_execution: true }).code_execution, true);
  });

  test('a missing or malformed payload leaves the stored policy untouched', () => {
    assert.deepEqual(mergeProviderDataScopes({ transcript: false }, null), { transcript: false });
    assert.deepEqual(mergeProviderDataScopes({ transcript: false }, 'nope'), { transcript: false });
    assert.deepEqual(mergeProviderDataScopes(undefined, undefined), {});
  });

  test('code_execution is a recognised scope key', () => {
    assert.equal(isProviderDataScope('code_execution'), true);
    assert.equal(isProviderDataScope('not_a_scope'), false);
    assert.deepEqual([...NON_UI_PROVIDER_DATA_SCOPES], ['code_execution']);
    assert.equal(PROVIDER_DATA_SCOPES.length, UI_PROVIDER_DATA_SCOPES.length + NON_UI_PROVIDER_DATA_SCOPES.length);
  });
});

// ── end to end: settings write → the predicate that gates the cloud runner ──

describe('a Privacy-panel toggle does not re-enable cloud code execution', () => {
  let userData;
  let envBefore;
  let SettingsManager;
  let cloudExecutionEnabled;

  before(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-key-integrity-'));
    // `electron` is an esbuild EXTERNAL, so the dist bundles resolve it through
    // Node at runtime — pre-seeding the module cache gives SettingsManager a
    // real app.getPath('userData') without an Electron process. Everything else
    // in this test is the shipped code.
    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
      id: electronPath, filename: electronPath, loaded: true,
      exports: { app: { isReady: () => true, getPath: () => userData, getVersion: () => '0.0.0-test' } },
    };
    envBefore = process.env.NATIVELY_CODE_EXECUTION_CLOUD;
    // Without this the predicate short-circuits to false and the test is vacuous.
    process.env.NATIVELY_CODE_EXECUTION_CLOUD = 'true';
    ({ SettingsManager } = require(dist('services/SettingsManager.js')));
    ({ cloudExecutionEnabled } = require(dist('llm/codeVerification/cloudRunner.js')));
  });

  after(() => {
    if (envBefore === undefined) delete process.env.NATIVELY_CODE_EXECUTION_CLOUD;
    else process.env.NATIVELY_CODE_EXECUTION_CLOUD = envBefore;
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* noop */ }
  });

  test('BASELINE: with code_execution allowed the cloud runner is permitted', () => {
    const sm = SettingsManager.getInstance();
    sm.set('providerDataScopes', { code_execution: true });
    assert.equal(cloudExecutionEnabled(), true, 'baseline must be true — otherwise the denial test proves nothing');
  });

  test('code_execution:false survives an unrelated scope toggle and still blocks the cloud runner', () => {
    const sm = SettingsManager.getInstance();
    sm.set('providerDataScopes', { code_execution: false });
    assert.equal(cloudExecutionEnabled(), false, 'the denial must take effect at all');

    // Exactly what the IPC handler does on a Privacy-panel toggle.
    const merged = mergeProviderDataScopes(sm.get('providerDataScopes'), { transcript: false });
    sm.set('providerDataScopes', merged);

    // Enforcement first: this is the assertion that describes what actually
    // happens to the user's code, and it must be the one a regression trips.
    assert.equal(cloudExecutionEnabled(), false,
      'LEAK: toggling an unrelated privacy scope re-enabled sending model code to the cloud runner');
    assert.equal(sm.get('providerDataScopes').code_execution, false, 'the stored scope was erased');
  });

  test('the denial persists across a fresh settings read (it is really on disk)', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
    assert.equal(raw.providerDataScopes.code_execution, false);
    assert.equal(raw.providerDataScopes.transcript, false);
  });
});

// ── drift guards: one source of truth, three consumers ──────────────────────

describe('scope key lists cannot drift apart again', () => {
  test('the IPC handler no longer carries its own scope list', () => {
    const src = read('electron/ipcHandlers.ts');
    assert.ok(!/const allowedKeys = new Set\(\[/.test(src),
      'a second hand-maintained scope list reappeared in the handler');
    assert.match(src, /mergeProviderDataScopes\(settings\.get\('providerDataScopes'\), scopes\)/,
      'the handler must merge over the stored policy, not replace it');
  });

  test('SettingsManager declares every scope the router knows about', () => {
    const src = read('electron/services/SettingsManager.ts');
    const block = src.slice(src.indexOf('providerDataScopes?: {'), src.indexOf('};', src.indexOf('providerDataScopes?: {')));
    for (const key of PROVIDER_DATA_SCOPES) {
      assert.ok(block.includes(`${key}?: boolean`), `SettingsManager does not declare the ${key} scope`);
    }
  });

  test('the Privacy panel renders exactly the UI-surfaced scopes, in order', () => {
    const src = read('src/components/settings/AIProvidersSettings.tsx');
    const rows = src.slice(src.indexOf('const SCOPE_ROWS = ['), src.indexOf('];', src.indexOf('const SCOPE_ROWS = [')));
    const keys = [...rows.matchAll(/key:\s*'([a-z_]+)'\s*as const/g)].map((m) => m[1]);
    assert.deepEqual(keys, [...UI_PROVIDER_DATA_SCOPES],
      'SCOPE_ROWS and UI_PROVIDER_DATA_SCOPES disagree — the renderer would show or omit a scope the main process enforces differently');
    for (const key of NON_UI_PROVIDER_DATA_SCOPES) {
      assert.ok(!keys.includes(key), `${key} is deliberately not a UI row; adding one is a product decision, not a drift fix`);
    }
  });

  test('the cloud runner still reads the scope it is gated by', () => {
    assert.match(read('electron/llm/codeVerification/cloudRunner.ts'), /policy\?\.code_execution !== false/);
  });
});
