// Mid-meeting transcription failover (2026-10-15, audio/sttFailover.ts): while
// a channel's cloud provider is down past main's reconnect policy, the next
// transcriber the user set up carries the live stream, until the primary is
// back. Fake providers, fake clock and timers: no socket, no network. The
// module is shared TypeScript; mic and system channels both run here, and the
// main-process wiring (both channels, auth errors never switch, gap recovery
// still told) is checked in the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '../../..');
const { SttFailover, failoverNotice, isTerminalSttError, sttProviderName } = require(path.join(REPO, 'dist-electron/electron/audio/sttFailover.js'));
const { planRecoveryTranscribers } = require(path.join(REPO, 'dist-electron/electron/audio/sttGapRecovery.js'));

class FakeStt extends EventEmitter {
    constructor(id) {
        super();
        this.id = id;
        this.writes = [];
        this.rate = null;
        this.channels = null;
        this.started = 0;
        this.stopped = 0;
        this.ended = 0;
    }
    setSampleRate(r) { this.rate = r; }
    setAudioChannelCount(c) { this.channels = c; }
    start() { this.started++; }
    write(chunk) { this.writes.push(chunk); }
    notifySpeechEnded() { this.ended++; }
    stop() { this.stopped++; }
}

function rig(source, { candidates = ['deepgram', 'local-whisper'], unavailable = [] } = {}) {
    let t = 0;
    const intervals = new Map();
    let seq = 0;
    const made = [];
    const out = [];
    const statuses = [];
    let restarts = 0;
    const failover = new SttFailover({
        source,
        primary: 'soniox',
        candidates: () => candidates,
        create: (id) => {
            if (unavailable.includes(id)) return null;
            const stt = new FakeStt(id);
            made.push(stt);
            return stt;
        },
        onTranscript: (seg, id) => out.push({ text: seg.text, final: seg.isFinal, id }),
        onStatus: (s) => statuses.push(s),
        restartPrimary: () => { restarts++; },
        now: () => t,
        setInterval: (fn, ms) => { const id = ++seq; intervals.set(id, { fn, ms, next: t + ms }); return id; },
        clearInterval: (id) => intervals.delete(id),
    }, { probeMs: 60_000 });
    const advance = (ms) => {
        t += ms;
        for (const iv of intervals.values()) {
            while (iv.next <= t) { iv.next += iv.ms; iv.fn(); }
        }
    };
    return { failover, made, out, statuses, advance, intervals, restarts: () => restarts };
}

const pcm = (n = 640) => Buffer.alloc(n);

