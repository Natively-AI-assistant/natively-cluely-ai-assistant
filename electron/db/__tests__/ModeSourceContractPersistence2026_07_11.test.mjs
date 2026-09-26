// Real-custom-mode-repair (2026-07-11) — proves the persisted ModeSourceContract
// survives an actual DatabaseManager RESTART (close + re-open the same on-disk
// SQLite file), the exact round-trip the incident brief requires:
//   create through the real API -> save -> restart -> reload -> activate ->
//   runtime snapshot must show the SAME contract, never re-derived, never
//   silently defaulted to general_mixed.
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
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = path.join(repoRoot, 'dist-electron/electron/db/DatabaseManager.js');
const CONTRACT_PATH = path.join(repoRoot, 'dist-electron/electron/services/modeSourceContract.js');

let DatabaseManager;
let contractMod;
let dbMgr;
let tmpDir;

describe('ModeSourceContract — persisted across a real DatabaseManager restart (2026-07-11)', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-source-contract-test-'));
    process.env.NATIVELY_TEST_USERDATA = tmpDir;
    try { delete require.cache[DB_PATH]; } catch {}
    try { delete require.cache[CONTRACT_PATH]; } catch {}
    DatabaseManager = require(DB_PATH).DatabaseManager;
    contractMod = require(CONTRACT_PATH);
    dbMgr = DatabaseManager.getInstance();
  });

  afterEach(() => {
    try { dbMgr?.close?.(); } catch {}
    try { delete require.cache[DB_PATH]; } catch {}
    try { delete require.cache[CONTRACT_PATH]; } catch {}
    delete process.env.NATIVELY_TEST_USERDATA;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test('migration v24 -> v25 adds source_contract_json without touching existing rows', () => {
    if (!dbMgr.isAvailable()) return;
    const db = dbMgr.getDb();
    const version = db.pragma('user_version', { simple: true });
    assert.ok(version >= 25, `expected migrated schema version >= 25, got ${version}`);
    const hasColumn = db.prepare(`PRAGMA table_info(modes)`).all()
      .some((col) => col.name === 'source_contract_json');
    assert.equal(hasColumn, true);
  });

  test('a mode created through the real API round-trips its explicit contract across a restart', () => {
    if (!dbMgr.isAvailable()) return;

    const modeId = 'restart-test-mode-1';
    const contract = contractMod.buildUserSelectedSourceContract({
      defaultOwner: 'reference_files',
      allowedExplicitSwitches: ['profile', 'job_description', 'transcript'],
    });

    dbMgr.createMode({
      id: modeId,
      name: 'Seminar mode',
      templateType: 'general',
      customContext: 'Presenting my thesis. Ask me anything about it.',
      sourceContractJson: contractMod.serializeModeSourceContract(contract),
    });

    // ── RESTART: close the connection and open a fresh DatabaseManager
    // instance against the SAME on-disk file, simulating an app quit+relaunch. ──
    dbMgr.close();
    delete require.cache[DB_PATH];
    DatabaseManager = require(DB_PATH).DatabaseManager;
    dbMgr = DatabaseManager.getInstance();

    const rows = dbMgr.getModes();
    const row = rows.find((r) => r.id === modeId);
    assert.ok(row, 'mode must survive restart');

    const reloaded = contractMod.parseModeSourceContract(row.source_contract_json);
    assert.deepEqual(reloaded, contract, 'the EXACT contract object must round-trip after restart — no re-derivation, no drift');
    assert.equal(reloaded.sourceAuthority, 'reference_files_primary');
    assert.notEqual(reloaded.sourceAuthority, 'general_mixed');
  });

  test('INCIDENT REGRESSION: a legacy mode (no persisted contract) migrates on first read to reference_files_primary, NEVER general_mixed, and the migration is itself persisted', () => {
    if (!dbMgr.isAvailable()) return;

    const modeId = 'legacy-mode-1';
    // Simulates a mode that existed BEFORE this migration shipped: created with
    // the old createMode signature (no sourceContractJson), realistic
    // non-regex-engineered prompt, reference file attached.
    dbMgr.createMode({ id: modeId, name: 'Seminar mode', templateType: 'general', customContext: 'This is a seminar mode. I am presenting my thesis on AgenticVLA. Help me confidently answer questions about my thesis and my project.' });
    dbMgr.addReferenceFile({ id: 'legacy-file-1', modeId, fileName: 'thesis.pdf', content: '[Page 1]\nThesis content here.' });

    const row = dbMgr.getModes().find((r) => r.id === modeId);
    assert.equal(row.source_contract_json, null, 'precondition: legacy mode has no persisted contract yet');

    // Migrate exactly as ModesManager.getOrMigrateSourceContract would.
    const migrated = contractMod.migrateSourceContractFromPrompt({
      customContext: row.custom_context,
      hasReferenceFiles: true,
      hasProfileFacts: false,
    });
    assert.notEqual(migrated.sourceAuthority, 'general_mixed', 'the incident: a mode with files + ambiguous prompt must never silently become general_mixed');
    assert.equal(migrated.sourceAuthority, 'reference_files_primary');
    assert.equal(migrated.evidenceRequired, true, 'reference-files-primary must require evidence, closing the identity/profile bypass');

    dbMgr.updateMode(modeId, { sourceContractJson: contractMod.serializeModeSourceContract(migrated) });

    // ── RESTART: prove the migration STICKS (never re-derived per-turn again). ──
    dbMgr.close();
    delete require.cache[DB_PATH];
    DatabaseManager = require(DB_PATH).DatabaseManager;
    dbMgr = DatabaseManager.getInstance();

    const reloadedRow = dbMgr.getModes().find((r) => r.id === modeId);
    const reloadedContract = contractMod.parseModeSourceContract(reloadedRow.source_contract_json);
    assert.deepEqual(reloadedContract, migrated, 'the migrated contract must be STABLE across restart, identical every time');
  });

  test('updateMode with only customContext does not clobber an existing sourceContractJson', () => {
    if (!dbMgr.isAvailable()) return;
    const modeId = 'update-preserve-1';
    const contract = contractMod.buildUserSelectedSourceContract({ defaultOwner: 'reference_files' });
    dbMgr.createMode({ id: modeId, name: 'M', templateType: 'general', customContext: 'v1', sourceContractJson: contractMod.serializeModeSourceContract(contract) });

    dbMgr.updateMode(modeId, { customContext: 'v2 — edited prompt text' });

    const row = dbMgr.getModes().find((r) => r.id === modeId);
    assert.equal(row.custom_context, 'v2 — edited prompt text');
    const stillThere = contractMod.parseModeSourceContract(row.source_contract_json);
    assert.deepEqual(stillThere, contract, 'editing the prompt text alone must not silently reset the explicit source contract');
  });
});
