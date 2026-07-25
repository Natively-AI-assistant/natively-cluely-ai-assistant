// Regression coverage for the Windows crash that occurred shortly after a
// Local Whisper meeting stopped. Force-terminating an ONNX worker while native
// inference was unwinding could terminate the entire Electron process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const localWhisperSource = fs.readFileSync(
  path.join(root, 'electron/audio/LocalWhisperSTT.ts'),
  'utf8',
);
const workerSource = fs.readFileSync(
  path.join(root, 'electron/audio/whisper/whisperWorker.ts'),
  'utf8',
);
const mainSource = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');

function extractMethodBody(source, methodName) {
  const re = new RegExp(`(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
  const match = re.exec(source);
  assert.ok(match, `could not locate ${methodName}`);
  let cursor = match.index + match[0].length;
  const start = cursor;
  let depth = 1;
  while (cursor < source.length && depth > 0) {
    if (source[cursor] === '{') depth++;
    else if (source[cursor] === '}') depth--;
    cursor++;
  }
  assert.equal(depth, 0, `unbalanced braces in ${methodName}`);
  return source.slice(start, cursor - 1);
}

test('Local Whisper requests cooperative worker shutdown instead of force termination', () => {
  const body = extractMethodBody(localWhisperSource, 'beginWorkerTermination');
  assert.doesNotMatch(body, /\.terminate\s*\(/, 'normal meeting shutdown must not force-terminate the ONNX worker');
  assert.match(body, /postMessage\s*\(\s*\{\s*type:\s*['"]shutdown['"]\s*\}\s*\)/);
});

test('Whisper worker closes its message port only after active operations finish', () => {
  assert.match(workerSource, /msg\.type\s*===\s*['"]shutdown['"]/);
  assert.match(workerSource, /activeOperations\s*===\s*0/);
  assert.match(workerSource, /parentPort!\.close\(\)/);
});

test('Whisper worker disposes the ONNX pipeline before closing its message port', () => {
  const closeStart = workerSource.indexOf('function closeWhenIdle');
  assert.notEqual(closeStart, -1, 'closeWhenIdle must exist');
  const disposeAt = workerSource.indexOf('dispose', closeStart);
  const closeAt = workerSource.indexOf('parentPort!.close()', closeStart);
  assert.notEqual(disposeAt, -1, 'cooperative shutdown must explicitly dispose the pipeline');
  assert.ok(disposeAt < closeAt, 'pipeline disposal must happen before parentPort.close()');
});

test('Local Whisper keeps the shared ONNX slot until the worker exit event', () => {
  const errorStart = localWhisperSource.indexOf("this.worker.on('error'");
  const exitStart = localWhisperSource.indexOf("this.worker.on('exit'", errorStart);
  assert.notEqual(errorStart, -1, 'worker error handler must exist');
  assert.ok(exitStart > errorStart, 'worker exit handler must follow the error handler');
  const errorHandler = localWhisperSource.slice(errorStart, exitStart);
  assert.doesNotMatch(
    errorHandler,
    /slotRelease\s*\(/,
    'worker error must not release the ONNX slot before native teardown exits',
  );
  const exitHandler = localWhisperSource.slice(exitStart);
  assert.match(exitHandler, /slotRelease\s*\(/);
});

test('failed shutdown delivery still waits for the worker exit event', () => {
  const body = extractMethodBody(localWhisperSource, 'beginWorkerTermination');
  const catchStart = body.indexOf('catch (err)');
  assert.notEqual(catchStart, -1, 'shutdown delivery must handle an unavailable worker');
  const catchBody = body.slice(catchStart);
  assert.doesNotMatch(catchBody, /slotRelease\s*\(/);
  assert.doesNotMatch(catchBody, /finishWorkerShutdown\s*\(/);
});

test('Local Whisper shutdown wait is bounded without releasing the native slot', () => {
  const body = extractMethodBody(localWhisperSource, 'waitForShutdown');
  assert.match(body, /setTimeout\s*\(/);
  assert.match(body, /reject\s*\(/);
  assert.doesNotMatch(body, /slotRelease\s*\(/);
});

test('meeting teardown waits for Local Whisper workers to exit', () => {
  const body = extractMethodBody(mainSource, 'endMeeting');
  assert.match(body, /waitForShutdown\?\.\(\)/);
});

test('audio test waits for an in-flight meeting teardown', () => {
  const body = extractMethodBody(mainSource, 'startAudioTest');
  assert.match(body, /await\s+this\._pendingTeardown/);
});

test('audio test owns the start guard before waiting for teardown', () => {
  const body = extractMethodBody(mainSource, 'startAudioTest');
  const guardAt = body.indexOf('this._audioTestStarting = true');
  const waitAt = body.indexOf('await this._pendingTeardown');
  assert.ok(guardAt >= 0 && guardAt < waitAt, 'the concurrency guard must be acquired before the first await');
});

test('meeting persistence continues after a bounded Local Whisper shutdown failure', () => {
  const body = extractMethodBody(mainSource, 'endMeeting');
  assert.match(body, /waitForShutdown\?\.\(\)[\s\S]*\.catch\s*\(/);
  assert.match(body, /intelligenceManager\.stopMeeting\s*\(\)/);
});
