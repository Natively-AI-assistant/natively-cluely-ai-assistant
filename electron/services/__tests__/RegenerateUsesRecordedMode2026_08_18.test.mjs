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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, '../../MeetingPersistence.ts'), 'utf8');

test('regeneration resolves the mode by the persisted id first', () => {
  assert.ok(/const byId = storedMode\?\.selectedModeId/.test(src),
    'regeneration must look the mode up by the id the meeting recorded (F-503)');
  assert.ok(/const match = byId \?\? all\.find/.test(src),
    'the template lookup must be a FALLBACK, not the primary resolution (F-503)');
});

test('resolution picks the recorded mode over an older same-template mode', () => {
  // created_at ASC — the seeded built-in first, the user's custom mode second.
  const modes = [
    { id: 'mode_builtin_general', name: 'General', templateType: 'general' },
    { id: 'mode_custom_abc', name: 'My Interview Prep', templateType: 'general' },
  ];
  const stored = { selectedModeId: 'mode_custom_abc', selectedTemplateType: 'general' };
  const byId = stored.selectedModeId ? modes.find((m) => m.id === stored.selectedModeId) : undefined;
  const match = byId ?? modes.find((m) => m.templateType === stored.selectedTemplateType);
  assert.equal(match.id, 'mode_custom_abc',
    'the meeting must regenerate under the mode it actually ran with');
});

test('a deleted mode falls back to the template match instead of failing', () => {
  const modes = [{ id: 'mode_builtin_general', name: 'General', templateType: 'general' }];
  const stored = { selectedModeId: 'mode_deleted', selectedTemplateType: 'general' };
  const byId = modes.find((m) => m.id === stored.selectedModeId);
  const match = byId ?? modes.find((m) => m.templateType === stored.selectedTemplateType);
  assert.equal(match.id, 'mode_builtin_general');
});
