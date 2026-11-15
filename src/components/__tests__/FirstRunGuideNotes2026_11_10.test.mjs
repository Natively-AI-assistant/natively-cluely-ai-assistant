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
  for (const s of ["type: 'note_typed'", "'Write while you talk.'", "'Click “Write notes” at the top of the page and type a line.'",
    "'Stop the meeting when you’re ready.'", 'np-elevated', "tr('{n} of {total}')", "aria-label={tr('Skip guide')}",
    '[data-guide="notes-stop"]']) assert.ok(g.includes(s), s);
  assert.ok(!g.includes('<GuideStrip'), 'not the hand-drawn strip');
  assert.ok(/next\.trim\(\)/.test(g), 'only real text counts');
  assert.ok(!/\.focus\(|autoFocus/.test(g), 'the no-activate notes window never takes focus');
  assert.ok(!fs.existsSync(path.join(ROOT, 'src/components/guide/GuideStrip.tsx')), 'the old strip is gone');
});

// Evin, 2026-11-15: "where to jot is confusing". Step 9 names the spot and the
// empty page's "Write notes" glows; CSS only, never ProseMirror's own DOM.
test('step 9 points at the page: the placeholder glows while the step waits', () => {
  const page = read('src/components/NotesWindow.tsx');
  assert.ok(page.includes("notesGuide.live === 'notepad' ? ' guide-write' : ''"));
  const css = read('src/components/guide/guide.css');
  assert.ok(css.includes('.notepad .guide-write .notes-editor p.is-editor-empty:first-child::before {'));
  assert.ok(read('src/components/notes/NotesEditor.tsx').includes("placeholder: 'Write notes'"), 'the words the line names');
});

// Evin, 2026-11-15: What to answer is pressed by the guide 15 s into the film.
test('the guide presses What to answer 15 s after the film is first heard, once, on step 3', () => {
  const g = read('src/components/guide/OverlayGuide.tsx');
  assert.ok(g.includes('heardAt + DEMO_FILM_ANSWER_AFTER_MS - Date.now()'));
  assert.ok(g.includes("if (step === 'overlay') { dispatch({ type: 'overlay_next' }); return; }"), 'step 2 moves on first');
  assert.ok(g.includes('autoAnswered.current = true;') && g.includes('if (filmFrom === null'), 'once, and only in the film meeting');
  assert.ok(read('src/components/NativelyInterface.tsx').includes('useOverlayGuide({ whatToAnswer: () => handlersRef.current.handleWhatToSay() })'), 'the chip\'s own handler');
  assert.ok(read('src/lib/demoVideoUrl.ts').includes('DEMO_FILM_ANSWER_AFTER_MS = 15_000'));
});

// Evin, 2026-11-15: "where to close the notepad meeting isnt shown". Step 11's
// recipe leaves Ask open, which folded the listening pill (and Stop) away.
test('step 12 keeps Stop on screen beside an open Ask and says where it is', () => {
  const page = read('src/components/NotesWindow.tsx');
  assert.ok(page.includes("const foldListening = askOpen && notesGuide.live !== 'stop2';"));
  assert.ok(page.includes('animate={foldListening'), 'the listening pill folds on foldListening, not askOpen');
  assert.ok(read('src/components/guide/NotesGuide.tsx').includes("'Press the stop button ■ in the bar at the bottom. Natively writes up your notes.'"));
});
