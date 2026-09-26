/**
 * OKF Profile Intelligence — Phase 1 DB round-trip (2026-07-02). Exercises the
 * REAL ProfilePackBuilder against a REAL DatabaseManager (migration v23: reserved
 * mode + knowledge_cards.pii), proving:
 *   - a profile pack persists to the shared knowledge_* tables and reads back
 *   - persisted cards carry pii=1
 *   - the pack hangs off the reserved '__profile_okf__' mode and NEVER appears
 *     in ModesManager.getModes() (no document-grounded leak via the mode path)
 *   - deleteAllProfilePacks() removes it
 *   - flags OFF → generateForProfile no-ops (skipped_flag_off), zero rows
 *
 * MUST run under the Electron test runner (native better-sqlite3 ABI):
 *   ELECTRON_RUN_AS_NODE=1 NATIVELY_TEST_USERDATA=<tmp> ./node_modules/.bin/electron --test <this file>
 * The npm script wrapper `test:electron` / a dedicated runner sets these; a bare
 * `node --test` will skip (guarded below) rather than crash on the native ABI.
 *
 * CONCURRENCY: when batching this alongside OTHER DB-backed knowledge tests in one
 * process, pass --test-concurrency=1. This test is destructive (deleteAllProfilePacks)
 * and shares the process-wide ProfilePackBuilder singleton + DB with the Phase 2
 * retrieval tests; parallel file execution would let this test wipe packs another
 * file is mid-retrieval on. Serialized, all pass deterministically. Run alone, no flag needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FIXTURE_RESUME, FIXTURE_JD, FIXTURE_ARTIFACTS } from './fixtures/profile-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');

const isElectronRuntime = Boolean(process.versions?.electron) || process.env.ELECTRON_RUN_AS_NODE === '1';

// Provide a writable userdata dir so DatabaseManager's app.getPath fallback works.
if (!process.env.NATIVELY_TEST_USERDATA) {
  process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-profile-db-'));
}
process.env.NATIVELY_OKF_PROFILE_PACKS = '1';

async function load(rel) {
  return import(pathToFileURL(path.join(distRoot, rel)).href);
}

test('Phase1-DB: profile pack persists, reads back, is pii, isolated from user modes, and deletes', { skip: !isElectronRuntime && !process.env.FORCE_DB_TEST }, async () => {
  process.env.NATIVELY_OKF_PROFILE_PACKS = '1'; // re-assert (resilient to concurrent flag-off test)
  const { DatabaseManager } = await load('db/DatabaseManager.js');
  const dbm = DatabaseManager.getInstance();
  // Force schema init / migrations.
  if (typeof dbm.initialize === 'function') { try { dbm.initialize(); } catch { /* already */ } }

  const { ProfilePackBuilder } = await load('services/knowledge/ProfilePackBuilder.js');
  const builder = ProfilePackBuilder.getInstance();

  // Clean slate.
  builder.deleteAllProfilePacks();

  // 1) Resume pack generates + persists.
  const res = builder.generateForProfile({
    kind: 'resume', docId: 101, structuredData: FIXTURE_RESUME, totalExperienceYears: 6,
  }, true);
  assert.equal(res.status, 'generated', `resume pack generated (got ${res.status} ${res.error || ''})`);
  assert.ok(res.pack && res.pack.cards.length > 0, 'resume pack has cards');

  // 2) Reads back from the store.
  const readBack = builder.getProfilePack('resume');
  assert.ok(readBack, 'resume pack reads back');
  assert.ok(readBack.cards.length === res.pack.cards.length, 'same card count on read-back');

  // 3) Every persisted card is pii.
  assert.ok(readBack.cards.every((c) => c.pii === true), 'persisted cards are pii=true');

  // 4) Pack hangs off the reserved mode.
  assert.equal(readBack.modeId, '__profile_okf__', 'pack modeId is the reserved sentinel');

  // 5) The reserved mode NEVER appears in ModesManager.getModes().
  const { ModesManager } = await load('services/ModesManager.js');
  const modes = ModesManager.getInstance().getModes();
  assert.ok(!modes.some((m) => m.id === '__profile_okf__'), 'reserved profile mode is filtered from getModes');
  assert.ok(!modes.some((m) => m.templateType === '__reserved__'), 'no __reserved__ template surfaces');

  // 6) JD pack (with artifacts) generates.
  const jdRes = builder.generateForProfile({
    kind: 'jd', docId: 202, structuredData: FIXTURE_JD, artifacts: FIXTURE_ARTIFACTS,
  }, true);
  assert.equal(jdRes.status, 'generated', 'jd pack generated');
  const jdTypes = new Set(jdRes.pack.cards.map((c) => c.type));
  assert.ok(jdTypes.has('artifact_gap_analysis'), 'jd pack has artifact cards');

  // 7) Delete removes both.
  builder.deleteAllProfilePacks();
  assert.equal(builder.getProfilePack('resume'), null, 'resume pack deleted');
  assert.equal(builder.getProfilePack('jd'), null, 'jd pack deleted');
});

// The flags-OFF no-op assertion (which must flip the shared
// NATIVELY_OKF_PROFILE_PACKS env) lives in OkfProfilePhase2FlagOff.test.mjs — kept
// out of this file for the same concurrency reason described in
// OkfProfilePhase2Retrieval.test.mjs.
