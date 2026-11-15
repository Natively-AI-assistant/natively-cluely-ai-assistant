// A screenshot answer no longer waits for a separate "describe the screen"
// call when the answering model reads the image itself (2026-11-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const { answerReadsScreenshotItself, SCREEN_IN_ATTACHED_IMAGE } = await import(
  pathToFileURL(path.join(root, 'dist-electron/electron/services/screen/screenPrepass.js')).href
);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const base = { mode: 'vision_first', allowScreenshots: true, visionAvailable: true, env: {} };

test('cloud vision allowed: the answer reads the image, no describe call first', () => {
  assert.equal(answerReadsScreenshotItself(base), true);
  assert.equal(answerReadsScreenshotItself({ ...base, mode: 'vision_only' }), true);
});

test('screenshots kept on this device: the describe call stays (local handling unchanged)', () => {
  assert.equal(answerReadsScreenshotItself({ ...base, mode: 'private_vision' }), false);
});

test('screenshots scope off for cloud: the describe call stays', () => {
  assert.equal(answerReadsScreenshotItself({ ...base, allowScreenshots: false }), false);
});

test('no vision provider: the describe call stays', () => {
  assert.equal(answerReadsScreenshotItself({ ...base, visionAvailable: false }), false);
});

test('NATIVELY_SCREEN_PREPASS=on restores the old order', () => {
  assert.equal(answerReadsScreenshotItself({ ...base, env: { NATIVELY_SCREEN_PREPASS: 'on' } }), false);
  assert.equal(answerReadsScreenshotItself({ ...base, env: { NATIVELY_SCREEN_PREPASS: 'ON' } }), false);
  assert.equal(answerReadsScreenshotItself({ ...base, env: { NATIVELY_SCREEN_PREPASS: 'off' } }), true);
});

test('the screen evidence names the attached image and is not a record marker', () => {
  assert.match(SCREEN_IN_ATTACHED_IMAGE, /attached to this message as an image/);
  assert.doesNotMatch(SCREEN_IN_ATTACHED_IMAGE, /^\[/, 'record markers start with "["; this must not look like one');
});

test('typed chat: skip gates the understand() call and feeds the port, not the record', () => {
  const src = read('electron/ipcHandlers.ts');
  assert.match(src, /const v3SkipPrepass = !v3ScreenDescription && answerReadsScreenshotItself\(/);
  assert.match(src, /const sur = v3ScreenDescription \|\| v3SkipPrepass \? null : await getScreenUnderstandingService\(\)\.understand\(/);
  assert.match(src, /description: v3ScreenDescription \|\| v3ScreenEvidence,/);
  // The record still uses the description (or SCREEN_BEING_READ), so the
  // post-answer transcription runs for a skipped turn.
  assert.match(src, /const screenPlaceholder = v3ScreenDescription \|\| \(imagePaths\?\.length \? SCREEN_BEING_READ : undefined\);/);
  assert.doesNotMatch(src, /screenPlaceholder = [^;]*v3ScreenEvidence/);
});

test('What to answer: skip gates understand() and is passed to the answer and its retry', () => {
  const src = read('electron/ipcHandlers.ts');
  assert.match(src, /const sur = screenFromImage \? null : await sus\.understand\(/);
  const passes = src.match(/\.\.\.\(screenFromImage \? \{ screenFromImage: true \} : \{\}\),/g) ?? [];
  assert.equal(passes.length, 2, 'first answer and the cropped retry');
});

test('What to answer: the image note reaches the screen port only, never the retrieval query', () => {
  const src = read('electron/IntelligenceEngine.ts');
  // F-CTX-11 (2026-11-13) adds the turn's mode snapshot as a second argument.
  assert.match(src, /const _ctx = this\.v3ModeRetrievalContext\(_screenPortText(?:, \{[^}]*\})?\);/);
  assert.match(src, /screenText: _screenDescription,/);
  assert.doesNotMatch(src, /screenText: _screenPortText/);
});
