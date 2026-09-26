// A post-SAVE failure must not destroy a meeting that saved (2026-09-04).
//
// THE DEFECT
// processAndSaveMeeting's catch calls markSummaryGenerationFailed, which blanks
// legacySummary and rewrites the title, on the stated assumption that
// "saveMeeting never ran on this path". But the try also covers everything
// AFTER the save — the renderer broadcast, the Hindsight retain, the attribution
// record — and the broadcast was unguarded. `webContents.send` throws on a
// destroyed window, so closing a window at the wrong moment took the notes and
// title off a meeting that had persisted perfectly. The catch this replaced only
// flipped a status, which is why the same structure was survivable before and is
// not now.
//
// WHY THIS IS A SOURCE PIN AND NOT AN EXECUTION TEST
// processAndSaveMeeting is private, monolithic, and runs LLM summarisation,
// telemetry and memory retain before it reaches the save — there is no seam to
// call the catch through. This repo already pins invariants this way where the
// unit is unreachable (LlmStreamAbortController, CurlProviderPayloadValidation).
// Both assertions below are mutation-probed: removing either guard turns this
// red, which is checked in the last test rather than assumed.
//
// Run: node --test electron/services/__tests__/MeetingSaveFailureGuard2026_09_04.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = path.join(repoRoot, 'electron/MeetingPersistence.ts');
const source = readFileSync(SRC, 'utf8');

/** The body of the catch that handles a failed save, by brace matching. */
function saveCatchBody(text) {
  const save = text.indexOf('DatabaseManager.getInstance().saveMeeting(meetingData');
  assert.ok(save > 0, 'could not locate the meeting save');
  // The CALL, not the bare identifier: this file's own comments name the method,
  // and anchoring on the name matched a comment 349 chars ahead of the real call
  // — the classic way a source pin quietly measures the wrong thing.
  const marker = text.indexOf('DatabaseManager.getInstance().markSummaryGenerationFailed(', save);
  assert.ok(marker > 0, 'could not locate the failure marker call');
  // Walk back to the catch that encloses it.
  const catchAt = text.lastIndexOf('} catch (error)', marker);
  assert.ok(catchAt > save, 'the failure marker should sit in a catch after the save');
  return text.slice(catchAt, marker + 400);
}

const guardsMarker = (text) =>
  /if\s*\(\s*!\s*meetingSaved\s*\)[\s\S]{0,200}DatabaseManager\.getInstance\(\)\.markSummaryGenerationFailed\(/
    .test(saveCatchBody(text));

const guardsBroadcast = (text) => {
  const save = text.indexOf("DatabaseManager.getInstance().saveMeeting(meetingData");
  const region = text.slice(save, text.indexOf('} catch (error)', save));
  const send = region.indexOf("send('meetings-updated')");
  if (send < 0) return false;
  // The broadcast must sit inside a try opened after the save.
  return /try\s*\{[\s\S]{0,300}$/.test(region.slice(0, send));
};

describe('the destructive failure path is gated on the save not having happened', () => {
  test('markSummaryGenerationFailed is guarded by !meetingSaved', () => {
    assert.ok(guardsMarker(source),
      'BUG: the catch blanks legacySummary and rewrites the title unconditionally. It also '
      + 'covers post-save code, so a throw AFTER a successful save destroys that meeting.');
  });

  test('meetingSaved is set immediately after the save, in the same try', () => {
    assert.match(source,
      /DatabaseManager\.getInstance\(\)\.saveMeeting\(meetingData[\s\S]{0,600}?meetingSaved\s*=\s*true/,
      'BUG: the flag must be set at the save, or the guard above reads stale state.');
  });

  test('the post-save renderer broadcast cannot reach the catch', () => {
    assert.ok(guardsBroadcast(source),
      'BUG: webContents.send throws on a destroyed window. Unguarded, that throw lands in the '
      + 'catch and marks a saved meeting as failed — the exact trigger observed.');
  });

  test('MUTATION PROBE: both guards are load-bearing, not decorative', () => {
    // Removing the guard must turn the first assertion red. If it does not, the
    // pin is vacuous and would keep passing through a regression.
    const withoutGuard = source.replace(
      /if\s*\(\s*!\s*meetingSaved\s*\)\s*\{/, 'if (true) { //',
    );
    assert.notEqual(withoutGuard, source, 'probe failed to mutate — the pattern moved');
    assert.ok(!guardsMarker(withoutGuard),
      'the !meetingSaved pin still passes with the guard removed — it is vacuous');

    const withoutTry = source.replace(
      /try\s*\{\s*\n(\s*)const wins = require\('electron'\)\.BrowserWindow\.getAllWindows\(\);/,
      '$1const wins = require(\'electron\').BrowserWindow.getAllWindows();',
    );
    assert.notEqual(withoutTry, source, 'probe failed to mutate the broadcast guard');
    assert.ok(!guardsBroadcast(withoutTry),
      'the broadcast pin still passes with the try removed — it is vacuous');
  });
});
