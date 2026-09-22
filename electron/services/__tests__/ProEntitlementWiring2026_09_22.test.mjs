// The reconciler is only useful if the app actually calls it. These pin the four
// call sites, and that every one of them is contained — entitlement repair must
// never be able to break a key save, a usage fetch or startup.
//
// Source assertions on purpose: the handlers live inside a 10k-line Electron IPC
// module that cannot be loaded without the whole app. Comments are stripped first
// so a comment mentioning a call can never satisfy (or fail) a pin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const IPC = code(read('../../ipcHandlers.ts'));
const MAIN = code(read('../../main.ts'));
const WIRING = code(read('../proEntitlementWiring.ts'));
const slice = (src, from, to) => { const a = src.indexOf(from); assert.ok(a >= 0, `marker not found: ${from}`); const b = src.indexOf(to, a); return src.slice(a, b > a ? b : a + 6000); };

test('startup: reconcile once, late, off the startup path, and contained', () => {
  const block = slice(MAIN, "logStartupPhase('create-window:complete'", 'NATIVELY_LOG_GPU_STATUS');
  assert.match(block, /setTimeout\(\(\) => \{\s*try \{[\s\S]*getProEntitlementReconciler\(\)\.run\('startup'\)[\s\S]*\} catch/);
  assert.match(block, /\}, 8000\)/);
  assert.match(block, /\.unref\?\.\(\)/, 'a pending timer must not hold the app open');
});

test('key save: a non-final activation failure starts the retry and is REPORTED, not swallowed', () => {
  const h = slice(IPC, "safeHandle('set-natively-api-key'", "safeHandle('get-natively-plans'");
  assert.match(h, /Pro not activated —[\s\S]*run\('key-saved'\)/);
  assert.match(h, /outcome === 'retrying'\) proPending =/);
  assert.match(h, /proPending: true, proError:/);
  // a REFUSED key still wins over everything else
  assert.ok(h.indexOf('keyRejection\n        ? { success: false') < h.indexOf('proPending: true'), 'key rejection must be reported first');
});

test('key cleared: the pending retry is cancelled — it would be retrying a key that is gone', () => {
  const h = slice(IPC, "safeHandle('set-natively-api-key'", "safeHandle('get-natively-plans'");
  const cleared = h.slice(h.indexOf('} else {\n        try {\n          require('));
  assert.match(h, /getProEntitlementReconciler\(\)\.stop\(\)/);
  assert.ok(h.indexOf('.stop()') < h.indexOf('lm.deactivate()'), 'stop before the licence is removed');
  void cleared;
});

test('usage fetched: the known plan is passed in, so the trigger costs no second request', () => {
  const h = slice(IPC, "safeHandle('get-natively-usage'", "safeHandle('invalidate-natively-usage-cache'");
  assert.match(h, /_usageCache\.set\(key[\s\S]*run\('usage-ok', \{ plan: data\.plan \}\)/);
  assert.match(h, /void getProEntitlementReconciler\(\)/, 'fire-and-forget: the usage panel must not wait on it');
});

test('wiring: no premium module means "nothing to do", never an error and never a request', () => {
  assert.match(WIRING, /isPremium: \(\) => \{ const lm = licenseManager\(\); return lm \? Boolean\(lm\.isPremium\(\)\) : true; \}/);
  assert.match(WIRING, /if \(!lm\) return \{ success: false, skipped: true \}/);
});

test('wiring: only 401/403 on /v1/usage count as a refused key — 429 and 5xx are transient', () => {
  assert.match(WIRING, /keyRejected: res\.status === 401 \|\| res\.status === 403/);
});

test('wiring: platform-neutral — no OS branch anywhere in the feature', () => {
  for (const [name, src] of [['wiring', WIRING], ['reconciler', code(read('../ProEntitlementReconciler.ts'))]]) {
    assert.doesNotMatch(src, /process\.platform|darwin|win32|isMac|isWindows/, `${name} must not branch on the OS`);
  }
});
