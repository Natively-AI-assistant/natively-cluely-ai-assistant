// Regression test for the "Transcription Not Configured" banner appearing
// even when audio IS actively being transcribed (false-positive during meetings).
//
// Root cause: two independent writers race on the same `sttNotConfigured` state
// in NativelyInterface.tsx (~line 1995-2015):
//
// 1. Mount-time promise: window.electronAPI.getSttProvider() called when the
//    component mounts, resolves asynchronously and sets state.
//
// 2. Live listener: window.electronAPI.onSttConfigChanged() subscribes to
//    'stt-config-changed' IPC events broadcast from main process whenever the
//    STT provider changes (e.g. user saves a key in Settings mid-meeting).
//
// No ordering guarantee: if the config-changed event fires while the mount-time
// promise is still in flight, the slower promise can resolve afterward and
// clobber the correct (now-configured) state with a stale `true`, causing the
// banner to incorrectly appear mid-meeting.
//
// Fix: track whether the live listener has fired (liveListenerHasFired flag).
// If it has, the mount-time promise result is ignored — the live event is
// always fresher than a slow mount-time RPC.
//
// Strategy: structural assertions against NativelyInterface.tsx source to
// verify the race guard exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const componentPath = path.resolve(__dirname, '../../../src/components/NativelyInterface.tsx');
const componentSource = readFileSync(componentPath, 'utf8');

test('NativelyInterface.tsx declares sttNotConfigured state', () => {
  assert.ok(
    /const\s+\[sttNotConfigured,\s*setSttNotConfigured\]\s*=\s*useState\s*\(\s*false\s*\)/.test(componentSource),
    'sanity: NativelyInterface.tsx must declare sttNotConfigured state.',
  );
});

test('sttNotConfigured effect tracks liveListenerHasFired to prevent race', () => {
  // Find the useEffect that sets up sttNotConfigured (look for the comment marker)
  // The useState for sttNotConfigured should be right before the useEffect
  const effectMatch = /const\s+\[sttNotConfigured,\s*setSttNotConfigured\][\s\S]{0,200}useEffect\s*\(\s*\(\s*\)\s*=>\s*\{/;
  const m = effectMatch.exec(componentSource);
  assert.ok(m, 'could not locate the sttNotConfigured useEffect in NativelyInterface.tsx');

  // Extract the effect body (find matching closing brace)
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < componentSource.length && depth > 0) {
    const ch = componentSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, 'unbalanced braces in sttNotConfigured useEffect');
  const effectBody = componentSource.slice(start, i - 1);

  // Check for liveListenerHasFired flag declaration
  assert.ok(
    /let\s+liveListenerHasFired\s*=\s*false/.test(effectBody),
    'BUG: sttNotConfigured effect must declare `let liveListenerHasFired = false` to track whether the live listener has fired.',
  );

  // Check that getSttProvider().then() guards on !liveListenerHasFired
  assert.ok(
    /getSttProvider[\s\S]{0,500}\.then[\s\S]{0,500}if\s*\(\s*mounted\s*&&\s*!\s*liveListenerHasFired\s*\)/.test(effectBody),
    'BUG: getSttProvider().then() must check `if (mounted && !liveListenerHasFired)` before calling setSttNotConfigured, to prevent clobbering fresher live-listener state.',
  );

  // Check that onSttConfigChanged sets liveListenerHasFired = true
  assert.ok(
    /onSttConfigChanged[\s\S]{0,300}liveListenerHasFired\s*=\s*true/.test(effectBody),
    'BUG: onSttConfigChanged listener must set `liveListenerHasFired = true` before calling setSttNotConfigured, marking its result as fresher than the mount-time promise.',
  );
});

test('getSttProvider().then() still respects mounted flag', () => {
  const effectMatch = /const\s+\[sttNotConfigured,\s*setSttNotConfigured\][\s\S]{0,200}useEffect\s*\(\s*\(\s*\)\s*=>\s*\{/;
  const m = effectMatch.exec(componentSource);
  assert.ok(m);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < componentSource.length && depth > 0) {
    const ch = componentSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  const effectBody = componentSource.slice(start, i - 1);

  // The mounted guard must still be present alongside liveListenerHasFired
  assert.ok(
    /let\s+mounted\s*=\s*true/.test(effectBody),
    'sanity: effect must declare `let mounted = true` for cleanup on unmount.',
  );
  assert.ok(
    /mounted\s*&&\s*!\s*liveListenerHasFired/.test(effectBody),
    'BUG: getSttProvider().then() must check BOTH mounted AND !liveListenerHasFired.',
  );
});

test('onSttConfigChanged still checks mounted before setState', () => {
  const effectMatch = /const\s+\[sttNotConfigured,\s*setSttNotConfigured\][\s\S]{0,200}useEffect\s*\(\s*\(\s*\)\s*=>\s*\{/;
  const m = effectMatch.exec(componentSource);
  assert.ok(m);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < componentSource.length && depth > 0) {
    const ch = componentSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  const effectBody = componentSource.slice(start, i - 1);

  // onSttConfigChanged must still guard on `if (mounted)` before setState
  assert.ok(
    /onSttConfigChanged[\s\S]{0,400}if\s*\(\s*mounted\s*\)\s*\{[\s\S]{0,150}liveListenerHasFired\s*=\s*true/.test(effectBody),
    'BUG: onSttConfigChanged must check `if (mounted)` before setting liveListenerHasFired and calling setSttNotConfigured.',
  );
});
