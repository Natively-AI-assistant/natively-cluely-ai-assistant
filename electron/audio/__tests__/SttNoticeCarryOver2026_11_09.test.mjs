// Review of the 2026-11-09 banner fixes, main side.
//
//  D2  the provider object outlives the meeting (the next one reuses it), and
//      teardown never settled the reconnect notice: a meeting that ended while
//      "Reconnecting" showed made the next meeting's first blip show at once,
//      a wait pending at teardown could fire in a meeting started within 5 s,
//      and "falling behind" was said once per app session, not per meeting.
//  O2  three permission losses reach the overlay as stuck (main keeps
//      probing); they now say they are a permission, so a hidden overlay
//      reopens for them (quietly).
//
// Platform-neutral main code; the permission losses are macOS detectors
// (Screen Recording, System Audio Recording) and the mic zero-fill detector,
// which runs on both.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SttReconnectNotice } from '../sttReconnectNotice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const main = fs.readFileSync(path.resolve(here, '../../main.ts'), 'utf8');

function rig() {
  let meeting = 1;
  const timers = new Map();
  let id = 0;
  const shown = [];
  const notice = new SttReconnectNotice({
    show: (p) => { shown.push(p); },
    epoch: () => meeting,
    setTimer: (fn) => { const h = ++id; timers.set(h, fn); return h; },
    clearTimer: (h) => timers.delete(h),
  });
  const fire = () => { for (const [h, fn] of [...timers]) { timers.delete(h); fn(); } };
  return { notice, shown, fire, nextMeeting: () => { meeting += 1; } };
}

test('D2: a wait pending when the meeting ended never shows in the next one', () => {
  const { notice, shown, fire, nextMeeting } = rig();
  notice.retrying({ attempt: 1 });
  nextMeeting(); // teardown missed it; a new meeting started within the wait
  fire();
  assert.deepEqual(shown, []);
  assert.equal(notice.showing, false);
});

test('D2: a notice still showing when the meeting ended gives the next meeting its grace', () => {
  const { notice, shown, fire, nextMeeting } = rig();
  notice.persistent({ attempt: 5 });
  assert.equal(notice.showing, true);
  nextMeeting();
  notice.retrying({ attempt: 1 });
  assert.equal(shown.length, 1, 'not shown at once: it waits');
  fire();
  assert.equal(shown.length, 2, 'and shows if the outage lasts');
});

test('D2: main settles the notice and resets "behind" on every teardown, and gives it the meeting', () => {
  const stop = main.slice(main.indexOf('(stt as any).stop = () => {'));
  const body = stop.slice(0, stop.indexOf('return rawStop();'));
  assert.match(body, /failover\.stop\(\);/);
  assert.match(body, /reconnectNotice\.settle\(\);/);
  assert.match(body, /_behindReported = false;/);
  assert.match(main, /new SttReconnectNotice\(\{\s*\/\/[^\n]*\n\s*epoch: \(\) => this\._meetingGeneration,/);
});

test('O2: the permission losses sent as stuck carry permission: true', () => {
  for (const key of ['mac-screen-recording-revoked-rebuild', 'mac-system-audio-recording-denied', 'mic-zero-fill']) {
    const at = main.indexOf(`titleKey: permissionTitleKey('${key}'),`);
    assert.ok(at > 0, key);
    const payload = main.slice(at, main.indexOf('});', at));
    assert.match(payload, /stuck: true,/, key);
    assert.match(payload, /permission: true,/, key);
  }
});
