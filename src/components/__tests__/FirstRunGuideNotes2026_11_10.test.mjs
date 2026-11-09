// First-run guide, notes window: step 4 ("Write while you talk.") and the stop
// prompt. The notes window is a no-activate window on Windows (PR #709): the
// strip must never take focus.
// Run: node --test src/components/__tests__/FirstRunGuideNotes2026_11_10.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the notes window draws the guide and reports the first line typed', () => {
  const w = read('src/components/NotesWindow.tsx');
  assert.ok(w.includes('useNotesGuide()'));
  assert.ok(w.includes("{phase !== 'ended' && notesGuide.node}"), 'drawn above the editor while the meeting is not over');
  const commit = w.slice(w.indexOf('const commit = useCallback'), w.indexOf('}, [', w.indexOf('const commit = useCallback')));
  assert.ok(commit.includes('notesGuide.onTyped(next)'), 'typing in the notepad reports to the guide');
});

test('NotesGuide: note_typed once there is text, the two strips, no focus', () => {
  const g = read('src/components/guide/NotesGuide.tsx');
  for (const s of ["type: 'note_typed'", "'Write while you talk.'", "'Jot a line. It goes into your meeting notes.'", "'Type a line'",
    "'Stop the meeting when you’re ready.'"]) assert.ok(g.includes(s), s);
  assert.ok(/next\.trim\(\)/.test(g), 'only real text counts');
  assert.ok(!/\.focus\(|autoFocus/.test(g) && !/\.focus\(|autoFocus/.test(read('src/components/guide/GuideStrip.tsx')));
});
