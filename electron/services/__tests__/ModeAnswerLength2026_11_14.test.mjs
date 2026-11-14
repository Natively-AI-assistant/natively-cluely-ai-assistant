// electron/services/__tests__/ModeAnswerLength2026_11_14.test.mjs
//
// A mode's Answer length (Shorter / Smart / Longer) through the REAL
// ModesManager + DatabaseManager on a temp natively.db:
//   - the modes.answer_length column exists, defaults to 'smart' for new and
//     existing modes, and is re-added on boot to a database that lacks it;
//   - updateMode stores it (durable on disk) and refuses an unknown value;
//   - the provider the length planner reads answers with the turn's mode, falls
//     back to General when no mode is active, and reads Smart without Pro;
//   - modes:update refuses Shorter / Longer without Pro and allows Smart.
//
// Runs under ELECTRON_RUN_AS_NODE=1 electron --test (native better-sqlite3 ABI),
// with NATIVELY_TEST_USERDATA pointed at a fresh temp dir. No platform branches:
// the column, the provider and the gate are the same on macOS and Windows.

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const distUrl = (rel) => pathToFileURL(path.join(REPO, 'dist-electron', rel)).href;

let tmpDir;
let dbPath;
let DatabaseManager;
let mm;
let al;

describe('a mode\'s Answer length', () => {
  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-answer-length-'));
    process.env.NATIVELY_TEST_USERDATA = tmpDir;
    dbPath = path.join(tmpDir, 'natively.db');
    DatabaseManager = (await import(distUrl('electron/db/DatabaseManager.js'))).DatabaseManager;
    mm = await import(distUrl('electron/services/ModesManager.js'));
    al = await import(distUrl('electron/llm/answerLength.js'));
    DatabaseManager.getInstance();
    // getInstance registers the providers and seeds General + the built-ins.
    mm.ModesManager.getInstance();
  });

  after(() => {
    try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  afterEach(() => mm.setModesProAccessCheck(null));

  const raw = (fn) => {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    try { return fn(db); } finally { db.close(); }
  };

  test('the column exists and every mode starts at Smart', () => {
    const cols = raw((db) => db.prepare("PRAGMA table_info('modes')").all());
    const col = cols.find((c) => c.name === 'answer_length');
    assert.ok(col, 'modes.answer_length exists');
    assert.equal(col.dflt_value, "'smart'");
    const mgr = mm.ModesManager.getInstance();
    const created = mgr.createMode({ name: 'Length test', templateType: 'general' });
    assert.equal(created.answerLength, 'smart');
    for (const m of mgr.getModes()) assert.equal(m.answerLength, 'smart', m.name);
  });

  test('updateMode stores it, durably, and refuses an unknown value', () => {
    const mgr = mm.ModesManager.getInstance();
    const mode = mgr.getModes().find((m) => m.name === 'Length test');
    mgr.updateMode(mode.id, { answerLength: 'longer' });
    assert.equal(mgr.getModes().find((m) => m.id === mode.id).answerLength, 'longer');
    assert.equal(raw((db) => db.prepare('SELECT answer_length FROM modes WHERE id = ?').get(mode.id).answer_length), 'longer');
    assert.throws(() => mgr.updateMode(mode.id, { answerLength: 'huge' }), /unknown answerLength/);
    assert.equal(mgr.getModes().find((m) => m.id === mode.id).answerLength, 'longer', 'a refused value leaves the stored one');
    // Saving the prompt text alone leaves the length as it was.
    mgr.updateMode(mode.id, { customContext: 'Focus on Go.' });
    assert.equal(mgr.getModes().find((m) => m.id === mode.id).answerLength, 'longer');
  });

  test('a value written outside the app reads as Smart', () => {
    const mgr = mm.ModesManager.getInstance();
    const mode = mgr.getModes().find((m) => m.name === 'Length test');
    raw((db) => db.prepare("UPDATE modes SET answer_length = 'enormous' WHERE id = ?").run(mode.id));
    assert.equal(mgr.getModes().find((m) => m.id === mode.id).answerLength, 'smart');
    mgr.updateMode(mode.id, { answerLength: 'longer' });
  });

  test('the planner reads the turn\'s mode: pinned, else active, else General', () => {
    const mgr = mm.ModesManager.getInstance();
    const custom = mgr.getModes().find((m) => m.name === 'Length test');
    const general = mgr.getGeneralMode();
    assert.ok(general, 'General is seeded');
    mgr.updateMode(general.id, { answerLength: 'shorter' });

    mgr.setActiveMode(custom.id);
    assert.equal(al.getRegisteredAnswerLength(), 'longer', 'active mode');
    assert.equal(al.getRegisteredAnswerLength(general.id), 'shorter', 'pinned mode wins over active');

    mgr.setActiveMode(null);
    assert.equal(al.getRegisteredAnswerLength(), 'shorter', 'no active mode answers as General');

    mgr.updateMode(general.id, { answerLength: 'smart' });
    assert.equal(al.getRegisteredAnswerLength(), 'smart');
  });

  test('without Pro or a trial every mode answers at Smart; the choice is kept', () => {
    const mgr = mm.ModesManager.getInstance();
    const custom = mgr.getModes().find((m) => m.name === 'Length test');
    const general = mgr.getGeneralMode();
    mgr.updateMode(general.id, { answerLength: 'longer' });
    mgr.setActiveMode(custom.id);
    let pro = false;
    mm.setModesProAccessCheck(() => pro);
    assert.equal(al.getRegisteredAnswerLength(), 'smart', 'custom mode, no Pro');
    assert.equal(al.getRegisteredAnswerLength(general.id), 'smart', 'General too: the setting is Pro');
    assert.equal(mgr.getModes().find((m) => m.id === custom.id).answerLength, 'longer', 'stored choice kept');
    pro = true;
    assert.equal(al.getRegisteredAnswerLength(), 'longer', 'Pro back, length back');
    mm.setModesProAccessCheck(() => { throw new Error('licence read failed'); });
    assert.equal(al.getRegisteredAnswerLength(), 'smart', 'a failed check is no access');
    mgr.setActiveMode(null);
  });

  test('a database without the column gets it back on boot, values intact', () => {
    raw((db) => db.exec('ALTER TABLE modes DROP COLUMN answer_length'));
    assert.equal(raw((db) => db.prepare("PRAGMA table_info('modes')").all()).some((c) => c.name === 'answer_length'), false);
    const dbm = DatabaseManager.getInstance();
    dbm.ensureModesAnswerLengthColumn();
    dbm.ensureModesAnswerLengthColumn(); // idempotent
    const rows = raw((db) => db.prepare('SELECT answer_length FROM modes').all());
    assert.ok(rows.length > 0);
    for (const r of rows) assert.equal(r.answer_length, 'smart');
  });
});

describe('modes:update gates Shorter and Longer on Pro', () => {
  const ipc = fs.readFileSync(path.join(REPO, 'electron/ipcHandlers.ts'), 'utf8');
  const start = ipc.indexOf("'modes:update',");
  const handler = ipc.slice(start, ipc.indexOf('safeHandle(', start));

  test('an unknown value is refused before anything is written', () => {
    assert.ok(start > 0);
    const check = handler.indexOf("error: 'invalid_answer_length'");
    assert.ok(check > 0 && check < handler.indexOf('mgr.updateMode(id, updates)'));
  });

  test('without Pro: Shorter / Longer refused, Smart (turning it off) allowed', () => {
    const gate = handler.slice(handler.indexOf('if (!isProOrTrialActive())'), handler.indexOf('mgr.updateMode(id, updates)'));
    assert.match(gate, /updates\.answerLength !== undefined && updates\.answerLength !== 'smart'\)\s*\{\s*return proRefusal\(\);/);
  });
});
