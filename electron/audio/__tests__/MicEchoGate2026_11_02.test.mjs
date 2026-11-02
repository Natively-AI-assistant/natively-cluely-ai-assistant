// Issue #710: on Windows, laptop speakers + the built-in mic transcribe the
// meeting a second time as "Me". audio/micEchoGate.ts drops a mic segment that
// repeats the meeting audio while it is playing. Fake clock and timers; the
// echo pairs are the issue's and a recorded bled session's (Soniox mic vs
// Deepgram system), the kept lines are real answers that reuse a question's
// words. main.ts wiring is checked in the source at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '../../..');
const { MicEchoGate, micEchoGateEnabledFor } = require(path.join(REPO, 'dist-electron/electron/audio/micEchoGate.js'));

function rig(opts = {}) {
    let now = 1_000_000;
    let timers = [];
    const drops = [];
    const gate = new MicEchoGate({
        enabled: true,
        now: () => now,
        setTimer: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
        clearTimer: (t) => { timers = timers.filter((x) => x !== t); },
        onDrop: (d) => drops.push(d),
        ...opts,
    });
    const out = [];
    const mic = (text, isFinal = true) => gate.submitMic({ text, isFinal }, () => out.push({ text, isFinal }));
    const meeting = (text, isFinal = true) => gate.noteMeetingAudio(text, isFinal);
    const advance = (ms) => {
        const until = now + ms;
        for (;;) {
            const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
            if (!due) break;
            now = due.at;
            timers = timers.filter((t) => t !== due);
            due.fn();
        }
        now = until;
    };
    return { gate, out, drops, mic, meeting, advance, pendingTimers: () => timers.length };
}

const ISSUE_PAIRS = [
    ['And I think the better the bed, the faster they revive, because then this is like 6 minutes of totally like 8 minutes, maybe.',
     "And I think the better the bed, the faster they revive, because this is like 6 minutes, but normally it's about 10 minutes, I think."],
    ['So you are actually here wasting some of the spaces.', 'So you are actually here wasting some of the spaces.'],
    ['Yeah, I can see your skin clearly.', 'Yeah. I can see your screen clearly, but just open the file'],
    ['But, uh, I am— I can only see my screen only, okay?', 'But I am I can only see my screen only. Okay?'],
    ['you are storing the two integers in, uh, two linked lists.', 'the two integers in, two, linked list linked list top storing'],
];

test('platform: on for Windows, off for macOS and anything else', () => {
    assert.equal(micEchoGateEnabledFor('win32'), true);
    assert.equal(micEchoGateEnabledFor('darwin'), false);
    assert.equal(micEchoGateEnabledFor('linux'), false);
});

test('disabled (macOS): every mic segment passes untouched and at once', () => {
    const r = rig({ enabled: false });
    r.meeting('So you are actually here wasting some of the spaces.');
    r.mic('So you are actually here wasting some of the spaces.');
    r.mic('So you are', false);
    assert.deepEqual(r.out.map((o) => o.text), ['So you are actually here wasting some of the spaces.', 'So you are']);
    assert.equal(r.pendingTimers(), 0);
});

test('the echo pairs are dropped when the meeting finalizes first', () => {
    for (const [mic, sys] of ISSUE_PAIRS) {
        const r = rig();
        r.meeting(sys.split(' ').slice(0, 4).join(' '), false);
        r.advance(400);
        r.mic(mic.split(' ').slice(0, 3).join(' '), false);
        r.advance(600);
        r.meeting(sys);
        r.advance(300);
        r.mic(mic);
        r.advance(2000);
        assert.equal(r.out.filter((o) => o.isFinal).length, 0, `kept as Me: "${mic}"`);
    }
});

