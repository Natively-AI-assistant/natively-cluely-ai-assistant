// When the native audio module does not load on Windows (missing VC++
// runtime, antivirus quarantine, wrong architecture), mic and system audio are
// now captured by Chromium in a hidden window (getUserMedia + getDisplayMedia
// with loopback audio), as Interview Coder does on Windows. Before this both
// channels were dead for the whole meeting. The stand-in classes feed the same
// wrappers, so they must behave like the native ones: same gate, same frames,
// same batching, same speech edges, failures through the data callback.
//
// Run: node scripts/build-electron.js && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/audio/__tests__/RendererCaptureFallback2026_10_21.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (rel) => require(path.join(repoRoot, 'dist-electron/electron/audio/fallback', rel));
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const { useRendererCaptureFallback } = dist('fallbackPolicy.js');
const { SilenceGate, MIC_GATE, SYSTEM_GATE, LATCH_WINDOW_SECS, LATCH_FLOOR_RUN_MS, LATCH_RELEASE_MARGIN } = dist('silenceGate.js');
const { ChannelTracker, sharedFallbackTracker } = dist('channelTracker.js');
const { FallbackPcmPipeline, RendererMicCapture, RendererSystemAudioCapture } = dist('rendererCaptureMonitor.js');
const { toInt16 } = dist('captureHost.js');

const policy = (over) => useRendererCaptureFallback({ platform: 'win32', nativeAvailable: false, isPackaged: true, forceEnv: undefined, ...over });

test('Windows uses the fallback exactly when the native class is missing', () => {
  assert.equal(policy({}), true);
  assert.equal(policy({ nativeAvailable: true }), false);
  // The dev override means nothing on Windows: the native path is never displaced.
  assert.equal(policy({ nativeAvailable: true, isPackaged: false, forceEnv: '1' }), false);
});

test('macOS never uses the fallback in a shipped build, even without the native module', () => {
  assert.equal(policy({ platform: 'darwin' }), false);
  assert.equal(policy({ platform: 'darwin', forceEnv: '1' }), false, 'packaged ignores the env override');
  assert.equal(policy({ platform: 'darwin', nativeAvailable: true, isPackaged: false }), false);
  assert.equal(policy({ platform: 'darwin', nativeAvailable: true, isPackaged: false, forceEnv: '1' }), true, 'dev override');
  assert.equal(policy({ platform: 'linux' }), false);
});

// --- Silence gate: a port of native-module/src/silence_suppression.rs ---------

test('the gate constants match the Rust configs it ports', () => {
  const rs = read('native-module/src/silence_suppression.rs');
  const block = (fn) => rs.slice(rs.indexOf(`pub fn ${fn}`), rs.indexOf(`pub fn ${fn}`) + 900);
  const num = (src, field) => Number(src.match(new RegExp(`${field}:\\s*([\\d.]+)`))[1]);
  const ms = (src, field) => Number(src.match(new RegExp(`${field}:\\s*Duration::from_millis\\((\\d+)\\)`))[1]);
  for (const [fn, cfg] of [['for_system_audio', SYSTEM_GATE], ['for_microphone_on', MIC_GATE]]) {
    const src = block(fn);
    assert.equal(cfg.speechThresholdRms, num(src, 'speech_threshold_rms'), fn);
    assert.equal(cfg.speechHangoverMs, ms(src, 'speech_hangover'), fn);
    assert.equal(cfg.keepaliveIntervalMs, ms(src, 'silence_keepalive_interval'), fn);
    assert.equal(cfg.adaptiveMultiplier, num(src, 'adaptive_multiplier'), fn);
    assert.equal(cfg.adaptiveMinFloor, num(src, 'adaptive_min_floor'), fn);
    assert.equal(cfg.emaAlpha, num(src, 'ema_alpha'), fn);
  }
  assert.equal(LATCH_WINDOW_SECS, Number(rs.match(/const LATCH_WINDOW_SECS: u64 = (\d+)/)[1]));
  assert.equal(LATCH_FLOOR_RUN_MS, Number(rs.match(/const LATCH_FLOOR_RUN_MS: u64 = (\d+)/)[1]));
  assert.equal(LATCH_RELEASE_MARGIN, Number(rs.match(/const LATCH_RELEASE_MARGIN: f32 = ([\d.]+)/)[1]));
});

