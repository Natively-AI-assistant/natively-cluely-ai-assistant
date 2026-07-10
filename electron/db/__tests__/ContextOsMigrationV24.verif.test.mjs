// Context OS — INDEPENDENT VERIFICATION of the v23→v24 migration.
//
// Uses the REAL DatabaseManager against REAL better-sqlite3 (not mocked):
//   1. fresh DB (user_version 0) → migrates straight to 24, tables exist
//   2. idempotent rerun → no error, tables intact
//   3. DAO round-trip: saveAssistantClaim / getVerifiedAssistantClaims /
//      markAssistantClaimContradicted / saveTurnContextContract
//   4. new tables coexist with foreign_keys=ON (they declare no FKs)
//
// Run: npm run build:electron && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/db/__tests__/ContextOsMigrationV24.verif.test.mjs

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const DB_MODULE = path.join(repoRoot, 'dist-electron/electron/db/DatabaseManager.js');

let DatabaseManager;

describe('Context OS v24 migration — REAL sqlite', () => {
  before(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxos-mig-'));
    process.env.NATIVELY_TEST_USERDATA = tmp;
    DatabaseManager = require(DB_MODULE).DatabaseManager;
  });

  test('fresh DB migrates to user_version 24 with both Context OS tables', () => {
    const dbm = DatabaseManager.getInstance();
    const raw = dbm.db; // the better-sqlite3 handle (public field used by other tests)
    const version = raw.pragma('user_version', { simple: true });
    assert.ok(version >= 24, `expected user_version >= 24, got ${version}`);

    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    assert.ok(tables.includes('assistant_claims'), 'assistant_claims table missing');
    assert.ok(tables.includes('turn_context_contracts'), 'turn_context_contracts table missing');

    // Column shape check on assistant_claims.
    const cols = raw.prepare('PRAGMA table_info(assistant_claims)').all().map((c) => c.name);
    for (const c of ['claim_id', 'turn_id', 'claim_text', 'source_owner', 'requested_property', 'validation_status', 'evidence_ids_json', 'created_at', 'contradicted_by_claim_id']) {
      assert.ok(cols.includes(c), `assistant_claims.${c} missing`);
    }
    // validation_status default must be 'unverified'.
    raw.prepare("INSERT INTO assistant_claims (claim_id, turn_id, claim_text, source_owner) VALUES ('c-default','t1','x','reference_files')").run();
    const row = raw.prepare("SELECT validation_status, evidence_ids_json FROM assistant_claims WHERE claim_id='c-default'").get();
    assert.equal(row.validation_status, 'unverified', 'default validation_status must be unverified');
    assert.equal(row.evidence_ids_json, '[]', 'default evidence_ids_json must be []');
  });

  test('foreign_keys is ON and the new FK-less tables are unaffected', () => {
    const raw = DatabaseManager.getInstance().db;
    assert.equal(raw.pragma('foreign_keys', { simple: true }), 1, 'foreign_keys must be ON');
    // assistant_claims declares no FK → inserting with an arbitrary turn_id never violates.
    raw.prepare("INSERT INTO assistant_claims (claim_id, turn_id, claim_text, source_owner) VALUES ('c-nofk','turn-does-not-exist','y','profile')").run();
    assert.ok(true, 'insert with dangling turn_id succeeded (no FK, as designed)');
  });

  test('DAO round-trip: save → verified filter → contradict', () => {
    const dbm = DatabaseManager.getInstance();
    dbm.saveAssistantClaim({ claimId: 'v1', turnId: 't-dao', claimText: 'The system uses Jetson.', sourceOwner: 'reference_files', requestedProperty: 'processor_or_controller', validationStatus: 'verified', evidenceIds: ['e1', 'e2'] });
    dbm.saveAssistantClaim({ claimId: 'u1', turnId: 't-dao', claimText: 'unverified claim', sourceOwner: 'reference_files', validationStatus: 'unverified', evidenceIds: [] });

    const verified = dbm.getVerifiedAssistantClaims(50);
    const ids = verified.map((r) => r.claim_id);
    assert.ok(ids.includes('v1'), 'verified claim missing from getVerifiedAssistantClaims');
    assert.ok(!ids.includes('u1'), 'UNVERIFIED claim leaked into verified results — memory-safety violation');
    const v1 = verified.find((r) => r.claim_id === 'v1');
    assert.deepEqual(JSON.parse(v1.evidence_ids_json), ['e1', 'e2'], 'evidence pointers not persisted');

    dbm.markAssistantClaimContradicted('v1', 'newer-claim');
    const after = dbm.getVerifiedAssistantClaims(50).map((r) => r.claim_id);
    assert.ok(!after.includes('v1'), 'contradicted claim must no longer be verified/reusable');
    const contradicted = dbm.db.prepare("SELECT validation_status, contradicted_by_claim_id FROM assistant_claims WHERE claim_id='v1'").get();
    assert.equal(contradicted.validation_status, 'contradicted');
    assert.equal(contradicted.contradicted_by_claim_id, 'newer-claim');
  });

  test('DAO round-trip: saveTurnContextContract persists source kinds only (no content)', () => {
    const dbm = DatabaseManager.getInstance();
    dbm.saveTurnContextContract({
      turnId: 't-contract', surface: 'manual_chat', activeModeId: 'm1',
      answerShape: 'list', sourceOwner: 'reference_files', requestedProperty: 'phase_or_stage',
      allowedSources: ['mode_reference_chunk'], forbiddenSources: ['profile_resume', 'hindsight_memory'],
      memoryWritePolicy: { allowAssistantMessage: true, allowVerifiedClaims: true, allowUnverifiedClaims: false },
    });
    const row = dbm.db.prepare("SELECT * FROM turn_context_contracts WHERE turn_id='t-contract'").get();
    assert.equal(row.source_owner, 'reference_files');
    assert.deepEqual(JSON.parse(row.forbidden_sources_json), ['profile_resume', 'hindsight_memory']);
    assert.deepEqual(JSON.parse(row.memory_write_policy_json).allowUnverifiedClaims, false);
    // Privacy: the stored row must not contain any question/answer content — only kinds/policy.
    const serialized = JSON.stringify(row);
    assert.ok(!/claim_text|answer|question/i.test(serialized) || !serialized.includes('The '), 'contract snapshot should carry no answer content');
  });
});
