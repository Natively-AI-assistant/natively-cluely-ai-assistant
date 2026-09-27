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
  // A non-macOS host must never be handed macOS troubleshooting (CLAUDE.md
  // cross-platform contract). Windows reaches this only via a carried-over
  // credential store, since the settings tile is isMac-gated.
  assert.match(errors[0].message, /macOS-only/i);
  assert.doesNotMatch(errors[0].message, /macOS 26 or later/i);
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

test('drops a punctuation-only final but keeps the words it already streamed', () => {
  // A `flush` force-finalizes a still-volatile result and Apple sometimes
  // answers with debris instead of the words. Live-reproduced against the real
  // compiled helper: 1 run in 8 returned a final of "......." after correct
  // partials. finalize() is the Answer button, so that debris would be
  // attributed to the question the user just asked.
  const { child, runtime } = createHarness();
  const stt = new AppleSpeechSTT('/fake/helper', runtime);
  const transcripts = [];
  stt.on('transcript', (transcript) => transcripts.push(transcript));

  stt.start();
  child.stdout.emit('data', '{"type":"ready"}\n');
  child.stdout.emit(
    'data',
    '{"type":"transcript","text":"Second sentence about hiring plans.","isFinal":false}\n' +
    '{"type":"transcript","text":".......","isFinal":true}\n',
  );

  assert.deepEqual(
    transcripts.map((t) => [t.text, t.isFinal]),
    [['Second sentence about hiring plans.', false]],
    'the punctuation-only final must not reach the transcript',
  );
});

test('a real final still passes, including non-Latin scripts and digit-only answers', () => {
  const { child, runtime } = createHarness();
  const stt = new AppleSpeechSTT('/fake/helper', runtime);
  const transcripts = [];
  stt.on('transcript', (transcript) => transcripts.push(transcript));

  stt.start();
  child.stdout.emit('data', '{"type":"ready"}\n');
  child.stdout.emit(
    'data',
    '{"type":"transcript","text":"季度收入增长了15%。","isFinal":true}\n' +
    '{"type":"transcript","text":"42.","isFinal":true}\n' +
    '{"type":"transcript","text":"!?…","isFinal":true}\n',
  );

  assert.deepEqual(
    transcripts.map((t) => t.text),
    ['季度收入增长了15%。', '42.'],
    'the guard must key on letters/digits in ANY script, never on ASCII punctuation alone',
  );
});

test('audio buffered before ready is trimmed, not failed, so the startup timer can fire', () => {
  // Regression: the ten-second pending cap used to hard-fail with "could not
  // keep up with the audio" whenever the helper was slow to start WITHOUT
  // announcing an asset download, which made MODEL_START_TIMEOUT_MS (120s)
  // unreachable any time audio was flowing.
  const { child, runtime } = createHarness();
  const stt = new AppleSpeechSTT('/fake/helper', runtime);
  const errors = [];
  stt.on('error', (error) => errors.push(error));

  stt.setSampleRate(16000);
  stt.start();
  // No 'ready', no asset-download status: 12 seconds of 16 kHz mono Int16
  // against a 10-second cap.
  const oneSecond = Buffer.alloc(16000 * 2);
  for (let i = 0; i < 12; i += 1) stt.write(oneSecond);

  assert.deepEqual(errors, [], 'a slow start must not be reported as the helper failing to keep up');
  assert.equal(child.stdin.writes.length, 1, 'only the init line — audio stays buffered until ready');

  // Once ready the retained tail drains, bounded to the cap.
  child.stdout.emit('data', '{"type":"ready"}\n');
  const drained = protocolMessages(child.stdin.writes.slice(1));
  assert.ok(drained.length > 0, 'the retained tail must be delivered once ready');
  assert.ok(drained.every((m) => m.type === 'audio'));
  const drainedBytes = drained.reduce((n, m) => n + Buffer.from(m.pcm, 'base64').length, 0);
  assert.ok(drainedBytes <= 16000 * 2 * 10, `retained tail must stay within the 10s cap, got ${drainedBytes} bytes`);
});

