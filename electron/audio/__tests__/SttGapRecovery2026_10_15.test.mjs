// Transcript gap recovery (2026-10-15): a streaming transcriber that drops or
// stalls must not leave a hole in the meeting transcript.
//
// Everything here runs against the built module with fake audio, a fake clock
// and fake transcribers: no socket, no provider, no network. The buffering
// sits above capture in shared TypeScript; macOS (CoreAudio tap /
// ScreenCaptureKit) and Windows (WASAPI) both deliver int16 LE mono from the
// same native DSP (native-module/src/lib.rs), at 16 kHz or, without the
// resampler, at the device rate — both rates are exercised below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '../../..');
const DIST = path.join(REPO, 'dist-electron/electron');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const gap = require(path.join(DIST, 'audio/sttGapRecovery.js'));

// ── fixtures ────────────────────────────────────────────────────────────

/** `ms` of int16 mono at `rate`: a tone (speech level) or silence. */
function pcm(ms, rate = 16000, amp = 3000) {
    const n = Math.round((rate * ms) / 1000);
    const b = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) b.writeInt16LE(amp ? Math.round(amp * Math.sin(i / 3)) : 0, i * 2);
    return b;
}

/** A fake clock plus a manual scheduler for the coordinator. */
function harness(opts = {}) {
    let now = 1_000_000;
    const timers = [];
    const recovered = [];
    const restarts = [];
    const logs = [];
    const calls = [];
    const transcribers = opts.transcribers ?? ((source) => [{
        id: 'fake', kind: 'same-provider',
        async transcribe(clip) { calls.push({ source, clip }); return `said at ${clip.startMs}`; },
    }]);
    const coord = new gap.SttGapRecoveryCoordinator({
        transcribers,
        onRecovered: (seg) => recovered.push(seg),
        restartStt: (source) => restarts.push(source),
        watchdogEnabled: opts.watchdogEnabled ?? (() => true),
        now: () => now,
        schedule: (fn, ms) => { const h = { fn, at: now + ms }; timers.push(h); return h; },
        cancel: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
        log: (level, msg) => logs.push({ level, msg }),
    }, opts.gapOptions ?? {});
    const h = {
        coord, recovered, restarts, logs, calls,
        get now() { return now; },
        /** Feeds `ms` of audio in 60 ms chunks (the native batch size), advancing the clock. */
        audio(source, ms, { amp = 3000, rate = 16000 } = {}) {
            for (let t = 0; t < ms; t += 60) {
                now += 60;
                coord.onAudio(source, pcm(60, rate, amp), rate);
            }
        },
        advance(ms) { now += ms; },
        async runTimers() {
            const due = timers.filter((t) => t.at <= now);
            for (const t of due) { timers.splice(timers.indexOf(t), 1); t.fn(); }
            await coord.whenIdle();
        },
    };
    return h;
}

// ── ring buffer ─────────────────────────────────────────────────────────

test('the ring buffer keeps at most its cap and evicts the oldest audio first', () => {
    const ring = new gap.PcmRingBuffer(1_000);
    let evicted = [];
    for (let i = 0; i < 30; i++) {
        evicted = evicted.concat(ring.push({ pcm: pcm(60), sampleRate: 16000, startMs: i * 60, durMs: 60, rms: 1000 }));
    }
    assert.ok(ring.durationMs() <= 1_000, `kept ${ring.durationMs()} ms`);
    assert.ok(ring.durationMs() > 1_000 - 60);
    assert.equal(evicted[0].startMs, 0, 'oldest first');
    assert.equal(ring.oldestStartMs(), evicted.length * 60);
    assert.deepEqual(ring.range(1200, 1300).map((f) => f.startMs), [1200, 1260]);
});

test('each source has its own 120 s ring: a long mic stretch never evicts system audio', () => {
    const h = harness({ watchdogEnabled: () => false });
    h.coord.startMeeting();
    h.audio('system', 10_000);
    h.audio('mic', 130_000);
    const mic = h.coord.getTracker('mic').ring.durationMs();
    const sys = h.coord.getTracker('system').ring.durationMs();
    assert.ok(mic <= 120_000 && mic > 119_000, `mic ${mic}`);
    assert.ok(Math.abs(sys - 10_020) < 100, `system ${sys}`);
});