test('the mic finalizing BEFORE the meeting: held, then dropped when the meeting copy lands', () => {
    const [mic, sys] = ISSUE_PAIRS[0];
    const r = rig();
    r.meeting('And I think the better', false);
    r.advance(200);
    r.mic('And I think', false);
    r.advance(1500);
    r.meeting('And I think the better the bed, the faster they revive', false);
    r.mic(mic);                       // arrives with the meeting's final still to come
    assert.equal(r.out.some((o) => o.isFinal), false, 'held, not delivered');
    r.advance(500);
    r.meeting(sys);
    r.advance(2000);
    assert.equal(r.out.some((o) => o.isFinal), false);
    assert.equal(r.drops.filter((d) => d.final).length, 1);
});

// KNOWN LIMIT, not a goal: the issue's second echo line. The laptop mic misheard
// "some of these bigger beds" as "somebody through your bed", so only 0.67 of its
// words are in the meeting text, under the 0.7 bar that keeps real answers safe.
// A transcript-level gate cannot catch heavy mishearing; acoustic echo
// cancellation can (scripts/win-aec-probe). If this starts failing because the
// line is now dropped, check the real-answer tests still pass before celebrating.
test('known limit: a heavily misheard echo line still gets through', () => {
    const r = rig();
    r.meeting("And I think the better the bed, the faster they revive, because this is like 6 minutes, but normally it's about 10 minutes, I think.");
    r.meeting('So if you get some of these bigger beds', false);
    r.mic('So if you get', false);
    r.meeting("So if you get some of these bigger beds, they'll revive. You just got to wait the full 6 minutes in-game time, and then they'll be back.");
    const line = "So if you get somebody through your bed and they'll revive, there's definitely people who are going to take time and then look at you.";
    r.mic(line);
    r.advance(2000);
    const score = r.gate.containment(line);
    assert.ok(score > 0.6 && score < 0.7, `containment ${score}`);
    assert.deepEqual(r.out.filter((o) => o.isFinal).map((o) => o.text), [line]);
});

test('a held final the meeting never echoes is delivered after the hold, in order', () => {
    const r = rig();
    r.meeting('So tell me about the project you led last year', false);
    r.mic('Honestly the biggest lesson was hiring', false);
    r.mic('Honestly the biggest lesson was hiring early for the platform team.');
    r.mic('After', false);                // queued behind the held final
    assert.deepEqual(r.out.map((o) => o.text), ['Honestly the biggest lesson was hiring']);
    r.advance(1199);
    assert.equal(r.out.length, 1);
    r.advance(1);
    assert.deepEqual(r.out.map((o) => o.text), [
        'Honestly the biggest lesson was hiring',
        'Honestly the biggest lesson was hiring early for the platform team.',
        'After',
    ]);
});

test('a real answer reusing the question\'s words is kept: the meeting had stopped', () => {
    const answers = [
        ['Can you tell me about a time you handled conflict on your team?', 'Sure, a time I handled conflict on my team was when two engineers disagreed.'],
        ['Can you see my screen clearly?', 'Yes I can see your screen clearly now.'],
        ['So how many bits are there in the integer?', 'There are 32 bits in the integer.'],
    ];
    for (const [question, answer] of answers) {
        const r = rig();
        r.meeting(question.split(' ').slice(0, 3).join(' '), false);
        r.advance(800);
        r.meeting(question);
        r.advance(900);
        r.mic(answer.split(' ').slice(0, 3).join(' '), false);
        r.advance(1500);
        r.mic(answer);
        assert.equal(r.out.filter((o) => o.isFinal).length, 1, `dropped: "${answer}"`);
        assert.equal(r.pendingTimers(), 0, 'nothing to wait for when the meeting is quiet');
    }
});

test('reading the question back after the other side stopped is kept: wording alone never drops', () => {
    const r = rig();
    r.meeting('What is the time complexity of binary search?');
    r.advance(2000);
    r.mic('So the time complexity', false);
    r.advance(1200);
    r.mic('So the time complexity of binary search');
    assert.ok(r.gate.containment('So the time complexity of binary search') >= 0.7, 'worded like an echo');
    assert.deepEqual(r.out.map((o) => o.text), ['So the time complexity', 'So the time complexity of binary search']);
});

