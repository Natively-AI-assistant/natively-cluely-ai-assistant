// Regression: system-audio recovery recreates the capture and calls start(),
// which returns synchronously — native init failures (CoreAudio tap + SCK both
// failing, WASAPI init timeout) arrive LATER as a fresh 'error' event. After the
// third recovery that event hit the `attempts >= 3` early return and was only
// console.warn'd; the terminal emission lived solely in the synchronous catch,
// which async failures never reach. The renderer hides non-terminal banners
// (NativelyInterface: `payload.terminal || payload.stuck`), so the user saw no
// banner and no interviewer transcript.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(__dirname, '../../main.ts'), 'utf8');

const handlerStart = source.indexOf('private setupAudioRecoveryHandler(): void {');
assert.ok(handlerStart >= 0, 'could not locate setupAudioRecoveryHandler');
const skipStart = source.indexOf('this._systemAudioRecoveryAttempts >= 3) {', handlerStart);
const skipEnd = source.indexOf('this._systemAudioRecoveryInProgress = true;', skipStart);
assert.ok(skipStart > 0 && skipEnd > skipStart, 'could not locate the max-attempts skip branch');
const skipBranch = source.slice(skipStart, skipEnd);

test('an error after recovery is exhausted surfaces a terminal system banner', () => {
  assert.match(skipBranch, /channel: 'system'/);
  assert.match(skipBranch, /terminal: true/);
});

test('the banner is deferred past a route-watcher tick and dropped if another flow rebuilt the capture', () => {
  // Unplugging the bound device fails the capture AND changes the default
  // output; the route flow rebuilds within 4s and zeroes the counter. A banner
  // sent immediately would say "gave up" over working audio.
  assert.match(skipBranch, /setTimeout\(/);
  assert.match(skipBranch, /this\.systemAudioCapture !== failedCapture/);
  assert.match(skipBranch, /this\._systemAudioRecoveryAttempts !== 4/);
});

test('the terminal banner fires once: only at exactly 3 attempts, then the counter moves past it', () => {
  assert.match(skipBranch, /this\._systemAudioRecoveryAttempts === 3 && isRecoveryCurrentMeeting\(\)\)/);
  assert.match(skipBranch, /this\._systemAudioRecoveryAttempts\+\+/);
  assert.match(skipBranch, /!this\._systemAudioRecoveryInProgress/);
});
