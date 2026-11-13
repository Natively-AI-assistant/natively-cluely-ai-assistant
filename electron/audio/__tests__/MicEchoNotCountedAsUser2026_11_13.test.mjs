// Live-pipeline forensics F-CTX-12 (2026-11-13): on laptop speakers the other
// side's words come back through the microphone, are transcribed on the mic
// channel and stored as [ME]. Only the Natively relay holds echo back (server
// side); every BYOK provider, on macOS and Windows, let it through, and a
// mic final after an answer runs the refinement follow-up ("Can you make that
// shorter?" said by the interviewer became the user asking for it).
// A mic final that repeats what the interviewer said in the last few seconds
// no longer counts as the user's speech: it is kept out of the session
// context (so no [ME] line and no follow-up) and out of retrieval. The live
// display still gets it (the Answer button's voice input reads mic text).
// Pure module, no platform branch: the same on macOS and Windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '../../..');
const { MicEchoGuard, MIC_ECHO_WINDOW_MS } = require(path.join(REPO, 'dist-electron/electron/audio/micEchoGuard.js'));

test('a mic final repeating the interviewer moments ago is echo', () => {
    const g = new MicEchoGuard();
    g.noteInterviewer('Can you make that shorter?', true, 1_000);
    assert.equal(g.isEcho('can you make that shorter', 1_400), true);
    // Bleed transcribed a little worse than the original is still echo.
    g.noteInterviewer('Walk me through how you would shard the orders table.', true, 5_000);
    assert.equal(g.isEcho('walk me through how you would shard the order table', 5_900), true);
});

test('the interviewer interim counts too: the mic final often lands before the system final', () => {
    const g = new MicEchoGuard();
    g.noteInterviewer('Tell me about your biggest', false, 1_000);
    g.noteInterviewer('Tell me about your biggest weakness', false, 1_600);
    assert.equal(g.isEcho('tell me about your biggest weakness', 1_900), true);
});

test('the user answering, paraphrasing or speaking later is the user', () => {
    const g = new MicEchoGuard();
    g.noteInterviewer('How would you design a rate limiter?', true, 1_000);
    assert.equal(g.isEcho('So how would I design a rate limiter', 2_000), false, 'a paraphrase');
    assert.equal(g.isEcho('I would use a token bucket per client', 2_500), false, 'an answer');
    assert.equal(g.isEcho('Yes', 1_200), false, 'too short to tell');
    assert.equal(g.isEcho('How would you design a rate limiter', 1_000 + MIC_ECHO_WINDOW_MS + 1), false, 'too late to be echo');
    assert.equal(new MicEchoGuard().isEcho('How would you design a rate limiter', 2_000), false, 'nothing heard');
});

test('main keeps an echo final out of the session and retrieval, and feeds the guard from the interviewer channel', () => {
    const main = fs.readFileSync(path.join(REPO, 'electron/main.ts'), 'utf8');
    const seg = main.slice(main.indexOf('const onSegment = '), main.indexOf('this._sttFailover[gapSource]?.stop();'));
    const note = seg.indexOf("this._micEcho.noteInterviewer(segment.text, segment.isFinal, Date.now())");
    const check = seg.indexOf("this._micEcho.isEcho(segment.text, Date.now())");
    const gap = seg.indexOf('this.sttGap.onTranscript(gapSource, segment.text, segment.isFinal);');
    const handle = seg.indexOf('this.intelligenceManager.handleTranscript({');
    const rag = seg.indexOf('this.ragManager.feedLiveTranscript(');
    assert.ok(note > 0 && check > 0, 'both channels wired');
    assert.ok(gap < check, 'an echo still proves the mic connection works');
    assert.match(seg, /if \(!micEcho\) \{\s*this\.intelligenceManager\.handleTranscript\(\{/);
    assert.match(seg, /if \(segment\.isFinal && this\.ragManager && !micEcho\)/);
    assert.ok(handle > check && rag > check);
    // The display send is not gated.
    assert.doesNotMatch(seg, /micEcho\)[^\n]*sendThrottledTranscript/);
});