// 50 silent frames, 40 loud, 60 silent, 4 x (50 faint + 30 loud), 300 faint,
// 80 silent: speech, hangover, keepalives, the adaptive floor and the
// background latch (system audio stays open on the faint bed).
function signal() {
  const frames = [];
  const push = (kind, count) => {
    for (let i = 0; i < count; i++) {
      const f = new Int16Array(320);
      for (let n = 0; n < 320; n++) f[n] = kind === 0 ? 0 : kind === 1 ? (Math.floor(n / 18) % 2 === 0 ? 3000 : -3000) : (n % 2 === 0 ? 15 : -15);
      frames.push(f);
    }
  };
  push(0, 50); push(1, 40); push(0, 60);
  for (let i = 0; i < 4; i++) { push(2, 50); push(1, 30); }
  push(2, 300); push(0, 80);
  return frames;
}

function trace(cfg) {
  const gate = new SilenceGate(cfg, 0);
  let out = '';
  signal().forEach((f, k) => {
    const r = gate.process(f, (k + 1) * 20);
    out += r.action === 'send' ? 'S' : r.action === 'silence' ? 'K' : '_';
    if (r.edge === 'started') out += '+';
    if (r.edge === 'ended') out += '-';
  });
  return out;
}

function summary(t) {
  const edges = [];
  let frame = 0;
  for (const c of t) {
    if ('SK_'.includes(c)) frame++;
    else edges.push(`${c}${frame}`);
  }
  return { edges: edges.join(' '), S: t.split('S').length - 1, K: t.split('K').length - 1, _: t.split('_').length - 1 };
}

// Produced by the Rust SilenceSuppressor (process_edges_at, use_vad false, one
// frame every 20 ms) on the same signal, 2026-10-21. Regenerate both sides if
// the Rust gate changes on purpose.
const RUST_GOLDEN = {
  system: {
    sha256: '6f159694f1db5e868b89218b67ba816f84d2cbd257500712e39d58dd7f55017a',
    edges: '+51 -121 +151 -341 +361 -421 +441 -501', S: 720, K: 26, _: 104,
  },
  mic: {
    sha256: '9e77fda6fcd9b8efba9c8c21379394d26208c99e38a1611a25066cf28047f8c2',
    edges: '+51 -116 +201 -256 +281 -336 +361 -416 +441 -496', S: 285, K: 113, _: 452,
  },
};

for (const [name, cfg] of [['system', SYSTEM_GATE], ['mic', MIC_GATE]]) {
  test(`the ${name} gate decides every frame as the Rust gate does`, () => {
    const t = trace(cfg);
    const { sha256, ...expected } = RUST_GOLDEN[name];
    assert.deepEqual(summary(t), expected);
    assert.equal(crypto.createHash('sha256').update(t).digest('hex'), sha256);
  });
}

// --- Joint speech edges -------------------------------------------------------

test('the tracker reports joint state like channel_state.rs, user edges not VAD-backed', () => {
  const t = new ChannelTracker(false);
  assert.equal(t.onEdge('user', false, 0), null, 'no change, no event');
  const a = t.onEdge('interviewer', true, 1000);
  assert.deepEqual(a, { channel: 'interviewer', speaking: true, joint: 'interviewer_speaking', atMs: 1000, msSinceOtherEdge: -1, userEdgesVadBacked: false });
  const b = t.onEdge('user', true, 1250);
  assert.equal(b.joint, 'both');
  assert.equal(b.msSinceOtherEdge, 250);
  assert.equal(t.onEdge('interviewer', false, 1400).joint, 'user_speaking');
  assert.equal(t.onEdge('user', false, 1500).joint, 'neither');
});