test('an outage longer than the cap drops its oldest audio with one logged warning', () => {
    const h = harness({ watchdogEnabled: () => false, gapOptions: { capMs: 5_000 } });
    h.coord.startMeeting();
    h.audio('mic', 1_000);
    h.coord.onProviderError('mic');
    h.audio('mic', 10_000);
    const outage = h.coord.getOutage('mic');
    assert.ok(outage.droppedMs > 4_000, `dropped ${outage.droppedMs}`);
    const warns = h.logs.filter((l) => /oldest audio is dropped/.test(l.msg));
    assert.equal(warns.length, 1);
});

// ── outage → recovery ───────────────────────────────────────────────────

test('outage, then recovery: missed speech comes back at its original time, marked, in order', async () => {
    const h = harness({ watchdogEnabled: () => false });
    h.coord.startMeeting();
    h.audio('system', 2_000);
    h.audio('system', 4_000, { amp: 0 });
    h.coord.onTranscript('system', 'hello there everyone', true);
    const errorAt = h.now;
    h.coord.onProviderError('system');
    // Two utterances separated by a second of silence, inside the outage.
    h.audio('system', 2_000);
    h.audio('system', 1_200, { amp: 0 });
    h.audio('system', 2_000);
    h.audio('system', 1_200, { amp: 0 });
    // The connection is back.
    h.coord.onTranscript('system', 'back again now', true);
    assert.equal(h.coord.getOutage('system'), null, 'the first transcript closes the outage');
    assert.equal(h.recovered.length, 0, 'nothing before the settle delay');
    h.advance(gap.GAP_DEFAULTS.settleMs);
    await h.runTimers();

    assert.ok(h.recovered.length >= 2, `recovered ${h.recovered.length}`);
    for (const seg of h.recovered) {
        assert.equal(seg.marker, 'recovered');
        assert.equal(seg.source, 'system');
        assert.equal(seg.reason, 'error');
        assert.ok(seg.timestamp >= errorAt - gap.GAP_DEFAULTS.errorPrerollMs && seg.timestamp < h.now);
    }
    // Insert into a transcript holding the live lines: time order holds.
    const transcript = [
        { text: 'hello there everyone', timestamp: errorAt - 1_000 },
        { text: 'back again now', timestamp: errorAt + 6_500 },
    ];
    for (const seg of h.recovered) gap.insertSortedByTimestamp(transcript, seg);
    const times = transcript.map((s) => s.timestamp);
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
    assert.equal(transcript[0].text, 'hello there everyone');
    assert.equal(transcript[transcript.length - 1].text, 'back again now');
});

test('a recovered line the live transcript already has (the provider\'s own flush) is dropped', async () => {
    const h = harness({
        watchdogEnabled: () => false,
        transcribers: () => [{ id: 'fake', kind: 'same-provider', transcribe: async () => 'we should ship on friday' }],
    });
    h.coord.startMeeting();
    h.coord.onProviderError('mic');
    h.audio('mic', 2_000);
    h.coord.onTranscript('mic', 'We should ship on Friday.', true);
    h.advance(gap.GAP_DEFAULTS.settleMs);
    await h.runTimers();
    assert.equal(h.recovered.length, 0);
});

test('silence and noise in an outage cost no request', async () => {
    const h = harness({ watchdogEnabled: () => false });
    h.coord.startMeeting();
    h.coord.onProviderError('mic');
    h.audio('mic', 5_000, { amp: 50 });
    h.coord.onTranscript('mic', 'ok', true);
    h.advance(gap.GAP_DEFAULTS.settleMs);
    await h.runTimers();
    assert.equal(h.calls.length, 0);
});

test('a meeting that ends before the settle delay recovers nothing into the next one', async () => {
    const h = harness({ watchdogEnabled: () => false });
    h.coord.startMeeting();
    h.coord.onProviderError('mic');
    h.audio('mic', 2_000);
    h.coord.onTranscript('mic', 'x', true);
    h.coord.endMeeting();
    h.coord.startMeeting();
    h.advance(gap.GAP_DEFAULTS.settleMs);
    await h.runTimers();
    assert.equal(h.calls.length, 0);
    assert.equal(h.recovered.length, 0);
});

