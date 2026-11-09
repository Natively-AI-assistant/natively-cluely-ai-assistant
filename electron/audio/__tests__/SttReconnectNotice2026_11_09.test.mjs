// "Transcription Reconnecting" only for an outage that lasts, cleared on
// reconnect, and never for a local model that is only slow (2026-11-09).
//
//  O3  main sent `reconnecting` on the first retryable error, and NativelyPro
//      raises one per WebSocket error: a socket back a second later flashed the
//      banner over a live call. Now it waits 5 s (sttReconnectNotice.mjs), or
//      shows at once on NativelyPro's persistent-reconnect.
//  O4  LocalWhisperSTT's `local_stt_behind` (at most every 30 s) was counted as
//      a reconnect: the banner flapped, and five of them read "Transcription
//      Stopped" over a transcript still arriving. It is its own notice now.
//  O5  only a final transcript cleared "reconnecting" for every provider but
//      NativelyPro. The streaming providers emit 'connected' when their session
//      is ready, and main maps it to awaiting-audio.
//
// Platform-neutral: the same main-process code runs on macOS and Windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SttReconnectNotice, STT_RECONNECT_NOTICE_DELAY_MS } from '../sttReconnectNotice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(here, rel), 'utf8');
const main = read('../../main.ts');

function fakeClock() {
  let now = 0;
  const timers = new Map();
  let id = 0;
  return {
    setTimer: (fn, ms) => { const h = ++id; timers.set(h, { at: now + ms, fn }); return h; },
    clearTimer: (h) => { timers.delete(h); },
    advance(ms) {
      now += ms;
      for (const [h, t] of [...timers]) if (t.at <= now) { timers.delete(h); t.fn(); }
    },
    get pending() { return timers.size; },
  };
}

