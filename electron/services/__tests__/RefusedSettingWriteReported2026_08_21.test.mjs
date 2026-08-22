// R-24 regression test.
//
// R-15 made set() refuse before mutating when the settings store is degraded,
// so memory and disk could not disagree. But set() was `void`, so no caller
// could tell a refusal from a success — and its own docstring conceded that
// "roughly fifteen IPC handlers report success to the renderer off this call".
//
// The return value was the lesser half. Those handlers also BROADCAST a
// `*-changed` event on the way to `return { success: true }`, so a refused
// write put every window on a value disk never received — which then silently
// reverted on the next launch, with the UI having confirmed it applied.
//
// (After R-19 this state is narrower than it was: settingsUnreadable now
// latches only when settings.json can be neither read nor quarantined. Narrower
// is not gone.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sm = fs.readFileSync(new URL('../SettingsManager.ts', import.meta.url), 'utf8');
const ipc = fs.readFileSync(new URL('../../ipcHandlers.ts', import.meta.url), 'utf8');

test('set() reports whether the write actually landed', () => {
  const i = sm.indexOf('public set<K extends keyof AppSettings>');
  assert.notEqual(i, -1, 'set() must still exist');
  const sig = sm.slice(i, sm.indexOf('{', i));
  assert.ok(/\)\s*:\s*boolean\s*$/.test(sig.trim()),
    'set() must return boolean — as void, a refusal is indistinguishable from a success');

  const body = sm.slice(i, i + 900);
  const refusal = body.slice(body.indexOf('this.settingsUnreadable'));
  assert.ok(/return false/.test(refusal.slice(0, 400)), 'the refusal path must return false');
  assert.ok(/return true/.test(body), 'the success path must return true');
});

test('no settings IPC handler reports success on a refused write', () => {
  const offenders = [];
  const re = /safeHandle\('([^']+)'/g;
  let m;
  while ((m = re.exec(ipc)) !== null) {
    const next = ipc.indexOf("safeHandle('", m.index + 12);
    const body = ipc.slice(m.index, next === -1 ? ipc.length : next);
    if (!/\.set\('/.test(body) || !body.includes('success: true')) continue;
    if (!body.includes('settings_store_degraded')) offenders.push(m[1]);
  }
  assert.deepEqual(offenders, [],
    `handler(s) ${offenders.join(', ')} still return success (and broadcast a *-changed event) `
    + 'after a write the settings store may have refused');
});

test('the guard precedes the broadcast, not just the return', () => {
  // Returning an error while still broadcasting would leave the other windows
  // desynchronised — the half of this bug that the return value does not cover.
  const i = ipc.indexOf("safeHandle('set-code-verification'");
  assert.notEqual(i, -1);
  const body = ipc.slice(i, i + 1200);
  const guard = body.indexOf('settings_store_degraded');
  const broadcast = body.indexOf("send('code-verification-changed'");
  assert.notEqual(broadcast, -1, 'the broadcast must still exist for the success path');
  assert.ok(guard !== -1 && guard < broadcast,
    'the refusal must short-circuit BEFORE the *-changed broadcast');
});
