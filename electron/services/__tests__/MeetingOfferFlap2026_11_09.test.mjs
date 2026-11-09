// One call, one "Start Natively?" (2026-11-09). Before, a Zoom call that
// released the microphone for one poll (a mute) withdrew its offer and raised a
// new notification when it was seen again; a failed native read made every
// call look gone at once; "Not now" held only until the call was gone a
// minute; and a Windows toast that timed out into the Action Center was
// forgotten, so the offer could no longer close it and a click hours later
// started a meeting.
//
// Fake clock and timers; the detector runs with darwin and win32 microphone
// identities. electronNotify runs against a stubbed electron Notification with
// the platform passed in.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => path.join(REPO, 'dist-electron/electron/services', p);
const wire = require(dist('meetingDetection/wireMeetingDetection.js'));
const { wireMeetingDetection } = wire;
const { MeetingOffers, notNowHolds, OFFER_NOT_NOW_MS } = require(dist('meetingDetection/meetingOffer.js'));
const { MeetingDetector } = require(dist('meetingDetection/MeetingDetector.js'));

const PLATFORMS = {
    darwin: { zoom: { pid: 99, path: '/Applications/zoom.us.app/Contents/MacOS/zoom.us', bundleId: 'us.zoom.xos' }, self: { pid: 1, execPath: '/Applications/Natively.app/Contents/MacOS/Natively' } },
    win32: { zoom: { path: 'C:\\Program Files\\Zoom\\bin\\Zoom.exe' }, self: { pid: 1, execPath: 'C:\\Program Files\\Natively\\Natively.exe' } },
};

