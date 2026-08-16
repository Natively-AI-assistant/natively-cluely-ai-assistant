// F-105 repro: a MicrophoneCapture.start() throw at meeting start kills the
// system-audio channel too.
//
// MicrophoneCapture.start() rethrows by design (construction is lazy — the
// native open happens inside start()). The meeting-start audio block runs a
// bare sequence: mic.start(); userSTT.start(); system.start(); sysSTT.start();
// then live indexing and the route watcher. A mic throw skips ALL of it and
// lands in the generic catch — the system capture is wired but never started,
// so it emits no 'start', the stuck watchdog never arms, and the meeting runs
// with BOTH channels dead behind one generic 'meeting-audio-error' broadcast.
// Same bare shape in reconfigureAudio and _doReconfigureSttProvider; the HFP
// auto-switch additionally swallows the rejection into console.warn.
//
// Live repro: real app (isolated scratch profile), real startMeeting() path.
// The wire interceptors force the mic start to throw and record (without
// running) the system start; spies record the banners.
//
// Expected (correct): system channel starts, route watcher arms, and a
// channel:'mic' terminal banner is sent → exit 0.
// Bug (F-105): system start never called, watcher never armed, only the
// generic meeting-audio-error broadcast → exit 1.
//
// Run: node scripts/audit/F-105-repro.mjs
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
const stdio = [];
app.process().stdout?.on('data', (d) => stdio.push(d.toString()));
app.process().stderr?.on('data', (d) => stdio.push(d.toString()));
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

  const st = { systemStartCalls: 0, micStartAttempts: 0, banners: [], broadcasts: [] };
  globalThis.__f105 = st;

  const origWireMic = s.wireMicCapture;
  s.wireMicCapture = function (capture, label) {
    capture.start = () => {
      st.micStartAttempts += 1;
      throw new Error('AUDIT-FORCED-MIC-FAIL');
    };
    return origWireMic.call(this, capture, label);
  };
  const origWireSys = s.wireSystemCapture;
  s.wireSystemCapture = function (capture, label) {
    capture.start = () => { st.systemStartCalls += 1; }; // record; no real tap
    return origWireSys.call(this, capture, label);
  };
  const origBanner = s.sendAudioCaptureFailed;
  s.sendAudioCaptureFailed = function (payload) {
    st.banners.push({ channel: payload?.channel, terminal: payload?.terminal, message: String(payload?.message ?? '').slice(0, 90) });
    return origBanner.call(this, payload);
  };
  const origBroadcast = s.broadcast;
  s.broadcast = function (channel, ...a) {
    st.broadcasts.push(channel);
    return origBroadcast.call(this, channel, ...a);
  };

  let startErr = null;
  try {
    await s.startMeeting({});
  } catch (e) {
    startErr = String(e).slice(0, 200);
  }
  // Audio init runs in a deferred IIFE — give it time to settle.
  await new Promise((r) => setTimeout(r, 4_000));

  const out = {
    startErr,
    micStartAttempts: st.micStartAttempts,
    systemStartCalls: st.systemStartCalls,
    watcherArmed: !!s._defaultOutputWatcherInterval,
    micBanner: st.banners.some((b) => b.channel === 'mic' && /failed to start/i.test(b.message)),
    banners: st.banners,
    genericAudioError: st.broadcasts.includes('meeting-audio-error'),
  };

  // Cleanup: end the meeting and restore patches.
  try { await s.endMeeting(); } catch { /* best-effort */ }
  s.wireMicCapture = origWireMic;
  s.wireSystemCapture = origWireSys;
  s.sendAudioCaptureFailed = origBanner;
  s.broadcast = origBroadcast;
  return out;
});
console.log('[F-105] result:', JSON.stringify(result));
app.process().kill('SIGKILL');

if (result.inconclusive) {
  console.error('[F-105] Inconclusive:', result.inconclusive);
  process.exit(2);
}
if (result.micStartAttempts === 0) {
  console.error('[F-105] Inconclusive: the meeting never attempted a mic start (permission gate or ambient mode?). startErr:', result.startErr);
  process.exit(2);
}
if (result.systemStartCalls > 0 && result.watcherArmed && result.micBanner) {
  console.log('[F-105] PASS: mic failure was isolated — system channel started, watcher armed, mic banner surfaced.');
  process.exit(0);
}
console.error('[F-105] FAIL: mic start threw and took the meeting down with it — systemStartCalls=' +
  `${result.systemStartCalls}, watcherArmed=${result.watcherArmed}, micBanner=${result.micBanner}, genericAudioError=${result.genericAudioError} (F-105 reproduced).`);
process.exit(1);
