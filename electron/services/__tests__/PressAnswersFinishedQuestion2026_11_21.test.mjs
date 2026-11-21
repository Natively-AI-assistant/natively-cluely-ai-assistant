/**
 * Issue #774 (2026-11-21): a manual What to Answer press made while the
 * interviewer is still talking answered the words heard at the press.
 *
 * Windows 11, Natively 3.2.1, Deepgram. Three presses in one interview:
 *  - 15:00.5 heard "Or your application port"; both channels finalised
 *    "application portfolio" by 15:01.1; the 15:07 answer was about network ports.
 *  - 28:54.0 heard "...There could be zero"; the interviewer finished "zero one
 *    two" at 28:56.6; the 29:00 answer treated zero as a count.
 *  - 33:25.9 heard "how do you intact"; "with other AWS services?" landed at
 *    33:26.2; the 33:41 answer explained how SQS invokes Lambda.
 *
 * The fix: when an interviewer final finishes the question a press heard while
 * its answer is still being written, the answer starts again, once, from the
 * finished transcript (electron/llm/pressQuestionCompletion.ts). Stubs only:
 * no model, no network, no platform branch.
 *
 * Run under Electron, as `npm test` does:
 *   npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test --test-force-exit electron/services/__tests__/PressAnswersFinishedQuestion2026_11_21.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = path.resolve(__dirname, '../../../dist-electron/electron');
const { liveAnswerDiscardKeepsThinking } = await import(pathToFileURL(path.resolve(__dirname, '../../../src/lib/chatStreamGuard.mjs')).href);
const {
    finalCompletesPressedQuestion,
    LIVE_INTERIM_AT_PRESS_MS,
    FINAL_AFTER_LIVE_INTERIM_MS,
    FINAL_AFTER_QUIET_PRESS_MS,
} = require(path.join(dist, 'llm/pressQuestionCompletion.js'));

describe('does a final finish the question the press heard?', () => {
    const T = 1_000_000;

    test('application portfolio: the final replaces the cut-off word, 0.6 s after the press', () => {
        const snap = { readAt: T, interimAt: T - 300, heardInterim: 'Or your application port' };
        assert.equal(finalCompletesPressedQuestion(snap, { text: 'Your application portfolio?', timestamp: T + 600 }), true);
    });

    test('RGB labels: the final adds "one two", 2.6 s after the press', () => {
        const heard = 'Again, the... Yeah. The idea should any three distinct types. You know? There could be zero';
        const snap = { readAt: T, interimAt: T - 400, heardInterim: heard };
        const fin = 'Again, the... Yeah. The idea should any three distinct types. You know? There could be zero one two or, you know, something like that. You know? So';
        assert.equal(finalCompletesPressedQuestion(snap, { text: fin, timestamp: T + 2_600 }), true);
    });

    test('Lambda: the rest of the sentence lands as its own final, 0.3 s after the press', () => {
        const snap = { readAt: T, interimAt: null, heardInterim: '' };
        assert.equal(finalCompletesPressedQuestion(snap, { text: 'with other AWS services?', timestamp: T + 300 }), true);
    });

    test('a final that only confirms the interim the press read changes nothing', () => {
        const snap = { readAt: T, interimAt: T - 200, heardInterim: 'How would you scale the write path?' };
        assert.equal(finalCompletesPressedQuestion(snap, { text: 'How would you scale the write path?', timestamp: T + 400 }), false);
        assert.equal(finalCompletesPressedQuestion(snap, { text: 'scale the write path', timestamp: T + 400 }), false, 'a shorter final inside the heard words');
    });

    test('mid-sentence at the press: a final up to 5 s later still finishes it', () => {
        const snap = { readAt: T, interimAt: T - LIVE_INTERIM_AT_PRESS_MS, heardInterim: 'so tell me about' };
        assert.equal(finalCompletesPressedQuestion(snap, { text: 'so tell me about your last project', timestamp: T + FINAL_AFTER_LIVE_INTERIM_MS }), true);
        assert.equal(finalCompletesPressedQuestion(snap, { text: 'so tell me about your last project', timestamp: T + FINAL_AFTER_LIVE_INTERIM_MS + 1 }), false);
    });

    test('quiet at the press: only a final that soon was already under way', () => {
        const snap = { readAt: T, interimAt: null, heardInterim: '' };
        assert.equal(finalCompletesPressedQuestion(snap, { text: 'Take your time.', timestamp: T + FINAL_AFTER_QUIET_PRESS_MS }), true);
        assert.equal(finalCompletesPressedQuestion(snap, { text: 'Take your time.', timestamp: T + FINAL_AFTER_QUIET_PRESS_MS + 1 }), false);
        const stale = { readAt: T, interimAt: T - LIVE_INTERIM_AT_PRESS_MS - 1, heardInterim: '' };
        assert.equal(finalCompletesPressedQuestion(stale, { text: 'Take your time.', timestamp: T + 3_000 }), false, 'an old interim is not speech at the press');
    });

    test('a final from before the press, an empty final or a broken clock never restarts', () => {
        const snap = { readAt: T, interimAt: T - 100, heardInterim: 'what about' };
        assert.equal(finalCompletesPressedQuestion(snap, { text: 'what about caching?', timestamp: T - 1 }), false);
        assert.equal(finalCompletesPressedQuestion(snap, { text: ' ... ', timestamp: T + 100 }), false);
        assert.equal(finalCompletesPressedQuestion(snap, { text: 'what about caching?', timestamp: Number.NaN }), false);
    });
});

// ── The engine: a real IntelligenceEngine with a scripted model ─────────────

const SAID = 'Again, the... Yeah. The idea should any three distinct types.';
const INTERIM = 'You know? There could be zero';
const FINAL = 'You know? There could be zero one two or, you know, something like that. You know? So';
const CUT_OFF_ANSWER = 'Zero occurrences of a type are fine, and an empty list works too.';
const FINISHED_ANSWER = 'Yes. 0, 1 and 2 can stand in for red, green and blue in the same three-pointer partition.';

async function until(cond, ms = 4000) {
    const t0 = Date.now();
    while (!cond()) { if (Date.now() - t0 > ms) throw new Error('condition not met in time'); await new Promise((r) => setTimeout(r, 5)); }
}
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

/** Run 1 streams a head, then waits for `releaseFirst()`. Later runs answer at once. */
async function makeEngine() {
    const { IntelligenceEngine } = await import(pathToFileURL(path.join(dist, 'IntelligenceEngine.js')).href);
    const { SessionTracker } = require(path.join(dist, 'SessionTracker.js'));
    const session = new SessionTracker();
    const engine = new IntelligenceEngine({ setNegotiationCoachingHandler() {} }, session);
    engine.lastTriggerTime = 0;
    engine.verifyAnswerClaims = async (o) => o.answer;
    const first = deferred();
    const transcripts = [];
    engine.whatToAnswerLLM = {
        async *generateStream(prepared) {
            transcripts.push(String(prepared));
            if (transcripts.length === 1) { yield 'Zero occurrences of a type are fine, '; await first.promise; yield 'and an empty list works too.'; return; }
            yield FINISHED_ANSWER;
        },
    };
    const tokens = [];
    const finals = [];
    const discards = [];
    engine.on('suggested_answer_token', (text, _q, _c, gen) => tokens.push({ text, gen }));
    engine.on('suggested_answer', (text, question, _c, gen) => finals.push({ text, question, gen }));
    engine.on('suggested_answer_discard', (reason, gen) => discards.push({ reason, gen }));
    session.addTranscript({ speaker: 'interviewer', text: SAID, timestamp: Date.now() - 3_000, final: true });
    engine.handleTranscript({ speaker: 'interviewer', text: INTERIM, timestamp: Date.now(), final: false, confidence: 0.9 });
    return { engine, session, transcripts, tokens, finals, discards, releaseFirst: () => first.resolve() };
}

