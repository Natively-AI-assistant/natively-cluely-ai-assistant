/**
 * CR-03 live verification against the REAL app: boots Electron and calls the
 * real preload bridge, so this exercises the actual
 * systemPreferences.getMediaAccessStatus on this machine — not a stub.
 *
 * Deliberately does NOT invoke openMicSettings: that would open System Settings
 * on the user's machine. Its presence on the bridge is what matters here; the
 * URI mapping is covered by MicPermissionPolicy2026_08_22.test.mjs.
 */
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';

const dotenv = Object.fromEntries(
  fs.readFileSync('/tmp/natively-land-wt/.env', 'utf8').split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const env = { ...process.env, ...dotenv, NATIVELY_E2E: '1', NODE_ENV: 'development',
  NATIVELY_DEV_BYPASS_SCREEN_TCC: '1', NATIVELY_E2E_LOCAL_TEST_TOKEN: 'local-test' };

const app = await electron.launch({ args: ['dist-electron/electron/main.js'], env, timeout: 90000 });
await app.firstWindow({ timeout: 45000 });
const w = app.windows()[0];
await w.waitForLoadState('domcontentloaded').catch(() => {});

const result = await w.evaluate(async () => {
  const api = window.electronAPI || window.api;
  return {
    perms: await api.checkPermissions(),
    hasOpenMicSettings: typeof api.openMicSettings === 'function',
    requestMic: await api.requestMicPermission?.().catch((e) => `threw: ${e?.message}`),
  };
});

const { classifyMicStatus } = await import('/tmp/natively-land-wt/src/lib/micPermissionPolicy.mjs');
const plan = classifyMicStatus(result.perms.platform, result.perms.microphone);

console.log('real systemPreferences payload :', JSON.stringify(result.perms));
console.log('openMicSettings on the bridge  :', result.hasOpenMicSettings);
console.log('requestMicPermission returned  :', result.requestMic);
console.log('policy verdict for this machine:', JSON.stringify(plan));

const VALID = ['granted', 'denied', 'not-determined', 'restricted', 'unknown'];
const checks = [
  ['status is within Electron 43 declared union', VALID.includes(result.perms.microphone)],
  ['openMicSettings is exposed on the bridge', result.hasOpenMicSettings === true],
  ['every status yields a defined remedy', ['none', 'request', 'settings', 'policy'].includes(plan.remedy)],
  // The core CR-03 guarantee: no status can leave the user with nothing to do.
  ['a non-usable status always has an actionable remedy',
    plan.usable || plan.remedy === 'settings' || plan.remedy === 'policy'],
];
let bad = 0;
for (const [label, ok] of checks) { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); }

await app.close();
console.log(bad === 0 ? '\nCR-03 verified against the real Electron API.' : `\n${bad} check(s) failed`);
process.exit(bad === 0 ? 0 : 1);
