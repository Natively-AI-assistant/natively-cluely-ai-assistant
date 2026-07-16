// Real-custom-mode-repair (2026-07-16) — REGRESSION for the Technical
// Interview failure mode reported in the canonical-gate production incident:
//
// A user creates a mode as "General" (seeded reference_files_primary) and
// later switches its `templateType` via the dropdown to "Technical
// Interview" (or Looking-for-Work). `ModesManager.updateMode({ templateType
// })` previously wrote the new templateType to the DB but DID NOT touch
// the mode's persisted sourceContract, so the mode silently kept the
// General seed (`reference_files_primary`, no profile grant) — exactly
// the failure contract the user described for "Technical Interview":
//
//   sourceAuthority: reference_files_primary
//   allowedSources: active_mode_pinned, custom_context, system_prompt_injection
//   forbiddenSources: reference_files, profile_resume, profile_jd, projects,
//                     live_transcript, meeting_rag, long_term_memory
//
// The fix has two layers:
//   1. PRIMARY: `updateMode({ templateType })` re-seeds the sourceContract
//      when origin === 'default_new_mode' (the only origin a renderer-side
//      template switch is allowed to overwrite — user-selected and
//      migrated-from-prompt contracts are NEVER silently replaced).
//   2. DEFENSE-IN-DEPTH: `getOrMigrateSourceContract` uses the new
//      `seededForTemplateType` field to detect a stale seed (e.g. direct DB
//      writes, future call sites bypassing updateMode) and re-seed on next
//      read.
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
const MODES_PATH = path.join(repoRoot, 'dist-electron/electron/services/ModesManager.js');

let DatabaseManager;
let ModesManager;
let dbMgr;
let mgr;
let tmpDir;

