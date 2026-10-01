// Meeting detection (services/meetingDetection): is a call on, which, and the
// one "Start Natively?" per call. Both OS branches run here with the platform
// injected: macOS names processes by bundle id and path (a browser's audio is
// a helper inside its .app), Windows by exe path or a packaged family name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = (p) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/services', p);
const { detectMeeting } = require(dist('meetingDetection/detectMeeting.js'));
const { appOfProcess, isSelf } = require(dist('meetingDetection/meetingApps.js'));
const { MeetingDetector } = require(dist('meetingDetection/MeetingDetector.js'));
const { describeDetection, wireMeetingDetection } = require(dist('meetingDetection/wireMeetingDetection.js'));

const MAC_SELF = { pid: 500, execPath: '/Applications/Natively.app/Contents/MacOS/Natively' };
const WIN_SELF = { pid: 500, execPath: 'C:\\Users\\a\\AppData\\Local\\Programs\\Natively\\Natively.exe' };
const CHROME_HELPER = { pid: 910, bundleId: 'com.google.Chrome.helper', path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/140.0/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper' };
const tab = (key, extra = {}) => ({ key, provider: key.split(':')[0].replace(/-.*/, ''), via: 'browser', seenAt: 1, ...extra });
const input = (platform, micUsers, { windows = [], live = [], self } = {}) => {
    let reads = 0;
    const i = { platform, micUsers, windows: () => { reads++; return windows; }, live, self: self ?? (platform === 'win32' ? WIN_SELF : MAC_SELF) };
    return { i, reads: () => reads };
};

test('macOS: a meeting app holding the microphone is a call', () => {
    const { i } = input('darwin', [{ pid: 700, bundleId: 'us.zoom.xos', path: '/Applications/zoom.us.app/Contents/MacOS/zoom.us' }]);
    assert.deepEqual(detectMeeting(i), { id: 'app:Zoom', app: 'Zoom', via: 'app' });
    const facetime = input('darwin', [{ pid: 80, path: '/usr/libexec/avconferenced' }]).i;
    assert.equal(detectMeeting(facetime)?.app, 'FaceTime', 'FaceTime audio runs in avconferenced');
});

test('macOS: a browser is a call only with a meeting in it', () => {
    // Its meeting tab (the Companion extension), the call's sound first.
    const withTab = input('darwin', [CHROME_HELPER], { live: [tab('meet:aaa-aaaa-aaa'), tab('zoom:81234567890', { audible: true, title: 'Zoom Meeting' })] });
    assert.deepEqual(detectMeeting(withTab.i), { id: 'tab:zoom:81234567890', app: 'Zoom', via: 'browser', title: 'Zoom Meeting', key: 'zoom:81234567890' });
    assert.equal(withTab.reads(), 0, 'no window list needed');
    // No extension: the front tab's title, as the window title.
    const byTitle = input('darwin', [CHROME_HELPER], { windows: [{ pid: 900, owner: 'Google Chrome', title: 'Meet – abc-defg-hij', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }] });
    assert.deepEqual(detectMeeting(byTitle.i), { id: 'browser:Google Chrome:Google Meet', app: 'Google Meet', via: 'browser' });
    // A voice note in a browser is not a meeting.
    const voiceNote = input('darwin', [CHROME_HELPER], { windows: [{ pid: 900, owner: 'Google Chrome', title: 'WhatsApp', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }] });
    assert.equal(detectMeeting(voiceNote.i), null);
    // A meeting title in ANOTHER browser doesn't count for this one.
    const otherBrowser = input('darwin', [CHROME_HELPER], { windows: [{ pid: 30, owner: 'Safari', title: 'Meet – abc-defg-hij', path: '/Applications/Safari.app/Contents/MacOS/Safari' }] });
    assert.equal(detectMeeting(otherBrowser.i), null);
});

test('macOS: Natively itself, and unknown recorders, are never a call', () => {
    assert.equal(detectMeeting(input('darwin', [{ pid: 500, path: MAC_SELF.execPath }]).i), null, 'our own pid');
    assert.equal(detectMeeting(input('darwin', [{ pid: 501, bundleId: 'com.electron.meeting-notes.helper', path: '/Applications/Natively.app/Contents/Frameworks/Natively Helper.app/Contents/MacOS/Natively Helper' }]).i), null, 'our own helper');
    assert.equal(detectMeeting(input('darwin', [{ pid: 28295, path: '/opt/homebrew/Cellar/ffmpeg/8.1.2_1/bin/ffmpeg' }]).i), null, 'a terminal recording (measured shape: no bundle id)');
    assert.equal(detectMeeting(input('darwin', []).i), null);
});

test('Windows: meeting apps by exe path or packaged family name; Teams names the meeting', () => {
    const zoom = input('win32', [{ path: 'C:\\Users\\a\\AppData\\Roaming\\Zoom\\bin\\Zoom.exe' }]).i;
    assert.equal(detectMeeting(zoom)?.id, 'app:Zoom');
    const teams = input('win32', [{ bundleId: 'MSTeams_8wekyb3d8bbwe' }], {
        windows: [
            { pid: 42, owner: 'ms-teams.exe', title: 'Chat | Microsoft Teams', path: 'C:\\Program Files\\WindowsApps\\MSTeams_24.1.0_x64__8wekyb3d8bbwe\\ms-teams.exe' },
            { pid: 42, owner: 'ms-teams.exe', title: 'Weekly sync | Microsoft Teams', path: 'C:\\Program Files\\WindowsApps\\MSTeams_24.1.0_x64__8wekyb3d8bbwe\\ms-teams.exe' },
        ],
    }).i;
    assert.deepEqual(detectMeeting(teams), { id: 'app:Microsoft Teams', app: 'Microsoft Teams', via: 'app', title: 'Weekly sync' });
});

test('Windows: a browser with a meeting window title; Natively\'s own exe never counts', () => {
    const chrome = input('win32', [{ path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }], {
        windows: [{ pid: 7, owner: 'chrome.exe', title: 'Meet - abc-defg-hij - Google Chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }],
    }).i;
    assert.equal(detectMeeting(chrome)?.app, 'Google Meet');
    assert.equal(detectMeeting(input('win32', [{ path: WIN_SELF.execPath.toUpperCase() }]).i), null, 'paths compare without case');
    assert.equal(isSelf('win32', { path: 'C:\\other\\Natively.exe' }, WIN_SELF), false);
});

test('no microphone information (macOS before 14, no native module): a meeting tab playing sound', () => {
    assert.equal(detectMeeting(input('darwin', null, { live: [tab('meet:abc-defg-hij', { audible: true })] }).i)?.key, 'meet:abc-defg-hij');
    assert.equal(detectMeeting(input('win32', null, { live: [tab('meet:abc-defg-hij')] }).i), null, 'a silent tab is not a call');
});

test('each OS reads only its own identities; an unsupported OS knows no apps', () => {
    assert.equal(appOfProcess('darwin', { path: 'C:\\Program Files\\Zoom\\bin\\Zoom.exe' }), null);
    assert.equal(appOfProcess('win32', { bundleId: 'us.zoom.xos' }), null);
    assert.equal(appOfProcess('linux', { bundleId: 'us.zoom.xos', path: '/usr/bin/zoom' }), null);
});

test('the detector: one prompt per call, after it holds, again only for a new call', () => {
    let t = 0;
    let signal = null;
    let active = false;
    const shown = [];
    const d = new MeetingDetector({ read: () => signal, isMeetingActive: () => active, onDetected: (x) => shown.push(x.id), now: () => t }, { confirmMs: 4000, rearmMs: 60000 });
    const zoom = input('darwin', [{ pid: 700, bundleId: 'us.zoom.xos' }]).i;
    const none = input('darwin', []).i;
    const step = (ms, s) => { t += ms; signal = s; d.tick(); };
    step(0, zoom); step(2000, zoom);
    assert.deepEqual(shown, [], 'not yet: a mic test is shorter');
    step(2000, zoom);
    assert.deepEqual(shown, ['app:Zoom']);
    step(2000, zoom); step(30000, none); step(2000, zoom); step(4000, zoom);
    assert.deepEqual(shown, ['app:Zoom'], 'a short drop is the same call');
    step(61000, none); step(1000, zoom); step(4000, zoom);
    assert.deepEqual(shown, ['app:Zoom', 'app:Zoom'], 'gone a minute: a new call');
    // A blip before the prompt starts the wait over.
    step(61000, none); step(1000, zoom); step(2000, none); step(2000, zoom); step(2000, zoom);
    assert.equal(shown.length, 2);
    // A call that was on while Natively ran is not announced after it stops.
    step(61000, none); active = true; step(1000, zoom); step(5000, zoom); active = false; step(5000, zoom);
    assert.equal(shown.length, 2);
});

test('the detector only polls while enabled', () => {
    const timers = [];
    const d = new MeetingDetector({ read: () => null, isMeetingActive: () => false, onDetected: () => {}, setInterval: (fn, ms) => { timers.push(ms); return 1; }, clearInterval: () => timers.push('cleared') });
    d.setEnabled(true); d.setEnabled(true);
    assert.deepEqual(timers, [2000], 'once, every 2 s');
    d.setEnabled(false);
    assert.equal(timers.at(-1), 'cleared');
    assert.equal(d.enabled, false);
});

const NOW = Date.now();
const at = (min) => new Date(NOW + min * 60_000).toISOString();
test('the notification names the event and starts linked to it only when the call\'s link says so', () => {
    const events = [{ id: 'sync', title: 'Weekly sync', startTime: at(-2), endTime: at(28), attendees: [{ email: 'p@x.com' }], meetingKeys: ['meet:abc-defg-hij'] }];
    const exact = describeDetection({ id: 'tab:meet:abc-defg-hij', app: 'Google Meet', via: 'browser', key: 'meet:abc-defg-hij' }, events, NOW);
    assert.equal(exact.body, '"Weekly sync" is on in Google Meet.');
    assert.deepEqual(exact.start, { title: 'Weekly sync', calendarEventId: 'sync', via: 'detected' });
    const byTime = describeDetection({ id: 'app:Zoom', app: 'Zoom', via: 'app' }, [{ ...events[0], meetingKeys: undefined }], NOW);
    assert.equal(byTime.body, '"Weekly sync" is on in Zoom.');
    assert.deepEqual(byTime.start, { via: 'detected' }, 'time alone: the linker decides at start, as for any start');
    assert.equal(describeDetection({ id: 'app:Zoom', app: 'Zoom', via: 'app' }, null, NOW).body, 'A Zoom call started.');
    const otherCall = describeDetection({ id: 'tab:meet:zzz-zzzz-zzz', app: 'Google Meet', via: 'browser', key: 'meet:zzz-zzzz-zzz' }, events, NOW);
    assert.equal(otherCall.body, 'A Google Meet call started.', 'an event with another link is not this call');
});

test('never shown while prompts are blocked (that call stays unannounced); its Start does nothing once a meeting runs', () => {
    const notes = [];
    const starts = [];
    let blocked = true;
    let active = false;
    let mic = [{ pid: 700, bundleId: 'us.zoom.xos' }];
    let t = 0;
    const detector = wireMeetingDetection({
        platform: 'darwin',
        native: { getMicUsers: () => mic, getVisibleWindows: () => [] },
        self: MAC_SELF,
        isMeetingActive: () => active,
        promptsBlocked: () => blocked,
        events: () => null,
        requestStart: (r) => starts.push(r),
        notify: (n) => { notes.push(n); return true; },
        live: { list: () => [], keys: () => [], on: () => {}, off: () => {} },
        now: () => t,
    });
    const tick = (ms) => { t += ms; detector.tick(); };
    tick(0); tick(5000);
    assert.equal(notes.length, 0, 'Undetectable or a disguise: no notification');
    blocked = false; tick(5000);
    assert.equal(notes.length, 0, 'turning it off mid-call does not bring a late prompt');
    mic = []; tick(61_000);
    mic = [{ pid: 700, bundleId: 'us.zoom.xos' }]; tick(1000); tick(5000);
    assert.equal(notes.length, 1, 'the next call is announced');
    assert.equal(notes[0].title, 'Start Natively?');
    assert.equal(notes[0].body, 'A Zoom call started.');
    active = true; notes[0].onStart();
    assert.equal(starts.length, 0);
    active = false; notes[0].onStart();
    assert.deepEqual(starts, [{ via: 'detected' }]);
});

// The real native module on this machine (skipped where no binary is built):
// both signals answer in the shapes the detector reads, reading them never
// makes this process a microphone user, and they are cheap enough to poll.
test('native signals: real shapes, no self-capture, cheap', (t) => {
    let native;
    try {
        native = require(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../native-module/index.js'));
    } catch {
        return t.skip('no native binary for this platform');
    }
    if (typeof native.getMicUsers !== 'function') return t.skip('binary predates meeting_signals.rs');
    const users = native.getMicUsers();
    assert.ok(users === null || Array.isArray(users));
    for (const u of users ?? []) {
        assert.ok(u.pid === undefined || Number.isInteger(u.pid));
        assert.ok(u.bundleId === undefined || typeof u.bundleId === 'string');
        assert.ok(u.path === undefined || typeof u.path === 'string');
    }
    const started = process.hrtime.bigint();
    for (let i = 0; i < 5; i++) native.getMicUsers();
    const perCallMs = Number(process.hrtime.bigint() - started) / 5e6;
    assert.ok(perCallMs < 50, `a poll costs ${perCallMs.toFixed(1)} ms`);
    assert.ok(!(native.getMicUsers() ?? []).some((u) => u.pid === process.pid), 'reading does not capture');
    const windows = native.getVisibleWindows();
    assert.ok(windows === null || Array.isArray(windows));
    for (const w of windows ?? []) {
        assert.ok(Number.isInteger(w.pid) && typeof w.owner === 'string' && typeof w.title === 'string');
    }
});
