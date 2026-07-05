/**
 * OKF Profile Intelligence — flag-OFF assertions (2026-07-02).
 *
 * These tests MUTATE the shared process.env OKF profile flags to prove the
 * flag-off behavior (pack generation skipped, retrieval blocked). They are
 * DELIBERATELY isolated in their own file, away from every "allowed"/retrieval
 * assertion, because node --test may run test files concurrently in one process
 * and a mid-test global env flip would otherwise race a sibling file's
 * retrieval assertion (observed flake). Run this file on its own or last.
 *
 * MUST run under Electron (native better-sqlite3). Guarded to skip on bare node.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FIXTURE_RESUME } from './fixtures/profile-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const isElectronRuntime = Boolean(process.versions?.electron) || process.env.ELECTRON_RUN_AS_NODE === '1';
if (!process.env.NATIVELY_TEST_USERDATA) {
  process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-profile-flagoff-'));
}
async function load(rel) {
  return import(pathToFileURL(path.join(distRoot, rel)).href);
}
const guard = { skip: !isElectronRuntime && !process.env.FORCE_DB_TEST };

test('flag OFF: generateForProfile no-ops (skipped_flag_off)', guard, async () => {
  process.env.NATIVELY_OKF_PROFILE_PACKS = '0';
  const { DatabaseManager } = await load('db/DatabaseManager.js');
  DatabaseManager.getInstance();
  const { ProfilePackBuilder } = await load('services/knowledge/ProfilePackBuilder.js');
  const res = ProfilePackBuilder.getInstance().generateForProfile(
    { kind: 'resume', docId: 999, structuredData: FIXTURE_RESUME }, true,
  );
  assert.equal(res.status, 'skipped_flag_off', 'no pack generated when okfProfilePacks off');
});

test('flag OFF: retrieval blocked (blockedReason flag_off) even with plan + policy required', guard, async () => {
  process.env.NATIVELY_OKF_PROFILE_HYBRID_RETRIEVAL = '0';
  const { retrieveProfileEvidence } = await load('services/knowledge/OkfProfileRetriever.js');
  const r = retrieveProfileEvidence({
    question: 'What are my strongest programming languages?',
    profileContextPolicy: 'required',
    documentGroundedActive: false,
    hasExplicitPlan: true,
  });
  assert.equal(r.allowed, false);
  assert.equal(r.blockedReason, 'flag_off');
});
