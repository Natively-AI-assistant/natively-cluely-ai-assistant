// Live-pipeline forensics F-ACC-09 (2026-11-13): STT outage paths lost
// questions.
//   D1  At failover hand-back the primary's first final was dropped when half
//       its word pairs appeared in ANY stand-in line of the last minute, so a
//       new question that shares its frame with an earlier one ("What is your
//       experience with Kafka?" after "…with Redis?") vanished.
//   D8  Only that first final was checked; the rest of the primary's flushed
//       buffer repeated what the stand-in had already said.
//   D2  The stall watchdog restarted the channel through the wrapped stop(),
//       which also ends the stand-in, silently, while it carried the channel.
//   D5  A line recovered after an outage was put in the transcript but never
//       reached Auto Answer.
// Fake providers and clock; shared TypeScript, the same on macOS and Windows.
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
const { SttFailover } = require(path.join(REPO, 'dist-electron/electron/audio/sttFailover.js'));
const gap = require(path.join(REPO, 'dist-electron/electron/audio/sttGapRecovery.js'));

class FakeStt extends EventEmitter {
    setSampleRate() {}
    setAudioChannelCount() {}
    start() {}
    write() {}
    stop() { this.stopped = (this.stopped ?? 0) + 1; }
}

function rig() {
    let t = 0;
    const made = [];
    const failover = new SttFailover({
        source: 'system',
        primary: 'soniox',
        candidates: () => ['deepgram'],
        create: () => { const s = new FakeStt(); made.push(s); return s; },
        onTranscript: () => {},
        onStatus: () => {},
        restartPrimary: () => {},
        now: () => t,
        setInterval: () => 1,
        clearInterval: () => {},
    });
    return { failover, made, advance: (ms) => { t += ms; } };
}

test('D1: a new question at the hand-back that shares its frame with a stand-in line goes through', () => {
    const { failover, made } = rig();
    failover.engage();
    made[0].emit('transcript', { text: 'What is your experience with Redis?', isFinal: true });
    assert.equal(
        failover.acceptPrimary({ text: 'What is your experience with Kafka?', isFinal: true }),
        true,
        'a different question is not a duplicate',
    );
    assert.equal(failover.active, false, 'the primary leads again');
});

test('D1: the primary repeating the stand-in (its flushed buffer) is still dropped, wording aside', () => {
    const { failover, made } = rig();
    failover.engage();
    made[0].emit('transcript', { text: 'What is your experience with Redis?', isFinal: true });
    assert.equal(failover.acceptPrimary({ text: 'what is your experience with redis', isFinal: true }), false);
    const one = rig();
    one.failover.engage();
    one.made[0].emit('transcript', { text: 'Yes.', isFinal: true });
    assert.equal(one.failover.acceptPrimary({ text: 'yes', isFinal: true }), false, 'a one-word repeat');
});

test('D8: the rest of the flushed buffer is checked for a short while after the hand-back, then not', () => {
    const { failover, made, advance } = rig();
    failover.engage();
    made[0].emit('transcript', { text: 'Tell me about your last project.', isFinal: true });
    made[0].emit('transcript', { text: 'How big was the team?', isFinal: true });
    assert.equal(failover.acceptPrimary({ text: 'Tell me about your last project', isFinal: true }), false);
    advance(1_000);
    assert.equal(failover.acceptPrimary({ text: 'How big was the team', isFinal: true }), false, 'second flushed line');
    assert.equal(failover.acceptPrimary({ text: 'And what did you own?', isFinal: true }), true, 'new speech passes');
    assert.equal(failover.acceptPrimary({ text: 'How big', isFinal: false }), true, 'partials pass');
    advance(20_000);
    assert.equal(failover.acceptPrimary({ text: 'How big was the team?', isFinal: true }), true, 'asked again later: new');
});

test('D2: the stall watchdog never runs, nor restarts the channel, while a stand-in carries it', () => {
    const main = fs.readFileSync(path.join(REPO, 'electron/main.ts'), 'utf8');
    const coord = main.slice(main.indexOf('private readonly sttGap = new SttGapRecoveryCoordinator({'));
    const block = coord.slice(0, coord.indexOf('\n  });'));
    assert.match(block, /watchdogEnabled: \(source\) => this\._sttGapProvider\[source\]\.streaming && !this\._sttFailover\[source\]\?\.active/);
    const restart = block.slice(block.indexOf('restartStt: (source) => {'));
    const guard = restart.indexOf('if (this._sttFailover[source]?.active) return;');
    assert.ok(guard > 0 && guard < restart.indexOf('stt.stop();'), 'the stand-in is not stopped by a stall restart');
});

test('D5: a recent recovered interviewer line may be answered; an old one, or the mic, may not', () => {
    const now = 1_000_000;
    const seg = (over) => ({ source: 'system', text: 'What is your notice period?', timestamp: now - 20_000, endTimestamp: now - 17_000, marker: 'recovered', transcriberId: 'deepgram', reason: 'error', ...over });
    assert.equal(gap.recoveredLineMayBeAnswered(seg(), now), true);
    assert.equal(gap.recoveredLineMayBeAnswered(seg({ source: 'mic' }), now), false, 'the user is not answered');
    assert.equal(gap.recoveredLineMayBeAnswered(seg({ endTimestamp: now - gap.RECOVERED_ANSWER_MAX_AGE_MS - 1 }), now), false, 'too old');
    assert.equal(gap.recoveredLineMayBeAnswered(seg({ text: '  ' }), now), false);
});

test('D5: main hands an inserted recovered line to Auto Answer once, only when it was inserted', () => {
    const main = fs.readFileSync(path.join(REPO, 'electron/main.ts'), 'utf8');
    const fn = main.slice(main.indexOf('private insertRecoveredTranscript(seg: RecoveredSegment): void {'));
    const body = fn.slice(0, fn.indexOf('\n  }\n'));
    assert.match(body, /if \(!inserted\) return;/);
    assert.match(body, /recoveredLineMayBeAnswered\(seg, Date\.now\(\)\)/);
    assert.equal((body.match(/this\.simpleAutoAnswer\.ingest\(/g) ?? []).length, 1);
    assert.match(body, /speaker: 'interviewer'[\s\S]*?final: true/);
});
