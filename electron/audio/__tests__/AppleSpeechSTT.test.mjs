import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { AppleSpeechSTT } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/audio/AppleSpeechSTT.js')).href
);

class FakeReadable extends EventEmitter {
  encoding = null;

  setEncoding(encoding) {
    this.encoding = encoding;
    return this;
  }
}

class FakeStdin extends EventEmitter {
  writes = [];
  ends = [];
  writeResults = [];
  writableEnded = false;

  constructor(writeResults = []) {
    super();
    this.writeResults = [...writeResults];
  }

  write(value) {
    this.writes.push(String(value));
    return this.writeResults.length ? this.writeResults.shift() : true;
  }

  end(value) {
    if (value !== undefined) this.ends.push(String(value));
    this.writableEnded = true;
    return this;
  }
}

class FakeChild extends EventEmitter {
  stdin;
  stdout = new FakeReadable();
  stderr = new FakeReadable();
  killed = false;
  exitCode = null;
  killSignals = [];

  constructor(writeResults = []) {
    super();
    this.stdin = new FakeStdin(writeResults);
  }

  kill(signal = 'SIGTERM') {
    this.killed = true;
    this.killSignals.push(signal);
    return true;
  }

  exit(code, signal = null) {
    this.exitCode = code;
    this.emit('exit', code, signal);
  }
}

function createHarness({ platform = 'darwin', release = '25.0.0', locale = 'en-AU', writeResults = [] } = {}) {
  const child = new FakeChild(writeResults);
  const spawnCalls = [];
  const scheduledTimers = [];
  const clearedTimers = [];
  const runtime = {
    platform,
    osRelease: () => release,
    getLocale: () => locale,
    spawn: (executable, args, options) => {
      spawnCalls.push({ executable, args, options });
      return child;
    },
    scheduleTimeout: (callback, delayMs) => {
      const timer = { callback, delayMs, unrefCalled: false, unref() { this.unrefCalled = true; } };
      scheduledTimers.push(timer);
      return timer;
    },
    clearTimer: (timer) => clearedTimers.push(timer),
  };
  return { child, spawnCalls, scheduledTimers, clearedTimers, runtime };
}

function protocolMessages(values) {
  return values.map((value) => JSON.parse(value.trim()));
}

test('starts the helper, waits for ready, drains buffered audio with backpressure, and emits transcripts', () => {
  // init succeeds, the first audio write backpressures, and the second audio
  // write is released only after the fake stream emits drain.
  const { child, spawnCalls, runtime } = createHarness({ writeResults: [true, false, true] });
  const stt = new AppleSpeechSTT('/fake/natively-apple-speech', runtime);
  const ready = [];
  const statuses = [];
  const transcripts = [];
  const errors = [];
  stt.on('ready', () => ready.push(true));
  stt.on('status', (status) => statuses.push(status));
  stt.on('transcript', (transcript) => transcripts.push(transcript));
  stt.on('error', (error) => errors.push(error));

  stt.setRecognitionLanguage('chinese');
  stt.setSampleRate(48000);
  stt.start();

  assert.deepEqual(spawnCalls, [{
    executable: '/fake/natively-apple-speech',
    args: [],
    options: { stdio: ['pipe', 'pipe', 'pipe'] },
  }]);
  assert.equal(child.stdout.encoding, 'utf8');
  assert.deepEqual(protocolMessages(child.stdin.writes), [{ type: 'init', locale: 'zh-CN' }]);

  const firstPcm = Buffer.from([1, 0, 2, 0]);
  const secondPcm = Buffer.from([3, 0, 4, 0]);
  stt.write(firstPcm);
  stt.write(secondPcm);
  assert.equal(child.stdin.writes.length, 1, 'audio must remain buffered until the model is ready');

  child.stdout.emit('data', '{"type":"ready"}\n{"type":"status","message":"model ready"}\n');
  assert.equal(ready.length, 1);
  assert.deepEqual(statuses, ['model ready']);
  assert.equal(child.stdin.writes.length, 2, 'ready should drain only the first chunk when stdin backpressures');

  child.stdin.emit('drain');
  const [, firstAudio, secondAudio] = protocolMessages(child.stdin.writes);
  assert.deepEqual(firstAudio, {
    type: 'audio',
    sampleRate: 48000,
    pcm: firstPcm.toString('base64'),
  });
  assert.deepEqual(secondAudio, {
    type: 'audio',
    sampleRate: 48000,
    pcm: secondPcm.toString('base64'),
  });

  // Exercise JSONL framing too: one result may arrive across stdout chunks.
  child.stdout.emit('data', '{"type":"transcript","text":"你');
  child.stdout.emit('data', '好","isFinal":false}\n{"type":"transcript","text":"你好","isFinal":true}\n');
  assert.deepEqual(transcripts, [
    { text: '你好', isFinal: false, confidence: 0.9 },
    { text: '你好', isFinal: true, confidence: 0.9 },
  ]);
  assert.equal(errors.length, 0);
  assert.equal(stt.finalize(), true);
  assert.deepEqual(protocolMessages(child.stdin.writes).at(-1), { type: 'flush' });

  stt.stop();
  child.exit(0);
});

