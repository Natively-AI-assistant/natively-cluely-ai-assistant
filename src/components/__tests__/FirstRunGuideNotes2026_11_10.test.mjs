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

test('the notes window draws the guide in its bottom bar and reports the first line typed', () => {
  const w = read('src/components/NotesWindow.tsx');
  assert.ok(w.includes('useNotesGuide()'));
  // Beside the meeting's own status, above the Stop pill; the auto-stop notice wins.
  assert.ok(w.includes("{phase === 'live' && stopsAt === null && notesGuide.node}"));
  assert.ok(!w.includes("{phase !== 'ended' && notesGuide.node}"), 'no longer a block above the editor');
  assert.ok(w.includes('data-guide="notes-stop"'), 'the Stop button can be lit');
  const commit = w.slice(w.indexOf('const commit = useCallback'), w.indexOf('}, [', w.indexOf('const commit = useCallback')));
  assert.ok(commit.includes('notesGuide.onTyped(next)'), 'typing in the notepad reports to the guide');
});

// Evin, 2026-11-10: the hand-drawn purple strip was "messy" in the overlay. The
// notes window's steps use its own raised pill (np-elevated, the auto-stop
// notice's look): title, one quiet line, the step count and a plain ✕.
test('NotesGuide: the notes window pill, note_typed once there is text, Stop lit, no focus', () => {
  const g = read('src/components/guide/NotesGuide.tsx');
  for (const s of ["type: 'note_typed'", "'Write while you talk.'", "'Jot a line. It goes into your meeting notes.'",
    "'Stop the meeting when you’re ready.'", 'np-elevated', "tr('{n} of {total}')", "aria-label={tr('Skip guide')}",
    '[data-guide="notes-stop"]']) assert.ok(g.includes(s), s);
  assert.ok(!g.includes('<GuideStrip'), 'not the hand-drawn strip');
  assert.ok(/next\.trim\(\)/.test(g), 'only real text counts');
  assert.ok(!/\.focus\(|autoFocus/.test(g), 'the no-activate notes window never takes focus');
  assert.ok(!fs.existsSync(path.join(ROOT, 'src/components/guide/GuideStrip.tsx')), 'the old strip is gone');
});
