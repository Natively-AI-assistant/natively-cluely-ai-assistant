// Behavioral tests for the meeting start/stop transition queue.
//
// THE DEFECT: AppState.startMeeting() and endMeeting() were plain async
// methods with no serialization. They are reachable concurrently from renderer
// IPC, calendar auto-start, global shortcuts, and the tray — so two starts, a
// stop landing mid-start, or a start landing mid-stop could interleave. The
// existing protections (_meetingGeneration, the _audioInitPromise
// abort-and-await, _pendingTeardown) each guard ONE hazard inside a
// transition; none of them prevent two transitions from running at once.
//
// The invariant: transitions are serialized. Same-direction duplicates
// coalesce onto the in-flight request; opposite-direction requests QUEUE and
// the last requested direction is the one that wins. A start must never be
// swallowed just because a stop is in flight (that is how "stop then
// immediately start" silently produced a dead meeting).
//
// These are behavioral tests against the extracted queue, not source-shape
// assertions — the queue is pure and platform-neutral by design, so the same
// contract is exercised for macOS and Windows callers alike.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
const { MeetingLifecycleQueue } = await import(pathToFileURL(path.join(distRoot, 'meetingLifecycleQueue.js')).href);

/** A promise you resolve/reject by hand, so tests control transition timing. */
function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const tick = () => new Promise(r => setImmediate(r));

test('duplicate start requests coalesce into one transition', async () => {
    const q = new MeetingLifecycleQueue();
    let runs = 0;
    const gate = deferred();
    const run = () => { runs++; return gate.promise; };

    const a = q.start(run);
    const b = q.start(run);
    const c = q.start(run);
    await tick();

    assert.equal(runs, 1, 'only one start transition may execute');
    assert.equal(q.getState(), 'starting');

    gate.resolve();
    await Promise.all([a, b, c]);
    assert.equal(q.getState(), 'active');
    assert.equal(runs, 1, 'no extra transition ran after settling');
});

test('a queued start adopts the NEWEST intent instead of discarding it', async () => {
    // Greptile PR #439: coalescing returned the first request's promise and
    // threw away the second closure. startMeeting() closes over `metadata`,
    // which carries the calendar title/eventId AND the user's chosen audio
    // devices (metadata.audio.inputDeviceId drives reconfigureAudio). A manual
    // Start racing a calendar auto-start therefore silently ignored the user's
    // selected microphone while still reporting success.
    //
    // Contract: while the transition is still QUEUED, the latest runner wins.
    const q = new MeetingLifecycleQueue();
    const ran = [];
    const gate = deferred();

    // Occupy the chain so the next start is QUEUED rather than run immediately.
    // (Do not await these — they are deliberately blocked on `gate`.)
    const blocker = q.start(async () => { ran.push('blocker'); await gate.promise; });
    await tick();
    const stopped = q.stop(async () => { ran.push('stop'); });
    await tick();

    // Two starts land while the chain is still busy. The SECOND carries the
    // metadata that must survive.
    const first = q.start(async () => { ran.push('calendar-metadata'); });
    const second = q.start(async () => { ran.push('user-selected-mic'); });
    assert.equal(first, second, 'both callers share one transition — still exactly one meeting');

    gate.resolve();
    await Promise.allSettled([blocker, stopped, first, second]);

    assert.ok(ran.includes('user-selected-mic'),
        `the newest start intent must execute, got ${JSON.stringify(ran)}`);
    assert.ok(!ran.includes('calendar-metadata'),
        'the superseded runner must NOT also run — that would start twice');
    assert.equal(q.getState(), 'active');
});

test('once a start is executing, later starts coalesce and do not swap the runner', async () => {
    // The mirror of the above: mid-flight the meeting is already starting, so
    // there is nothing to re-apply and swapping the runner underneath a running
    // transition would be far worse than coalescing.
    const q = new MeetingLifecycleQueue();
    const ran = [];
    const gate = deferred();

    const first = q.start(async () => { ran.push('executing'); await gate.promise; });
    await tick();   // let the body begin
    const second = q.start(async () => { ran.push('too-late'); });

    gate.resolve();
    await Promise.all([first, second]);

    assert.deepEqual(ran, ['executing'], 'the in-flight runner must not be replaced mid-execution');
});