// ── transcribers: replay, batch fallback, privacy ───────────────────────

test('a provider without replay goes to the batch path; a failing transcriber hands over to the next', async () => {
    const plan = gap.planRecoveryTranscribers({
        primaryProvider: 'natively', effectiveProvider: 'natively', localOnly: false,
        configuredCloud: ['groq'], localModelAvailable: true,
    });
    assert.deepEqual(plan, [{ id: 'groq', kind: 'cloud' }, { id: 'local-whisper', kind: 'local' }]);

    const used = [];
    const h = harness({
        watchdogEnabled: () => false,
        transcribers: () => [
            { id: 'groq', kind: 'cloud', transcribe: async () => { used.push('groq'); throw new Error('429'); } },
            { id: 'local-whisper', kind: 'local', transcribe: async () => { used.push('local'); return 'from the local model'; } },
        ],
    });
    h.coord.startMeeting();
    h.coord.onProviderError('mic');
    h.audio('mic', 2_000);
    h.coord.onTranscript('mic', 'z', true);
    h.advance(gap.GAP_DEFAULTS.settleMs);
    await h.runTimers();
    assert.deepEqual(used, ['groq', 'local']);
    assert.equal(h.recovered[0].transcriberId, 'local-whisper');
});

test('a replay-capable provider replays itself first, then other saved providers, the local model last', () => {
    assert.deepEqual(gap.planRecoveryTranscribers({
        primaryProvider: 'deepgram', effectiveProvider: 'deepgram', localOnly: false,
        configuredCloud: ['deepgram', 'groq', 'soniox'], localModelAvailable: true,
    }), [
        { id: 'deepgram', kind: 'same-provider' },
        { id: 'groq', kind: 'cloud' },
        { id: 'soniox', kind: 'cloud' },
        { id: 'local-whisper', kind: 'local' },
    ]);
    assert.equal(gap.REPLAY_CAPABLE_PROVIDERS.has('natively'), false, 'a second Natively session would collide with the live one');
});

test('Qwen can replay its own missed audio and serve as a configured cloud fallback', () => {
    assert.deepEqual(gap.planRecoveryTranscribers({
        primaryProvider: 'qwen', effectiveProvider: 'qwen', localOnly: false,
        configuredCloud: ['qwen'], localModelAvailable: false,
    }), [{ id: 'qwen', kind: 'same-provider' }]);
    assert.deepEqual(gap.planRecoveryTranscribers({
        primaryProvider: 'soniox', effectiveProvider: 'soniox', localOnly: false,
        configuredCloud: ['qwen'], localModelAvailable: false,
    }), [
        { id: 'soniox', kind: 'same-provider' },
        { id: 'qwen', kind: 'cloud' },
    ]);
});

test('local-only transcription never sends recovery audio to a cloud provider', async () => {
    for (const input of [
        { primaryProvider: 'local-whisper', effectiveProvider: 'local-whisper', localOnly: false },
        { primaryProvider: 'apple-speech', effectiveProvider: 'apple-speech', localOnly: false },
        { primaryProvider: 'deepgram', effectiveProvider: 'deepgram', localOnly: true },
    ]) {
        const plan = gap.planRecoveryTranscribers({ ...input, configuredCloud: ['groq', 'openai', 'deepgram'], localModelAvailable: true });
        assert.deepEqual(plan, [{ id: 'local-whisper', kind: 'local' }], JSON.stringify(input));
        const none = gap.planRecoveryTranscribers({ ...input, configuredCloud: ['groq'], localModelAvailable: false });
        assert.deepEqual(none, [], 'no local model: nothing, never a cloud stand-in');
    }

    // End to end: transcribers built from the local-only plan; a cloud one is never called.
    const cloudCalls = [];
    const fakes = {
        groq: { id: 'groq', kind: 'cloud', transcribe: async () => { cloudCalls.push('groq'); return 'leaked'; } },
        'local-whisper': { id: 'local-whisper', kind: 'local', transcribe: async () => 'kept on this machine' },
    };
    const h = harness({
        watchdogEnabled: () => false,
        transcribers: () => gap.planRecoveryTranscribers({
            primaryProvider: 'deepgram', effectiveProvider: 'deepgram', localOnly: true,
            configuredCloud: ['groq'], localModelAvailable: true,
        }).map((e) => fakes[e.id]).filter(Boolean),
    });
    h.coord.startMeeting();
    h.coord.onProviderError('system');
    h.audio('system', 2_000);
    h.coord.onTranscript('system', 'q', true);
    h.advance(gap.GAP_DEFAULTS.settleMs);
    await h.runTimers();
    assert.deepEqual(cloudCalls, []);
    assert.equal(h.recovered[0].text, 'kept on this machine');
});

