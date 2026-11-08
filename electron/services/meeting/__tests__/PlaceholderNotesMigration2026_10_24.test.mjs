// GitHub #662: meetings saved before the fix keep "empty summary array." (and
// "None" bullets) in their stored notes. placeholderNotesMigration cleans them
// once, after backing the originals up, and moves a notes rating to the new
// notes' hash. Run under the electron runner (better-sqlite3's ABI):
//   ELECTRON_RUN_AS_NODE=1 npx electron --test <this file>
// Nothing here branches on the platform, so the same assertions hold on macOS
// and Windows.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dist = (p) => path.join(REPO, 'dist-electron/electron', p);
const { cleanPlaceholderNotes, runPlaceholderNotesMigration } = require(dist('services/meeting/placeholderNotesMigration.js'));
const { notesContentHash } = require(dist('services/meeting/notesVersions.js'));

// The notes a #662 meeting could have been saved with.
const SAVED = () => ({
  schemaVersion: 3,
  overview: 'Empty overview string.',
  tldr: ['empty summary array.'],
  keyPoints: ['None', 'Empty array', 'The user described their data engineering background.'],
  actionItems: ['empty array'],
  actionItemsV3: [{ id: 'a1', text: 'N/A', confidence: 'high' }],
  decisions: [{ text: 'Use Postgres for the pipeline', confidence: 'high' }],
  openQuestions: [{ text: 'None', status: 'open' }],
  risks: [{ text: 'Nothing', severity: 'low' }],
  sectionsV3: [
    { id: 'risks', title: 'Risks', bullets: [{ id: 'b1', text: 'None' }] },
    { id: 'edge', title: 'Edge cases', bullets: [{ id: 'b2', text: 'Empty array' }, { id: 'b3', text: '(empty)' }] },
  ],
  sections: [{ title: 'Risks', bullets: ['None'] }],
  speakerLabels: { speaker_2: 'Dana' },
});

describe('cleanPlaceholderNotes', () => {
  test('drops placeholder items and the overview, keeps real notes', () => {
    const out = cleanPlaceholderNotes(SAVED());
    assert.equal(out.overview, '');
    assert.deepEqual(out.tldr, []);
    assert.deepEqual(out.keyPoints, ['Empty array', 'The user described their data engineering background.'],
      'a free note "Empty array" (an interview edge case) stays');
    assert.deepEqual(out.actionItems, []);
    assert.deepEqual(out.actionItemsV3, []);
    assert.deepEqual(out.decisions, [{ text: 'Use Postgres for the pipeline', confidence: 'high' }]);
    assert.deepEqual(out.openQuestions, []);
    assert.deepEqual(out.risks, []);
    assert.deepEqual(out.sectionsV3, [{ id: 'edge', title: 'Edge cases', bullets: [{ id: 'b2', text: 'Empty array' }] }],
      'a V3 section left with no bullets is dropped, as the V3 notes do');
    assert.deepEqual(out.sections, [{ title: 'Risks', bullets: [] }],
      'a V2 template section keeps its heading, as the V2 notes do');
    assert.deepEqual(out.speakerLabels, { speaker_2: 'Dana' });
  });

  test('clean notes need no change', () => {
    const clean = { overview: 'The team picked Postgres.', tldr: ['Postgres chosen'], keyPoints: ['Empty array', 'Value is null'], sectionsV3: [{ id: 'x', title: 'X', bullets: [{ text: 'Real' }] }] };
    assert.equal(cleanPlaceholderNotes(clean), null);
  });

  test('the saved notes are not changed in place', () => {
    const saved = SAVED();
    const before = JSON.stringify(saved);
    cleanPlaceholderNotes(saved);
    assert.equal(JSON.stringify(saved), before);
  });

  test('missing or odd notes are left alone', () => {
    assert.equal(cleanPlaceholderNotes(undefined), null);
    assert.equal(cleanPlaceholderNotes(null), null);
    assert.equal(cleanPlaceholderNotes({ tldr: 'not a list', sectionsV3: [null, { title: 'No bullets' }] }), null);
  });
});