describe('ModesManager.updateMode — re-seed sourceContract on templateType change (2026-07-16)', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modes-template-switch-reseed-test-'));
    process.env.NATIVELY_TEST_USERDATA = tmpDir;
    try { delete require.cache[DB_PATH]; } catch {}
    try { delete require.cache[MODES_PATH]; } catch {}
    DatabaseManager = require(DB_PATH).DatabaseManager;
    ModesManager = require(MODES_PATH).ModesManager;
    dbMgr = DatabaseManager.getInstance();
    mgr = ModesManager.getInstance();
  });

  afterEach(() => {
    try { dbMgr?.close?.(); } catch {}
    try { delete require.cache[DB_PATH]; } catch {}
    try { delete require.cache[MODES_PATH]; } catch {}
    delete process.env.NATIVELY_TEST_USERDATA;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test('INCIDENT REGRESSION: switching a General mode to Technical Interview re-seeds profile_only', () => {
    if (!dbMgr.isAvailable()) return;

    // 1) Create mode as General (the most common entry path; user later
    //    switches it to Technical Interview via the dropdown).
    const created = mgr.createMode({ name: 'My interview mode', templateType: 'general' });
    const seed = mgr.getOrMigrateSourceContract(created.id);
    assert.equal(seed.sourceAuthority, 'reference_files_primary');
    assert.equal(seed.defaultOwner, 'reference_files');
    assert.deepEqual(seed.allowedExplicitSwitches, ['reference_files']);
    assert.equal(seed.seededForTemplateType, 'general');

    // 2) Renderer-side: user changes templateType via the dropdown to
    //    technical-interview. NO sourceContract update is passed by the
    //    panel for a template-only change.
    mgr.updateMode(created.id, { templateType: 'technical-interview' });

    // 3) THE FIX: getOrMigrateSourceContract now reports the correct
    //    per-template seed for the new template — not the stale General
    //    seed that the previous (buggy) behavior would have returned.
    const afterSwitch = mgr.getOrMigrateSourceContract(created.id);
    assert.equal(afterSwitch.sourceAuthority, 'profile_only',
      'TECHNICAL INTERVIEW REGRESSION: switching templateType must re-seed sourceContract');
    assert.equal(afterSwitch.defaultOwner, 'profile');
    assert.deepEqual(afterSwitch.allowedExplicitSwitches, ['profile', 'job_description']);
    assert.equal(afterSwitch.seededForTemplateType, 'technical-interview');
    assert.equal(afterSwitch.origin, 'default_new_mode');
  });

  test('switching Technical Interview back to General re-seeds reference_files_primary', () => {
    if (!dbMgr.isAvailable()) return;

    const created = mgr.createMode({ name: 'TI first', templateType: 'technical-interview' });
    const seed = mgr.getOrMigrateSourceContract(created.id);
    assert.equal(seed.sourceAuthority, 'profile_only');
    assert.equal(seed.seededForTemplateType, 'technical-interview');

    mgr.updateMode(created.id, { templateType: 'general' });

    const afterSwitch = mgr.getOrMigrateSourceContract(created.id);
    assert.equal(afterSwitch.sourceAuthority, 'reference_files_primary',
      'Switching back to General must re-seed to reference_files_primary');
    assert.equal(afterSwitch.seededForTemplateType, 'general');
  });

  test('user_selected contract is NEVER overwritten by a template switch', () => {
    if (!dbMgr.isAvailable()) return;

    const created = mgr.createMode({ name: 'Customised', templateType: 'general' });

    // User opens Knowledge Source and toggles to an explicit selection.
    // For a `general` template the defaultOwner='reference_files', so any
    // non-empty switch set produces a `reference_files_primary` contract
    // (this is the natural shape for a reference-files-primary user choice).
    const userContract = mgr.buildUserSourceContract({
      modeId: created.id,
      templateType: 'general',
      switches: ['reference_files', 'profile'],
    });
    mgr.updateMode(created.id, { sourceContract: userContract });

    const beforeSwitch = mgr.getOrMigrateSourceContract(created.id);
    assert.equal(beforeSwitch.origin, 'user_selected');
    assert.equal(beforeSwitch.sourceAuthority, 'reference_files_primary');
    assert.equal(beforeSwitch.defaultOwner, 'reference_files');

    // User switches templateType via the dropdown — the panel does NOT
    // touch sourceContract for a template-only change.
    mgr.updateMode(created.id, { templateType: 'technical-interview' });

    // THE INVARIANT: a user's explicit Knowledge Source choice must
    // survive any later template change. Only `default_new_mode` (system
    // seed) is eligible for re-seed.
    const afterSwitch = mgr.getOrMigrateSourceContract(created.id);
    assert.equal(afterSwitch.origin, 'user_selected',
      'user_selected contract MUST survive template switch');
    assert.equal(afterSwitch.sourceAuthority, 'reference_files_primary');
    assert.deepEqual(afterSwitch.allowedExplicitSwitches, ['reference_files', 'profile']);
    assert.equal(afterSwitch.seededForTemplateType, undefined,
      'user_selected contract is authoritative; seededForTemplateType stays undefined');
  });

  test('migrated_from_prompt contract is NEVER overwritten by a template switch', () => {
    if (!dbMgr.isAvailable()) return;

    const created = mgr.createMode({ name: 'Custom prompt', templateType: 'general' });

    // Manually inject a migrated_from_prompt contract via direct DB write
    // (simulates the legacy migration path: prompt was already on disk when
    // the mode was first read by the new code, so the heuristic migrated it).
    const migratedContract = {
      version: 1,
      defaultOwner: 'reference_files',
      allowedExplicitSwitches: ['profile', 'job_description'],
      sourceAuthority: 'reference_files_primary',
      evidenceRequired: true,
      conflictPolicy: 'reference_files_win',
      memoryPolicy: { allowPriorAssistantFacts: false, allowPriorAssistantReferents: true, allowHindsight: false },
      origin: 'migrated_from_prompt',
      migrationRevision: 2,
    };
    mgr.updateMode(created.id, { sourceContract: migratedContract });

    mgr.updateMode(created.id, { templateType: 'sales' });

    const afterSwitch = mgr.getOrMigrateSourceContract(created.id);
    assert.equal(afterSwitch.origin, 'migrated_from_prompt',
      'migrated_from_prompt contract MUST survive template switch');
    assert.equal(afterSwitch.sourceAuthority, 'reference_files_primary');
    assert.equal(afterSwitch.migrationRevision, 2);
  });

  test('no-op templateType update (same template) does not re-seed', () => {
    if (!dbMgr.isAvailable()) return;

    const created = mgr.createMode({ name: 'Stable', templateType: 'technical-interview' });
    const before = mgr.getOrMigrateSourceContract(created.id);
    const beforeTimestamp = Date.now();

    // Same templateType: not a "change", so no re-seed.
    mgr.updateMode(created.id, { templateType: 'technical-interview' });

    const after = mgr.getOrMigrateSourceContract(created.id);
    assert.deepEqual(after, before,
      'Updating templateType to its current value must NOT change the contract');
  });

  test('defense-in-depth: stale default_new_mode seed (seededForTemplateType mismatch) is healed on next read', () => {
    if (!dbMgr.isAvailable()) return;

    // Create the mode. Its seed is for `general`. Now hand-write a
    // mismatch: change the mode's templateType via the DB layer directly
    // (bypassing mgr.updateMode), then ALSO hand-write a contract whose
    // seededForTemplateType disagrees with the mode's templateType. This
    // is the exact pre-fix bug state — the contract's origin is
    // default_new_mode, the templateType is wrong, but no updateMode call
    // ever re-seeded. The defense-in-depth layer in
    // getOrMigrateSourceContract must detect this on next read and re-seed.
    const created = mgr.createMode({ name: 'Manual override', templateType: 'general' });

    // Hand-write the staleness state: templateType changed without
    // re-seeding the contract.
    dbMgr.updateMode(created.id, { templateType: 'technical-interview' });

    const handStaleContract = {
      version: 1,
      defaultOwner: 'reference_files',
      allowedExplicitSwitches: ['reference_files'],
      sourceAuthority: 'reference_files_primary',
      evidenceRequired: true,
      conflictPolicy: 'reference_files_win',
      memoryPolicy: { allowPriorAssistantFacts: false, allowPriorAssistantReferents: true, allowHindsight: false },
      origin: 'default_new_mode',
      seededForTemplateType: 'general',
    };
    mgr.updateMode(created.id, { sourceContract: handStaleContract });

    // Defense-in-depth: getOrMigrateSourceContract detects the mismatch
    // (origin=default_new_mode AND seededForTemplateType=general BUT
    // mode.templateType=technical-interview) and re-seeds on next read.
    // The re-seed uses the CURRENT templateType, not the stale
    // seededForTemplateType.
    const healed = mgr.getOrMigrateSourceContract(created.id);
    assert.equal(healed.sourceAuthority, 'profile_only',
      'DEFENSE-IN-DEPTH: stale default_new_mode seed must self-heal on next read');
    assert.equal(healed.seededForTemplateType, 'technical-interview',
      'Heal must use the mode CURRENT templateType, not the stale seededFor value');
    assert.equal(healed.origin, 'default_new_mode');
  });

  test('user-selected sourceContract survives updateMode with both sourceContract AND templateType in same call', () => {
    if (!dbMgr.isAvailable()) return;

    const created = mgr.createMode({ name: 'Combo', templateType: 'general' });

    // Save an explicit user selection AND switch templateType in one
    // round-trip (e.g. via a future UI button). The user-supplied contract
    // wins over the re-seed path because the call site supplied both.
    const userContract = mgr.buildUserSourceContract({
      modeId: created.id,
      templateType: 'technical-interview',
      switches: ['profile'],
    });
    mgr.updateMode(created.id, {
      templateType: 'technical-interview',
      sourceContract: userContract,
    });

    const after = mgr.getOrMigrateSourceContract(created.id);
    assert.equal(after.origin, 'user_selected');
    assert.deepEqual(after.allowedExplicitSwitches, ['profile']);
  });

  test('seededForTemplateType round-trips through serializeModeContract + parseModeSourceContract', () => {
    // (Pure serialization test — no DB. Validates the new optional field
    // survives the production JSON shape.)
    const mscPath = path.join(repoRoot, 'dist-electron/electron/services/modeSourceContract.js');
    const { defaultSourceContractForNewMode, parseModeSourceContract, serializeModeSourceContract } =
      require(mscPath);

    const seed = defaultSourceContractForNewMode('technical-interview');
    assert.equal(seed.seededForTemplateType, 'technical-interview');
    const serialized = serializeModeSourceContract(seed);
    const parsed = parseModeSourceContract(serialized);
    assert.ok(parsed, 'parser must accept new field');
    assert.equal(parsed.seededForTemplateType, 'technical-interview');
    assert.equal(parsed.sourceAuthority, 'profile_only');
  });
});