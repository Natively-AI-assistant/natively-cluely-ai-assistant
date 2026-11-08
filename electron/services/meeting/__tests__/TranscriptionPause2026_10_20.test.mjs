// Pause transcription and the real audio level in the notepad (2026-10-20,
// services/meeting/transcriptionPause.ts): while paused both channels feed
// silence of the same length, the inactivity stop is off, and a resume counts
// from then. Pure modules, no Electron: the gate sits in main's capture 'data'
// handlers, which macOS and Windows share (the source contract below), so the
// same assertions hold on both platforms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const dist = (p) => path.resolve(root, 'dist-electron/electron/services', p);
const { TranscriptionPause, AudioLevelMeter, level, LEVEL_INTERVAL_MS } = require(dist('meeting/transcriptionPause.js'));
const { createMeetingAutoStop } = require(dist('meeting/wireMeetingAutoStop.js'));
const { cleanUserNotes } = require(dist('meeting/meetingNotesContext.js'));
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const pcm = (...samples) => {
    const b = Buffer.alloc(samples.length * 2);
    samples.forEach((s, i) => b.writeInt16LE(s, i * 2));
    return b;
};

test('the gate passes the chunk itself, or zeros of the same length while paused', () => {
    const p = new TranscriptionPause();
    const chunk = pcm(1200, -800, 300);
    assert.equal(p.gate(chunk), chunk);
    assert.equal(p.setPaused(true), true);
    const silent = p.gate(chunk);
    assert.equal(silent.length, chunk.length);
    assert.ok(silent.every((byte) => byte === 0));
    assert.deepEqual([...chunk], [...pcm(1200, -800, 300)], 'the real chunk is never written over');
    assert.equal(p.setPaused(true), false, 'no change, no news');
    p.setPaused(false);
    assert.equal(p.gate(chunk), chunk);
});

test('listeners hear each change once; one that throws never blocks the switch', () => {
    const p = new TranscriptionPause();
    const heard = [];
    p.onChange(() => { throw new Error('boom'); });
    const off = p.onChange((v) => heard.push(v));
    p.setPaused(true);
    p.setPaused(true);
    p.setPaused(false);
    off();
    p.setPaused(true);
    assert.deepEqual(heard, [true, false]);
    assert.equal(p.isPaused(), true);
});

test('level: 0 for silence and empty chunks, rises with loudness, capped at 1', () => {
    assert.equal(level(Buffer.alloc(0)), 0);
    assert.equal(level(Buffer.alloc(3200)), 0);
    const quiet = level(pcm(...Array(400).fill(1000)));
    const loud = level(pcm(...Array(400).fill(8000)));
    assert.ok(quiet > 0 && quiet < loud, `${quiet} < ${loud}`);
    assert.equal(level(pcm(...Array(400).fill(32767))), 1);
});

test('the meter sends the louder channel, at most every LEVEL_INTERVAL_MS; reset starts over', () => {
    let now = 1_000;
    const sent = [];
    const m = new AudioLevelMeter((v) => sent.push(v), () => now);
    m.note('mic', 0.2);
    m.note('system', 0.6);
    now += LEVEL_INTERVAL_MS;
    m.note('mic', 0.1);
    assert.deepEqual(sent, [0.2, 0.6]);
    m.reset();
    m.note('system', 0.05);
    assert.deepEqual(sent, [0.2, 0.6, 0.05]);
});

function autoStop(overrides = {}) {
    const auto = createMeetingAutoStop({
        platform: 'darwin',
        self: { pid: 1, execPath: '/Applications/Natively.app/Contents/MacOS/Natively', bundleId: 'com.natively' },
        native: { getMicUsers: () => [] },
        live: { list: () => [], keys: () => [], on() {}, off() {} },
        metadata: () => null,
        speakerNames: () => ({ me: 'Me', them: 'Them' }),
        settings: () => ({ enabled: true, inactivityMinutes: 15 }),
        generate: null,
        stopMeeting: () => {},
        notify: () => {},
        log: () => {},
        now: () => 1_800_000_000_000,
        setInterval: () => 1,
        clearInterval: () => {},
        ...overrides,
    });
    return auto;
}
const inactivityOn = (auto) => auto.detector.o.inactivityEnabled;

for (const platform of ['darwin', 'win32']) {
    test(`auto-stop (${platform}): paused turns the inactivity stop off; resume turns it back on unless Undetectable`, () => {
        const auto = autoStop({ platform });
        auto.start({ ambientChat: false, undetectable: false });
        assert.equal(inactivityOn(auto), true);
        auto.setPaused(true);
        assert.equal(inactivityOn(auto), false);
        auto.setUndetectable(false);
        assert.equal(inactivityOn(auto), false, 'Undetectable going off does not undo the pause');
        auto.setPaused(false);
        assert.equal(inactivityOn(auto), true);
        auto.setUndetectable(true);
        auto.setPaused(true);
        auto.setPaused(false);
        assert.equal(inactivityOn(auto), false, 'a resume does not undo Undetectable');
        // A new meeting starts unpaused.
        auto.setUndetectable(false);
        auto.setPaused(true);
        auto.start({ ambientChat: false, undetectable: false });
        assert.equal(inactivityOn(auto), true);
    });
}

test('the notes prompt reads the notepad\'s markdown as plain words (underline, escapes)', () => {
    assert.equal(cleanUserNotes('Needs ++SSO++ first'), 'Needs SSO first');
    assert.equal(cleanUserNotes('Costs \\*about\\* 20\\% \\#1'), 'Costs *about* 20\\% #1');
    assert.equal(cleanUserNotes('- [ ] Send the doc\n- [x] Share it'), '- [ ] Send the doc\n- [x] Share it');
});

test('main: both captures go through the pause (shared by macOS and Windows); a meeting starts and ends unpaused', () => {
    const main = read('electron/main.ts');
    assert.match(main, /if \(this\.systemAudioCapture === capture\) \{[\s\S]{0,200}chunk = this\.transcriptionPause\.gate\(chunk\);[\s\S]{0,200}this\.googleSTT\?\.write\(chunk\)/);
    assert.match(main, /const heard = this\.transcriptionPause\.gate\(meetingMuteSync\.gate\(chunk\)\);[\s\S]{0,200}this\.googleSTT_User\?\.write\(heard\)/);
    assert.match(main, /this\.transcriptionPause\.setPaused\(false\);\s*this\.audioLevelMeter\.reset\(\);/);
    assert.match(main, /meetingAutoStop\.setPaused\(paused\)/);
    const ipc = read('electron/ipcHandlers.ts');
    for (const channel of ['meeting:get-transcription-paused', 'meeting:set-transcription-paused', 'live-notes:set-title', 'live-notes:calendar-candidates', 'live-notes:link-event', 'live-notes:set-attendees', 'notes-window:copy-text']) {
        assert.match(ipc, new RegExp(`safeHandle\\('${channel}'`), channel);
    }
    const preload = read('electron/preload.ts');
    for (const name of ['getTranscriptionPaused', 'setTranscriptionPaused', 'onTranscriptionPaused', 'onMeetingAudioLevel', 'notesWindowCopyText', 'liveNotesSetTitle', 'liveNotesCalendarCandidates', 'liveNotesLinkEvent', 'liveNotesSetAttendees']) {
        assert.match(preload, new RegExp(`\\b${name}:`), name);
    }
});
