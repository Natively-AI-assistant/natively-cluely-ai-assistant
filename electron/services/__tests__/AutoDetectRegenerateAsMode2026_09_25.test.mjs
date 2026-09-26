// node:test — Settings → Intelligence → "Auto-detect meeting type".
//
// The detector suggests "This looks like a Sales call — Regenerate notes as
// Sales". Until 2026-09-25 the button passed `undefined` whenever the detector
// had matched a mode (always, for the built-ins), and regenerate preferred the
// meeting's SAVED mode over any explicit choice — so the notes came back in the
// original template and the suggestion vanished as if it had worked.
// resolveRegenerateTarget is the precedence regenerateSavedMeeting now uses; the
// matched mode is what its note sections are read from.
//
// Run under Electron's Node (the bundle pulls native modules):
//   ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/AutoDetectRegenerateAsMode2026_09_25.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Module = require('node:module');
// A stand-in `electron` so the bundle loads outside an app (it only needs these at import).
const realLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'electron') return { app: { getPath: () => '/tmp', isReady: () => false, getAppPath: () => '/tmp', isPackaged: false, on() {}, once() {} }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle() {}, on() {} } };
  return realLoad.call(this, req, parent, isMain);
};
const { resolveRegenerateTarget } = require(path.resolve(__dirname, '../../../dist-electron/electron/MeetingPersistence.js'));
Module._load = realLoad;

const MODES = [
  { id: 'general', templateType: 'general', name: 'General' },
  { id: 'sales-1', templateType: 'sales', name: 'Sales' },
  { id: 'custom-1', templateType: 'general', name: 'My custom' },
];
const STORED = { selectedModeId: 'custom-1', selectedTemplateType: 'general' };

test('the detected mode id wins over the mode the meeting ran under', () => {
  const r = resolveRegenerateTarget({ modeId: 'sales-1', stored: STORED, modes: MODES, activeTemplateType: 'general' });
  assert.equal(r.match.id, 'sales-1', 'notes are rebuilt with the DETECTED mode');
  assert.equal(r.templateType, 'sales');
});

test('an explicit template wins over the saved mode id too', () => {
  const r = resolveRegenerateTarget({ templateType: 'sales', stored: STORED, modes: MODES });
  assert.equal(r.match.id, 'sales-1');
});

test('a plain Regenerate keeps the mode the meeting ran under (F-503 unchanged)', () => {
  const r = resolveRegenerateTarget({ stored: STORED, modes: MODES, activeTemplateType: 'sales' });
  assert.equal(r.match.id, 'custom-1', 'not the oldest general mode, not the active one');
});

test('an unknown mode id falls back to the saved mode, never throws', () => {
  const r = resolveRegenerateTarget({ modeId: 'deleted', stored: STORED, modes: MODES });
  assert.equal(r.match.id, 'custom-1');
});