test('a real answer while the other side still talks, in other words, is kept', () => {
    const r = rig();
    r.meeting('and we also looked at the caching layer and the queue', false);
    r.mic('I would put a hash map in front so lookups are constant time.');
    r.meeting('and we also looked at the caching layer and the queue workers');
    r.advance(1500);
    assert.equal(r.out.length, 1);
    assert.equal(r.drops.length, 0);
});

test('backchannels are never dropped, even when the meeting just said them', () => {
    const r = rig();
    r.meeting('Yeah okay', false);
    r.mic('Yeah okay');
    r.meeting('Yeah okay sounds good.');
    r.mic('Sounds good.');
    r.advance(2000);
    assert.deepEqual(r.out.map((o) => o.text), ['Yeah okay', 'Sounds good.']);
});

test('short echo interims stay hidden; short interims with new words show', () => {
    const r = rig();
    r.meeting('So if you get some of these', false);
    r.mic('So if you', false);
    r.mic('Wait what', false);
    assert.deepEqual(r.out.map((o) => o.text), ['Wait what']);
});

test('meeting text older than the window no longer matches', () => {
    const r = rig();
    r.meeting('So you are actually here wasting some of the spaces.');
    r.advance(9000);
    r.meeting('Okay next question', false);
    r.mic('So you are actually here wasting some of the spaces.');
    r.advance(2000);
    assert.equal(r.out.length, 1);
});

test('expedite (Answer Stop): a held final is judged now, not after the hold', () => {
    const r = rig();
    r.meeting('let me share my screen for a second', false);
    r.mic('What is the time complexity of this solution?');
    assert.equal(r.out.length, 0);
    r.gate.expedite();
    assert.equal(r.out.length, 1);
    r.mic('And the space complexity too please.');
    assert.equal(r.out.length, 2, 'finals right after Stop are not held');
});

test('flush releases held finals for the saved transcript; reset forgets everything', () => {
    const r = rig();
    r.meeting('one more thing before we wrap', false);
    r.mic('Thanks a lot for your time today everyone.');
    assert.equal(r.out.length, 0);
    r.gate.flush();
    assert.equal(r.out.length, 1);
    r.mic('One more line held at teardown here.');
    r.gate.reset();
    r.advance(5000);
    assert.equal(r.out.length, 1);
    assert.equal(r.gate.droppedCount, 0);
    assert.equal(r.pendingTimers(), 0);
});

test('main.ts: the gate sits in onSegment before every content consumer', () => {
    const src = fs.readFileSync(path.join(REPO, 'electron/main.ts'), 'utf8');
    assert.match(src, /new MicEchoGate\(\{\s*enabled: micEchoGateEnabledFor\(process\.platform\)/);
    const on = src.indexOf('const onSegment = (');
    const deliver = src.indexOf('const deliverSegment = (', on);
    assert.ok(on > 0 && deliver > on);
    const head = src.slice(on, deliver);
    assert.match(head, /this\.sttGap\.onTranscript\(/, 'liveness signals still see every segment');
    assert.match(head, /this\.micEchoGate\.submitMic\(segment, \(\) => deliverSegment\(/);
    assert.match(head, /this\.micEchoGate\.noteMeetingAudio\(/);
    assert.doesNotMatch(head, /handleTranscript\(|sendThrottledTranscript\(|feedLiveTranscript\(|simpleAutoAnswer\.ingest\(/);
    const body = src.slice(deliver, deliver + 6000);
    for (const consumer of ['intelligenceManager.handleTranscript(', 'simpleAutoAnswer.ingest(', 'ragManager.feedLiveTranscript(', 'sendThrottledTranscript(']) {
        assert.ok(body.includes(consumer), `${consumer} behind the gate`);
    }
    assert.match(src, /this\.micEchoGate\.reset\(\);\s*this\.meetingAutoStop\.start\(/);
    assert.match(src, /this\.googleSTT_User\?\.stop\(\);[\s\S]{0,200}this\.micEchoGate\.flush\(\);[\s\S]{0,400}intelligenceManager\.stopMeeting\(\)/);
    assert.match(src, /public finalizeMicSTT\(\)[\s\S]{0,300}this\.micEchoGate\.expedite\(\)/);
});
