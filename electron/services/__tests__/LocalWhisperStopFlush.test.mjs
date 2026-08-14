import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../../audio/LocalWhisperSTT.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const stopStart = source.indexOf('    stop(): void');
const stopEnd = source.indexOf('    write(chunk: Buffer): void', stopStart);
const stopSource = source.slice(stopStart, stopEnd);
const flushPendingStart = source.indexOf('    private flushPending(): void');
const flushPendingEnd = source.indexOf('    private beginWorkerTermination', flushPendingStart);
const flushPendingSource = source.slice(flushPendingStart, flushPendingEnd);
const listenerStart = source.indexOf('    private attachWorkerListeners(): void');
const listenerEnd = source.indexOf('    private flushPending(): void', listenerStart);
const listenerSource = source.slice(listenerStart, listenerEnd);

test('LocalWhisperSTT.stop does not clear queued VAD finals before worker readiness', () => {
  assert.ok(stopStart >= 0, 'stop should exist');
  assert.doesNotMatch(stopSource, /this\.pendingAudio = \[\];/);
  assert.match(stopSource, /this\.isDrainingFinals = true;[\s\S]*segs\.forEach\(s => this\.dispatchFinal\(s\.samples\)\);/);
  assert.match(stopSource, /shouldKeepWorkerForFinals[\s\S]*this\.pendingAudio\.length > 0/);
});

test('LocalWhisperSTT drains queued stop-time finals before terminating worker', () => {
  assert.ok(flushPendingStart >= 0, 'flushPending should exist');
  assert.match(source, /if \(this\.isDrainingFinals\) \{\n\s+this\.drainingFinalsInFlight\+\+;\n\s+\}\n\s+this\.sendTranscribe\(audio, false\);/);
  assert.match(flushPendingSource, /queued\.forEach\(audio => this\.sendTranscribe\(audio, false\)\);/);
  assert.match(listenerSource, /!this\.isActive && !\(this\.isDrainingFinals && msg\.type === 'result'\)/);
  assert.match(listenerSource, /this\.drainingFinalsInFlight = Math\.max\(0, this\.drainingFinalsInFlight - 1\);/);
  assert.match(listenerSource, /this\.beginWorkerTermination\(this\.worker\);/);
});
