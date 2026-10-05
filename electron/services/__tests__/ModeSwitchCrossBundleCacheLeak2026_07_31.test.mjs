// Cross-mode reference contamination (2026-07-31) — the active-mode snapshot
// must be invalidated for EVERY copy of ModesManager in the process.
//
// THE INCIDENT
// A live Stage 1 run reported that Recruiting and Sales answered from Technical
// Interview reference files. Reconstructed from SQLite: Recruiting had exactly
// `maya_nair_candidate_resume.md` + `platform_engineer_job_description.md`
// attached, yet its answers described TalentScope, RedisMart and Aetherbot —
// content that exists ONLY in `technical_project_portfolio.md`, a file attached
// solely to the Technical Interview mode.
//
// THE CAUSE
// esbuild inlines ModesManager into every main-process entry bundle that imports
// it (14 of them). Each inlined copy is its own module scope with its own
// `ModesManager.instance`, so `getInstance()` returns a DIFFERENT object per
// bundle. `setActiveMode` is only ever reached through the ipcHandlers copy, so
// the IntelligenceEngine copy's `_activeModeInfoCache` was filled once and never
// invalidated again. Retrieval keys off that snapshot — `getReferenceFiles(
// modeInfo.id)` — so the whole evidence set followed the stale mode.
//
// WHY THIS TEST LOADS THE MODULE TWICE
// A single-copy test cannot fail on this bug: within one module scope the cache
// is invalidated correctly, which is exactly why it shipped. Busting
// `require.cache` for ModesManager ONLY (DatabaseManager stays shared, as the DB
// is the shared truth in production too) reproduces the two-bundle split
// faithfully — two class objects, two singletons, one database.
//
// Run under `ELECTRON_RUN_AS_NODE=1 electron --test` (native better-sqlite3 ABI).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = path.join(repoRoot, 'dist-electron/electron/db/DatabaseManager.js');
const MODES_PATH = path.join(repoRoot, 'dist-electron/electron/services/ModesManager.js');

let tmpDir;
let dbMgr;

/** Load a FRESH copy of the ModesManager module — one simulated esbuild bundle. */
function loadModesBundle() {
  delete require.cache[MODES_PATH];
  return require(MODES_PATH);
}

describe('mode switch invalidates the active-mode snapshot across bundles (2026-07-31)', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-xbundle-'));
    process.env.NATIVELY_TEST_USERDATA = tmpDir;
    delete require.cache[DB_PATH];
    dbMgr = require(DB_PATH).DatabaseManager.getInstance();
  });

  afterEach(() => {
    try { dbMgr?.close?.(); } catch { /* noop */ }
    delete require.cache[DB_PATH];
    delete require.cache[MODES_PATH];
    delete globalThis.__nativelyActiveModeInfoCacheV1__;
    delete process.env.NATIVELY_TEST_USERDATA;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  test('two module copies really are two singletons (the premise of this test)', () => {
    if (!dbMgr.isAvailable()) return;
    const A = loadModesBundle();
    const B = loadModesBundle();
    assert.notEqual(A.ModesManager, B.ModesManager,
      'busting require.cache did not produce a second class object — this test would be vacuous');
    assert.notEqual(A.ModesManager.getInstance(), B.ModesManager.getInstance(),
      'the two copies share an instance — the bundle split is not being modelled');
  });

  test('a switch through copy B is visible to copy A on the very next turn', () => {
    if (!dbMgr.isAvailable()) return;
    const A = loadModesBundle();
    const B = loadModesBundle();
    const a = A.ModesManager.getInstance();
    const b = B.ModesManager.getInstance();

    // Two modes with DIFFERENT reference files — the shape of the incident.
    const tech = a.createMode({ name: 'Technical Interview', templateType: 'technical-interview' });
    const recruit = a.createMode({ name: 'Recruiting', templateType: 'recruiting' });
    assert.ok(tech?.id && recruit?.id, 'mode creation failed');

    // Copy A answers a turn in Technical Interview, filling its snapshot.
    b.setActiveMode(tech.id);
    assert.equal(a.getActiveModeInfo()?.id, tech.id);

    // The user switches mode. In production this IPC lands in ONE bundle.
    b.setActiveMode(recruit.id);

    // The regression: copy A used to keep returning `tech.id` for the rest of
    // the process, so `getReferenceFiles(modeInfo.id)` handed a Recruiting turn
    // the Technical Interview files.
    assert.equal(a.getActiveModeInfo()?.id, recruit.id,
      'copy A still reports the previous mode — cross-mode contamination is live again');
    assert.equal(a.getActiveModeInfo()?.templateType, 'recruiting');
  });

  test('reference files follow the switched mode, not the cached one', () => {
    if (!dbMgr.isAvailable()) return;
    const A = loadModesBundle();
    const B = loadModesBundle();
    const a = A.ModesManager.getInstance();
    const b = B.ModesManager.getInstance();

    const tech = a.createMode({ name: 'Technical Interview', templateType: 'technical-interview' });
    const recruit = a.createMode({ name: 'Recruiting', templateType: 'recruiting' });
    dbMgr.addReferenceFile?.({
      id: 'ref_tech', modeId: tech.id, fileName: 'technical_project_portfolio.md',
      content: 'TalentScope RedisMart Aetherbot', fileType: 'md', fileSize: 31,
    });
    dbMgr.addReferenceFile?.({
      id: 'ref_cand', modeId: recruit.id, fileName: 'maya_nair_candidate_resume.md',
      content: 'IncidentLens QueueFlow CampusMesh', fileType: 'md', fileSize: 33,
    });

    b.setActiveMode(tech.id);
    a.getActiveModeInfo();               // copy A caches Technical Interview
    b.setActiveMode(recruit.id);

    const files = a.getReferenceFiles(a.getActiveModeInfo().id).map((f) => f.fileName);
    assert.deepEqual(files, ['maya_nair_candidate_resume.md'],
      `a Recruiting turn resolved to ${JSON.stringify(files)} — the leak is back`);
  });

  test('the snapshot lives in one process-wide slot, not on the instance', () => {
    if (!dbMgr.isAvailable()) return;
    const A = loadModesBundle();
    assert.equal(A.ACTIVE_MODE_CACHE_KEY, '__nativelyActiveModeInfoCacheV1__');
    const mode = A.ModesManager.getInstance().createMode({ name: 'General', templateType: 'general' });
    A.ModesManager.getInstance().setActiveMode(mode.id);
    A.ModesManager.getInstance().getActiveModeInfo();
    assert.ok(globalThis[A.ACTIVE_MODE_CACHE_KEY],
      'the cache moved back onto the instance — every non-ipcHandlers bundle goes stale again');
  });
});
