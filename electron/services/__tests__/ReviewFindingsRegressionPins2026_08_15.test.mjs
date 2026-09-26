// electron/services/__tests__/ReviewFindingsRegressionPins2026_08_15.test.mjs
//
// Standalone regression pins for review findings F5, F6, F10 — DELIBERATELY in
// a file of their own. The original pins for F6/F10 live inside suites that a
// concurrent workstream actively edits (UsageOutbox.test.mjs,
// ZerofillDetectorPeakToPeak.test.mjs); a stale editor buffer was observed
// (2026-08-15) that reverted the F5/F6/F10 fixes AND deleted the in-file F6
// guard in the same save. A guard that travels in the same file as the code
// it protects can be deleted by the same accident — this file cannot.
//
// If any test here goes red, a merged fix has regressed; do not weaken the
// assertion — restore the fix (or supersede it CONSCIOUSLY, updating the pin
// with the reasoning, as the R1 merge did for F9).
//
// Run with:
//   npm run build:electron
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/services/__tests__/ReviewFindingsRegressionPins2026_08_15.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const require_ = createRequire(import.meta.url);

describe('F5 — usage-outbox durability contract', () => {
  test('MAX_ATTEMPTS spans at least the 7-day durability window (≥168 at the 1h backoff cap)', () => {
    const src = read('electron/services/UsageOutbox.ts');
    const m = /const MAX_ATTEMPTS = (\d+);/.exec(src);
    assert.ok(m, 'MAX_ATTEMPTS must exist as a plain numeric constant');
    const attempts = Number(m[1]);
    // The module header promises the queue "survives a server outage" and that
    // 401s stay queued because "the user may paste a valid key later". At the
    // 1h-capped backoff, attempts ≈ hours: 12 exhausted events in ~6.1h (the
    // original F5 finding); 168 is 7 days — the same window the delivered-row
    // retention uses. Storage is bounded by the 10k cap + delivered-first
    // eviction, NOT by this constant.
    assert.ok(attempts >= 168,
      `MAX_ATTEMPTS=${attempts} exhausts undelivered usage events after ~${attempts} capped-backoff hours — ` +
      'below the 7-day durability window the module header promises (F5, code-review 2026-08-14)');
  });
});

describe('F6 — builtin feature attribution accepts the LIVE call-site shape', () => {
  test('featureForMode resolves named features for camelCase Mode input (ModesManager.getActiveMode output)', () => {
    const { featureForMode, FEATURE } = require_(
      path.join(root, 'dist-electron/electron/services/usageInstrumentation.js'),
    );
    // The production call site (ipcHandlers) passes ModesManager.getActiveMode()
    // output, whose Mode type carries CAMELCASE `isBuiltin` (rowToMode maps
    // `is_builtin === 1` → isBuiltin). If only the snake_case raw-row field is
    // read, builtin detection is ALWAYS false in production and every
    // execution ledgers as generic mode_execution (F6). If the call-site
    // contract changes to raw rows, update this pin WITH the call-site change.
    assert.equal(
      featureForMode({ templateType: 'technical-interview', isBuiltin: true }),
      FEATURE.TECHNICAL_INTERVIEW,
      'camelCase isBuiltin:true must resolve the named builtin feature (F6)',
    );
    assert.equal(
      featureForMode({ templateType: 'technical-interview', isBuiltin: false }),
      FEATURE.MODE_EXECUTION,
      'camelCase isBuiltin:false must stay generic',
    );
    // Raw-row shape keeps working too — accepting both is the fix.
    assert.equal(
      featureForMode({ templateType: 'technical-interview', is_builtin: 1 }),
      FEATURE.TECHNICAL_INTERVIEW,
      'snake_case raw-row input must continue to resolve',
    );
  });
});

describe('F10 — the revoked-Screen-Recording diagnostic has an emitter', () => {
  test('sustained zero-fill on macOS probes the TCC grant and can emit mac-screen-recording-revoked-rebuild', () => {
    const main = read('electron/main.ts');
    const branch = main.split("sustained-zero-valued-silence' && process.platform === 'darwin'")[1]?.slice(0, 2200) ?? '';
    assert.ok(branch.length > 0,
      'main.ts must branch on the sustained-zero-valued-silence reason (darwin-gated) — ' +
      'without it the revoked-grant diagnostic is dead code and revoked users are told to change devices (F10)');
    assert.match(branch, /resolveMacScreenCaptureCapability/,
      'the branch must PROBE the actual grant rather than assume revocation');
    assert.match(branch, /mac-screen-recording-revoked-rebuild/,
      'the revoked-rebuild diagnostic must be emitted from this branch');
    assert.match(branch, /sendAudioCaptureFailed/,
      'the diagnosis must reach the renderer as a banner, not just a log line');
  });
});
