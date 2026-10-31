// Stop with the notepad open (2026-10-31): the notes are written in the notepad,
// so the launcher no longer jumps up over them. endMeeting enters launcher mode
// hidden (keys, overlay down, no launcher window); the launcher shows when the
// user closes the notepad, with the same app activation the Stop would have had.
// Same code path on macOS and Windows; the darwin-only activation stays gated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.resolve(__dirname, '../../../electron', p), 'utf8');
const mainSource = read('main.ts');
const whSource = read('WindowHelper.ts');
const notesSource = read('NotesWindowHelper.ts');

function extractMethodBody(source, methodName) {
  const re = new RegExp(`(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
  const m = re.exec(source);
  assert.ok(m, `could not locate ${methodName}`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(start, i - 1);
}

test('endMeeting enters launcher mode hidden while the notepad is open', () => {
  const body = extractMethodBody(mainSource, 'endMeetingTransition');
  assert.match(body, /setWindowMode\(\s*'launcher',\s*this\.isUndetectable \? true : undefined,\s*\{ hidden: this\.notesWindowHelper\.isVisible\(\) \}\s*\)/);
});

test('a hidden switchToLauncher shows nothing, owes the show, and does not activate the app', () => {
  const body = extractMethodBody(whSource, 'switchToLauncher');
  assert.match(body, /const hidden = !!opts\?\.hidden;/);
  assert.match(body, /if \(hidden\) \{\s*this\.launcherShowOwed = true;\s*this\.isWindowVisible = false;\s*\} else if \(this\.launcherWindow/);
  assert.match(body, /!inactive &&\s*!hidden &&\s*!wasLauncher/);
  // The owed show still counts as leaving the overlay, so macOS activation runs then.
  assert.match(body, /const wasLauncher = this\.currentWindowMode === 'launcher' && !this\.launcherShowOwed;/);
  assert.match(extractMethodBody(whSource, 'setWindowMode'), /this\.switchToLauncher\(inactive, opts\)/);
});

test('the owed launcher shows only in launcher mode, and a meeting start cancels it', () => {
  const owed = extractMethodBody(whSource, 'showOwedLauncher');
  assert.match(owed, /if \(!this\.launcherShowOwed \|\| this\.currentWindowMode !== 'launcher'\) return false;/);
  assert.match(extractMethodBody(whSource, 'switchToOverlay'), /this\.launcherShowOwed = false;/);
});

test('only the user closing the notepad brings the launcher up (mid-meeting: MeetingNotesWindow2026_10_15)', () => {
  const hide = extractMethodBody(notesSource, 'hide');
  assert.match(hide, /if \(byUser\) \{[\s\S]*this\.closedByUserListener\?\.\(\)/);
  assert.match(mainSource, /onClosedByUser\(\(\) => \{\s*const inactive = this\.isUndetectable \? true : undefined;\s*const action = planNotesClosed\(this\.isMeetingActive, this\.windowHelper\.isOverlayHeldHidden\(\)\);\s*if \(action === 'owed-launcher'\) this\.windowHelper\.showOwedLauncher\(inactive\);/);
});
