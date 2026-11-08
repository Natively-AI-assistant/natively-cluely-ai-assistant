// PR 654 review fixes (2026-10-15): a retired transcription stand-in keeps an
// error listener; dictation hands the whole recording to the replay after a
// live error and waits as long as its provider needs; a detected call's
// automatic start is cancelled when the call ends; a calendar occurrence is
// reminded once even when the lead time shrinks. Fake providers, clocks and
// timers; platform-neutral modules (the detector's darwin and win32 inputs
// both run).
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
const { SttFailover, retireStandIn } = require(dist('audio/sttFailover.js'));
const { LiveDictationSession, liveTimingFor } = require(dist('services/dictation/dictationSession.js'));
const { MeetingOffers, planReminders, reminderKey, pruneReminded } = require(dist('services/meetingDetection/meetingOffer.js'));
const { wireMeetingDetection } = require(dist('services/meetingDetection/wireMeetingDetection.js'));

class FakeStt extends EventEmitter {
    constructor() { super(); this.stopped = 0; }
    setSampleRate() {} setAudioChannelCount() {} start() {} write() {} notifySpeechEnded() {}
    stop() { this.stopped++; }
}

// ── 1. Failover: a late error from a stopped stand-in never crashes main ──

test('a stand-in dropped mid-upload keeps a quiet error listener after stop', () => {
    const made = [];
    const f = new SttFailover({
        source: 'system', primary: 'soniox', candidates: () => ['groq'],
        create: () => { const s = new FakeStt(); made.push(s); return s; },
        onTranscript: () => {}, onStatus: () => {}, restartPrimary: () => {},
        setInterval: () => 1, clearInterval: () => {},
    });
    f.engage();
    const groq = made[0];
    assert.equal(f.acceptPrimary({ text: 'back again now', isFinal: true }), true);
    assert.equal(groq.stopped, 1);
    assert.equal(groq.listenerCount('transcript'), 0, 'its text is no longer wanted');
    assert.equal(groq.listenerCount('error'), 1, 'one quiet listener left');
    assert.doesNotThrow(() => groq.emit('error', new Error('upload failed after stop')));
    // The same for an instance retired directly (one that failed to start).
    const s = new FakeStt();
    s.on('error', () => { throw new Error('the old handler must be gone'); });
    retireStandIn(s);
    assert.doesNotThrow(() => s.emit('error', new Error('late')));
    assert.equal(s.stopped, 1);
});

// ── 2 and 3. Dictation's live session ──────────────────────────────────────

function liveStt({ finalizeReturns } = {}) {
    const s = new FakeStt();
    s.finalize = () => finalizeReturns;
    return s;
}
const pcm = (ms = 100, rate = 16000) => Buffer.alloc(Math.round((rate * ms) / 1000) * 2, 1);

test('a live error after some words: finish throws, so the whole recording is replayed', async () => {
    const s = liveStt();
    const session = new LiveDictationSession(() => s, { sleep: async () => {}, idleMs: 0, timeoutMs: 0 });
    session.write(pcm(), 16000);
    s.emit('transcript', { text: 'send the deck', isFinal: true });
    s.emit('error', new Error('socket closed'));
    await assert.rejects(session.finish(), /socket closed/);
    assert.equal(s.listenerCount('error'), 1, 'its error listener stays after dispose');
});