test('starting while already active is a no-op', async () => {
    const q = new MeetingLifecycleQueue();
    let runs = 0;
    await q.start(async () => { runs++; });
    assert.equal(q.getState(), 'active');

    await q.start(async () => { runs++; });
    assert.equal(runs, 1, 'an already-active meeting must not start a second time');
});

test('stopping while already idle is a no-op', async () => {
    const q = new MeetingLifecycleQueue();
    let runs = 0;
    await q.stop(async () => { runs++; });
    assert.equal(runs, 0, 'stopping an idle lifecycle must not run a teardown');
    assert.equal(q.getState(), 'idle');
});

test('a stop requested during a start runs AFTER the start completes', async () => {
    const q = new MeetingLifecycleQueue();
    const order = [];
    const startGate = deferred();

    const started = q.start(async () => { order.push('start:begin'); await startGate.promise; order.push('start:end'); });
    await tick();
    const stopped = q.stop(async () => { order.push('stop:begin'); order.push('stop:end'); });
    await tick();

    assert.deepEqual(order, ['start:begin'], 'the stop must not run while the start is in flight');

    startGate.resolve();
    await started;
    await stopped;

    assert.deepEqual(order, ['start:begin', 'start:end', 'stop:begin', 'stop:end']);
    assert.equal(q.getState(), 'idle');
});

test('duplicate stops join the in-flight stop', async () => {
    const q = new MeetingLifecycleQueue();
    await q.start(async () => {});

    let stops = 0;
    const gate = deferred();
    const a = q.stop(async () => { stops++; await gate.promise; });
    const b = q.stop(async () => { stops++; await gate.promise; });
    await tick();

    assert.equal(stops, 1, 'concurrent stops must share one teardown');

    gate.resolve();
    await Promise.all([a, b]);
    assert.equal(q.getState(), 'idle');
});

test('a start requested during a stop queues a real restart', async () => {
    // The regression this pins: coalescing by "is any request pending" rather
    // than by DIRECTION swallowed the restart, leaving the user staring at a
    // stopped meeting after pressing Start.
    const q = new MeetingLifecycleQueue();
    await q.start(async () => {});

    const order = [];
    const stopGate = deferred();
    const stopped = q.stop(async () => { order.push('stop'); await stopGate.promise; });
    await tick();
    const restarted = q.start(async () => { order.push('restart'); });
    await tick();

    assert.deepEqual(order, ['stop'], 'the restart must wait for the stop');

    stopGate.resolve();
    await stopped;
    await restarted;

    assert.deepEqual(order, ['stop', 'restart'], 'the restart must actually run');
    assert.equal(q.getState(), 'active', 'the lifecycle must end ACTIVE — the last request wins');
});

test('start → stop → start settles active (final requested direction wins)', async () => {
    const q = new MeetingLifecycleQueue();
    const order = [];
    const gate = deferred();

    const p1 = q.start(async () => { order.push('start1'); await gate.promise; });
    await tick();
    const p2 = q.stop(async () => { order.push('stop'); });
    await tick();
    const p3 = q.start(async () => { order.push('start2'); });
    await tick();

    gate.resolve();
    await Promise.all([p1, p2, p3]);

    assert.deepEqual(order, ['start1', 'stop', 'start2']);
    assert.equal(q.getState(), 'active');
});

test('stop → start → stop settles idle (final requested direction wins)', async () => {
    const q = new MeetingLifecycleQueue();
    await q.start(async () => {});

    const order = [];
    const gate = deferred();
    const p1 = q.stop(async () => { order.push('stop1'); await gate.promise; });
    await tick();
    const p2 = q.start(async () => { order.push('start'); });
    await tick();
    const p3 = q.stop(async () => { order.push('stop2'); });
    await tick();

    gate.resolve();
    await Promise.all([p1, p2, p3]);

    assert.deepEqual(order, ['stop1', 'start', 'stop2']);
    assert.equal(q.getState(), 'idle');
});