test('preserves finalize behind backpressured audio and flushes exactly once in order', () => {
  // init succeeds, the first audio chunk fills stdin, then drain releases the
  // second chunk and the deferred flush in protocol order.
  const { child, runtime } = createHarness({ writeResults: [true, false, true, true] });
  const stt = new AppleSpeechSTT('/fake/helper', runtime);
  stt.on('error', () => {});
  stt.start();
  child.stdout.emit('data', '{"type":"ready"}\n');

  const firstPcm = Buffer.from([1, 0, 2, 0]);
  const secondPcm = Buffer.from([3, 0, 4, 0]);
  stt.write(firstPcm);
  stt.write(secondPcm);

  assert.equal(stt.finalize(), true, 'queued finalization must keep the transcript-tail wait open');
  assert.deepEqual(
    protocolMessages(child.stdin.writes).map((message) => message.type),
    ['init', 'audio'],
    'flush must wait behind the blocked and queued audio',
  );

  child.stdin.emit('drain');
  const messages = protocolMessages(child.stdin.writes);
  assert.deepEqual(messages.map((message) => message.type), ['init', 'audio', 'audio', 'flush']);
  assert.equal(messages.filter((message) => message.type === 'flush').length, 1);
  assert.equal(messages[1].pcm, firstPcm.toString('base64'));
  assert.equal(messages[2].pcm, secondPcm.toString('base64'));

  stt.stop();
  child.exit(0);
});

test('uses the injected app locale for automatic language selection', () => {
  const { child, runtime } = createHarness({ locale: 'fr-FR' });
  const stt = new AppleSpeechSTT('/fake/helper', runtime);
  stt.on('error', () => {});

  assert.doesNotThrow(() => stt.setCredentials('/ignored/google-credentials.json'));
  stt.start();

  assert.deepEqual(protocolMessages(child.stdin.writes)[0], { type: 'init', locale: 'fr-FR' });
  stt.stop();
  child.exit(0);
});

test('allows a longer startup window while macOS installs a language asset', () => {
  const { child, scheduledTimers, clearedTimers, runtime } = createHarness();
  const stt = new AppleSpeechSTT('/fake/helper', runtime);
  const errors = [];
  stt.on('error', (error) => errors.push(error));

  stt.start();
  assert.equal(scheduledTimers.length, 1);
  assert.equal(scheduledTimers[0].delayMs, 120_000);
  assert.equal(scheduledTimers[0].unrefCalled, true);

  child.stdout.emit('data', '{"type":"status","phase":"asset-download","message":"downloading"}\n');
  assert.equal(scheduledTimers.length, 2);
  assert.equal(scheduledTimers[1].delayMs, 15 * 60_000);
  assert.equal(scheduledTimers[1].unrefCalled, true);
  assert.deepEqual(clearedTimers, [scheduledTimers[0]]);

  const oneSecond = Buffer.alloc(16_000 * 2);
  for (let i = 0; i < 11; i += 1) stt.write(oneSecond);
  assert.deepEqual(errors, [], 'a long asset download must not abort after ten seconds of captured audio');

  child.stdout.emit('data', '{"type":"ready"}\n');
  assert.deepEqual(clearedTimers, [scheduledTimers[0], scheduledTimers[1]]);
  assert.equal(
    protocolMessages(child.stdin.writes).filter((message) => message.type === 'audio').length,
    10,
    'only the most recent bounded audio tail should be replayed once the asset is ready',
  );
  stt.stop();
  child.exit(0);
});

