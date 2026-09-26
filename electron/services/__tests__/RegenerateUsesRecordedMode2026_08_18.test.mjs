// F-503 regression test (audit/autopilot-2026-08-18).
//
// MeetingPersistence persists selectedModeId/Name/TemplateType at write time,
// but the regenerate path ignored selectedModeId and resolved the mode with
//   getModes().find(m => m.templateType === templateType)
// getModes() is ORDER BY created_at ASC, so `find` returns the OLDEST row with
// that template. Every user-built custom mode is templateType 'general' and the
// built-in "General" is seeded first — so regenerating a meeting that ran under
// a custom mode silently used the built-in's note sections to drive
// assembleSummary AND rewrote modeMeta.selectedModeId/Name with the wrong
// identity. Triggers as soon as any custom mode exists.
//
// 2026-09-25: the precedence moved into the exported resolveRegenerateTarget
// (shared with the auto-detect "Regenerate notes as X" path), so these tests
// EXECUTE it out of the compiled bundle instead of grepping for the old inline
// lines. Run under Electron's Node (the bundle pulls native modules):
//   ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/RegenerateUsesRecordedMode2026_08_18.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
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
const src = fs.readFileSync(path.resolve(__dirname, '../../MeetingPersistence.ts'), 'utf8');

// created_at ASC — the seeded built-in first, the user's custom mode second.
const MODES = [
  { id: 'mode_builtin_general', name: 'General', templateType: 'general' },
  { id: 'mode_custom_abc', name: 'My Interview Prep', templateType: 'general' },
];

test('regeneration resolves the mode through resolveRegenerateTarget, with the stored record', () => {
  assert.ok(/resolveRegenerateTarget\(\{[\s\S]{0,200}stored: storedMode/.test(src),
    'regenerateSavedMeeting must hand the meeting\'s recorded mode to the resolver (F-503)');
});

test('resolution picks the recorded mode over an older same-template mode', () => {
  const stored = { selectedModeId: 'mode_custom_abc', selectedTemplateType: 'general' };
  const r = resolveRegenerateTarget({ stored, modes: MODES, activeTemplateType: 'general' });
  assert.equal(r.byId?.id, 'mode_custom_abc', 'the recorded id is looked up first (F-503)');
  assert.equal(r.match.id, 'mode_custom_abc',
    'the meeting must regenerate under the mode it actually ran with');
});

test('a deleted mode falls back to the template match instead of failing', () => {
  const stored = { selectedModeId: 'mode_deleted', selectedTemplateType: 'general' };
  const r = resolveRegenerateTarget({ stored, modes: MODES.slice(0, 1), activeTemplateType: 'general' });
  assert.equal(r.byId, undefined);
  assert.equal(r.match.id, 'mode_builtin_general');
});
