// F-104 repro: recovery / route-change rebuild flows fire the old capture's
// destroy() WITHOUT awaiting it, so the fresh capture's start() executes
// BEFORE the dying monitor's deferred native stop.
//
// SystemAudioCapture.stop() defers the blocking native monitor.stop() via
// setImmediate (macrotask). On the warm-TCC-cache / dev-bypass paths,
// resolveMacScreenCaptureCapability resolves without leaving the microtask
// queue — and microtasks drain before the check phase. Net effect in
// handleDefaultOutputChanged (and the recovery flow): fresh.start() acquires
// the CoreAudio tap while the dying instance still holds its HAL resources —
// the exact collision the repo documents as "0 chunks in 8s" / HAL
// property-listener deadlock (SystemAudioCapture.ts:170-180, main.ts endMeeting
// comment). Every OTHER teardown site awaits destroy for this reason.
//
// This repro asserts the ORDERING invariant deterministically, with no real
// native resources: captures are real JS wrappers, but start() is suppressed
// by the wire interceptor and the old capture's monitor is a fake whose stop()
// records a mark. The route-change flow is driven twice: once to obtain a real
// SystemAudioCapture instance for the field, then the measured run.
//
// Expected (correct): old capture's native stop completes BEFORE the fresh
// start → exit 0. Bug (F-104): fresh.start records first → exit 1.
//
// Run: node scripts/audit/F-104-repro.mjs
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';

try {
  fs.symlinkSync('../../native-module', 'dist-electron/electron/native-module', 'dir');
} catch (e) {
  if (e.code !== 'EEXIST') throw e;
}

const app = await electron.launch({
  args: ['dist-electron/electron/main.js'],
  env: { ...process.env, NODE_ENV: 'production', NATIVELY_DEV_BYPASS_SCREEN_TCC: '1' },
  timeout: 60_000,
});
await app.firstWindow({ timeout: 30_000 }).catch(() => null);
await app.evaluate(() => {
  const Module = process.mainModule.constructor;
  const key = Object.keys(Module._cache).find((k) => k.includes('dist-electron') && k.endsWith('main.js'));
  if (key) globalThis.__auditMainExports = Module._cache[key].exports;
});
await new Promise((r) => setTimeout(r, 4_000));

const result = await app.evaluate(async () => {
  const { AppState } = globalThis.__auditMainExports ?? {};
  if (!AppState?.getInstance) return { inconclusive: 'AppState unreachable' };
  const s = AppState.getInstance();

  const marks = [];
  const wired = [];
  const origWire = s.wireSystemCapture;
  s.wireSystemCapture = function (capture, label) {
    wired.push(capture);
    // Suppress the real native start — record the moment the flow would have
    // acquired the tap. This is the exact point of HAL contention.
    capture.start = () => { marks.push('fresh.start'); };
    return origWire.call(this, capture, label);
  };

  const sttStub = () => ({
    write() {}, setSampleRate() {}, setAudioChannelCount() {}, notifySpeechEnded() {},
    stop() {}, removeAllListeners() {}, start() {},
  });
  s.isMeetingActive = true;
  s._isQuitting = false;
  s._lastRequestedOutputDeviceId = null;
  s._defaultOutputSwitchInProgress = false;
  s._systemAudioRecoveryInProgress = false;
  s._systemAudioRecoveryAttempts = 3;
  s._micRecoveryAttempts = 3;
  s.googleSTT = sttStub();
  s.googleSTT_User = sttStub();

  // Run 1 — obtain a REAL SystemAudioCapture wrapper in the field.
  s.systemAudioCapture = { destroy: async () => {} };
  await s.handleDefaultOutputChanged('AUDIT-ROUTE-1');
  const old = s.systemAudioCapture;
  if (!old || !wired.includes(old)) {
    return { inconclusive: 'warmup did not install a real capture', wiredCount: wired.length };
  }

  // Doctor the real instance so its REAL stop() runs the REAL setImmediate
  // deferral against a fake native monitor that records the release moment.
  old.isRecording = true;
  old.monitor = { stop: () => { marks.push('old.nativeStop'); } };

  // Run 2 — the measured interleaving.
  await s.handleDefaultOutputChanged('AUDIT-ROUTE-2');
  // Let any still-pending setImmediate drain.
  await new Promise((r) => setTimeout(r, 300));

  // Cleanup.
  for (const c of wired) { try { await c.destroy(); } catch { /* down */ } }
  s.systemAudioCapture = null;
  s.googleSTT = null;
  s.googleSTT_User = null;
  s.isMeetingActive = false;
  s.wireSystemCapture = origWire;

  return { marks, wiredCount: wired.length };
});
console.log('[F-104] result:', JSON.stringify(result));
app.process().kill('SIGKILL');

if (result.inconclusive) {
  console.error('[F-104] Inconclusive:', result.inconclusive);
  process.exit(2);
}
const stopIdx = result.marks.indexOf('old.nativeStop');
const startIdx = result.marks.lastIndexOf('fresh.start');
if (stopIdx === -1 || startIdx === -1) {
  console.error('[F-104] Inconclusive: expected both marks, got', result.marks);
  process.exit(2);
}
if (startIdx < stopIdx) {
  console.error('[F-104] FAIL: fresh.start ran BEFORE the dying monitor released its native handles — HAL-lock collision window (F-104 reproduced). Marks:', result.marks.join(' → '));
  process.exit(1);
}
console.log('[F-104] PASS: dying monitor released native handles before the fresh capture started. Marks:', result.marks.join(' → '));
process.exit(0);