/** Run 1 paints a head past the 40-char first-paint hold (so it has an open row), then waits. */
function paintFirstRun(h) {
    const hold = deferred();
    let runs = 0;
    h.engine.whatToAnswerLLM = {
        async *generateStream(prepared) {
            runs += 1;
            h.transcripts.push(String(prepared));
            if (runs === 1) { yield 'Zero occurrences of a type are fine, and so is '; await hold.promise; yield 'an empty list.'; return; }
            yield FINISHED_ANSWER;
        },
    };
    return () => hold.resolve();
}

const press = (engine, question) => engine.runWhatShouldISay(question, 0.8, undefined, { skipCooldown: true, forceFresh: true });
const interviewerFinal = (h, text, offsetMs = 0) =>
    h.engine.handleTranscript({ speaker: 'interviewer', text, timestamp: Date.now() + offsetMs, final: true, confidence: 0.9 });

describe('the engine answers the finished question', () => {
    test('#774: the finished line arrives mid-answer → the answer starts again from it, and the press returns that answer', async () => {
        const h = await makeEngine();
        const recorded = [];
        h.engine.recordLiveTurn = (answer, _screen, heard) => recorded.push({ answer, heard });
        const pressed = press(h.engine);
        await until(() => h.transcripts.length === 1);
        assert.match(h.transcripts[0], /there could be zero/i);
        assert.doesNotMatch(h.transcripts[0], /zero one two/i, 'the press heard only the interim');

        interviewerFinal(h, FINAL);
        await until(() => h.transcripts.length === 2);
        assert.match(h.transcripts[1], /zero one two/i, 'the new run reads the finished line');
        h.releaseFirst();

        const answer = await pressed;
        assert.equal(answer, FINISHED_ANSWER);
        assert.equal(h.finals.length, 1, 'one answer reaches the overlay');
        assert.equal(h.finals[0].text, FINISHED_ANSWER);
        assert.ok(!h.finals.some((f) => f.text.includes(CUT_OFF_ANSWER)));
        const firstGen = h.tokens[0]?.gen;
        if (firstGen !== undefined && firstGen !== h.finals[0].gen) {
            assert.ok(h.discards.some((d) => d.gen === firstGen), 'the cut-off answer\'s open row is discarded');
        }
        assert.equal(h.engine.getActiveMode(), 'idle');
        assert.equal(recorded.length, 1, 'the press is recorded once');
        assert.equal(recorded[0].answer, FINISHED_ANSWER);
        assert.match(recorded[0].heard, /zero one two/i, 'filed under the finished question');
    });

    test('the replaced answer had words on screen → its row is discarded as "restarted", not "superseded"', async () => {
        const h = await makeEngine();
        const releaseFirst = paintFirstRun(h);
        const pressed = press(h.engine);
        await until(() => h.tokens.length >= 1);
        const firstGen = h.tokens[0].gen;
        interviewerFinal(h, FINAL);
        await until(() => h.transcripts.length === 2);
        releaseFirst(); // the stub ignores its abort; a real stream unwinds at once
        assert.equal(await pressed, FINISHED_ANSWER);
        await until(() => h.discards.some((d) => d.gen === firstGen));
        assert.deepEqual(h.discards.filter((d) => d.gen === firstGen).map((d) => d.reason), ['restarted'],
            'the overlay keeps Thinking for a restart (liveAnswerDiscardKeepsThinking)');
        assert.equal(liveAnswerDiscardKeepsThinking('restarted'), true);
    });

    test('a second press still discards the first answer as "superseded" (Thinking comes from the new press)', async () => {
        const h = await makeEngine();
        const releaseFirst = paintFirstRun(h);
        const first = press(h.engine);
        await until(() => h.tokens.length >= 1);
        const firstGen = h.tokens[0].gen;
        const second = press(h.engine);
        await until(() => h.transcripts.length === 2);
        releaseFirst();
        await Promise.allSettled([first, second]);
        await until(() => h.discards.some((d) => d.gen === firstGen));
        assert.deepEqual(h.discards.filter((d) => d.gen === firstGen).map((d) => d.reason), ['superseded']);
        assert.equal(liveAnswerDiscardKeepsThinking('superseded'), false);
    });

    test('restarts once: a second final while the new answer runs does not start a third', async () => {
        const h = await makeEngine();
        let release2;
        const second = new Promise((r) => { release2 = r; });
        const hold1 = deferred();
        const runs = [];
        h.engine.whatToAnswerLLM = {
            async *generateStream(prepared) {
                runs.push(String(prepared));
                // Run 1 hangs (ignores its abort) until the press has returned:
                // the press must not wait for the replaced run to unwind.
                if (runs.length === 1) { await hold1.promise; return; }
                yield 'Part one of the answer, '; await second; yield 'part two.';
            },
        };
        const pressed = press(h.engine);
        await until(() => runs.length === 1);
        interviewerFinal(h, FINAL);
        await until(() => runs.length === 2);
        interviewerFinal(h, 'And can you do it in one pass?', 200);
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(runs.length, 2);
        release2();
        assert.equal(await pressed, 'Part one of the answer, part two.');
        hold1.resolve();
    });

    test('a final that lands after the answer is shown changes nothing', async () => {
        const h = await makeEngine();
        h.releaseFirst();
        const answer = await press(h.engine);
        assert.match(answer, /empty list works too/);
        interviewerFinal(h, FINAL);
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(h.transcripts.length, 1);
        assert.equal(h.engine.getActiveMode(), 'idle');
    });

    test('a final that repeats what the press already heard does not restart', async () => {
        const h = await makeEngine();
        const pressed = press(h.engine);
        await until(() => h.transcripts.length === 1);
        interviewerFinal(h, INTERIM);
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(h.transcripts.length, 1);
        h.releaseFirst();
        assert.match(await pressed, /empty list works too/);
    });

    test('a typed question is never restarted by the transcript', async () => {
        const h = await makeEngine();
        const pressed = press(h.engine, 'Does the three-pointer partition work for numeric labels?');
        await until(() => h.transcripts.length === 1);
        interviewerFinal(h, FINAL);
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(h.transcripts.length, 1);
        h.releaseFirst();
        await pressed;
    });

    test('a new sentence long after the press is not the press\'s question', async () => {
        const h = await makeEngine();
        const pressed = press(h.engine);
        await until(() => h.transcripts.length === 1);
        interviewerFinal(h, 'Okay, take your time, no rush.', FINAL_AFTER_LIVE_INTERIM_MS + 500);
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(h.transcripts.length, 1);
        h.releaseFirst();
        await pressed;
    });
});
