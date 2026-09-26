// electron/services/__tests__/GeneratedModePersistence.test.mjs
//
// Phase 2 persistence validation: the 10 modes generated live by MiniMax
// (test-results/modes-autopilot/generated-modes/*.json) must persist through the
// REAL ModesManager + DatabaseManager (SQLite on disk), be independently
// readable from a SECOND raw connection to the same natively.db file (proving
// on-disk durability, i.e. "survives a restart"), and be editable/re-savable.
//
// Runs under ELECTRON_RUN_AS_NODE=1 electron --test (native better-sqlite3 ABI).
// Uses an isolated temp userData dir (NATIVELY_TEST_USERDATA) so it never
// touches real user modes.
//
// Gated on the generated-modes artifacts existing (Phase 2 generation run).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const GEN_DIR = path.join(REPO, 'test-results/modes-autopilot/generated-modes');

const briefKeys = [
  'backend-eng', 'behavioral-hr', 'thesis-defense', 'data-analyst', 'sales-discovery',
  'investor-pitch', 'consulting-case', 'legal-compliance', 'conference-talk', 'support-escalation',
];

function loadDrafts() {
  const drafts = [];
  for (const key of briefKeys) {
    const p = path.join(GEN_DIR, `${key}.json`);
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j?.draft) drafts.push(j.draft);
    }
  }
  return drafts;
}

const DRAFTS = loadDrafts();
const HAVE = DRAFTS.length === 10;

let tmpDir;
let dbPath;
let ModesManager;
let DatabaseManager;

describe('Generated mode persistence', { skip: !HAVE ? `skip: expected 10 generated modes in ${GEN_DIR}, found ${DRAFTS.length}` : false }, () => {
  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-genmode-'));
    process.env.NATIVELY_TEST_USERDATA = tmpDir;
    dbPath = path.join(tmpDir, 'natively.db');
    const dbMod = await import(pathToFileURL(path.join(REPO, 'dist-electron/electron/db/DatabaseManager.js')).href);
    const mmMod = await import(pathToFileURL(path.join(REPO, 'dist-electron/electron/services/ModesManager.js')).href);
    DatabaseManager = dbMod.DatabaseManager;
    ModesManager = mmMod.ModesManager;
    // Force DB init on the temp path.
    DatabaseManager.getInstance();
  });

  after(() => {
    try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const createdIds = [];

  test('all 10 generated modes persist and are retrievable via ModesManager', () => {
    const mgr = ModesManager.getInstance();
    for (const d of DRAFTS) {
      const mode = mgr.createMode({ name: d.name, templateType: d.templateType });
      mgr.updateMode(mode.id, { customContext: d.customContext });
      createdIds.push({ id: mode.id, draft: d });
    }
    const all = mgr.getModes();
    for (const { id, draft } of createdIds) {
      const found = all.find((m) => m.id === id);
      assert.ok(found, `mode ${draft.name} not found after create`);
      assert.equal(found.customContext, draft.customContext, `customContext mismatch for ${draft.name}`);
      assert.equal(found.templateType, draft.templateType);
    }
  });

  test('generated modes are durable on disk (independent raw connection sees them)', () => {
    // Open a SECOND connection to the same natively.db — this proves the rows are
    // physically committed to disk, i.e. a fresh app process would read them back.
    assert.ok(fs.existsSync(dbPath), `db file exists at ${dbPath}`);
    const Database = require('better-sqlite3');
    const raw = new Database(dbPath, { readonly: true });
    try {
      const rows = raw.prepare('SELECT id, name, template_type, custom_context FROM modes').all();
      for (const { draft } of createdIds) {
        const match = rows.find((r) => r.name === draft.name && r.custom_context === draft.customContext);
        assert.ok(match, `generated mode "${draft.name}" not durable on disk`);
        assert.equal(match.template_type, draft.templateType);
      }
    } finally {
      raw.close();
    }
  });

  test('a generated mode can be edited and re-saved (durable)', () => {
    const mgr = ModesManager.getInstance();
    const target = createdIds[0];
    const newName = `${target.draft.name} (edited)`;
    const newCtx = `${target.draft.customContext}\n\nEXTRA: keep spoken answers under 30 seconds.`;
    mgr.updateMode(target.id, { name: newName, customContext: newCtx });

    const Database = require('better-sqlite3');
    const raw = new Database(dbPath, { readonly: true });
    try {
      const row = raw.prepare('SELECT name, custom_context FROM modes WHERE id = ?').get(target.id);
      assert.equal(row.name, newName);
      assert.ok(row.custom_context.includes('under 30 seconds'));
    } finally {
      raw.close();
    }
  });

  test('activating a generated grounded mode reports isCustom + grounding text', () => {
    const mgr = ModesManager.getInstance();
    const groundedDraft = DRAFTS.find((d) => d.documentGrounded);
    assert.ok(groundedDraft, 'at least one grounded draft exists');
    const mode = mgr.getModes().find((m) => m.customContext === groundedDraft.customContext);
    assert.ok(mode, 'grounded mode persisted');
    mgr.setActiveMode(mode.id);
    const info = mgr.getActiveModeDocumentGroundingInfo();
    assert.equal(info.isCustom, true, 'generated mode is custom');
    assert.equal(info.hasCustomPrompt, true, 'generated mode has a custom prompt');
    if (typeof ModesManager.detectCustomModeDocumentGrounding === 'function') {
      assert.equal(ModesManager.detectCustomModeDocumentGrounding(mode.customContext), true);
    }
  });
});
