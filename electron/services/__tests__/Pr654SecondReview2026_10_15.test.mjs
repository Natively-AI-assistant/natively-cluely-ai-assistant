// PR 654, second review (2026-10-15).
//  1. Without microphone information a browser call counts only while its tab
//     plays sound: a quiet stretch must not end the offer at once, and an
//     offer withdrawn unanswered comes back when the call does. The automatic
//     start still never fires for a call not seen at the last poll.
//  2. Dictation's last-words wait follows work the provider still has on its
//     way (an upload in flight or queued, a local final being transcribed),
//     not only a fixed quiet time.
// Fake clock, timers and providers; the detector runs with darwin and win32 inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => path.join(REPO, 'dist-electron/electron', p);
const { wireMeetingDetection } = require(dist('services/meetingDetection/wireMeetingDetection.js'));
const { MeetingOffers } = require(dist('services/meetingDetection/meetingOffer.js'));
const { LiveDictationSession, liveTimingFor } = require(dist('services/dictation/dictationSession.js'));

function quietTabRig(platform) {
    let t = 0;
    let audible = true;
    const pending = [];
    const starts = [];
    const panel = [];
    const tab = () => [{ key: 'meet:abc-defg-hij', provider: 'meet', via: 'browser', seenAt: 1, audible }];
    const d = wireMeetingDetection({
        platform,
        // No microphone information (macOS before 14, or no native module).
        native: { getMicUsers: () => null, getVisibleWindows: () => [] },
        self: platform === 'win32' ? { pid: 1, execPath: 'C:\\n\\Natively.exe' } : { pid: 1, execPath: '/Applications/Natively.app/Contents/MacOS/Natively' },
        isMeetingActive: () => false, promptsBlocked: () => false, events: () => null,
        requestStart: (r) => starts.push(r), notify: () => true, showPanel: (o) => panel.push(o),
        launcherFocused: () => true, autoStart: () => true,
        setTimeout: (fn, ms) => { pending.push({ fn, at: t + ms, live: true }); return pending.length; },
        clearTimeout: (id) => { if (pending[id - 1]) pending[id - 1].live = false; },
        live: { list: () => tab().filter((m) => m.audible), keys: () => [], on: () => {}, off: () => {} },
        now: () => t,
    });
    const step = (ms) => {
        const end = t + ms;
        while (t < end) {
            t = Math.min(end, t + 2000);
            for (const p of pending) if (p.live && p.at <= t) { p.live = false; p.fn(); }
            d.tick();
        }
    };
    return { d, step, starts, panel, setAudible: (v) => { audible = v; }, now: () => t };
}

for (const platform of ['darwin', 'win32']) {
    test(`${platform}: a quiet stretch in a tab-only call keeps the offer; the countdown never starts a call not seen`, () => {
        const r = quietTabRig(platform);
        r.d.tick(); r.step(4000);
        assert.equal(r.panel.filter(Boolean).length, 1, 'offered');
        const first = r.panel.at(-1);
        // Four seconds of silence in the tab: the offer stays up (a grace, not the end).
        r.setAudible(false); r.step(4000);
        assert.notEqual(r.panel.at(-1), null, 'a short quiet stretch does not withdraw it');
        // Still quiet when the countdown ends: no start, offer withdrawn.
        r.step(6000);
        assert.deepEqual(r.starts, [], 'not seen at the last poll: no automatic start');
        assert.equal(r.panel.at(-1), null);
        // Sound again within the minute: offered again, with a fresh countdown.
        r.setAudible(true); r.step(2000);
        const again = r.panel.at(-1);
        assert.ok(again, 'offered again');
        assert.equal(again.autoStartAt, r.now() + 10_000, 'a fresh countdown');
        assert.ok(again.autoStartAt > first.autoStartAt);
        r.step(10_000);
        assert.deepEqual(r.starts, [{ via: 'detected' }], 'the call is on: it starts');
    });

    test(`${platform}: a tab-only call that stays quiet past the grace is withdrawn, and comes back when it plays again`, () => {
        const r = quietTabRig(platform);
        r.d.tick(); r.step(4000);
        r.setAudible(false); r.step(22_000);
        assert.equal(r.panel.at(-1), null, 'gone after the grace');
        const offersBefore = r.panel.filter(Boolean).length;
        r.setAudible(true); r.step(2000);
        assert.equal(r.panel.filter(Boolean).length, offersBefore + 1, 'back: offered again');
    });
}