test('the replay transcriber feeds a private instance faster than real time and returns its finals', async () => {
    let clock = 0;
    const events = [];
    const listeners = {};
    const fake = {
        on(ev, fn) { (listeners[ev] ??= []).push(fn); },
        removeAllListeners() {},
        setSampleRate(r) { events.push(['rate', r]); },
        setAudioChannelCount(c) { events.push(['ch', c]); },
        start() { events.push(['start']); },
        write(b) { events.push(['write', b.length]); },
        notifySpeechEnded() { events.push(['speechEnded']); },
        finalize() {
            events.push(['finalize']);
            listeners.transcript.forEach((fn) => fn({ text: 'partial', isFinal: false }));
            listeners.transcript.forEach((fn) => fn({ text: 'the missed words', isFinal: true }));
        },
        stop() { events.push(['stop']); },
    };
    const t = gap.createReplayTranscriber('deepgram', 'same-provider', () => fake, {
        speed: 2, sleep: async (ms) => { clock += ms; }, now: () => clock,
    });
    const clip = { pcm: pcm(1_000, 48000), sampleRate: 48000, startMs: 0, endMs: 1_000, speechMs: 1_000 };
    const text = await t.transcribe(clip);
    assert.equal(text, 'the missed words');
    assert.deepEqual(events[0], ['rate', 48000], 'the clip\'s own rate (no 16 kHz assumption)');
    const written = events.filter((e) => e[0] === 'write').reduce((a, e) => a + e[1], 0);
    assert.ok(written >= clip.pcm.length, 'every byte of the clip, plus a silence tail');
    assert.deepEqual(events.at(-1), ['stop'], 'the private instance is always closed');
    // 1 s of audio + 1.2 s tail at 2x is about 1.1 s of feeding, not 2.2 s.
    assert.ok(clock < 1_000 + 1_200 + gap.REPLAY_DEFAULTS.idleMs + 500, `fed in ${clock} ms`);
});

test('a replay that only errors throws, so the next transcriber gets the clip', async () => {
    let clock = 0;
    const listeners = {};
    const fake = {
        on(ev, fn) { (listeners[ev] ??= []).push(fn); },
        setSampleRate() {}, start() { listeners.error.forEach((fn) => fn(new Error('socket refused'))); },
        write() {}, stop() {},
    };
    const t = gap.createReplayTranscriber('soniox', 'same-provider', () => fake, { sleep: async (ms) => { clock += ms; }, now: () => clock });
    await assert.rejects(t.transcribe({ pcm: pcm(200), sampleRate: 16000, startMs: 0, endMs: 200, speechMs: 200 }), /socket refused/);
    const missing = gap.createReplayTranscriber('x', 'cloud', () => null);
    await assert.rejects(missing.transcribe({ pcm: pcm(200), sampleRate: 16000, startMs: 0, endMs: 200, speechMs: 200 }), /not available/);
});

// ── stall watchdog ──────────────────────────────────────────────────────

test('stall decision table', () => {
    const base = { nowMs: 20_000, quietSinceMs: 0, speechMsSinceQuiet: 5_000, stallMs: 15_000, stallSpeechMs: 4_000 };
    assert.equal(gap.shouldDeclareStall(base), true);
    assert.equal(gap.shouldDeclareStall({ ...base, nowMs: 14_000 }), false, 'not quiet long enough');
    assert.equal(gap.shouldDeclareStall({ ...base, speechMsSinceQuiet: 3_000 }), false, 'too little speech went in');
    assert.equal(gap.stallBackoffMs(0, 15_000, 120_000), 15_000);
    assert.equal(gap.stallBackoffMs(1, 15_000, 120_000), 30_000);
    assert.equal(gap.stallBackoffMs(5, 15_000, 120_000), 120_000);
});