// Locale resolution. Apple rejects anything that is not a real BCP-47 locale:
// probed live against the framework, "english" -> nil and "spanish" -> nil, so
// forwarding an unresolved settings key can only ever fail. Worse, bare "en"
// resolves to en-IE (Irish English), so falling back to iso639 silently
// mis-transcribes. Every other provider refuses an unknown key and keeps its
// default (GoogleSTT warns and returns); this one has to produce a locale, so
// it falls back to the app locale instead of forwarding garbage.
function localeSentTo(child) {
  return JSON.parse(child.stdin.writes[0].trim()).locale;
}

test('a legacy "english" setting resolves to a real English locale, not the literal string', () => {
  // 'english' is what installs from before the English-variants split still
  // have persisted; RECOGNITION_LANGUAGES has a plain key for every language
  // EXCEPT English, which exists only as english-us/uk/in/au/ca.
  const { child, runtime } = createHarness({ locale: 'fr-FR' });
  const stt = new AppleSpeechSTT('/fake/helper', runtime);
  stt.on('error', () => {});
  stt.setRecognitionLanguage('english');
  stt.start();
  assert.equal(localeSentTo(child), 'en-US', 'a non-English app locale must not drag English to fr-FR');
});

test('"english" prefers the regional variant the machine already runs', () => {
  const { child, runtime } = createHarness({ locale: 'en-GB' });
  const stt = new AppleSpeechSTT('/fake/helper', runtime);
  stt.on('error', () => {});
  stt.setRecognitionLanguage('english');
  stt.start();
  assert.equal(localeSentTo(child), 'en-GB');
});

test('explicit region keys and plain language keys both still resolve', () => {
  for (const [key, expected] of [['english-au', 'en-AU'], ['spanish', 'es-ES'], ['japanese', 'ja-JP']]) {
    const { child, runtime } = createHarness({ locale: 'en-US' });
    const stt = new AppleSpeechSTT('/fake/helper', runtime);
    stt.on('error', () => {});
    stt.setRecognitionLanguage(key);
    stt.start();
    assert.equal(localeSentTo(child), expected, `${key} must map to ${expected}`);
  }
});

test('an unknown key falls back to the app locale instead of being forwarded', () => {
  const { child, runtime } = createHarness({ locale: 'de-DE' });
  const stt = new AppleSpeechSTT('/fake/helper', runtime);
  stt.on('error', () => {});
  stt.setRecognitionLanguage('klingon');
  stt.start();
  const sent = localeSentTo(child);
  assert.equal(sent, 'de-DE');
  assert.notEqual(sent, 'klingon', 'a settings key must never reach Apple as a locale');
});

// --- readAppleSpeechLocales: the Settings language picker's data source ------
// Every failure must degrade to available:false, which the renderer reads as
// "don't restrict the list and don't badge" — i.e. exactly the behaviour before
// this existed. A picker that silently hides languages because a probe broke
// would be worse than one that never annotated them.
const { readAppleSpeechLocales } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/audio/AppleSpeechSTT.js')).href
);

function stubSpawn(behaviour) {
  return () => {
    const child = new FakeChild();
    queueMicrotask(() => behaviour(child));
    return child;
  };
}

/**
 * Production deliberately unrefs helper timeouts so they cannot keep Electron
 * alive during shutdown. An isolated Node test may have no other referenced
 * handles, so retain the runner while asserting those timeout paths.
 */
async function observeUnrefedTimeout(work, keepAliveMs = 100) {
  const keepRunnerAlive = setTimeout(() => {}, keepAliveMs);
  try {
    return await work();
  } finally {
    clearTimeout(keepRunnerAlive);
  }
}

