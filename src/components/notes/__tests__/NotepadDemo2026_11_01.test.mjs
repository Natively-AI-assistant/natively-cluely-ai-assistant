// The notepad preview's live demo (2026-11-01): the loop's frames. No DOM, no platform branches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTEPAD_DEMO_LOOP_MS, NOTEPAD_DEMO_STILL_MS, NOTEPAD_DEMO_TEMPLATE, notepadDemoFrame, sameDemoContent } from '../notepadDemo.ts';
import { noteTemplateById } from '../../../../electron/services/meeting/noteTemplates.ts';
import { answerSources } from '../notepadView.ts';

test('the loop starts empty and comes back to the start', () => {
    const start = notepadDemoFrame(0);
    assert.equal(start.text, '');
    assert.equal(start.transcript.lines.length, 0);
    assert.equal(start.showTranscript, false);
    assert.equal(start.askOpen, false);
    assert.deepEqual(notepadDemoFrame(NOTEPAD_DEMO_LOOP_MS + 5_000), notepadDemoFrame(5_000));
});

test('the transcript streams word by word, then the line is final', () => {
    const words = (ms) => notepadDemoFrame(ms).transcript.partials[0]?.text.split(' ').length ?? 0;
    assert.ok(words(3_500) >= 1);
    assert.ok(words(4_200) > words(3_500), 'more words arrive');
    const later = notepadDemoFrame(6_000).transcript;
    assert.equal(later.lines[0].speaker, 'them');
    assert.match(later.lines[0].text, /Beta goes out Thursday/);
    assert.ok(notepadDemoFrame(4_000).level > notepadDemoFrame(2_000).level, 'the bars rise while someone talks');
    const talking = [4_000, 4_090, 4_180, 4_270, 4_360].map((ms) => notepadDemoFrame(ms).level);
    assert.ok(new Set(talking).size > 3, 'the bars move while someone talks');
    assert.ok(talking.every((l) => l > 0.06 && l < 0.3125), 'and stay under full height, so the height itself moves');
});

test('notes are typed letter by letter, markers at once, never a half marker', () => {
    const t1 = notepadDemoFrame(5_000).text;
    const t2 = notepadDemoFrame(5_400).text;
    assert.ok(t2.startsWith(t1) && t2.length > t1.length);
    for (let ms = 0; ms < NOTEPAD_DEMO_LOOP_MS; ms += 50) {
        assert.doesNotMatch(notepadDemoFrame(ms).text, /- \[$|- \[ $|\n-$/, `half marker at ${ms}`);
    }
    assert.match(notepadDemoFrame(20_000).text, /# Next steps\n- \[ \] Settings screenshots/);
});

test('the still frame shows the whole call with the transcript open', () => {
    const f = notepadDemoFrame(NOTEPAD_DEMO_STILL_MS);
    assert.equal(f.showTranscript, true);
    assert.equal(f.transcript.lines.length, 7);
    assert.equal(f.transcript.partials.length, 0);
    assert.match(f.text, /# Launch/);
});

test('Ask opens after the transcript closes and answers with lines from it', () => {
    for (let ms = 0; ms < NOTEPAD_DEMO_LOOP_MS; ms += 100) {
        const f = notepadDemoFrame(ms);
        assert.ok(!(f.showTranscript && f.askOpen), `transcript and Ask never both open (${ms})`);
    }
    const slash = notepadDemoFrame(23_000);
    assert.equal(slash.askOpen, true);
    assert.equal(slash.askText, '/');
    assert.equal(slash.turns.length, 0, 'the recipe list shows before any answer');
    const streaming = notepadDemoFrame(25_500).turns[0];
    assert.equal(notepadDemoFrame(25_500).askText, '');
    assert.equal(streaming.status, 'streaming');
    const done = notepadDemoFrame(32_500);
    assert.equal(done.askOpen, true);
    assert.equal(done.turns[0].status, 'done');
    assert.ok(answerSources(done.turns[0].text, done.transcript.lines).length > 0, 'the answer cites transcript lines');
});

test('the template chip names a real template; frames compare by what they draw', () => {
    assert.ok(noteTemplateById(NOTEPAD_DEMO_TEMPLATE));
    assert.equal(sameDemoContent(notepadDemoFrame(1_000), { ...notepadDemoFrame(1_000), level: 0.9 }), true);
    assert.equal(sameDemoContent(notepadDemoFrame(1_000), notepadDemoFrame(5_500)), false);
});