for (const source of ['mic', 'system']) {
    test(`${source}: idle until engaged; the stand-in gets the audio, rate and speech ends; its text is live`, () => {
        const { failover, made, out, statuses } = rig(source);
        failover.setSampleRate(48_000);
        failover.setAudioChannelCount(1);
        failover.write(pcm());
        assert.equal(made.length, 0, 'nothing runs while the primary is fine');
        assert.equal(failover.active, false);

        assert.equal(failover.engage(), true);
        assert.equal(failover.active, true);
        assert.equal(failover.fallbackId, 'deepgram');
        const fb = made[0];
        assert.deepEqual([fb.rate, fb.channels, fb.started], [48_000, 1, 1], 'configured like the primary before it starts');
        assert.deepEqual(statuses, [{ source, phase: 'fallback', primary: 'soniox', fallback: 'deepgram' }]);

        failover.write(pcm(320));
        failover.notifySpeechEnded();
        failover.setSampleRate(16_000);
        assert.equal(fb.writes.length, 1);
        assert.equal(fb.ended, 1);
        assert.equal(fb.rate, 16_000);

        fb.emit('transcript', { text: 'we ship on', isFinal: false });
        fb.emit('transcript', { text: 'we ship on friday', isFinal: true });
        assert.deepEqual(out, [
            { text: 'we ship on', final: false, id: 'deepgram' },
            { text: 'we ship on friday', final: true, id: 'deepgram' },
        ]);
        assert.equal(failover.engage(), true, 'engaging again keeps the same stand-in');
        assert.equal(made.length, 1);
    });

    test(`${source}: the primary is back at its first final; a flushed line the stand-in already said is dropped`, () => {
        const { failover, made, statuses, intervals } = rig(source);
        failover.engage();
        const fb = made[0];
        fb.emit('transcript', { text: 'the budget is twelve thousand', isFinal: true });
        // Partials from the primary while it reconnects wait.
        assert.equal(failover.acceptPrimary({ text: 'the budget', isFinal: false }), false);
        assert.equal(failover.active, true);
        // Its first final: back. This one repeats the stand-in's line (flushed buffer).
        assert.equal(failover.acceptPrimary({ text: 'The budget is twelve thousand.', isFinal: true }), false);
        assert.equal(failover.active, false);
        assert.equal(fb.stopped, 1, 'stand-in stopped');
        assert.equal(fb.listenerCount('transcript'), 0);
        assert.equal(intervals.size, 0, 'probe stopped');
        assert.deepEqual(statuses.at(-1), { source, phase: 'primary', primary: 'soniox', fallback: null, reason: 'recovered' });
        // Everything after goes through as usual; the stand-in's late text does not.
        assert.equal(failover.acceptPrimary({ text: 'next point', isFinal: false }), true);
        fb.emit('transcript', { text: 'late', isFinal: true });
        failover.write(pcm());
        assert.equal(fb.writes.length, 0);

        // A new line at the switch-back goes through.
        const r = rig(source);
        r.failover.engage();
        r.made[0].emit('transcript', { text: 'hello there', isFinal: true });
        assert.equal(r.failover.acceptPrimary({ text: 'and the timeline is march', isFinal: true }), true);
    });

    test(`${source}: while a stand-in leads the primary is restarted every minute, for providers that latch off`, () => {
        const { failover, advance, restarts } = rig(source);
        failover.engage();
        advance(59_000);
        assert.equal(restarts(), 0);
        advance(1_000);
        assert.equal(restarts(), 1);
        advance(120_000);
        assert.equal(restarts(), 3);
        failover.acceptPrimary({ text: 'back', isFinal: true });
        advance(300_000);
        assert.equal(restarts(), 3);
    });

    test(`${source}: a failing stand-in hands over; a refused key at once; none left reports exhausted and waits`, () => {
        const { failover, made, statuses, out, advance } = rig(source, { candidates: ['deepgram', 'groq', 'local-whisper'], unavailable: ['groq'] });
        failover.engage();
        const dg = made[0];
        const err = (m, extra = {}) => Object.assign(new Error(m), extra);
        dg.emit('error', err('socket closed'));
        dg.emit('error', err('socket closed'));
        assert.equal(failover.fallbackId, 'deepgram', 'two errors: still trying');
        dg.emit('transcript', { text: 'still here', isFinal: true });
        dg.emit('error', err('socket closed'));
        dg.emit('error', err('socket closed'));
        assert.equal(failover.fallbackId, 'deepgram', 'a final in between resets its count');
        dg.emit('error', err('socket closed'));
        assert.equal(failover.fallbackId, 'local-whisper', 'three in a row: next one (groq is not set up)');
        assert.equal(dg.stopped, 1);
        const local = made[1];
        local.emit('error', err('model failed', { code: 'local_stt_unavailable' }));
        assert.equal(failover.active, false, 'none left');
        assert.deepEqual(statuses.at(-1), { source, phase: 'primary', primary: 'soniox', fallback: null, reason: 'exhausted' });
        assert.equal(failover.engage(), false, 'not again on the very next error');
        advance(119_000);
        assert.equal(failover.engage(), false);
        advance(1_000);
        assert.equal(failover.engage(), true, 'after two minutes, another try');
        assert.equal(out.length, 1);
    });

    test(`${source}: nothing set up means no switch; the primary itself is never its own stand-in; stop ends it quietly`, () => {
        const none = rig(source, { candidates: [] });
        assert.equal(none.failover.engage(), false);
        assert.deepEqual(none.statuses, []);
        const self = rig(source, { candidates: ['soniox'] });
        assert.equal(self.failover.engage(), false);
        assert.equal(self.made.length, 0);

        const r = rig(source);
        r.failover.engage();
        r.failover.stop();
        assert.equal(r.failover.active, false);
        assert.equal(r.made[0].stopped, 1);
        assert.equal(r.statuses.length, 1, 'a teardown reports nothing');
        assert.equal(r.intervals.size, 0);
    });
}

