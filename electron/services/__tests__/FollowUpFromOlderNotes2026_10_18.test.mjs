// node:test — the meeting page's Follow-up email button on notes saved before V3.
//
// The button (MeetingDetails header) used to show only on V3 notes, and the
// writer refused anything else (schemaVersion !== 3). Older notes keep their
// content in other fields: key points, plain-string action items, and sections
// whose bullets are strings. followUpSourceFromLegacyNotes maps them onto what
// FollowUpDraftGenerator reads, so an old meeting gets a real follow-up too.
//
// Run under Electron's Node (the bundle pulls native modules):
//   ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/FollowUpFromOlderNotes2026_10_18.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const Module = require('node:module');
// A stand-in `electron` so the bundle loads outside an app (it only needs these at import).
const realLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'electron') return { app: { getPath: () => '/tmp', isReady: () => false, getAppPath: () => '/tmp', isPackaged: false, on() {}, once() {} }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {} } };
  return realLoad.call(this, req, parent, isMain);
};
const { followUpSourceFromLegacyNotes } = require(path.join(REPO, 'dist-electron/electron/MeetingPersistence.js'));
Module._load = realLoad;

test('older notes map onto the generator input', () => {
  const src = followUpSourceFromLegacyNotes({
    overview: 'We agreed the pilot scope.',
    keyPoints: ['Pilot starts in May', '', 42],
    actionItems: ['Send the contract', '  '],
    sections: [
      { title: 'Concerns', bullets: ['Budget is tight', ''] },
      { title: 'Empty', bullets: [] },
      { bullets: ['no title'] },
    ],
  }, 'Acme pilot');
  assert.equal(src.title, 'Acme pilot');
  assert.equal(src.overview, 'We agreed the pilot scope.');
  assert.deepEqual(src.tldr, ['Pilot starts in May']);
  assert.deepEqual(src.actionItems, [{ text: 'Send the contract' }]);
  assert.deepEqual(src.sections, [
    { title: 'Concerns', order: 0, bullets: [{ text: 'Budget is tight' }] },
    { title: 'Empty', order: 1, bullets: [] },
  ]);
});

test('structured action items win over the plain ones; missing fields stay empty', () => {
  const structured = [{ id: 'a1', text: 'Book the review', owner: 'Ana' }];
  const src = followUpSourceFromLegacyNotes({ actionItems: ['x'], actionItemsStructured: structured });
  assert.equal(src.actionItems, structured);
  assert.equal(src.overview, '');
  assert.deepEqual(src.tldr, []);
  assert.deepEqual(src.sections, []);
  assert.equal(src.title, undefined);
});

test('the writer takes older notes, the page shows the button for them, and the old bottom block is gone', () => {
  const persistence = fs.readFileSync(path.join(REPO, 'electron/MeetingPersistence.ts'), 'utf8');
  assert.doesNotMatch(persistence, /if \(!detailed \|\| detailed\.schemaVersion !== 3\) return false;/);
  assert.match(persistence, /detailed\.schemaVersion !== 3 \? followUpSourceFromLegacyNotes\(detailed, details\?\.title\)/);
  const page = fs.readFileSync(path.join(REPO, 'src/components/MeetingDetails.tsx'), 'utf8');
  assert.match(page, /\{meeting\.detailedSummary && \(\s*<LiquidGlassButton[\s\S]{0,200}onClick=\{openFollowUp\}/);
  // The compose sheet is rendered inside that block. Slice the block to its
  // close rather than guess a distance: the sheet's motion and tone menu sit
  // between its opening and the dialog, and grew past any fixed window.
  const sheetStart = page.indexOf('{meeting.detailedSummary && (() => {');
  assert.ok(sheetStart >= 0, 'the follow-up sheet block is still gated on detailedSummary');
  const sheetEnd = page.indexOf('})()}', sheetStart);
  assert.ok(sheetEnd > sheetStart, 'the follow-up sheet block closes');
  const sheet = page.slice(sheetStart, sheetEnd);
  assert.match(sheet, /<DialogPrimitive\.Root/);
  assert.doesNotMatch(page, /t\('Follow-up Draft'\)/);
});