test('restarts an active helper when the recognition language changes', () => {
  const first = new FakeChild();
  const second = new FakeChild();
  const children = [first, second];
  const { runtime } = createHarness();
  let spawnCount = 0;
  runtime.spawn = () => children[spawnCount++];
  const stt = new AppleSpeechSTT('/fake/helper', runtime);
  stt.on('error', () => {});

  stt.setRecognitionLanguage('english-us');
  stt.start();
  assert.deepEqual(protocolMessages(first.stdin.writes)[0], { type: 'init', locale: 'en-US' });

  stt.setRecognitionLanguage('german');
  assert.equal(spawnCount, 2);
  assert.deepEqual(protocolMessages(first.stdin.ends), [{ type: 'stop' }]);
  assert.deepEqual(protocolMessages(second.stdin.writes)[0], { type: 'init', locale: 'de-DE' });

  stt.setRecognitionLanguage('german');
  assert.equal(spawnCount, 2, 'setting the same language must not restart the helper');
  stt.stop();
  first.exit(0);
  second.exit(0);
});

test('reports an unexpected helper exit as a terminal local-STT error and tears down input', () => {
  const { child, runtime } = createHarness();
  const stt = new AppleSpeechSTT('/fake/helper', runtime);
  const errors = [];
  stt.on('error', (error) => errors.push(error));

  stt.start();
  child.exit(7);

  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'local_stt_unavailable');
  assert.match(errors[0].message, /stopped unexpectedly \(7\)/i);
  assert.deepEqual(protocolMessages(child.stdin.ends), [{ type: 'stop' }]);

  const writesAfterFailure = child.stdin.writes.length;
  stt.write(Buffer.from([1, 0]));
  assert.equal(child.stdin.writes.length, writesAfterFailure, 'audio after a terminal failure must be ignored');
  assert.equal(stt.finalize(), false);
});

test('stop sends the protocol terminator, discards pending audio, and makes a later exit expected', () => {
  const { child, runtime } = createHarness();
  const stt = new AppleSpeechSTT('/fake/helper', runtime);
  const errors = [];
  stt.on('error', (error) => errors.push(error));

  stt.start();
  stt.write(Buffer.from([1, 0, 2, 0]));
  stt.stop();

  assert.deepEqual(protocolMessages(child.stdin.ends), [{ type: 'stop' }]);
  assert.equal(stt.finalize(), false);
  child.exit(0);
  assert.deepEqual(errors, [], 'the helper exiting after stop must not be reported as a crash');
});

test('rejects unsupported platforms before spawning the helper', () => {
  const { spawnCalls, runtime } = createHarness({ platform: 'linux', release: '6.0.0' });
  const stt = new AppleSpeechSTT('/fake/helper', runtime);
  const errors = [];
  stt.on('error', (error) => errors.push(error));

  stt.start();

  assert.equal(spawnCalls.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'local_stt_unavailable');
  assert.match(errors[0].message, /requires macOS 26 or later/i);
});

test('rejects pre-macOS-26 Darwin releases before spawning the helper', () => {
  const { spawnCalls, runtime } = createHarness({ platform: 'darwin', release: '24.6.0' });
  const stt = new AppleSpeechSTT('/fake/helper', runtime);
  const errors = [];
  stt.on('error', (error) => errors.push(error));

  stt.start();

  assert.equal(spawnCalls.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'local_stt_unavailable');
  assert.match(errors[0].message, /requires macOS 26 or later/i);
});
