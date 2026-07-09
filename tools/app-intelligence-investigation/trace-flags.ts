// tools/app-intelligence-investigation/trace-flags.ts
//
// Read-only trace of every intelligence flag surfaced by
// `electron/intelligence/intelligenceFlags.ts` plus the runtime-resolved
// values that are interesting to investigators (the global snapshot).
//
// This script does NOT modify state. It does NOT call providers. It imports
// only the pure flag module (whose own `readSettingOverride` already wraps
// `require('../services/SettingsManager')` in try/catch and returns null on
// any error — so the module is safe to import in a headless process).
//
// Run with:
//   npx tsx tools/app-intelligence-investigation/trace-flags.ts

import {
  intelligenceFlagKeys,
  intelligenceFlagMeta,
  intelligenceFlagSnapshot,
} from '../../electron/intelligence/intelligenceFlags';

function main(): void {
  console.log('# Intelligence flag registry — current state');
  console.log('# Source: electron/intelligence/intelligenceFlags.ts (FLAGS record)');
  console.log('# A flag is ON when: env override = ON > settings opt-in > registry default.');
  console.log('# -------------------------------------------------------------------');

  const keys = intelligenceFlagKeys();
  console.log(`# ${keys.length} flags registered.\n`);

  console.log('# Per-flag metadata + current resolved value');
  console.log('# -------------------------------------------------------------------');
  console.log('  flag'.padEnd(38) +
    'env'.padEnd(40) +
    'default'.padEnd(8) +
    'now');
  console.log('  ' + '-'.repeat(120));
  const snapshot = intelligenceFlagSnapshot();
  for (const key of keys) {
    const meta = intelligenceFlagMeta(key);
    console.log('  ' +
      key.padEnd(38) +
      meta.env.padEnd(40) +
      String(meta.default).padEnd(8) +
      String(snapshot[key]));
  }

  console.log('');
  console.log('# Default distribution');
  console.log('# -------------------------------------------------------------------');
  let on = 0;
  let off = 0;
  for (const key of keys) {
    if (snapshot[key]) on += 1;
    else off += 1;
  }
  console.log(`  ON  : ${on}`);
  console.log(`  OFF : ${off}`);

  console.log('');
  console.log('# ON-by-default flags (product ON, with opt-out via NATIVELY_*=0)');
  console.log('# -------------------------------------------------------------------');
  for (const key of keys) {
    const meta = intelligenceFlagMeta(key);
    if (meta.default && snapshot[key]) {
      console.log(`  - ${key}  (env ${meta.env})`);
    }
  }

  console.log('');
  console.log('# OFF-by-default flags (gated, default-no-op)');
  console.log('# -------------------------------------------------------------------');
  for (const key of keys) {
    const meta = intelligenceFlagMeta(key);
    if (!meta.default) {
      console.log(`  - ${key}  (env ${meta.env})`);
    }
  }

  console.log('');
  console.log('# Process-env overrides currently in effect');
  console.log('# -------------------------------------------------------------------');
  let nOverridden = 0;
  for (const key of keys) {
    const meta = intelligenceFlagMeta(key);
    const raw = (process.env[meta.env] || '').trim();
    if (raw) {
      nOverridden += 1;
      console.log(`  ${meta.env}="${raw}"  →  ${key}  →  snapshot[${key}]=${snapshot[key]}`);
    }
  }
  if (nOverridden === 0) {
    console.log('  (none)');
  }

  console.log('');
  console.log('# End of trace-flags.ts output.');
}

main();