test('the mic and system wrappers share one tracker and one host, though bundled apart', () => {
  // Same Symbol.for key from two separately loaded copies gives one object.
  assert.equal(sharedFallbackTracker(), sharedFallbackTracker());
  for (const rel of ['electron/audio/fallback/captureHost.ts', 'electron/audio/fallback/channelTracker.ts']) {
    assert.match(read(rel), /Symbol\.for\('natively\.audioFallback\./, `${rel} keeps its singleton on globalThis`);
  }
});

// --- Framing, batching and edges out of the pipeline --------------------------

function pipeline(cfg, channel = 'user') {
  const out = { chunks: [], ended: 0, edges: [] };
  let now = 0;
  const p = new FallbackPcmPipeline(cfg, channel, new ChannelTracker(false), {
    data: (c) => out.chunks.push(c),
    speechEnded: () => out.ended++,
    edge: (e) => out.edges.push(`${e.channel}:${e.speaking}`),
  }, () => now);
  return { p, out, tick: (ms) => { now += ms; } };
}

const loud = (samples) => Int16Array.from({ length: samples }, (_, n) => (Math.floor(n / 18) % 2 === 0 ? 3000 : -3000));

test('speech comes out in 20 ms frames, three per chunk, whatever block size arrives', () => {
  const { p, out } = pipeline(MIC_GATE);
  p.begin();
  // 1600-sample blocks (the worklet's 100 ms) plus a ragged tail.
  p.push(loud(1600));
  p.push(loud(1600));
  p.push(loud(150));
  assert.equal(p.audioMs, 200, '3350 samples = 10 whole frames, 150 left over');
  assert.deepEqual(out.chunks.map((c) => c.length), [1920, 1920, 1920], 'nine frames sent, one waiting in the batch');
  assert.deepEqual(out.edges, ['user:true']);
});

test('a part-filled batch flushes after 100 ms, and silence sends keepalive zeros', () => {
  const { p, out, tick } = pipeline(MIC_GATE);
  p.push(loud(320));
  p.maybeFlushTimeout();
  assert.equal(out.chunks.length, 0, 'not yet');
  tick(100);
  p.maybeFlushTimeout();
  assert.deepEqual(out.chunks.map((c) => c.length), [640]);
  // Long silence: past the hangover, one zero frame every 100 ms of audio.
  const before = out.chunks.length;
  p.push(new Int16Array(320 * 100));
  p.flush();
  const frames = out.chunks.slice(before).reduce((sum, c) => sum + c.length / 640, 0);
  assert.ok(out.chunks.slice(before).every((c) => c.every((b) => b === 0)));
  // 500 ms hangover sends every frame (25), then one frame per 100 ms for the
  // remaining 1.5 s (15), not the 75 silent frames received.
  assert.equal(frames, 40);
});

test('end of speech flushes the batch, then reports speech_ended and the off edge', () => {
  const { p, out } = pipeline(MIC_GATE);
  p.begin();
  p.push(loud(320 * 4));
  p.push(new Int16Array(320 * 40)); // 800 ms > 500 ms hangover
  assert.equal(out.ended, 1);
  assert.deepEqual(out.edges, ['user:true', 'user:false']);
});

// --- The stand-in classes -----------------------------------------------------

function fakeOpener() {
  const calls = [];
  return {
    calls,
    open(kind, deviceLabel, handlers) {
      return new Promise((resolve, reject) => {
        calls.push({ kind, deviceLabel, handlers, closed: 0, resolve: (rate = 48000) => resolve({ id: `${kind}-x`, label: 'Mic', nativeRate: rate, close: () => calls.at(-1).closed++ }), reject });
      });
    },
  };
}
const flushMicrotasks = () => new Promise((r) => setImmediate(r));

test('the stand-ins have the native surface the wrappers call', () => {
  const opener = fakeOpener();
  const mic = new RendererMicCapture('Headset Microphone (Jabra)', opener);
  const sys = new RendererSystemAudioCapture('ignored', opener);
  for (const m of [mic, sys]) {
    for (const fn of ['start', 'stop', 'getSampleRate', 'getNativeSampleRate', 'getActiveBackend']) assert.equal(typeof m[fn], 'function', fn);
    assert.equal(m.getSampleRate(), 16000);
  }
  assert.equal(sys.getActiveBackend(), 'chromium-loopback');
  mic.start(() => {});
  sys.start(() => {});
  assert.deepEqual(opener.calls.map((c) => [c.kind, c.deviceLabel]), [['mic', 'Headset Microphone (Jabra)'], ['system', null]]);
  mic.stop();
  sys.stop();
});

test('audio flows to onData; a failed open reaches onData as an error, as native failures do', async () => {
  const opener = fakeOpener();
  const mic = new RendererMicCapture(null, opener);
  const got = [];
  mic.start((err, chunk) => got.push(err ? `err:${err.message}` : chunk.length));
  opener.calls[0].resolve(44100);
  await flushMicrotasks();
  assert.equal(mic.getNativeSampleRate(), 44100);
  opener.calls[0].handlers.onData(loud(960));
  assert.deepEqual(got, [1920]);
  opener.calls[0].handlers.onEnded('the capture track ended');
  assert.match(String(got.at(-1)), /^err:\[AudioFallback\] Microphone capture failed: the capture track ended/);
  assert.equal(opener.calls[0].closed, 1, 'the session is closed on failure');

  const sys = new RendererSystemAudioCapture(null, opener);
  const sysGot = [];
  sys.start((err) => sysGot.push(err?.message));
  opener.calls[1].reject(new Error('NotAllowedError: Permission denied'));
  await flushMicrotasks();
  assert.match(sysGot[0], /System audio capture failed: NotAllowedError/);
  sys.start(() => {}); // a failed monitor can be started again, as recovery does
  sys.stop();
});

test('a capture that opens after stop() is closed at once and delivers nothing', async () => {
  const opener = fakeOpener();
  const mic = new RendererMicCapture(null, opener);
  const got = [];
  mic.start((err, chunk) => got.push(err ?? chunk));
  mic.stop();
  opener.calls[0].resolve();
  await flushMicrotasks();
  assert.equal(opener.calls[0].closed, 1);
  opener.calls[0].handlers.onData(loud(960));
  opener.calls[0].handlers.onEnded('late');
  assert.deepEqual(got, []);
});

test('PCM from IPC is read as 16-bit samples, copied only when unaligned', () => {
  const buf = new Int16Array([1, -2, 3]).buffer;
  assert.deepEqual([...toInt16(buf)], [1, -2, 3]);
  assert.deepEqual([...toInt16(new Uint8Array(buf))], [1, -2, 3]);
  const odd = new Uint8Array(7);
  odd.set(new Uint8Array(buf), 1);
  assert.deepEqual([...toInt16(odd.subarray(1))], [1, -2, 3]);
  assert.equal(toInt16('nope'), null);
});

// --- Wiring -------------------------------------------------------------------

test('both wrappers choose the stand-in through the policy, and the page ships', () => {
  const mic = read('electron/audio/MicrophoneCapture.ts');
  const sys = read('electron/audio/SystemAudioCapture.ts');
  assert.match(mic, /rendererCaptureFallbackActive\(!!NativeModule\?\.MicrophoneCapture\)[\s\S]{0,300}RendererMicCapture[\s\S]{0,40}: NativeModule\?\.MicrophoneCapture;/);
  assert.match(sys, /rendererCaptureFallbackActive\(!!NativeModule\?\.SystemAudioCapture\)[\s\S]{0,300}RendererSystemAudioCapture[\s\S]{0,40}: NativeModule\?\.SystemAudioCapture;/);
  assert.match(read('scripts/build-electron.js'), /from: 'electron\/audio\/fallback\/capture\.html', to: 'electron\/audio\/fallback\/capture\.html'/);
  assert.match(read('electron/main.ts'), /require\('\.\/audio\/fallback\/captureHost'\)\.disposeCaptureHost\(\)/);
});

test('the capture window is locked to its own partition and grants media to itself only', () => {
  const host = read('electron/audio/fallback/captureHost.ts');
  assert.match(host, /partition: PARTITION/);
  assert.match(host, /sandbox: true/);
  assert.match(host, /contextIsolation: true/);
  assert.match(host, /nodeIntegration: false/);
  assert.match(host, /show: false/);
  assert.match(host, /skipTaskbar: true/);
  assert.match(host, /session\.fromPartition\(PARTITION\)/);
  assert.match(host, /const allow = ours\(wc\) && \(permission === 'media' \|\| permission === 'display-capture'\)/);
  assert.match(host, /callback\(\{ video: source, audio: 'loopback' \}\)/);
  const preload = read('electron/audio/fallback/captureWindowPreload.ts');
  assert.deepEqual([...preload.matchAll(/from '([^']+)'/g)].map((m) => m[1]), ['electron', './captureChannels'], 'sandboxed preload imports');
  const page = read('electron/audio/fallback/capture.html');
  assert.match(page, /echoCancellation: false, noiseSuppression: false, autoGainControl: false/);
  assert.match(page, /new AudioContext\(\{ sampleRate: 16000/);
  assert.match(page, /readyState === 'ended'/, 'a dead loopback track is an error, not silence');
});