test('speech going in with no transcript out reconnects the channel and opens a stall outage', async () => {
    const h = harness();
    h.coord.startMeeting();
    h.coord.onTranscript('system', 'last words before the stall', true);
    h.audio('system', 16_000);
    assert.deepEqual(h.restarts, ['system']);
    assert.equal(h.coord.getOutage('system').reason, 'stall');
    // Still nothing: the next restart waits for the doubled interval.
    h.audio('system', 16_000);
    assert.equal(h.restarts.length, 1);
    h.audio('system', 16_000);
    assert.equal(h.restarts.length, 2);
    // Text comes back: the outage closes and its speech is recovered.
    h.coord.onTranscript('system', 'and we are back', true);
    h.advance(gap.GAP_DEFAULTS.settleMs);
    await h.runTimers();
    assert.ok(h.recovered.length > 0);
    assert.ok(h.recovered.every((s) => s.reason === 'stall'));
});

test('no stall from silence, from a healthy stream, or where the watchdog is off', () => {
    const silent = harness();
    silent.coord.startMeeting();
    silent.audio('mic', 30_000, { amp: 0 });
    assert.deepEqual(silent.restarts, []);

    const healthy = harness();
    healthy.coord.startMeeting();
    for (let i = 0; i < 10; i++) { healthy.audio('mic', 3_000); healthy.coord.onTranscript('mic', 'words', false); }
    assert.deepEqual(healthy.restarts, []);

    const rest = harness({ watchdogEnabled: (s) => s !== 'mic' });
    rest.coord.startMeeting();
    rest.audio('mic', 30_000);
    assert.deepEqual(rest.restarts, [], 'a REST provider has no connection to stall');
    assert.equal(rest.coord.getOutage('mic'), null);
});

test('nothing is buffered outside a meeting', () => {
    const h = harness();
    h.audio('mic', 5_000);
    assert.equal(h.coord.getTracker('mic').ring.size(), 0);
});

// ── clips ───────────────────────────────────────────────────────────────

test('clips: silence splits them, a rate change splits them, noise alone is dropped', () => {
    const frames = [];
    let t = 0;
    const add = (ms, rate, amp) => {
        for (let i = 0; i < ms; i += 60) {
            const buf = pcm(60, rate, amp);
            frames.push({ pcm: buf, sampleRate: rate, startMs: t, durMs: 60, rms: gap.pcmRms(buf) });
            t += 60;
        }
    };
    add(1_200, 16000, 3000);
    add(1_000, 16000, 0);
    add(1_200, 48000, 3000); // the device rate when the resampler is unavailable
    add(2_000, 48000, 40);   // noise floor
    const clips = gap.splitIntoSpeechClips(frames);
    assert.equal(clips.length, 2);
    assert.deepEqual(clips.map((c) => c.sampleRate), [16000, 48000]);
    assert.ok(clips[0].startMs < clips[1].startMs);
    assert.equal(clips[1].pcm.length % 2, 0);
});

test('isCoveredByLive matches word pairs, not common words', () => {
    assert.equal(gap.isCoveredByLive('we should ship on friday', ['We should ship on Friday.']), true);
    assert.equal(gap.isCoveredByLive('the budget is the problem', ['the plan is the thing and the team is the best']), false);
    assert.equal(gap.isCoveredByLive('Priya', ['thanks Priya']), true);
    assert.equal(gap.isCoveredByLive('', []), true);
});

// ── session insertion and main wiring ───────────────────────────────────