describe('runPlaceholderNotesMigration', () => {
  const deps = (rows, over = {}) => {
    const log = { backups: [], saved: [], rekeyed: [], done: false };
    return {
      log,
      deps: {
        isDone: () => log.done,
        markDone: () => { log.done = true; },
        listSummaries: () => rows,
        backup: (r) => log.backups.push(r),
        replaceDetailedSummary: (id, d) => { log.saved.push([id, d]); return true; },
        rekeyNotesRating: (...a) => log.rekeyed.push(a),
        ...over,
      },
    };
  };
  const row = (id, detailedSummary) => ({ id, summaryJson: JSON.stringify({ detailedSummary }) });

  test('backs up the changed meetings first, rewrites them, moves the rating, runs once', () => {
    const { log, deps: d } = deps([row('bad', SAVED()), row('clean', { tldr: ['Postgres chosen'] }), { id: 'broken', summaryJson: '{' }]);
    const order = [];
    d.backup = (r) => { order.push('backup'); log.backups.push(r); };
    const save = d.replaceDetailedSummary;
    d.replaceDetailedSummary = (...a) => { order.push('save'); return save(...a); };
    assert.deepEqual(runPlaceholderNotesMigration(d), ['bad']);
    assert.deepEqual(order, ['backup', 'save']);
    assert.deepEqual(log.backups, [[{ id: 'bad', summaryJson: JSON.stringify({ detailedSummary: SAVED() }) }]]);
    assert.deepEqual(log.rekeyed, [['bad', notesContentHash(SAVED()), notesContentHash(log.saved[0][1])]]);
    assert.equal(log.done, true);
    assert.deepEqual(runPlaceholderNotesMigration(d), [], 'a second launch does nothing');
    assert.equal(log.saved.length, 1);
  });

  test('a failed backup changes nothing and leaves it to run again', () => {
    const { log, deps: d } = deps([row('bad', SAVED())], { backup: () => { throw new Error('disk full'); } });
    assert.throws(() => runPlaceholderNotesMigration(d), /disk full/);
    assert.equal(log.saved.length, 0);
    assert.equal(log.done, false);
  });
});

describe('a #662 meeting already in the database', () => {
  let tmpDir;
  let DatabaseManager;
  const originalLoad = Module._load;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-placeholder-notes-'));
    process.env.NATIVELY_TEST_USERDATA = tmpDir;
    const electronStub = {
      app: { getPath: () => tmpDir, isPackaged: false, getVersion: () => '0.0.0', on: () => {}, whenReady: () => Promise.resolve() },
      BrowserWindow: { getAllWindows: () => [] },
      safeStorage: { isEncryptionAvailable: () => false },
      shell: {}, ipcMain: { handle: () => {}, on: () => {} },
      Notification: class { static isSupported() { return false; } on() {} show() {} },
    };
    Module._load = function (request, parent, isMain) {
      if (request === 'electron') return electronStub;
      return originalLoad.call(this, request, parent, isMain);
    };
    ({ DatabaseManager } = require(dist('db/DatabaseManager.js')));
    const start = Date.now() - 60_000;
    DatabaseManager.getInstance().saveMeeting({
      id: 'issue-662',
      title: 'Data engineering background',
      date: new Date(start).toISOString(),
      duration: '1:00',
      summary: 'See detailed summary',
      detailedSummary: SAVED(),
      transcript: [{ speaker: 'user', text: 'I have five years in data engineering.', timestamp: start }],
      usage: [],
      isProcessed: true,
      summaryStatus: 'completed',
    }, start, 60_000);
  });
  after(() => {
    Module._load = originalLoad;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  test('the stored notes are cleaned, the backup holds the original, the rating follows', () => {
    const db = DatabaseManager.getInstance();
    const oldHash = notesContentHash(SAVED());
    assert.equal(db.saveNotesRating({ meetingId: 'issue-662', rating: 'down', notesHash: oldHash }), true);

    let backedUp = null;
    let done = false;
    const changed = runPlaceholderNotesMigration({
      isDone: () => done,
      markDone: () => { done = true; },
      listSummaries: () => db.listMeetingSummaries(),
      backup: (rows) => { backedUp = rows; },
      replaceDetailedSummary: (id, d) => db.replaceDetailedSummary(id, d),
      rekeyNotesRating: (id, from, to) => db.rekeyNotesRating(id, from, to),
    });
    assert.deepEqual(changed, ['issue-662']);
    assert.deepEqual(JSON.parse(backedUp[0].summaryJson).detailedSummary.tldr, ['empty summary array.']);

    const details = db.getMeetingDetails('issue-662');
    assert.deepEqual(details.detailedSummary.tldr, []);
    assert.equal(details.detailedSummary.overview, '');
    assert.deepEqual(details.detailedSummary.sectionsV3.map((s) => s.title), ['Edge cases']);
    assert.equal(details.title, 'Data engineering background');

    const newHash = notesContentHash(details.detailedSummary);
    assert.notEqual(newHash, oldHash);
    assert.equal(db.getNotesRating('issue-662', newHash)?.rating, 'down');
    assert.equal(db.getNotesRating('issue-662', oldHash), null);
  });
});
