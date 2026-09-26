/**
 * OKF Profile Intelligence — Phase 2 (2026-07-02): fail-closed retrieval + evidence.
 * Exercises the REAL OkfProfileRetriever against a REAL persisted profile pack,
 * proving the gate order and, most importantly, that it contributes NOTHING at
 * ungated entry points.
 *
 * MUST run under Electron (native better-sqlite3). Guarded to skip on bare node.
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

if (!process.env.NATIVELY_TEST_USERDATA) {
  process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-profile-p2-'));
}
process.env.NATIVELY_OKF_PROFILE_PACKS = '1';
process.env.NATIVELY_OKF_PROFILE_HYBRID_RETRIEVAL = '1';

async function load(rel) {
  return import(pathToFileURL(path.join(distRoot, rel)).href);
}

async function seedPacks() {
  // Re-assert the flags this file depends on at every seed. node --test may run
  // files concurrently in one process; the flag-off subtest below flips a shared
  // process.env flag, so every "allowed" test re-sets both flags on entry to be
  // resilient to that race (product code reads the flag live per call).
  process.env.NATIVELY_OKF_PROFILE_PACKS = '1';
  process.env.NATIVELY_OKF_PROFILE_HYBRID_RETRIEVAL = '1';
  const { DatabaseManager } = await load('db/DatabaseManager.js');
  DatabaseManager.getInstance();
  const { ProfilePackBuilder } = await load('services/knowledge/ProfilePackBuilder.js');
  const builder = ProfilePackBuilder.getInstance();
  // Idempotent generate — DO NOT deleteAllProfilePacks() here. Tests in this file
  // share the singleton builder + DB and node --test runs them concurrently; a
  // delete in one test's seed would wipe the packs another test is mid-retrieval
  // on. generateForProfile is content-hash idempotent, so repeated calls are safe
  // no-ops once the packs exist.
  if (!builder.getProfilePack('resume')) {
    builder.generateForProfile({ kind: 'resume', docId: 1, structuredData: FIXTURE_RESUME, totalExperienceYears: 6 }, true);
  }
  if (!builder.getProfilePack('jd')) {
    builder.generateForProfile({ kind: 'jd', docId: 2, structuredData: FIXTURE_JD, artifacts: FIXTURE_ARTIFACTS }, true);
  }
  return builder;
}

const guard = { skip: !isElectronRuntime && !process.env.FORCE_DB_TEST };

test('Phase2: FAIL-CLOSED — no explicit plan (phone-chat / chat()) → empty, blockedReason no_route', guard, async () => {
  await seedPacks();
  const { retrieveProfileEvidence } = await load('services/knowledge/OkfProfileRetriever.js');
  const r = retrieveProfileEvidence({
    question: 'Tell me about your experience at Nimbus Data.',
    profileContextPolicy: 'required',
    documentGroundedActive: false,
    hasExplicitPlan: false, // <-- the ungated entry points
  });
  assert.equal(r.allowed, false, 'not allowed without an explicit plan');
  assert.equal(r.block, '', 'empty block');
  assert.equal(r.blockedReason, 'no_route');
});

test('Phase2: policy forbidden → empty (blockedReason policy_forbidden), even with plan + flag on', guard, async () => {
  await seedPacks();
  const { retrieveProfileEvidence } = await load('services/knowledge/OkfProfileRetriever.js');
  const r = retrieveProfileEvidence({
    question: 'Write a for loop in Python.',
    profileContextPolicy: 'forbidden',
    documentGroundedActive: false,
    hasExplicitPlan: true,
  });
  assert.equal(r.allowed, false);
  assert.equal(r.blockedReason, 'policy_forbidden');
});

test('Phase2: document-grounded active → empty (blockedReason doc_grounded), regardless of policy', guard, async () => {
  await seedPacks();
  const { retrieveProfileEvidence } = await load('services/knowledge/OkfProfileRetriever.js');
  const r = retrieveProfileEvidence({
    question: 'What is my thesis about?',
    profileContextPolicy: 'required',
    documentGroundedActive: true, // doc-grounded custom mode
    hasExplicitPlan: true,
  });
  assert.equal(r.allowed, false);
  assert.equal(r.blockedReason, 'doc_grounded');
});

// NOTE: the flag-OFF assertion (which must flip the shared NATIVELY_OKF_PROFILE_
// HYBRID_RETRIEVAL env) lives in its OWN file — OkfProfilePhase2FlagOff.test.mjs —
// NOT here. node --test may run test files concurrently in one process, and a
// mid-test global env flip in this file would race the retrieval-allowed tests in
// a sibling file (observed flake). Keeping every env-mutating assertion out of the
// files that also assert the ALLOWED path removes the race by construction.

test('Phase2: ALLOWED path — plan + policy required + flag on + not doc-grounded → cards returned', guard, async () => {
  await seedPacks();
  const { retrieveProfileEvidence } = await load('services/knowledge/OkfProfileRetriever.js');
  const r = retrieveProfileEvidence({
    question: 'Tell me about my experience at Nimbus Data and my strongest languages.',
    profileContextPolicy: 'required',
    documentGroundedActive: false,
    hasExplicitPlan: true,
  });
  assert.equal(r.allowed, true, 'allowed');
  assert.ok(r.cardCount >= 1, `at least one card (${r.cardCount})`);
  assert.match(r.block, /CANDIDATE KNOWLEDGE CARDS/, 'formatted block present');
  // At least one relevant card surfaced.
  const titles = r.cards.map((c) => c.card.title.toLowerCase());
  assert.ok(titles.some((t) => t.includes('nimbus') || t.includes('languages')), 'relevant card surfaced');
});

test('Phase2: JD/negotiation intent surfaces artifact cards when policy allows', guard, async () => {
  await seedPacks();
  const { retrieveProfileEvidence } = await load('services/knowledge/OkfProfileRetriever.js');
  const r = retrieveProfileEvidence({
    question: 'Which requirements of the job description do I not yet meet?',
    profileContextPolicy: 'allowed',
    documentGroundedActive: false,
    hasExplicitPlan: true,
  });
  assert.equal(r.allowed, true);
  assert.ok(r.cardCount >= 1, 'cards returned for gap/JD intent');
});
