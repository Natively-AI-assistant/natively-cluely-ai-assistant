// F-107 repro: an absent/wrong-arch native audio module boots into a silent
// no-op meeting.
//
// When loadNativeModule() returns null (missing binary, wrong arch, packaging
// regression, early-boot cache poisoning), both capture wrappers'
// constructors only console.error, and both start() methods return WITHOUT
// emitting 'error' OR 'start' — so no banner fires, the stuck watchdog never
// arms (it arms on 'start'), device lists are empty, and the meeting reports
// "started successfully" with zero transcript and zero UI signal. The boot
// arch gate covers only better-sqlite3 + keytar.
//
// Live repro: bare-file launch WITHOUT the dist native-module symlink — the
// loader misses every candidate (the exact silent-null state observed during
// F-103's investigation). Spy sendAudioCaptureFailed, run the real
// startMeeting(), and look for any native-unavailable channel banner.
//
// Expected (correct): terminal mic AND system banners mentioning the native
// audio engine → exit 0. Bug (F-107): no such banners → exit 1.
//
// Run: node scripts/audit/F-107-repro.mjs
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';

// Ensure the loader CANNOT find the native module in this launch mode.
try { fs.unlinkSync('dist-electron/electron/native-module'); } catch { /* absent already */ }

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
await new Promise((r) => setTimeout(r, 3_000));

const result = await app.evaluate(async () => {
  const { AppState } = globalThis.__auditMainExports ?? {};
  if (!AppState?.getInstance) return { inconclusive: 'AppState unreachable' };
  const s = AppState.getInstance();

  const st = { banners: [] };
  const origBanner = s.sendAudioCaptureFailed;
  s.sendAudioCaptureFailed = function (payload) {
    st.banners.push({ channel: payload?.channel, terminal: payload?.terminal, message: String(payload?.message ?? '').slice(0, 100) });
    return origBanner.call(this, payload);
  };

  let startErr = null;
  try { await s.startMeeting({}); } catch (e) { startErr = String(e).slice(0, 160); }
  await new Promise((r) => setTimeout(r, 4_000));

  const out = {
    startErr,
    banners: st.banners,
    nativeBanner: st.banners.filter((b) => /native audio engine/i.test(b.message)),
  };
  try { await s.endMeeting(); } catch { /* best-effort */ }
  s.sendAudioCaptureFailed = origBanner;
  return out;
});
console.log('[F-107] result:', JSON.stringify(result));
app.process().kill('SIGKILL');

if (result.inconclusive) {
  console.error('[F-107] Inconclusive:', result.inconclusive);
  process.exit(2);
}
const channels = new Set(result.nativeBanner.map((b) => b.channel));
if (channels.has('mic') && channels.has('system')) {
  console.log('[F-107] PASS: both channels surfaced a native-audio-engine-unavailable banner.');
  process.exit(0);
}
console.error('[F-107] FAIL: no native-unavailable banner on', ['mic', 'system'].filter((c) => !channels.has(c)).join('+'), '— the meeting runs silently dead (F-107 reproduced).');
process.exit(1);
