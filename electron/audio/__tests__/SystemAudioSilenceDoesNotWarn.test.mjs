// Regression test for false system-audio warnings during legitimate meeting silence.
//
// Root cause: wireSystemCapture used to arm an initial "0 chunks in 12s"
// watchdog and broadcast `system-audio-stuck` when no system-audio chunks had
// arrived yet. On macOS, a quiet meeting can produce no system-output chunks
// before the interviewer speaks, so absence of chunks/transcript is not proof of
// a permission or routing failure.
//
// Desired behavior: initial no-chunk silence and sustained zero-valued chunks
// are logged/observed internally, but must not show the user-facing Audio
// Capture Issue banner. User-facing system audio warnings require hard evidence
// such as an explicit same-device route conflict or a ScreenCaptureKit/TCC error
// from the native capture layer; amplitude silence alone is not hard evidence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

function extractMethodBody(methodName) {
  const methodRe = new RegExp(`(?:public|private)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)[^{]*\\{`);
  const match = methodRe.exec(mainSource);
  assert.ok(match, `could not locate ${methodName}`);
  let i = match.index + match[0].length;
  let depth = 1;
  const start = i;
  while (i < mainSource.length && depth > 0) {
    const ch = mainSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces while extracting ${methodName}`);
  return mainSource.slice(start, i - 1);
}

function extractWatchdogBody(wireSystemBody) {
  const marker = 'if (chunkCount > 0) return;';
  const markerIndex = wireSystemBody.indexOf(marker);
  assert.ok(markerIndex >= 0, 'could not locate initial no-chunk watchdog guard');

  const tickIndex = wireSystemBody.indexOf("kind: 'watchdog-tick'", markerIndex);
  assert.ok(tickIndex >= 0, 'could not locate classifier watchdog tick');

  const dataListenerIndex = wireSystemBody.indexOf("capture.on('data'", markerIndex);
  assert.ok(dataListenerIndex > tickIndex, 'sanity: initial no-chunk watchdog should appear before data listener');

  return wireSystemBody.slice(markerIndex, dataListenerIndex);
}

const wireSystemBody = extractMethodBody('wireSystemCapture');
const watchdogBody = extractWatchdogBody(wireSystemBody);

test('wireSystemCapture delegates ambiguous silence to the audio health classifier', () => {
  assert.match(
    mainSource,
    /SystemAudioHealthClassifier/,
    'BUG: wireSystemCapture should use the pure SystemAudioHealthClassifier instead of inline silence warning heuristics.',
  );
  assert.match(
    watchdogBody,
    /kind:\s*['"]watchdog-tick['"]/,
    'BUG: initial no-chunk watchdog should feed a classifier tick rather than directly showing a banner.',
  );
  assert.doesNotMatch(
    watchdogBody,
    /formatPermissionMessage\(\s*['"]system-audio-stuck['"]\s*\)/,
    'BUG: initial 0-chunk system-output silence must not use the system-audio-stuck user-facing warning copy.',
  );
});

test('sustained zero-valued system-output chunks do not emit a permission failure banner', () => {
  assert.match(
    wireSystemBody,
    /kind:\s*['"]chunk['"]/,
    'BUG: system-audio chunks should be fed to the pure classifier for signal diagnostics.',
  );
  // F10 (2026-08-14) deliberately began emitting a
  // mac-screen-recording-revoked-rebuild banner on sustained zero-fill — the
  // signature of a MID-MEETING Screen Recording revocation, where the tap keeps
  // "running" but every IO callback yields zero frames. Those users were
  // previously told to change devices, or told nothing.
  //
  // That does not break this test's invariant. The banner is raised only after
  // re-probing the ACTUAL TCC grant (bypassCache, because the revocation just
  // happened and a cached 'granted' would defeat the check) and finding it
  // denied — so amplitude silence alone still warns about nothing. A flat
  // doesNotMatch cannot express "present but guarded", so assert the guard.
  const revokedRe = /formatPermissionMessage\(\s*['"]mac-screen-recording-revoked-rebuild['"]\s*\)/;
  const revokedMatch = revokedRe.exec(wireSystemBody);
  if (revokedMatch) {
    const silenceIdx = wireSystemBody.search(/['"]sustained-zero-valued-silence['"]/);
    assert.ok(
      silenceIdx >= 0 && silenceIdx < revokedMatch.index,
      'BUG: the revoked/rebuild banner must live inside the sustained-zero-valued-silence branch, ' +
      'not on a path any silence can reach.',
    );
    const guard = wireSystemBody.slice(silenceIdx, revokedMatch.index);
    assert.match(
      guard, /process\.platform\s*===\s*['"]darwin['"]/,
      'BUG: the Screen Recording revoked banner is macOS-only — Windows has no TCC grant to lose.',
    );
    assert.match(
      guard, /resolveMacScreenCaptureCapability\s*\(/,
      'BUG: zero-fill must re-probe the real Screen Recording grant before blaming permissions — ' +
      'silence alone is also produced by a genuinely quiet room.',
    );
    assert.match(
      guard, /bypassCache:\s*true/,
      'BUG: the probe must bypass the permission cache — the revocation just happened, so a cached ' +
      "'granted' would defeat the check.",
    );
    assert.match(
      guard, /effectiveDenied/,
      'BUG: the banner must be conditional on the probe finding the grant actually denied.',
    );
  }
});

test('hard same-device route conflict still emits an actionable system audio warning', () => {
  assert.match(
    watchdogBody,
    /detectSameInputOutputDevice\s*\(\s*\)/,
    'sanity: the no-chunk watchdog should still check the explicit macOS same input/output route conflict.',
  );
  assert.match(
    watchdogBody,
    /kind:\s*['"]same-device-route-detected['"]/,
    'BUG: explicit same input/output conflicts should be represented as a classifier hard-failure event.',
  );
  assert.match(
    wireSystemBody,
    /formatPermissionMessage\(\s*['"]mac-same-device-input-output['"]/,
    'BUG: explicit same input/output conflicts should keep their specific actionable warning.',
  );
  assert.match(
    wireSystemBody,
    /sendAudioCaptureFailed\s*\(\s*\{[\s\S]*channel:\s*['"]system['"]/,
    'BUG: explicit same-device route conflicts should still notify the UI.',
  );
});