function rig(opts = {}) {
  const clock = fakeClock();
  const shown = [];
  const notice = new SttReconnectNotice({
    show: (p) => { if (opts.decline?.()) return false; shown.push(p); },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, shown, notice };
}

test('the wait is 5 seconds', () => {
  assert.equal(STT_RECONNECT_NOTICE_DELAY_MS, 5_000);
});

test('a drop that recovers within the wait is never shown', () => {
  const { clock, shown, notice } = rig();
  notice.retrying({ attempt: 1 });
  clock.advance(1_500);
  assert.equal(notice.settle(), false, 'nothing had been shown');
  clock.advance(10_000);
  assert.deepEqual(shown, []);
  assert.equal(clock.pending, 0, 'the timer was cancelled');
});

test('an outage that lasts is shown once, with what the latest error said', () => {
  const { clock, shown, notice } = rig();
  notice.retrying({ attempt: 1 });
  clock.advance(2_000);
  notice.retrying({ attempt: 2 }); // inside the wait: only updates the text
  clock.advance(2_999);
  assert.deepEqual(shown, []);
  clock.advance(1);
  assert.deepEqual(shown, [{ attempt: 2 }]);
  assert.equal(notice.showing, true);
  // Showing: a later error refreshes the attempt count at once.
  notice.retrying({ attempt: 3 });
  assert.deepEqual(shown.at(-1), { attempt: 3 });
  // The recovery reports that it had been shown, so main announces it.
  assert.equal(notice.settle(), true);
  assert.equal(notice.showing, false);
});

test('a sustained outage (persistent-reconnect) is shown at once and cancels the wait', () => {
  const { clock, shown, notice } = rig();
  notice.retrying({ attempt: 1 });
  notice.persistent({ attempt: 5 });
  assert.deepEqual(shown, [{ attempt: 5 }]);
  clock.advance(10_000);
  assert.equal(shown.length, 1, 'the pending show was cancelled');
});

test('a declined show (a stand-in leads, the provider was replaced) counts as not shown', () => {
  const { clock, shown, notice } = rig({ decline: () => true });
  notice.retrying({ attempt: 1 });
  clock.advance(5_000);
  assert.deepEqual(shown, []);
  assert.equal(notice.showing, false);
});

// ── main.ts wiring ──────────────────────────────────────────────────────────

const handlerStart = main.indexOf("stt.on('error', (raw: unknown) => {");
const handler = main.slice(handlerStart, main.indexOf("stt.on('transcript', (segment: { text: string, isFinal: boolean, confidence: number }) => {", handlerStart));

test('main: a retryable error goes through the notice, not straight to the overlay', () => {
  assert.match(main, /import \{ SttReconnectNotice \} from "\.\/audio\/sttReconnectNotice\.mjs"/);
  assert.match(handler, /reconnectNotice\.retrying\( \{\s*state: 'reconnecting'/);
  assert.doesNotMatch(handler, /_lastState = 'reconnecting'/, "_lastState turns 'reconnecting' only when the notice is sent");
  const notice = main.slice(main.indexOf('const reconnectNotice = new SttReconnectNotice({'), handlerStart);
  assert.match(notice, /_lastState = 'reconnecting';\s*\n\s*this\.sendSttStatus\(payload\);/);
  // Declined for a stand-in, outside a meeting, or for a replaced provider.
  assert.match(notice, /if \(failover\.active \|\| !this\.isMeetingActive \|\| current !== stt\) return false;/);
});

test('main: every path that settles the channel cancels a pending notice', () => {
  // auth / local unavailable, past the policy (before engage), a final, a
  // stand-in status, a reconnect.
  assert.match(handler, /if \(isAuthError \|\| isLocalSttUnavailable\) \{\s*_consecutiveErrors = 0;\s*reconnectNotice\.settle\(\);/);
  assert.match(handler, /reconnectNotice\.settle\(\);\s*\n\s*failoverCause = isQuotaError \? 'quota' : 'other';\s*\n\s*if \(failover\.engage\(\)\) return;/);
  assert.match(main, /_consecutiveErrors = 0; \/\/ Success — reset counter\s*\n\s*reconnectNotice\.settle\(\);/);
  assert.match(main, /onStatus: \(st: FailoverStatus\) => \{[\s\S]{0,200}reconnectNotice\.settle\(\);/);
  assert.match(main, /stt\.on\('persistent-reconnect'[\s\S]{0,300}reconnectNotice\.persistent\( \{/);
});

test('main: a local model that is behind is its own notice, once, and never a reconnect', () => {
  const at = handler.indexOf("if ((err as any)?.code === 'local_stt_behind') {");
  assert.ok(at > 0, 'behind is handled before the reconnect counting');
  assert.ok(at < handler.indexOf('_consecutiveErrors++;'), 'never counted as an error');
  assert.ok(at < handler.indexOf('this.sttGap.onProviderError(gapSource);'), 'no gap recovery on an overloaded CPU');
  const branch = handler.slice(at, handler.indexOf('return;\n      }', at));
  assert.match(branch, /if \(!_behindReported\) \{\s*_behindReported = true;/);
  assert.match(branch, /behind: true/);
  assert.match(branch, /state: _lastState/, 'the channel state is reported unchanged');
});

test('main: a provider that reopens maps to awaiting-audio, from reconnecting only, without resetting the count', () => {
  const at = main.indexOf('if (!(stt instanceof NativelyProSTT)) {');
  assert.ok(at > 0);
  const block = main.slice(at, main.indexOf('\n    }\n', at));
  assert.match(block, /stt\.on\('connected', \(\) => \{\s*reconnectNotice\.settle\(\);\s*if \(failover\.active \|\| _lastState !== 'reconnecting'\) return;\s*_lastState = 'awaiting-audio';/);
  assert.match(block, /state: 'awaiting-audio'/);
  assert.doesNotMatch(block, /_consecutiveErrors = 0/, 'an open-then-fail loop must still reach failed');
});

test('the streaming providers announce a session ready for audio', () => {
  const cases = {
    'DeepgramStreamingSTT.ts': /LiveTranscriptionEvents\.Open[\s\S]*?this\.emit\('connected'\)/,
    'SonioxStreamingSTT.ts': /console\.log\('\[SonioxStreaming\] Config sent'\);[\s\S]{0,300}this\.emit\('connected'\)/,
    'OpenAIStreamingSTT.ts': /case 'transcription_session\.created':[\s\S]{0,1000}this\.emit\('connected'\)/,
    'ElevenLabsStreamingSTT.ts': /case 'session_started':[\s\S]{0,800}this\.emit\('connected'\)/,
    'QwenRealtimeSTT.ts': /event\.type === 'session\.updated'[\s\S]{0,700}this\.emit\('connected'\)/,
    'NvidiaNimStreamingSTT.ts': /if \(gen === this\.generation && !announced\) \{\s*announced = true;\s*try \{ this\.emit\('connected'\);/,
  };
  for (const [file, re] of Object.entries(cases)) assert.match(read(`../${file}`), re, file);
});
