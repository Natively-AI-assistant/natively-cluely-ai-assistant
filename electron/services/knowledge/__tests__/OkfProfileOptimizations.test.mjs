/**
 * OKF Profile Intelligence — optimization-pass regressions (2026-07-02).
 * Locks in the fixes from the post-live hardening sweep:
 *   - relevance-band trim: a focused question returns few, relevant cards (no
 *     ~0.15 filler padding) while a BROAD question keeps its cluster.
 *   - content-only hash: an unchanged re-ingest short-circuits (no needless
 *     regeneration just because the doc row id changed).
 *
 * MUST run under Electron. --test-concurrency=1 when batched.
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
  process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-opt-'));
}
process.env.NATIVELY_OKF_PROFILE_PACKS = '1';
process.env.NATIVELY_OKF_PROFILE_HYBRID_RETRIEVAL = '1';
const load = (r) => import(pathToFileURL(path.join(distRoot, r)).href);
const guard = { skip: !isElectronRuntime && !process.env.FORCE_DB_TEST };

async function seeded() {
  const { DatabaseManager } = await load('db/DatabaseManager.js');
  DatabaseManager.getInstance();
  const { ProfilePackBuilder } = await load('services/knowledge/ProfilePackBuilder.js');
  const b = ProfilePackBuilder.getInstance();
  if (!b.getProfilePack('resume')) b.generateForProfile({ kind: 'resume', structuredData: FIXTURE_RESUME, totalExperienceYears: 6 }, true);
  if (!b.getProfilePack('jd')) b.generateForProfile({ kind: 'jd', structuredData: FIXTURE_JD, artifacts: FIXTURE_ARTIFACTS }, true);
  const { retrieveProfileEvidence } = await load('services/knowledge/OkfProfileRetriever.js');
  return { b, retrieveProfileEvidence };
}

test('band-trim: a focused question returns a tight, relevant set (no ~0.15 filler)', guard, async () => {
  const { retrieveProfileEvidence } = await seeded();
  for (const q of ['Where did you study?', 'What salary should you ask for?', 'Give me a 60-second intro.']) {
    const r = retrieveProfileEvidence({ question: q, profileContextPolicy: 'required', documentGroundedActive: false, hasExplicitPlan: true });
    assert.ok(r.cardCount >= 1 && r.cardCount <= 2, `${q} → tight set (got ${r.cardCount})`);
    // No filler card scoring at the floor should survive next to a strong top.
    const minScore = Math.min(...r.cards.map((c) => c.score));
    assert.ok(minScore > 0.2, `${q} → no floor-filler survives (min ${minScore.toFixed(2)})`);
  }
});

test('band-trim: a BROAD question keeps its relevant cluster (not over-trimmed)', guard, async () => {
  const { retrieveProfileEvidence } = await seeded();
  const r = retrieveProfileEvidence({ question: 'Tell me about yourself.', profileContextPolicy: 'required', documentGroundedActive: false, hasExplicitPlan: true });
  assert.ok(r.cardCount >= 2, `broad question keeps multiple cards (got ${r.cardCount})`);
  const types = new Set(r.cards.map((c) => c.card.type));
  assert.ok(types.has('candidate_identity') || types.has('candidate_summary'), 'identity/summary present for a self-intro');
});

test('content-only hash: an unchanged re-ingest short-circuits (no regen, same packVersion)', guard, async () => {
  const { b } = await seeded();
  b.deleteAllProfilePacks();
  const first = b.generateForProfile({ kind: 'resume', docId: 1, structuredData: FIXTURE_RESUME, totalExperienceYears: 6 }, true);
  assert.equal(first.status, 'generated');
  const v1 = first.pack.packVersion;
  // Re-ingest identical content with a DIFFERENT docId (as a real re-upload would
  // get a new autoincrement id) and force=false → must short-circuit, NOT bump version.
  const second = b.generateForProfile({ kind: 'resume', docId: 99999, structuredData: FIXTURE_RESUME, totalExperienceYears: 6 }, false);
  assert.equal(second.status, 'generated');
  assert.equal(second.pack.packVersion, v1, 'unchanged content did not bump packVersion despite a new docId');
});

test('trial-wipe backstop: deleteAllProfilePacks clears packs even without the orchestrator', guard, async () => {
  const { b } = await seeded();
  // Ensure at least one pack exists, then the direct backstop removes it.
  if (!b.getProfilePack('resume')) b.generateForProfile({ kind: 'resume', structuredData: FIXTURE_RESUME, totalExperienceYears: 6 }, true);
  assert.ok(b.getProfilePack('resume'), 'pack exists pre-wipe');
  b.deleteAllProfilePacks();
  assert.equal(b.getProfilePack('resume'), null, 'resume pack gone after backstop wipe');
  assert.equal(b.getProfilePack('jd'), null, 'jd pack gone after backstop wipe');
});