/** The detector and offer as main wires them, on a fake 2 s poll. `mic`: 'held' | 'free' | 'throws' | 'null'. */
function rig(platform, { auto = false } = {}) {
    let t = 0;
    let mic = 'held';
    const timers = [];
    const notes = [];
    const starts = [];
    const panel = [];
    const d = wireMeetingDetection({
        platform,
        native: {
            getMicUsers: () => {
                if (mic === 'throws') throw new Error('CoreAudio/consent store unavailable');
                if (mic === 'null') return null;
                return mic === 'held' ? [PLATFORMS[platform].zoom] : [];
            },
            getVisibleWindows: () => [],
        },
        self: PLATFORMS[platform].self,
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
    return { d, poll, notes, starts, panel, setMic: (v) => { mic = v; }, now: () => t, advance: (ms) => { t += ms; } };
}

for (const platform of ['darwin', 'win32']) {
    test(`${platform}: the audit's Zoom call (a one-poll mute, then a 70 s one) — one offer until it is a new call`, () => {
        const r = rig(platform);
        r.poll(5);
        assert.equal(r.notes.length, 1, 'confirmed: offered');
        r.setMic('free'); r.poll(1);
        r.setMic('held'); r.poll(3);
        assert.equal(r.notes.length, 1, 'a one-poll mute: no withdraw, no second notification (was 2)');
        assert.notEqual(r.panel.at(-1), null, 'the offer is still up');
        r.setMic('free'); r.poll(35);
        assert.equal(r.panel.at(-1), null, 'gone past the 10 s grace: withdrawn');
        r.setMic('held'); r.poll(4);
        // Gone over a minute: a new call by the detector's rule, offered once more (was the 3rd).
        assert.equal(r.notes.length, 2);
    });

    test(`${platform}: a 30 s mute withdraws the offer, and the call coming back within the minute is not offered again`, () => {
        const r = rig(platform);
        r.poll(5);
        r.setMic('free'); r.poll(15);
        assert.equal(r.panel.at(-1), null, 'withdrawn');
        r.setMic('held'); r.poll(10);
        assert.equal(r.notes.length, 1, 'the same call: not raised again');
    });

    test(`${platform}: Not now holds for that app's calls for 10 minutes, even across a new call`, () => {
        const r = rig(platform);
        r.poll(5);
        r.notes[0].onDismiss();
        assert.equal(r.panel.at(-1), null);
        r.setMic('free'); r.poll(35);          // gone 70 s: a new call by the detector
        r.setMic('held'); r.poll(5);
        assert.equal(r.notes.length, 1, 'Not now remembered (was offered again)');
        r.setMic('free'); r.advance(OFFER_NOT_NOW_MS); r.poll(1); r.poll(31);
        r.setMic('held'); r.poll(5);
        assert.equal(r.notes.length, 2, 'after 10 minutes the next call is offered');
    });

    for (const failure of ['throws', 'null']) {
        test(`${platform}: a failed native read (${failure}) keeps every call as it was`, () => {
            const r = rig(platform);
            r.poll(5);
            assert.equal(r.notes.length, 1);
            r.setMic(failure); r.poll(10);   // 20 s of failed reads: longer than the grace
            assert.notEqual(r.panel.at(-1), null, 'not withdrawn by a read that said nothing');
            assert.equal(r.d.isPresent('app:Zoom'), false, 'not known to be on while reads fail (no automatic start on it)');
            r.setMic('held'); r.poll(2);
            assert.equal(r.d.isPresent('app:Zoom'), true);
            assert.equal(r.notes.length, 1, 'and nothing was raised again');
        });
    }

    test(`${platform}: Start automatically waits through a one-poll gap at the end of its countdown, then starts once`, () => {
        const r = rig(platform, { auto: true });
        r.poll(3);                           // seen at 2 s, confirmed at 6 s: countdown to 16 s
        assert.equal(r.notes.length, 1);
        r.poll(3);                           // 12 s
        r.setMic('free'); r.poll(1);         // 14 s: the poll the countdown will check misses the call
        r.setMic('held'); r.poll(1);         // 16 s: the countdown ends (the rig runs timers before the poll)
        assert.deepEqual(r.starts, [], 'not started over a poll that missed the call');
        assert.notEqual(r.panel.at(-1), null, 'the offer stays up');
        r.poll(1);                           // 18 s: looked at again, the call is on
        assert.deepEqual(r.starts, [{ via: 'detected' }], 'heard again: started');
        assert.equal(r.notes.length, 1, 'one notification throughout');
    });

    test(`${platform}: a call that really ends during the countdown is never started`, () => {
        const r = rig(platform, { auto: true });
        r.poll(4);
        r.setMic('free'); r.poll(20);
        assert.deepEqual(r.starts, []);
        assert.equal(r.panel.at(-1), null, 'withdrawn after the grace');
    });
}

test('a read failing for good is taken as the OS\'s answer after maxSkippedReads', () => {
    let t = 0;
    let micUsers = [{ pid: 7, bundleId: 'us.zoom.xos' }];
    const gone = [];
    const d = new MeetingDetector({
        read: () => ({ platform: 'darwin', micUsers, windows: () => [], live: [], self: PLATFORMS.darwin.self }),
        isMeetingActive: () => false, onDetected: () => {}, onGone: (id) => gone.push([id, t]), now: () => t,
    }, { maxSkippedReads: 3 });
    for (; t <= 6000; t += 2000) d.tick();
    micUsers = null;
    for (let i = 0; i < 3; i++) { t += 2000; d.tick(); }
    assert.deepEqual(gone, [], 'three skipped');
    for (let i = 0; i < 6; i++) { t += 2000; d.tick(); }
    assert.equal(gone.length, 1, 'then the call ages as usual');
});

test('Not now is per call id and expires', () => {
    const m = new Map([['app:Zoom', 1000]]);
    assert.equal(notNowHolds(m, 'app:Zoom', 999), true);
    assert.equal(notNowHolds(m, 'app:Teams', 999), false);
    assert.equal(notNowHolds(m, undefined, 999), false);
    assert.equal(notNowHolds(m, 'app:Zoom', 1000), false);
    assert.equal(m.size, 0, 'pruned');
    assert.equal(OFFER_NOT_NOW_MS, 10 * 60_000);
});

// ── C8: the OS notification ─────────────────────────────────────────────────

function withFakeElectron(fn) {
    const made = [];
    class FakeNotification {
        static isSupported() { return true; }
        constructor(opts) { this.opts = opts; this.handlers = {}; this.closed = 0; made.push(this); }
        on(name, h) { (this.handlers[name] ??= []).push(h); }
        emit(name, ...a) { for (const h of this.handlers[name] ?? []) h(...a); }
        show() {}
        close() { this.closed++; }
    }
    const originalLoad = Module._load;
    Module._load = function (request, ...args) {
        if (request === 'electron') return { Notification: FakeNotification };
        return originalLoad.call(this, request, ...args);
    };
    try { return fn(made); } finally { Module._load = originalLoad; wire.closeDetectedNotification(); }
}

test('win32: a toast that timed out into the Action Center stays closable, and its later click starts nothing', () => {
    withFakeElectron((made) => {
        let t = 0;
        const timers = [];
        const starts = [];
        const offers = new MeetingOffers({
            isMeetingActive: () => false, requestStart: (r) => starts.push(r), autoStart: () => false,
            showPanel: () => {}, launcherFocused: () => false,
            notify: (n) => wire.electronNotify(n, 'win32'),
            closeNotification: wire.closeDetectedNotification,
            now: () => t, setTimeout: (fn, ms) => { timers.push({ fn, at: t + ms }); return timers.length; }, clearTimeout: () => {},
        });
        offers.offer({ app: 'Zoom', body: 'A Zoom call started.', start: { via: 'detected' }, callId: 'app:Zoom' });
        const toast = made[0];
        toast.emit('close', { reason: 'timedOut' });
        assert.equal(offers.view()?.app, 'Zoom', 'timing out is not Not now');
        // The offer expires (2 min): it closes the toast out of the Action Center.
        t = 120_000; timers.find((x) => x.at === 120_000).fn();
        assert.equal(offers.view(), null);
        assert.equal(toast.closed, 1, 'closed by the app (was forgotten on the timeout)');
        // Clicked hours later anyway (the close raced): nothing starts.
        t = 3 * 3600_000;
        toast.emit('click');
        assert.deepEqual(starts, []);
    });
});

test('darwin: any close is the user\'s Not now, and the notification is forgotten', () => {
    withFakeElectron((made) => {
        let dismissed = 0;
        wire.electronNotify({ title: 'Start Natively?', body: 'x', action: 'Start Natively', onStart: () => {}, onDismiss: () => { dismissed++; } }, 'darwin');
        made[0].emit('close', {});
        assert.equal(dismissed, 1);
        wire.closeDetectedNotification();
        assert.equal(made[0].closed, 0, 'nothing left to close');
    });
});

test('win32: the user closing the toast is Not now; timing out is not', () => {
    withFakeElectron((made) => {
        let dismissed = 0;
        const n = { title: 'Start Natively?', body: 'x', action: 'Start Natively', onStart: () => {}, onDismiss: () => { dismissed++; } };
        wire.electronNotify(n, 'win32');
        made[0].emit('close', { reason: 'timedOut' });
        assert.equal(dismissed, 0);
        wire.electronNotify(n, 'win32');
        assert.equal(made[0].closed, 1, 'the timed-out toast is closed when the next arrives');
        made[1].emit('close', { reason: 'userCanceled' });
        assert.equal(dismissed, 1);
    });
});
