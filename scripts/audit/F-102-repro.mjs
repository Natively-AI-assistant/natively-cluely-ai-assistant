// F-102 repro: concurrent capture-rebuild flows orphan a live SystemAudioCapture
// that keeps writing into the live STT socket.
//
// The three rebuild flows guard each other only pairwise: recovery defers to
// route-change (main.ts:4662) and route-change defers to recovery (:4868), but
// restartCapturesAfterResume takes no mutex, clears both flags (:3916/:3923),
// and NO flow re-validates field ownership after its awaits before assigning.
// Interleaving: route-change nulls the field and suspends on
// resolveMacScreenCaptureCapability; resume runs in the same turn (field null →
// skips destroy), suspends on its own capability call; route-change resumes,
// constructs fresh#1, assigns, wires, starts; resume then constructs fresh#2
// and OVERWRITES the field — fresh#1 is orphaned: started, wired, never
// destroyed, still pumping PCM into this.googleSTT (the data write at :3487 has
// no instance-identity guard, unlike the watchdog :3424 and rate-lock :3475).
//
// Simulation: live AppState, fake meeting flags, STT stubs (no network), a
// stub old capture in the field, recovery saturated (attempts=3) so start
// errors can't trigger extra rebuilds. The two flows are fired in one
// synchronous turn. Fresh captures are REAL SystemAudioCapture instances (the
// isolated scratch profile + TCC bypass env); everything tracked is destroyed
// in cleanup.
//
// Expected (correct): every wired capture except the current field is
// destroyed by the flows themselves → orphans=0 → exit 0.
// Bug (F-102): one wired, never-destroyed capture is not the field → exit 1.
// Inconclusive (no capture ever constructed — capability denied): exit 2.
//
// Run: node scripts/audit/F-102-repro.mjs
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

  const st = { wired: [], destroyedIdx: new Set(), sttWrites: 0 };
  globalThis.__f102 = st;

  const origWire = s.wireSystemCapture;
  s.wireSystemCapture = function (capture, label) {
    const idx = st.wired.length;
    st.wired.push({ capture, label });
    const origDestroy = capture.destroy?.bind(capture);
    capture.destroy = async function (...a) {
      st.destroyedIdx.add(idx);
      return origDestroy?.(...a);
    };
    return origWire.call(this, capture, label);
  };

  const sttStub = () => ({
    write: () => { st.sttWrites += 1; },
    setSampleRate() {}, setAudioChannelCount() {}, notifySpeechEnded() {},
    stop() {}, removeAllListeners() {}, start() {},
  });

  s.isMeetingActive = true;
  s._isQuitting = false;
  s._lastRequestedOutputDeviceId = null;
  s._lastRequestedInputDeviceId = undefined;
  s._defaultOutputSwitchInProgress = false;
  s._systemAudioRecoveryInProgress = false;
  s._systemAudioRecoveryAttempts = 3; // saturate: recovery bails immediately
  s._micRecoveryAttempts = 3;
  s.googleSTT = sttStub();
  s.googleSTT_User = sttStub();
  s.systemAudioCapture = { __stub: true, destroy: async () => {} };
  s.microphoneCapture = null;

  // Fire both rebuild flows in ONE synchronous turn.
  const p1 = s.handleDefaultOutputChanged('AUDIT-NEW-ROUTE').catch((e) => `route-change threw: ${e}`);
  const p2 = s.restartCapturesAfterResume().catch((e) => `resume threw: ${e}`);
  const settled = await Promise.all([p1, p2]);
  await new Promise((r) => setTimeout(r, 1_500));

  const field = s.systemAudioCapture;
  const alive = st.wired
    .map((w, i) => ({ label: w.label, i, isField: w.capture === field, destroyed: st.destroyedIdx.has(i) }))
    .filter((w) => !w.destroyed);
  const orphans = alive.filter((w) => !w.isField);

  // Cleanup: destroy everything we wired plus whatever sits in the fields.
  for (const w of st.wired) { try { await w.capture.destroy(); } catch { /* already down */ } }
  try { await s.microphoneCapture?.destroy?.(); } catch { /* best-effort */ }
  s.systemAudioCapture = null;
  s.microphoneCapture = null;
  s.googleSTT = null;
  s.googleSTT_User = null;
  s.isMeetingActive = false;
  s.wireSystemCapture = origWire;

  return {
    settled,
    wired: st.wired.map((w, i) => ({ label: w.label, destroyed: st.destroyedIdx.has(i) })),
    aliveCount: alive.length,
    orphanCount: orphans.length,
    orphanLabels: orphans.map((o) => o.label),
    fieldWasWired: st.wired.some((w) => w.capture === field),
  };
});
console.log('[F-102] result:', JSON.stringify(result, null, 2));
app.process().kill('SIGKILL');

if (result.inconclusive || (result.wired?.length ?? 0) === 0) {
  console.error('[F-102] Inconclusive:', result.inconclusive ?? 'no capture was ever constructed (capability denied?)');
  process.exit(2);
}
if (result.orphanCount > 0) {
  console.error(`[F-102] FAIL: ${result.orphanCount} wired, started, never-destroyed capture(s) lost the field but were never torn down (${result.orphanLabels.join(', ')}) — orphaned tap double-writing STT (F-102 reproduced).`);
  process.exit(1);
}
console.log('[F-102] PASS: no orphaned capture after concurrent rebuild flows.');
process.exit(0);
