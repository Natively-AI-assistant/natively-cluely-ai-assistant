// Review of the 2026-11-09 offer fixes. A desktop call is named by its app
// ("app:Zoom"), so "Not now" must cover that call only: it ends once the call
// has been gone SAME_CALL_GAP_MS, and the next meeting in the same app is
// offered. A call that goes quiet past the 10 s grace (a headset connecting)
// gets its offer and countdown back on the panel when it returns, without a
// second notification. A native read that keeps failing past the skip limit
// is taken as it comes from then on, instead of cycling back to skipping.
//
// Fake clock and timers; darwin and win32 microphone identities.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => path.join(REPO, 'dist-electron/electron/services', p);
const { wireMeetingDetection } = require(dist('meetingDetection/wireMeetingDetection.js'));
const { MeetingOffers, SAME_CALL_GAP_MS } = require(dist('meetingDetection/meetingOffer.js'));
const { MeetingDetector } = require(dist('meetingDetection/MeetingDetector.js'));

const ZOOM = {
    darwin: { mic: { pid: 99, path: '/Applications/zoom.us.app/Contents/MacOS/zoom.us', bundleId: 'us.zoom.xos' }, self: { pid: 1, execPath: '/Applications/Natively.app/Contents/MacOS/Natively' } },
    win32: { mic: { path: 'C:\\Program Files\\Zoom\\bin\\Zoom.exe' }, self: { pid: 1, execPath: 'C:\\Program Files\\Natively\\Natively.exe' } },
};

function rig(platform, { auto = false } = {}) {
    let t = 0;
    let held = true;
    const timers = [];
    const notes = [];
    const starts = [];
    const panel = [];
    const d = wireMeetingDetection({
        platform,
        native: { getMicUsers: () => (held ? [ZOOM[platform].mic] : []), getVisibleWindows: () => [] },
        self: ZOOM[platform].self,
        isMeetingActive: () => false, promptsBlocked: () => false, events: () => null,
        requestStart: (r) => starts.push(r),
        notify: (n) => { notes.push(n); return true; },
        showPanel: (o) => panel.push(o),
        autoStart: () => auto,
        now: () => t,
        setTimeout: (fn, ms) => { const h = { at: t + ms, fn }; timers.push(h); return h; },
        clearTimeout: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
        live: { list: () => [], keys: () => [], on: () => {}, off: () => {} },
    });
    const poll = (n = 1) => {
        for (let i = 0; i < n; i++) {
            t += 2000;
            for (const h of [...timers]) if (h.at <= t) { timers.splice(timers.indexOf(h), 1); h.fn(); }
            d.tick();
        }
    };
    return { poll, notes, starts, panel, mic: (v) => { held = v; }, now: () => t };
}

for (const platform of ['darwin', 'win32']) {
    test(`${platform}: Not now on a Zoom call, it ends, another Zoom call 5 minutes later is offered`, () => {
        const r = rig(platform);
        r.poll(5);
        assert.equal(r.notes.length, 1);
        r.notes[0].onDismiss();
        r.mic(false); r.poll(150);              // 5 minutes without a call
        r.mic(true); r.poll(5);
        assert.equal(r.notes.length, 2, 'the next meeting is offered (was held for 10 minutes)');
    });

    test(`${platform}: Not now still holds through a 90 s mute of the same call`, () => {
        const r = rig(platform);
        r.poll(5);
        r.notes[0].onDismiss();
        r.mic(false); r.poll(45);               // 90 s: past the detector's minute, under SAME_CALL_GAP_MS
        r.mic(true); r.poll(5);
        assert.equal(r.notes.length, 1, 'taken as the same call');
        assert.equal(r.panel.at(-1), null);
    });

    test(`${platform}: Start automatically survives a 12 s gap: the offer comes back on the panel and starts, one notification`, () => {
        const r = rig(platform, { auto: true });
        r.poll(3);                              // offered at 6 s, countdown to 16 s
        assert.equal(r.notes.length, 1);
        r.mic(false); r.poll(6);                // 12 s without the mic: past the 10 s grace, withdrawn
        assert.equal(r.panel.at(-1), null, 'withdrawn while gone');
        r.mic(true); r.poll(1);
        const back = r.panel.at(-1);
        assert.ok(back, 'back on the panel');
        assert.equal(back.autoStartAt, r.now() + 10_000, 'with a fresh countdown');
        r.poll(15);
        assert.deepEqual(r.starts, [{ via: 'detected' }], 'started (was never, for the rest of the call)');
        assert.equal(r.notes.length, 1, 'no second notification');
    });

    test(`${platform}: the audit's flap simulation raises one OS notification`, () => {
        const r = rig(platform);
        r.poll(5);
        r.mic(false); r.poll(1);
        r.mic(true); r.poll(3);
        r.mic(false); r.poll(35);
        r.mic(true); r.poll(4);
        assert.equal(r.notes.length, 1, 'was 3 before 2026-11-09, 2 after the first fix');
        assert.notEqual(r.panel.at(-1), null, 'and the offer is up on the panel');
    });
}