test('locales query parses the helper answer', async () => {
  const result = await readAppleSpeechLocales('/fake/helper', {
    platform: 'darwin',
    spawn: stubSpawn((c) => {
      c.stdout.emit('data', JSON.stringify({
        type: 'locales', available: true, supported: ['en-US', 'es-ES'], installed: ['en-US'],
      }) + '\n');
      c.emit('close', 0, null);
    }),
  });
  assert.deepEqual(result, {
    available: true, supported: ['en-US', 'es-ES'], installed: ['en-US'], reserved: [], maxReserved: 0,
  });
});

test('locales query never spawns anything off macOS', async () => {
  let spawned = false;
  const result = await readAppleSpeechLocales('/fake/helper', {
    platform: 'win32',
    spawn: () => { spawned = true; throw new Error('must not spawn'); },
  });
  assert.equal(spawned, false, 'Windows must not try to run a Mach-O helper');
  assert.deepEqual(result, { available: false, supported: [], installed: [], reserved: [], maxReserved: 0 });
});

test('a missing helper, garbage output, or a hang all degrade to unavailable', async () => {
  const missing = await readAppleSpeechLocales('/fake/helper', {
    platform: 'darwin',
    spawn: stubSpawn((c) => c.emit('error', new Error('ENOENT'))),
  });
  assert.deepEqual(missing, { available: false, supported: [], installed: [], reserved: [], maxReserved: 0 });

  const garbage = await readAppleSpeechLocales('/fake/helper', {
    platform: 'darwin',
    spawn: stubSpawn((c) => { c.stdout.emit('data', 'not json\n'); c.emit('close', 1, null); }),
  });
  assert.deepEqual(garbage, { available: false, supported: [], installed: [], reserved: [], maxReserved: 0 });

  const hung = await observeUnrefedTimeout(() =>
    readAppleSpeechLocales('/fake/helper', {
      platform: 'darwin',
      timeoutMs: 20,
      spawn: stubSpawn(() => { /* never answers, never closes */ }),
    }),
  );
  assert.deepEqual(hung, { available: false, supported: [], installed: [], reserved: [], maxReserved: 0 }, 'a hung probe must not block Settings forever');
});

test('an unavailable Mac reports no locales rather than an empty supported list it might act on', async () => {
  const result = await readAppleSpeechLocales('/fake/helper', {
    platform: 'darwin',
    spawn: stubSpawn((c) => {
      c.stdout.emit('data', JSON.stringify({ type: 'locales', available: false, supported: [], installed: [] }) + '\n');
      c.emit('close', 0, null);
    }),
  });
  assert.equal(result.available, false);
});

// --- installAppleSpeechLocale: the Settings download button --------------
const { installAppleSpeechLocale } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/audio/AppleSpeechSTT.js')).href
);