test('Not now, Start and a running meeting are final answers: no re-offer when the call comes back', () => {
    let t = 0;
    let active = false;
    const shown = [];
    const offers = new MeetingOffers({
        isMeetingActive: () => active, requestStart: () => {}, autoStart: () => false,
        showPanel: (o) => shown.push(o), notify: () => true, closeNotification: () => {}, launcherFocused: () => true,
        now: () => t, setTimeout: () => 1, clearTimeout: () => {},
    });
    const input = { app: 'Google Meet', body: 'x', start: { via: 'detected' }, callId: 'tab:meet:a' };
    const v = offers.offer(input);
    offers.dismiss(v.id);
    offers.callGone('tab:meet:a');
    offers.callBack('tab:meet:a');
    assert.equal(offers.view(), null, 'Not now holds');
    offers.offer(input);
    offers.callGone('tab:meet:a');
    active = true;
    offers.callBack('tab:meet:a');
    assert.equal(offers.view(), null, 'a meeting is running');
    active = false;
    offers.offer(input);
    offers.callGone('tab:meet:a');
    offers.callBack('tab:meet:other');
    assert.equal(offers.view(), null, 'another call is not this one');
    offers.callBack('tab:meet:a');
    assert.ok(offers.view(), 'the same call: back');
});

// ── 2. Dictation waits for work still on its way ──────────────────────────

class BusyStt extends EventEmitter {
    constructor() { super(); this.busyUntil = 0; this.now = () => 0; }
    setSampleRate() {} setAudioChannelCount() {} start() {} write() {} notifySpeechEnded() {} stop() {}
    hasPendingWork() { return this.now() < this.busyUntil; }
}
const pcm = () => Buffer.alloc(3200, 1);

test('an upload slower than the idle time is waited for (Groq, Azure, IBM, OpenAI REST)', async () => {
    let t = 0;
    const s = new BusyStt();
    s.now = () => t;
    s.busyUntil = 20_000; // a 20 s upload, far past the 8 s idle
    const session = new LiveDictationSession(() => s, {
        now: () => t, ...liveTimingFor('groq'),
        sleep: async (ms) => { t += ms; if (t >= 20_000 && !s.sent) { s.sent = true; s.emit('transcript', { text: 'the slow upload', isFinal: true }); } },
    });
    session.write(pcm(), 16000);
    assert.equal(await session.finish(), 'the slow upload');
});

test('a local final that comes back empty ends the wait (no hang to the hard limit)', async () => {
    let t = 0;
    const s = new BusyStt();
    s.now = () => t;
    s.finalize = () => true;      // a final is in flight…
    s.busyUntil = 3_000;          // …and its (empty) result arrives at 3 s
    const session = new LiveDictationSession(() => s, { now: () => t, sleep: async (ms) => { t += ms; }, idleMs: 1_500, timeoutMs: 120_000 });
    session.write(pcm(), 16000);
    assert.equal(await session.finish(), '');
    assert.ok(t < 6_000, `done at ${t} ms, not at the 120 s limit`);
});

test('the providers that upload or infer after the audio say when work is still on its way', () => {
    const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
    assert.match(read('electron/audio/RestSTT.ts'), /public hasPendingWork\(\): boolean \{[\s\S]*?this\.isUploading \|\| this\.flushPending/);
    assert.match(read('electron/audio/OpenAIStreamingSTT.ts'), /public hasPendingWork\(\): boolean \{[\s\S]*?this\.mode === 'rest' && \(this\.restIsUploading \|\| this\.restFlushPending\)/);
    const lw = read('electron/audio/LocalWhisperSTT.ts');
    assert.match(lw, /hasPendingWork\(\): boolean \{[\s\S]*?this\.pendingAudio\.length > 0 \|\| this\.finalTasksOutstanding > 0/);
    assert.match(lw, /if \(!streaming\) this\.finalTasksOutstanding\+\+;/);
    assert.equal((lw.match(/this\.finalTasksOutstanding = Math\.max\(0, this\.finalTasksOutstanding - 1\)/g) || []).length, 2, 'answered by a result or an error');
    // Every non-streaming provider id gets the long wait; streaming ones keep the short one.
    for (const id of ['groq', 'azure', 'ibmwatson']) assert.equal(liveTimingFor(id).idleMs, 8_000, id);
    assert.equal(liveTimingFor('openai', { openAiCustomEndpoint: true }).idleMs, 8_000);
    assert.equal(liveTimingFor('local-whisper').idleMs, 30_000);
    for (const id of ['deepgram', 'soniox', 'elevenlabs', 'natively', 'google', 'nvidia_nim', 'openai']) assert.equal(liveTimingFor(id).idleMs, 1_500, id);
});

test('a restored offer respects Undetectable and disguises like a new one', () => {
    const src = fs.readFileSync(path.join(REPO, 'electron/services/meetingDetection/wireMeetingDetection.ts'), 'utf8');
    assert.match(src, /onBack: \(id\) => \{\s*if \(deps\.promptsBlocked\(\)\) return;\s*offers\.callBack\(id\);/);
});