test('finish waits for a final still on the way (a local model) and for a batch upload, within the provider\'s limit', async () => {
    let t = 0;
    const sleep = async (ms) => { t += ms; };
    // Local model: finalize() says a final is coming; it lands at 9 s, past any streaming idle wait.
    const local = liveStt({ finalizeReturns: true });
    let landed = false;
    const sleepLanding = async (ms) => { await sleep(ms); if (!landed && t >= 9_000) { landed = true; local.emit('transcript', { text: 'late words', isFinal: true }); } };
    const s1 = new LiveDictationSession(() => local, { sleep: sleepLanding, now: () => t, idleMs: 1_500, timeoutMs: 120_000 });
    s1.write(pcm(), 16000);
    assert.equal(await s1.finish(), 'late words', 'held for the announced final even with a short idle');

    // Groq (batch): nothing until the upload returns at 6 s; the 8 s idle covers it.
    t = 0;
    const groq = liveStt();
    let sent = false;
    const s2 = new LiveDictationSession(() => groq, {
        now: () => t, ...liveTimingFor('groq'),
        sleep: async (ms) => { t += ms; if (!sent && t >= 6_000) { sent = true; groq.emit('transcript', { text: 'uploaded text', isFinal: true }); } },
    });
    s2.write(pcm(), 16000);
    assert.equal(await s2.finish(), 'uploaded text');

    // The hard limit still ends a wait that never resolves.
    t = 0;
    const stuck = liveStt({ finalizeReturns: true });
    const s3 = new LiveDictationSession(() => stuck, { sleep, now: () => t, idleMs: 1_000, timeoutMs: 5_000 });
    s3.write(pcm(), 16000);
    assert.equal(await s3.finish(), '');
    assert.ok(t >= 5_000 && t < 6_000);

    assert.deepEqual(liveTimingFor('groq'), { idleMs: 8_000, timeoutMs: 45_000 });
    assert.deepEqual(liveTimingFor('openai', { openAiCustomEndpoint: true }), { idleMs: 8_000, timeoutMs: 45_000 });
    assert.equal(liveTimingFor('local-whisper').idleMs, 30_000);
    assert.equal(liveTimingFor('deepgram').idleMs, 1_500, 'streaming keeps the short wait');
    const wiring = fs.readFileSync(path.join(REPO, 'electron/services/dictation/wireDictation.ts'), 'utf8');
    assert.match(wiring, /liveTiming: \(\) => \{[\s\S]*?liveTimingFor\(sttProvider\(\)/);
});

// ── 4. The automatic start follows the call ────────────────────────────────

for (const [platform, zoom] of [['darwin', { pid: 7, bundleId: 'us.zoom.xos' }], ['win32', { path: 'C:\\z\\Zoom.exe' }]]) {
    test(`${platform}: the call ends during the countdown, so nothing starts`, () => {
        let t = 0;
        let mic = [zoom];
        const pending = [];
        const starts = [];
        const panel = [];
        const d = wireMeetingDetection({
            platform,
            native: { getMicUsers: () => mic, getVisibleWindows: () => [] },
            self: platform === 'win32' ? { pid: 1, execPath: 'C:\\n\\Natively.exe' } : { pid: 1, execPath: '/Applications/Natively.app/Contents/MacOS/Natively' },
            isMeetingActive: () => false, promptsBlocked: () => false, events: () => null,
            requestStart: (r) => starts.push(r), notify: () => true, showPanel: (o) => panel.push(o),
            launcherFocused: () => true, autoStart: () => true,
            setTimeout: (fn, ms) => { pending.push({ fn, at: t + ms, live: true }); return pending.length; },
            clearTimeout: (id) => { if (pending[id - 1]) pending[id - 1].live = false; },
            live: { list: () => [], keys: () => [], on: () => {}, off: () => {} },
            now: () => t,
        });
        const run = () => { for (const p of pending) if (p.live && p.at <= t) { p.live = false; p.fn(); } };
        d.tick(); t += 4000; d.tick();
        assert.equal(panel.length, 1, 'offered');
        assert.ok(panel[0].autoStartAt);
        // The call ends 4 s into the countdown: the next poll clears the offer.
        t += 2000; mic = []; d.tick();
        assert.equal(panel.at(-1), null, 'offer withdrawn');
        t += 10_000; run();
        assert.deepEqual(starts, []);
    });
}

test('right before the automatic start, a call the detector no longer sees is not started', () => {
    let t = 0;
    const timers = [];
    let on = true;
    const starts = [];
    const offers = new MeetingOffers({
        isMeetingActive: () => false, requestStart: (r) => starts.push(r), autoStart: () => true,
        showPanel: () => {}, notify: () => true, closeNotification: () => {}, launcherFocused: () => true,
        callStillOn: (id) => on && id === 'app:Zoom',
        now: () => t, setTimeout: (fn, ms) => { timers.push({ fn, at: t + ms }); return timers.length; }, clearTimeout: () => {},
    });
    offers.offer({ app: 'Zoom', body: 'A Zoom call started.', start: { via: 'detected' }, callId: 'app:Zoom' });
    on = false;
    t = 10_000; timers[0].fn();
    assert.deepEqual(starts, []);
    assert.equal(offers.view(), null);
    // Still on: it starts. A Gone for another call leaves this one.
    on = true;
    offers.offer({ app: 'Zoom', body: 'x', start: { via: 'detected' }, callId: 'app:Zoom' });
    offers.callGone('app:Slack');
    assert.ok(offers.view());
    timers.at(-2).fn();
    assert.deepEqual(starts, [{ via: 'detected' }]);
});

// ── 6. A reminder is shown once per occurrence ────────────────────────────

test('a shorter lead after a reminder fired does not remind that occurrence again', () => {
    const now = Date.parse('2026-10-15T10:00:00Z');
    const ev = { id: 'sync', startTime: '2026-10-15T10:04:00Z', title: 'Sync' };
    const next = { id: 'sync', startTime: '2026-10-16T10:04:00Z', title: 'Sync' }; // tomorrow's instance
    // At 5 minutes the reminder for 10:04 is already due (in the past): none.
    assert.deepEqual(planReminders([ev], now, 5, new Set()), []);
    // It was shown at 09:59 with the 5-minute lead; the user now picks 2 minutes.
    const reminded = new Set([reminderKey(ev)]);
    assert.deepEqual(planReminders([next], now, 2, reminded), [], 'tomorrow\'s instance is past the 24 h window for now');
    const plan = planReminders([ev], now, 2, new Set());
    assert.equal(plan.length, 1, 'not reminded yet: scheduled');
    assert.equal(plan[0].delayMs, 2 * 60_000);
    assert.deepEqual(planReminders([ev], now, 2, reminded), [], 'reminded already: not again');
    // A moved meeting is a new occurrence.
    assert.equal(planReminders([{ ...ev, startTime: '2026-10-15T10:30:00Z' }], now, 2, reminded).length, 1);
    // Old occurrences are forgotten.
    const old = new Set([reminderKey({ id: 'a', startTime: '2026-10-13T09:00:00Z' }), reminderKey(ev)]);
    pruneReminded(old, now);
    assert.deepEqual([...old], [reminderKey(ev)]);
    const src = fs.readFileSync(path.join(REPO, 'electron/services/CalendarManager.ts'), 'utf8');
    assert.match(src, /this\.remindedOccurrences\.add\(reminderKey\(event\)\)/);
    assert.match(src, /planReminders\(events, now, leadMinutes, this\.remindedOccurrences\)/);
});