test('install streams progress fractions and resolves ok on install-done', async () => {
  const seen = [];
  const result = await installAppleSpeechLocale('ko-KR', (f) => seen.push(f), '/fake/helper', {
    platform: 'darwin',
    spawn: stubSpawn((c) => {
      c.stdout.emit('data', '{"type":"install-progress","locale":"ko-KR","fraction":0.15}\n');
      c.stdout.emit('data', '{"type":"install-progress","locale":"ko-KR","fraction":0.8}\n{"type":"install-done","locale":"ko-KR"}\n');
      c.emit('close', 0, null);
    }),
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(seen, [0.15, 0.8]);
});

test('a fraction outside 0..1 is clamped before it reaches a progress bar', async () => {
  const seen = [];
  await installAppleSpeechLocale('ko-KR', (f) => seen.push(f), '/fake/helper', {
    platform: 'darwin',
    spawn: stubSpawn((c) => {
      c.stdout.emit('data', '{"type":"install-progress","fraction":-3}\n{"type":"install-progress","fraction":42}\n{"type":"install-done"}\n');
      c.emit('close', 0, null);
    }),
  });
  assert.deepEqual(seen, [0, 1]);
});

test('an exit without install-done is a failure, not a silent success', async () => {
  const result = await installAppleSpeechLocale('ko-KR', () => {}, '/fake/helper', {
    platform: 'darwin',
    spawn: stubSpawn((c) => {
      c.stdout.emit('data', '{"type":"error","message":"network unreachable"}\n');
      c.emit('close', 1, null);
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /network unreachable/);
});

test('install never spawns a Mach-O helper off macOS', async () => {
  let spawned = false;
  const result = await installAppleSpeechLocale('ko-KR', () => {}, '/fake/helper', {
    platform: 'win32',
    spawn: () => { spawned = true; throw new Error('must not spawn'); },
  });
  assert.equal(spawned, false);
  assert.equal(result.ok, false);
});

// --- releaseAppleSpeechLocale: the only way back from Apple's 5-slot cap ----
// Apple allocates at most maximumReservedLocales (5) per app and an install
// takes a slot permanently — a sixth download fails with "Too many allocated
// locales, 5 maximum", reproduced live. Releasing is the only recovery and it
// PURGES the asset (zh-CN vanished from installedLocales in testing), so it is
// never called automatically to make room; only from an explicit user action.
const { releaseAppleSpeechLocale } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/audio/AppleSpeechSTT.js')).href
);

test('release resolves ok only when the helper confirms release-done', async () => {
  const ok = await releaseAppleSpeechLocale('zh-CN', '/fake/helper', {
    platform: 'darwin',
    spawn: stubSpawn((c) => {
      c.stdout.emit('data', '{"type":"release-done","locale":"zh-CN","released":true}\n');
      c.emit('close', 0, null);
    }),
  });
  assert.deepEqual(ok, { ok: true });
});

test('an exit without release-done is a failure, never a silent success', async () => {
  const r = await releaseAppleSpeechLocale('zh-CN', '/fake/helper', {
    platform: 'darwin',
    spawn: stubSpawn((c) => {
      c.stdout.emit('data', '{"type":"error","message":"not reserved"}\n');
      c.emit('close', 1, null);
    }),
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /not reserved/);
});

test('release times out rather than leaving Settings stuck on "Removing…"', async () => {
  const r = await observeUnrefedTimeout(() =>
    releaseAppleSpeechLocale('zh-CN', '/fake/helper', {
      platform: 'darwin',
      timeoutMs: 20,
      spawn: stubSpawn(() => { /* never answers */ }),
    }),
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /timed out/i);
});

test('release never spawns a Mach-O helper off macOS', async () => {
  let spawned = false;
  const r = await releaseAppleSpeechLocale('zh-CN', '/fake/helper', {
    platform: 'win32',
    spawn: () => { spawned = true; throw new Error('must not spawn'); },
  });
  assert.equal(spawned, false);
  assert.equal(r.ok, false);
});

test('the locales probe carries the reservation budget the picker gates on', async () => {
  const r = await readAppleSpeechLocales('/fake/helper', {
    platform: 'darwin',
    spawn: stubSpawn((c) => {
      c.stdout.emit('data', JSON.stringify({
        type: 'locales', available: true, supported: ['en-US'], installed: ['en-US'],
        reserved: ['en-US', 'de-DE'], maxReserved: 5,
      }) + '\n');
      c.emit('close', 0, null);
    }),
  });
  assert.deepEqual(r.reserved, ['en-US', 'de-DE']);
  assert.equal(r.maxReserved, 5);
});

test('a helper that omits the reservation fields degrades to an empty budget', async () => {
  // An older helper binary next to a newer app must not make the picker think
  // zero slots exist and block every download.
  const r = await readAppleSpeechLocales('/fake/helper', {
    platform: 'darwin',
    spawn: stubSpawn((c) => {
      c.stdout.emit('data', '{"type":"locales","available":true,"supported":["en-US"],"installed":["en-US"]}\n');
      c.emit('close', 0, null);
    }),
  });
  assert.deepEqual(r.reserved, []);
  assert.equal(r.maxReserved, 0);
});
