// F-106 repro: MicrophoneCapture leaks an open native handle when start()
// fails after construction.
//
// MicrophoneStream::new opens the cpal input device at CONSTRUCTION
// (native-module/src/microphone.rs — build_input_stream; the wrapper's own
// lazy-init comment documents that construction alone lights the macOS
// orange mic indicator). When monitor.start() then throws (WASAPI play()
// failure, device pulled between construct and play, exclusive-mode steal),
// the wrapper's catch rethrows with this.monitor still set — and every
// subsequent stop()/destroy() early-returns on !isRecording, dropping the
// open stream without ever calling monitor.stop(). SystemAudioCapture has an
// explicit ORPHAN-HANDLE FIX for exactly this; the mic wrapper never got it.
// Concrete reachable site: the Settings > Audio test retry path constructs,
// fails, nulls the wrapper — the device stays held against the retry.
//
// Harness: same fake-native-module injection the repo's audio tests use
// (CaptureStopAwaitable / CaptureRestartRegression), against the dist bundle.
//
// Expected (correct): the failed-start monitor's stop() runs (deferred is
// fine) before/at stop()/destroy() → exit 0.
// Bug (F-106): stopCalls stays 0 — open device handle orphaned → exit 1.
//
// Run: node scripts/audit/F-106-repro.mjs   (requires npm run build:electron)
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../dist-electron/electron/audio');

const created = [];
const fakeNativeModule = {
  getHardwareId: () => 'fake',
  verifyGumroadKey: async () => 'fake',
  getInputDevices: () => [],
  getOutputDevices: () => [],
  SystemAudioCapture: function () { return { start() {}, stop() {}, getSampleRate: () => 16000 }; },
  MicrophoneCapture: function (_d) {
    const inst = {
      stopCalls: 0,
      start() { throw new Error('AUDIT-FORCED-NATIVE-START-FAIL'); },
      stop() { this.stopCalls += 1; },
      getSampleRate: () => 16000,
      getNativeSampleRate: () => 48000,
    };
    created.push(inst);
    return inst;
  },
};

const origLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return { app: { getAppPath: () => '/tmp/fake', isPackaged: false, isReady: () => false } };
  }
  if (request.endsWith('.node') || request.includes('native-module')) {
    return fakeNativeModule;
  }
  return origLoad.apply(this, arguments);
};

const { MicrophoneCapture } = await import(path.join(distRoot, 'MicrophoneCapture.js'));

const cap = new MicrophoneCapture('audit-test-mic');
cap.on('error', () => {}); // expected — keep the emitter from throwing

let threw = false;
try {
  cap.start();
} catch {
  threw = true;
}
if (!threw || created.length !== 1) {
  console.error('[F-106] Inconclusive: start did not construct+throw as expected', { threw, created: created.length });
  process.exit(2);
}

// The failure paths a caller actually takes:
await cap.stop();
await cap.destroy();
// Let any deferred (setImmediate) orphan-stop run.
await new Promise((r) => setImmediate(() => setImmediate(r)));

const stopCalls = created[0].stopCalls;
console.log('[F-106] native stopCalls after failed start + stop() + destroy():', stopCalls);
if (stopCalls === 0) {
  console.error('[F-106] FAIL: the constructed native stream was never stopped — open mic device handle orphaned until GC (F-106 reproduced).');
  process.exit(1);
}
console.log('[F-106] PASS: failed-start monitor was stopped deterministically.');
process.exit(0);
