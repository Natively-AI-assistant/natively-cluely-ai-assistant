/**
 * OKF Profile Intelligence — intent→type retrieval boost (2026-07-02).
 *
 * Locks in the fix found by the live MiniMax run: a profile question whose intent
 * word shares no tokens with the target card body (e.g. "Where did you study?" vs
 * "B.S. in Computer Science, University of Texas at Austin") must still surface the
 * right card via the intent→card-type boost, and — for artifact cards the lexical
 * pre-filter would drop below threshold — via the intent-seed candidate injection.
 *
 * MUST run under Electron. Guarded to skip on bare node. Run --test-concurrency=1
 * when batched with other DB-backed profile tests.
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
  process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-intent-'));
}
process.env.NATIVELY_OKF_PROFILE_PACKS = '1';
process.env.NATIVELY_OKF_PROFILE_HYBRID_RETRIEVAL = '1';
const load = (r) => import(pathToFileURL(path.join(distRoot, r)).href);
const guard = { skip: !isElectronRuntime && !process.env.FORCE_DB_TEST };

let retrieve;
async function ensureSeeded() {
  const { DatabaseManager } = await load('db/DatabaseManager.js');
  DatabaseManager.getInstance();
  const { ProfilePackBuilder } = await load('services/knowledge/ProfilePackBuilder.js');
  const b = ProfilePackBuilder.getInstance();
  if (!b.getProfilePack('resume')) b.generateForProfile({ kind: 'resume', docId: 1, structuredData: FIXTURE_RESUME, totalExperienceYears: 6 }, true);
  if (!b.getProfilePack('jd')) b.generateForProfile({ kind: 'jd', docId: 2, structuredData: FIXTURE_JD, artifacts: FIXTURE_ARTIFACTS }, true);
  ({ retrieveProfileEvidence: retrieve } = await load('services/knowledge/OkfProfileRetriever.js'));
}
function topCard(r) { return r.cards[0]?.card; }

test('intent-boost: "Where did you study?" surfaces the education card first (no lexical overlap)', guard, async () => {
  await ensureSeeded();
  for (const q of ['Where did you study?', 'Where did you go to college?', 'Which university did you attend?']) {
    const r = retrieve({ question: q, profileContextPolicy: 'required', documentGroundedActive: false, hasExplicitPlan: true });
    assert.equal(r.allowed, true);
    assert.equal(topCard(r)?.type, 'candidate_education', `top card is education for "${q}" (got ${topCard(r)?.type})`);
  }
});

test('intent-seed: "What salary should you ask for?" surfaces the negotiation artifact (below lexical threshold)', guard, async () => {
  await ensureSeeded();
  const r = retrieve({ question: 'What salary should you ask for?', profileContextPolicy: 'allowed', documentGroundedActive: false, hasExplicitPlan: true });
  assert.equal(r.allowed, true);
  assert.equal(topCard(r)?.type, 'artifact_negotiation', `top card is negotiation (got ${topCard(r)?.type})`);
});

test('intent-boost: "Give me a 60-second intro" surfaces the intro artifact first', guard, async () => {
  await ensureSeeded();
  const r = retrieve({ question: 'Give me a 60-second intro.', profileContextPolicy: 'required', documentGroundedActive: false, hasExplicitPlan: true });
  assert.equal(topCard(r)?.type, 'artifact_intro', `top card is intro (got ${topCard(r)?.type})`);
});

test('intent-boost does NOT weaken isolation — forbidden/doc-grounded still return nothing', guard, async () => {
  await ensureSeeded();
  const forbidden = retrieve({ question: 'Where did you study?', profileContextPolicy: 'forbidden', documentGroundedActive: false, hasExplicitPlan: true });
  assert.equal(forbidden.allowed, false);
  const docG = retrieve({ question: 'Where did you study?', profileContextPolicy: 'required', documentGroundedActive: true, hasExplicitPlan: true });
  assert.equal(docG.allowed, false);
  const noPlan = retrieve({ question: 'Where did you study?', profileContextPolicy: 'required', documentGroundedActive: false, hasExplicitPlan: false });
  assert.equal(noPlan.allowed, false);
});
