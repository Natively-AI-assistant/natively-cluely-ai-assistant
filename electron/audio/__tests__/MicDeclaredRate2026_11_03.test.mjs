/**
 * The microphone must declare to STT the rate it really emits (2026-11-03).
 *
 * User log 2026-11-01 (Windows 2.9.2, ElevenLabs, Auto): English through the
 * Speak button came back as "И-и-и, ё-ё-ё, алло!". Live ElevenLabs runs ruled
 * out language locking, accent, noise, -14 dB and 35 % dropped audio (all came
 * back English) and reproduced Cyrillic nonsense only with PCM sent at a rate
 * other than the declared one (48 kHz declared as 16 kHz → "Ага.").
 *
 *  1. Native: when the mic resampler fails to build, the DSP thread passes PCM
 *     through at the device rate. SystemAudioCapture then published that rate;
 *     MicrophoneCapture kept saying 16000. Both threads must now publish it.
 *  2. The debug log names the declared rate, the device rate and the channel
 *     count, which the native module printed only to stdout.
 *
 * No platform branch: lib.rs's capture threads and this log are shared by
 * macOS and Windows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const libRs = readFileSync(path.join(repo, 'native-module/src/lib.rs'), 'utf8');
const mainTs = readFileSync(path.join(repo, 'electron/main.ts'), 'utf8');
const { describeMicRate, CANONICAL_MIC_STT_RATE } = await import(
  pathToFileURL(path.join(repo, 'dist-electron/electron/audio/micRateDiagnostics.js')).href
);

/** The body of `impl <name> { ... }`'s start(): from `pub fn start(` to the DSP loop. */
function threadSetup(structName) {
  const implAt = libRs.indexOf(`impl ${structName} {`);
  assert.ok(implAt > 0, `impl ${structName} not found`);
  const startAt = libRs.indexOf('pub fn start(', implAt);
  const loopAt = libRs.indexOf('loop {', startAt);
  assert.ok(startAt > implAt && loopAt > startAt, `${structName}.start() DSP loop not found`);
  return libRs.slice(startAt, loopAt);
}

for (const structName of ['SystemAudioCapture', 'MicrophoneCapture']) {
  test(`${structName}: the DSP thread publishes the rate it really emits`, () => {
    const setup = threadSetup(structName);
    const decide = setup.indexOf('let emitted_rate = if resampler.is_some() { CANONICAL_STT_RATE } else { native_rate };');
    const publish = setup.indexOf('sample_rate_shared.store(emitted_rate, Ordering::Release);');
    assert.ok(decide > 0, 'the emitted rate must follow whether the resampler was built');
    assert.ok(publish > decide, 'the emitted rate must be stored where get_sample_rate() reads it, after it is decided');
    assert.ok(/let sample_rate_shared = self\.sample_rate\.clone\(\);/.test(setup), 'the thread must hold the same atomic get_sample_rate() reads');
  });
}

test('MicrophoneCapture exposes the device channel count', () => {
  assert.ok(/pub fn get_channel_count\(&self\) -> u32/.test(libRs));
  const dts = readFileSync(path.join(repo, 'native-module/index.d.ts'), 'utf8');
  assert.ok(/getChannelCount\(\): number/.test(dts), 'index.d.ts must declare getChannelCount');
});

test('describeMicRate: the usual resampled mic', () => {
  const r = describeMicRate({ emittedRate: 16000, nativeRate: 48000, channels: 2 });
  assert.equal(r.unusual, false);
  assert.equal(r.line, 'Mic format: declared 16000Hz, device 48000Hz, 2 ch, resampled');
});

test('describeMicRate: a resampler that failed (passthrough at the device rate) is flagged', () => {
  const r = describeMicRate({ emittedRate: 48000, nativeRate: 48000, channels: 4 });
  assert.equal(r.unusual, true);
  assert.match(r.line, /declared 48000Hz, device 48000Hz, 4 ch, not resampled/);
  assert.match(r.line, /not the usual 16000Hz/);
});

test('describeMicRate: a 16 kHz device, and unknowns from an older native build or the Chromium fallback', () => {
  assert.equal(describeMicRate({ emittedRate: 16000, nativeRate: 16000, channels: 1 }).line,
    'Mic format: declared 16000Hz, device 16000Hz, 1 ch, not resampled');
  const unknown = describeMicRate({ emittedRate: 16000, nativeRate: 0, channels: 0, backend: 'chromium' });
  assert.equal(unknown.line, 'Mic format: declared 16000Hz, device unknown, unknown ch, backend chromium, not resampled');
  assert.equal(unknown.unusual, false);
  assert.equal(CANONICAL_MIC_STT_RATE, 16000);
});

test('main logs the mic format where it locks the user STT rate', () => {
  const lock = mainTs.indexOf('User STT rate locked from first mic chunk');
  const log = mainTs.indexOf('describeMicRate({', lock);
  assert.ok(lock > 0 && log > lock && log - lock < 800, 'the format line must sit next to the rate lock');
  assert.ok(/getChannelCount\(\)/.test(mainTs.slice(log, log + 300)));
});

test('the MicrophoneCapture wrapper reads the channel count and falls back to 0', async () => {
  const origLoad = Module._load;
  Module._load = function patchedLoad(request) {
    if (request === 'electron') return { app: { getAppPath: () => '/tmp/fake-natively-app', isPackaged: false, isReady: () => false } };
    return origLoad.apply(this, arguments);
  };
  try {
    const { MicrophoneCapture } = await import(pathToFileURL(path.join(repo, 'dist-electron/electron/audio/MicrophoneCapture.js')).href);
    const cap = Object.create(MicrophoneCapture.prototype);
    cap.monitor = { getChannelCount: () => 4 };
    assert.equal(cap.getChannelCount(), 4);
    cap.monitor = {};                       // older native build / Chromium fallback
    assert.equal(cap.getChannelCount(), 0);
    cap.monitor = null;
    assert.equal(cap.getChannelCount(), 0);
  } finally {
    Module._load = origLoad;
  }
});
