// F-103 repro: a default-output route change observed during an in-flight
// system-audio recovery is swallowed PERMANENTLY.
//
// The watcher tick (main.ts startDefaultOutputWatcher) advances
// _lastObservedDefaultOutputId BEFORE calling handleDefaultOutputChanged();
// the handler's recovery-mutex bail (the only bail reachable from a passing
// tick — the other three re-check conditions the tick already checked
// synchronously) then does no work. The next tick sees
// currentId === _lastObservedDefaultOutputId and never re-fires — despite the
// in-code comment claiming "the watcher's setInterval will re-fire and pick
// up the route change once recovery's instance is in place."
//
// Simulation (no real devices, no audio, no meeting): drive the LIVE AppState
// singleton via process.mainModule.exports. Fake meeting-active state, point
// _lastObservedDefaultOutputId at a fake "old" device so the real default
// registers as a route change, hold _systemAudioRecoveryInProgress through one
// tick, then release it. A spy wrapper counts handler invocations and lets
// only the FIRST call through (which bails on the recovery mutex — before any
// capture work — so no audio is ever touched, pre- or post-fix).
//
// Expected (correct): handler re-fires after recovery clears → calls >= 2 → exit 0.
// Bug (F-103): calls stays 1, observation already advanced → exit 1.
// Inconclusive: watcher never ticked → exit 2.
//
// Run: node scripts/audit/F-103-repro.mjs
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';

// Bare-file launches (electron dist-electron/electron/main.js) put
// app.getAppPath() at dist-electron/electron, so nativeModuleLoader's dev
// candidates miss the repo's native-module/. Symlink it into place (dist
// output, gitignored) so the watcher's native dependency resolves while we
// keep the isolated "Electron" scratch userData profile.
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
const stdio = [];
app.process().stdout?.on('data', (d) => stdio.push(d.toString()));
app.process().stderr?.on('data', (d) => stdio.push(d.toString()));

await app.firstWindow({ timeout: 30_000 }).catch(() => null);

// Stash the app bundle's live exports IMMEDIATELY: the main.js require-cache
// entry is present right after boot but something (Playwright's electron
// loader) prunes it within a few seconds — a later scan comes up empty.
await app.evaluate(() => {
  const Module = process.mainModule.constructor;
  const key = Object.keys(Module._cache).find((k) => k.includes('dist-electron') && k.endsWith('main.js'));
  if (key) globalThis.__auditMainExports = Module._cache[key].exports;
});
await new Promise((r) => setTimeout(r, 5_000));

const setup = await app.evaluate(() => {
  const exp = globalThis.__auditMainExports ?? {};
  const AppState = exp.AppState;
  if (!AppState?.getInstance) {
    return { ok: false, expKeys: Object.keys(exp).slice(0, 10) };
  }
  const s = AppState.getInstance();

  // Spy: count invocations; only the first call runs the real handler (it
  // bails on the recovery mutex before touching any capture state).
  const orig = s.handleDefaultOutputChanged;
  globalThis.__f103 = { calls: 0, s, orig };
  s.handleDefaultOutputChanged = async function (...a) {
    globalThis.__f103.calls += 1;
    if (globalThis.__f103.calls === 1) return orig.apply(this, a);
    return undefined;
  };

  s.isMeetingActive = true;                       // watcher tick guard
  s.systemAudioCapture = s.systemAudioCapture || {}; // watcher tick guard (truthy)
  s._lastRequestedOutputDeviceId = null;          // "on default route"
  s._defaultOutputSwitchInProgress = false;
  s._systemAudioRecoveryInProgress = true;        // the in-flight recovery
  s.startDefaultOutputWatcher();                  // (re)start; reads REAL default id
  const realId = s._lastObservedDefaultOutputId;
  s._lastObservedDefaultOutputId = 'AUDIT-FAKE-OLD-DEVICE'; // simulate a route change
  return { ok: true, realId };
});
console.log('[F-103] setup:', JSON.stringify(setup));
if (!setup.ok) {
  console.error('[F-103] Inconclusive: AppState not reachable from main-module exports.');
  app.process().kill('SIGKILL');
  process.exit(2);
}

// One tick (4s interval) with recovery held.
await new Promise((r) => setTimeout(r, 5_500));
const mid = await app.evaluate(() => ({
  calls: globalThis.__f103.calls,
  lastObserved: globalThis.__f103.s._lastObservedDefaultOutputId,
}));
console.log('[F-103] after tick with recovery in flight:', JSON.stringify(mid));
if (mid.calls === 0) {
  console.error('[F-103] Inconclusive: watcher never ticked (guards not satisfied).');
  const relevant = stdio.join('').split('\n').filter((l) =>
    /DefaultOutputWatcher|nativeModuleLoader|native-module/i.test(l)
  );
  console.error('[F-103] relevant app output:\n' + relevant.slice(-15).join('\n'));
  app.process().kill('SIGKILL');
  process.exit(2);
}

// Recovery completes; give the watcher 2+ ticks to (ideally) re-fire.
await app.evaluate(() => { globalThis.__f103.s._systemAudioRecoveryInProgress = false; });
await new Promise((r) => setTimeout(r, 9_500));

const fin = await app.evaluate(() => {
  const st = globalThis.__f103;
  const out = { calls: st.calls, lastObserved: st.s._lastObservedDefaultOutputId };
  // Cleanup: restore real handler and quiescent state.
  st.s.handleDefaultOutputChanged = st.orig;
  st.s.isMeetingActive = false;
  if (st.s.systemAudioCapture && typeof st.s.systemAudioCapture.destroy !== 'function') {
    st.s.systemAudioCapture = null; // remove our dummy only
  }
  st.s._systemAudioRecoveryInProgress = false;
  st.s.stopDefaultOutputWatcherForShutdown();
  return out;
});
console.log('[F-103] final:', JSON.stringify(fin));
app.process().kill('SIGKILL');

if (fin.calls >= 2) {
  console.log('[F-103] PASS: route change retried after recovery cleared.');
  process.exit(0);
}
console.error(
  `[F-103] FAIL: handler fired once (bailed on recovery mutex), observation already advanced to ${JSON.stringify(fin.lastObserved)} — route change swallowed forever (F-103 reproduced).`
);
process.exit(1);