test('SessionTracker puts a recovered line at its time without triggering anything', () => {
    const { SessionTracker } = require(path.join(DIST, 'SessionTracker.js'));
    const s = new SessionTracker();
    const now = Date.now();
    s.addTranscript({ speaker: 'interviewer', text: 'first', timestamp: now - 5_000, final: true });
    s.addTranscript({ speaker: 'interviewer', text: 'third', timestamp: now - 1_000, final: true });
    assert.equal(s.insertRecoveredTranscript({ speaker: 'interviewer', text: 'second', timestamp: now - 3_000, final: true, marker: 'recovered', origin: 'stt' }), true);
    assert.deepEqual(s.getFullTranscript().map((x) => [x.text, x.marker ?? null]), [['first', null], ['second', 'recovered'], ['third', null]]);
    assert.deepEqual(s.getContext(120).map((x) => x.text), ['first', 'second', 'third']);
    assert.equal(s.insertRecoveredTranscript({ speaker: 'user', text: '  ', timestamp: now, final: true }), false);
});

test('main feeds both captures, opens outages on retryable errors only, and starts recovery for cloud providers only', () => {
    const main = read('electron/main.ts');
    assert.match(main, /this\.googleSTT\?\.write\(chunk\);[\s\S]{0,300}this\.sttGap\.onAudio\('system', chunk, gapRate\)/);
    // The mic chunk passes the mute gate first (MeetingMuteSync); both sinks get the gated copy.
    assert.match(main, /this\.googleSTT_User\?\.write\(heard\);[\s\S]{0,300}this\.sttGap\.onAudio\('mic', heard, gapRate\)/);
    // The error hook sits after the terminal (auth / local unavailable) return.
    const err = main.indexOf('this.sttGap.onProviderError(gapSource)');
    assert.ok(err > main.indexOf('if (isAuthError || isLocalSttUnavailable) {'));
    assert.match(main, /if \(provider !== 'none' && !LOCAL_STT_PROVIDERS\.has\(provider\)\) this\.sttGap\.startMeeting\(\)/);
    assert.match(main, /this\._isDraining = true;\s*this\.sttGap\.endMeeting\(\);/);
    assert.match(main, /insertRecoveredTranscript\(\{[\s\S]{0,200}marker: 'recovered'/);
});

test('a local model is loaded once per outage, not once per clip, and closed when the outage is done', async () => {
    let clock = 0;
    let created = 0;
    let stopped = 0;
    const make = () => {
        created++;
        const listeners = {};
        return {
            on(ev, fn) { (listeners[ev] ??= []).push(fn); },
            removeAllListeners() {},
            setSampleRate() {}, start() {}, write() {},
            finalize() { listeners.transcript.forEach((fn) => fn({ text: `clip ${clock}`, isFinal: true })); },
            stop() { stopped++; },
        };
    };
    const t = gap.createReplayTranscriber('local-whisper', 'local', make, {
        reuseInstance: true, sleep: async (ms) => { clock += ms; }, now: () => clock,
    });
    const clip = { pcm: pcm(300), sampleRate: 16000, startMs: 0, endMs: 300, speechMs: 300 };
    await t.transcribe(clip);
    await t.transcribe(clip);
    assert.equal(created, 1);
    assert.equal(stopped, 0);
    await t.transcribe({ ...clip, pcm: pcm(300, 48000), sampleRate: 48000 });
    assert.equal(created, 2, 'another rate, another instance');
    t.dispose();
    assert.equal(stopped, 2);

    // The coordinator disposes the outage's transcribers when it is done.
    let disposed = 0;
    const h = harness({
        watchdogEnabled: () => false,
        transcribers: () => [{ id: 'local-whisper', kind: 'local', transcribe: async () => 'x y z', dispose: () => { disposed++; } }],
    });
    h.coord.startMeeting();
    h.coord.onProviderError('mic');
    h.audio('mic', 2_000);
    h.coord.onTranscript('mic', 'q', true);
    h.advance(gap.GAP_DEFAULTS.settleMs);
    await h.runTimers();
    assert.equal(disposed, 1);
});

test('the recovery factory reuses the local instance and gives batch and local providers time to answer', () => {
    const src = read('electron/audio/sttRecoveryTranscribers.ts');
    assert.match(src, /reuseInstance: entry\.kind === 'local'/);
    assert.match(src, /IDLE_MS[^\n]*groq: 8_000[^\n]*'local-whisper': 30_000/);
    // Privacy is the plan's decision, not the factory's.
    assert.match(src, /currentRecoveryPlan\(source, ctx\)\.map\(/);
});