test('a failed transition does not poison the queue', async () => {
    const q = new MeetingLifecycleQueue();

    await assert.rejects(
        q.start(async () => { throw new Error('audio pipeline exploded'); }),
        /audio pipeline exploded/,
        'the failure must propagate to the caller, not be swallowed'
    );
    assert.equal(q.getState(), 'failed');

    // The next transition must still run.
    let ran = false;
    await q.start(async () => { ran = true; });
    assert.equal(ran, true, 'a later start must still execute after a failed one');
    assert.equal(q.getState(), 'active');
});

test('a failed stop still lets a subsequent start proceed', async () => {
    const q = new MeetingLifecycleQueue();
    await q.start(async () => {});
    await assert.rejects(q.stop(async () => { throw new Error('teardown failed'); }), /teardown failed/);
    assert.equal(q.getState(), 'failed');

    let ran = false;
    await q.start(async () => { ran = true; });
    assert.equal(ran, true);
    assert.equal(q.getState(), 'active');
});

test('state changes are reported to the observer in order', async () => {
    const seen = [];
    const q = new MeetingLifecycleQueue((s) => seen.push(s));

    await q.start(async () => {});
    await q.stop(async () => {});

    assert.deepEqual(seen, ['starting', 'active', 'stopping', 'idle']);
});

// ── Wiring contract ─────────────────────────────────────────────────────────
// The queue is only worth anything if AppState actually routes through it. A
// future edit that makes startMeeting/endMeeting do the work inline again
// would leave all the behavioral tests above passing while the real app went
// back to unserialized transitions.

test('AppState routes both public entry points through the queue', async () => {
    const fs = await import('node:fs');
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.ts'), 'utf8');

    assert.match(
        mainSource,
        /public startMeeting\([^)]*\): Promise<void> \{\s*return this\._meetingLifecycle\.start\(/,
        'startMeeting must delegate to the lifecycle queue'
    );
    assert.match(
        mainSource,
        /public endMeeting\(\): Promise<void> \{\s*return this\._meetingLifecycle\.stop\(/,
        'endMeeting must delegate to the lifecycle queue'
    );
    // The ordered bodies must still exist as private transitions.
    assert.ok(
        mainSource.includes('private async startMeetingTransition'),
        'the ordered start body must live in startMeetingTransition'
    );
    assert.ok(
        mainSource.includes('private async endMeetingTransition'),
        'the ordered stop body must live in endMeetingTransition'
    );
    // Regression guard: the public wrappers must stay thin. If the ordered work
    // migrates back into them it would bypass the queue entirely.
    const wrapperStart = mainSource.indexOf('public startMeeting(');
    const wrapperEnd = mainSource.indexOf('private logMeetingLifecycleState', wrapperStart);
    const wrapper = mainSource.slice(wrapperStart, wrapperEnd);
    assert.ok(
        !wrapper.includes('_audioInitPromise') && !wrapper.includes('_pendingTeardown'),
        'the public startMeeting wrapper must not contain transition work'
    );
});

test('a burst of interleaved requests never runs two transitions at once', async () => {
    // Models the real hazard: renderer IPC, calendar auto-start, a global
    // shortcut and the tray all firing within the same few ticks.
    const q = new MeetingLifecycleQueue();
    let inFlight = 0;
    let maxConcurrent = 0;
    const body = async () => {
        inFlight++;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise(r => setTimeout(r, 1));
        inFlight--;
    };

    const pending = [];
    for (let i = 0; i < 40; i++) {
        pending.push(i % 2 === 0 ? q.start(body) : q.stop(body));
    }
    await Promise.allSettled(pending);

    assert.equal(maxConcurrent, 1, `transitions overlapped (max concurrent = ${maxConcurrent})`);
    assert.ok(['idle', 'active'].includes(q.getState()), `settled in a stable state, got ${q.getState()}`);
});