test('Not now holds while the call goes on, for up to 10 minutes; its absence is counted from the gone report', () => {
    let t = 0;
    const notes = [];
    const offers = new MeetingOffers({
        isMeetingActive: () => false, requestStart: () => {}, autoStart: () => false,
        showPanel: () => {}, notify: (n) => { notes.push(n); return true; }, closeNotification: () => {}, launcherFocused: () => false,
        now: () => t, setTimeout: () => 0, clearTimeout: () => {},
    });
    const input = { app: 'Zoom', body: 'x', start: { via: 'detected' }, callId: 'app:Zoom' };
    offers.dismiss(offers.offer(input).id);
    t = 60_000; offers.callGone('app:Zoom');
    t = 90_000; offers.callBack('app:Zoom');               // back: on again
    t = 100_000; offers.callGone('app:Zoom');
    t = 100_000 + SAME_CALL_GAP_MS - 1;
    assert.equal(offers.offer(input), null, 'gone just under the gap: the same call');
    // That offer saw the call, so it is on again: absence restarts at the next gone report.
    t = 400_000; offers.callGone('app:Zoom');
    t = 400_000 + SAME_CALL_GAP_MS;
    assert.ok(offers.offer(input), 'gone the whole gap: a new call, offered');
    assert.equal(notes.length, 2);
    // Continuous: 10 minutes after Not now it ends anyway.
    offers.dismiss(offers.view().id);
    t += 10 * 60_000 - 1;
    assert.equal(offers.offer(input), null);
    t += 1;
    assert.ok(offers.offer(input));
});

test('a restored offer never comes back after Not now, Start, expiry or a running meeting', () => {
    let t = 0;
    let active = false;
    const offers = new MeetingOffers({
        isMeetingActive: () => active, requestStart: () => {}, autoStart: () => false,
        showPanel: () => {}, notify: () => true, closeNotification: () => {}, launcherFocused: () => true,
        now: () => t, setTimeout: () => 0, clearTimeout: () => {},
    });
    const input = (id) => ({ app: 'Zoom', body: 'x', start: { via: 'detected' }, callId: id });
    offers.offer(input('a')); offers.callGone('a'); offers.callBack('a');
    offers.dismiss(offers.view().id); offers.callGone('a'); offers.callBack('a');
    assert.equal(offers.view(), null, 'Not now');
    offers.offer(input('b')); offers.start(offers.view().id); offers.callGone('b'); offers.callBack('b');
    assert.equal(offers.view(), null, 'Start');
    offers.offer(input('c')); offers.clear('expired'); offers.callGone('c'); offers.callBack('c');
    assert.equal(offers.view(), null, 'expired');
    offers.offer(input('d')); offers.callGone('d'); active = true; offers.callBack('d');
    assert.equal(offers.view(), null, 'a meeting is running');
});

test('a read that keeps throwing: past the skip limit every poll is taken as it comes (no 15-skip cycles)', () => {
    let t = 0;
    let throws = false;
    const gone = [];
    const d = new MeetingDetector({
        read: () => {
            if (throws) throw new Error('native read failed');
            return { platform: 'darwin', micUsers: [ZOOM.darwin.mic], windows: () => [], live: [], self: ZOOM.darwin.self };
        },
        isMeetingActive: () => false, onDetected: () => {}, onGone: (id) => gone.push([id, t]), now: () => t,
    }, { maxSkippedReads: 3 });
    for (; t <= 6000; t += 2000) d.tick();        // seen at 0..6 s, announced
    throws = true;
    for (t = 8000; t <= 30_000; t += 2000) d.tick();
    // Skipped at 8, 10, 12; taken from 14 s on: gone 10 s after it was last seen (6 s), at 16 s.
    assert.deepEqual(gone, [['app:Zoom', 16_000]], 'was reported at 22 s (skips resumed after one processed poll)');
});