test('the stand-ins follow gap recovery\'s privacy plan: local-only never reaches a cloud provider', () => {
    // Main asks failoverCandidates, which is this plan minus the failing provider.
    const cloud = planRecoveryTranscribers({ primaryProvider: 'soniox', effectiveProvider: 'soniox', localOnly: false, configuredCloud: ['deepgram', 'soniox'], localModelAvailable: true })
        .filter((e) => e.kind !== 'same-provider').map((e) => e.id);
    assert.deepEqual(cloud, ['deepgram', 'local-whisper']);
    const localOnly = planRecoveryTranscribers({ primaryProvider: 'soniox', effectiveProvider: 'soniox', localOnly: true, configuredCloud: ['deepgram'], localModelAvailable: true })
        .filter((e) => e.kind !== 'same-provider').map((e) => e.id);
    assert.deepEqual(localOnly, ['local-whisper']);
    const src = fs.readFileSync(path.join(REPO, 'electron/audio/sttRecoveryTranscribers.ts'), 'utf8');
    assert.match(src, /export function failoverCandidates[\s\S]*?currentRecoveryPlan\(source, ctx\)[\s\S]*?entry\.kind !== 'same-provider'/);
});

test('the notice and what counts as a refused key', () => {
    assert.equal(failoverNotice('soniox', 'deepgram'), 'Transcribing with Deepgram while Soniox is down.');
    assert.equal(failoverNotice('natively', 'local-whisper'), 'Transcribing with the local model while Natively is down.');
    assert.equal(sttProviderName('unknown-x'), 'unknown-x');
    assert.equal(isTerminalSttError(Object.assign(new Error('Request failed'), { response: { status: 401 } })), true);
    assert.equal(isTerminalSttError(new Error('invalid_key')), true);
    assert.equal(isTerminalSttError(new Error('socket hang up')), false);
    assert.equal(isTerminalSttError(Object.assign(new Error('x'), { response: { status: 503 } })), false);
});

test('main wires it on both channels, never on an auth error, and keeps gap recovery fed', () => {
    const main = fs.readFileSync(path.join(REPO, 'electron/main.ts'), 'utf8');
    // Both channels get the stand-in's audio, rate and speech ends.
    for (const ch of ['system', 'mic']) {
        assert.match(main, new RegExp(`this\\._sttFailover\\.${ch}\\?\\.write\\(`), `${ch} audio`);
        assert.match(main, new RegExp(`this\\._sttFailover\\.${ch}\\?\\.setSampleRate\\(rate\\)`), `${ch} rate`);
        assert.match(main, new RegExp(`this\\._sttFailover\\.${ch}\\?\\.notifySpeechEnded\\(\\)`), `${ch} speech end`);
    }
    // The error handler: auth/terminal returns before any failover; engage only past the policy.
    const handler = main.slice(main.indexOf("stt.on('error', (raw: unknown) => {"));
    const authReturn = handler.indexOf('if (isAuthError || isLocalSttUnavailable) {');
    const activeGuard = handler.indexOf('if (failover.active) return;');
    const gapError = handler.indexOf('this.sttGap.onProviderError(gapSource);');
    const engage = handler.indexOf('if (failover.engage()) return;');
    const policy = handler.indexOf('if (_consecutiveErrors >= maxErrors || isQuotaError) {');
    assert.ok(authReturn > 0 && authReturn < activeGuard, 'auth errors are terminal before failover is consulted');
    assert.ok(activeGuard < gapError && gapError < policy && policy < engage, 'gap recovery still opens the outage; failover only past the policy');
    // The stand-in's text runs the same handler, which closes the gap outage.
    assert.match(main, /onTranscript: \(seg, id\) => onSegment\(/);
    const onSegment = main.slice(main.indexOf('const onSegment = '), main.indexOf('this._sttFailover[gapSource]?.stop();'));
    assert.match(onSegment, /this\.sttGap\.onTranscript\(gapSource, segment\.text, segment\.isFinal\)/);
    assert.match(onSegment, /sttProvider: sttId/);
    // Every teardown of the provider ends its stand-in.
    assert.match(main, /\(stt as any\)\.stop = \(\) => \{\s*failover\.stop\(\);\s*return rawStop\(\);/);
});
