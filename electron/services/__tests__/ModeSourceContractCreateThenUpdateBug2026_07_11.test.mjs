// Real-custom-mode-repair (2026-07-11) — REGRESSION for a bug the real
// end-to-end benchmark caught: ModesManager.createMode() seeds every new
// mode with defaultSourceContractForNewMode() (origin='default_new_mode')
// AT CREATION TIME — before the user has written a prompt or attached any
// reference file. getOrMigrateSourceContract()'s naive
// "if mode.sourceContract, return it" check would then short-circuit
// FOREVER, because a non-null contract already exists from creation — the
// mode never migrates from its real prompt/files, permanently freezing
// EVERY mode at the empty-mode default (defaultOwner='clarify'), regardless
// of what the user actually configures afterward. This is the incident's
// failure class recurring one layer up: a stale cached decision silently
// overriding the mode's real content.
//
// This exercises the REAL ModesManager + real DatabaseManager together
// (not a mocked DB) — the exact create -> update(prompt) -> addReferenceFile
// -> read sequence the real UI performs.
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

describe('ModesManager.getOrMigrateSourceContract — create-then-update migration timing bug (2026-07-11)', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modes-manager-migration-bug-test-'));
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

  test('INCIDENT REGRESSION: a mode created, THEN given a prompt + reference file, migrates correctly (not frozen at the empty-mode default)', () => {
    if (!dbMgr.isAvailable()) return;

    // Step 1: create the mode (exactly what modesCreate does — no prompt, no files yet).
    // NOTE (2026-07-15): the seed for `templateType='general'` is now
    // `defaultOwner='reference_files'`, `sourceAuthority='reference_files_primary'`
    // (per Fix 1's per-template seed). The `general` template's `default_new_mode`
    // contract remains re-migration-eligible (the re-migration guard at
    // ModesManager.ts:581 exempts only non-general template-aware seeds),
    // so the create-then-migrate flow still works. The test below now asserts
    // the seed lands at the doc-grounded authority for `general`, then
    // re-migrates to `migrated_from_prompt` when the user writes a prompt.
    const created = mgr.createMode({ name: 'Seminar mode', templateType: 'general' });

    // Precondition: the seed contract is the template-aware empty-mode default.
    const seedContract = mgr.getOrMigrateSourceContract(created.id);
    assert.equal(seedContract.origin, 'default_new_mode');
    assert.equal(seedContract.defaultOwner, 'reference_files');
    assert.equal(seedContract.sourceAuthority, 'reference_files_primary');

    // Step 2: the user writes a realistic (non-regex-engineered) prompt —
    // exactly what modesUpdate does.
    mgr.updateMode(created.id, {
      customContext: 'This is a seminar mode. I am presenting my thesis on AgenticVLA. Help me confidently answer questions about my thesis and my project.',
    });

    // Step 3: the user attaches a reference file — exactly what
    // modes:upload-reference-file's addReferenceFile call does.
    mgr.addReferenceFile({ id: 'ref-1', modeId: created.id, fileName: 'thesis.pdf', content: 'AgenticVLA thesis content about Mercury X1.' });

    // Step 4: read the contract again — THIS is where the bug manifested.
    // Before the fix, this returned the STALE seed contract (still
    // defaultOwner='clarify', origin='default_new_mode') because
    // getOrMigrateSourceContract short-circuited on "mode.sourceContract
    // already exists" without checking whether it was ever a REAL decision.
    const migratedContract = mgr.getOrMigrateSourceContract(created.id);

    assert.notEqual(migratedContract.origin, 'default_new_mode',
      'the contract must be RE-MIGRATED once the mode has real content — never frozen at the empty seed');
    assert.equal(migratedContract.origin, 'migrated_from_prompt');
    assert.equal(migratedContract.defaultOwner, 'reference_files');
    assert.equal(migratedContract.sourceAuthority, 'reference_files_primary');
    assert.notEqual(migratedContract.sourceAuthority, 'general_mixed');

    // Step 5: the migration must be STABLE afterward — a subsequent read
    // (e.g. after adding ANOTHER file) must not re-derive or drift.
    mgr.addReferenceFile({ id: 'ref-2', modeId: created.id, fileName: 'thesis2.pdf', content: 'More thesis content.' });
    const stableContract = mgr.getOrMigrateSourceContract(created.id);
    assert.deepEqual(stableContract, migratedContract, 'a completed migration must never re-derive on subsequent calls');
  });

  test('a user-selected contract (origin=user_selected) is NEVER re-migrated, even if it happens to look like the empty default', () => {
    if (!dbMgr.isAvailable()) return;

    const created = mgr.createMode({ name: 'Custom mode', templateType: 'general' });
    const { buildUserSelectedSourceContract } = require(path.join(repoRoot, 'dist-electron/electron/services/modeSourceContract.js'));
    const explicit = buildUserSelectedSourceContract({ defaultOwner: 'mixed' });
    mgr.updateMode(created.id, { sourceContract: explicit });
    mgr.updateMode(created.id, { customContext: 'Some prompt text that would otherwise migrate differently.' });
    mgr.addReferenceFile({ id: 'ref-x', modeId: created.id, fileName: 'file.txt', content: 'content' });

    const readBack = mgr.getOrMigrateSourceContract(created.id);
    assert.equal(readBack.origin, 'user_selected', 'an explicit user choice must never be silently overwritten by migration');
    assert.deepEqual(readBack, explicit);
  });

  test('a mode created and activated with NO prompt and NO files stays at the safe doc-grounded default (not silently promoted)', () => {
    if (!dbMgr.isAvailable()) return;

    // NOTE (2026-07-15): the seed for `templateType='general'` is now
    // `defaultOwner='reference_files'`, `sourceAuthority='reference_files_primary'`
    // (per Fix 1). The "safe default" assertion below flipped from
    // `'clarify'` to `'reference_files_primary'` — both are equally safe
    // (neither is `general_mixed`), and the new default is more aligned
    // with the doc-grounded isolation contract. A user with no prompt and
    // no files gets the doc-grounded defaults instead of the ambiguous
    // `ask_if_ambiguous` fallback.
    const created = mgr.createMode({ name: 'Empty mode', templateType: 'general' });
    const contract = mgr.getOrMigrateSourceContract(created.id);
    assert.equal(contract.defaultOwner, 'reference_files');
    assert.equal(contract.sourceAuthority, 'reference_files_primary');
    assert.notEqual(contract.sourceAuthority, 'general_mixed');
  });
});
