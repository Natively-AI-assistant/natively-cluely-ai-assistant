// The notepad's pure logic (2026-10-20): the "/" menu, Find, the reading
// text of the notes, Ask's sources and context, the event's people, the notes
// after Stop and the transcript search. No DOM, no platform branches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterSlashItems, findMatchRanges, readableNotesMarkdown, slashQuery, stepMatch } from '../notesEditorModel.ts';
import {
    answerSources, askContext, companyOfEmail, contentWords, enhancedNotesMarkdown, enhancedOverview, enhancedSections, groupAttendees, findInTranscript, listeningBarHeights,
    LANGUAGE_RESTRICTED_PROVIDERS, RECIPES_SHOWN, languageButtonLabel, micButtonLabel, notepadLanguageChoices, visibleRecipes,
    applyTranscriptEvent, EMPTY_LIVE_TRANSCRIPT, liveTranscriptRows, isSummaryTitle, fallbackNoteSections, actionLine,
} from '../notepadView.ts';

test('"/" asks for the menu only at the start of a line, up to 20 letters', () => {
    assert.equal(slashQuery('/'), '');
    assert.equal(slashQuery('/Sub'), 'sub');
    assert.equal(slashQuery('a /sub'), null);
    assert.equal(slashQuery('/https://x'), null);
    assert.equal(slashQuery(`/${'a'.repeat(21)}`), null);
});

test('the menu is Granola\'s three, kept by label word or keyword prefix', () => {
    assert.deepEqual(filterSlashItems('').map((i) => i.id), ['heading', 'bulletList', 'taskList']);
    assert.deepEqual(filterSlashItems('list').map((i) => i.id), ['bulletList']);
    assert.deepEqual(filterSlashItems('todo').map((i) => i.id), ['taskList']);
    assert.deepEqual(filterSlashItems('check').map((i) => i.id), ['taskList']);
    assert.deepEqual(filterSlashItems('zz'), []);
});

test('find: every match, case ignored, not overlapping; stepping wraps both ways', () => {
    assert.deepEqual(findMatchRanges('Send it, then SEND more', 'send'), [{ from: 0, to: 4 }, { from: 14, to: 18 }]);
    assert.deepEqual(findMatchRanges('aaaa', 'aa'), [{ from: 0, to: 2 }, { from: 2, to: 4 }]);
    assert.deepEqual(findMatchRanges('abc', ''), []);
    assert.equal(stepMatch(2, 3), 0);
    assert.equal(stepMatch(0, 3, true), 2);
    assert.equal(stepMatch(5, 0), 0);
});

test('the notes as reading text: the underline is plain words, the rest stays markdown', () => {
    assert.equal(readableNotesMarkdown('# Plan\n- ++SSO++ first\n- [ ] Send'), '# Plan\n- SSO first\n- [ ] Send');
    assert.equal(readableNotesMarkdown('a + b ++ c'), 'a + b ++ c');
});

const lines = [
    { speaker: 'them', text: 'So the annual plan, what does that come to for forty seats?', at: 1 },
    { speaker: 'user', text: 'With the launch discount it is twenty percent off the list price.', at: 2 },
    { speaker: 'them', text: 'Yes, that works.', at: 3 },
    { speaker: 'them', text: 'Maya will draft the release note by Friday for the docs page.', at: 4 },
];

test('sources: lines that share enough meaningful words with the answer, in time order; short lines never count', () => {
    const answer = 'Priya asked what forty seats come to on the annual plan. You said twenty percent off the list price with the launch discount.';
    assert.deepEqual(answerSources(answer, lines).map((l) => l.at), [1, 2]);
    assert.deepEqual(answerSources('Yes, that works.', lines), []);
    assert.deepEqual(answerSources('', lines), []);
    assert.equal(answerSources(answer, lines, 1).length, 1);
    assert.ok(!contentWords('the and you that').size);
});

test('Ask context: the last finished turns, oldest first; none without any', () => {
    const turns = [
        { question: 'q1', text: 'a1', status: 'done' },
        { question: 'q2', text: '', status: 'error' },
        { question: 'q3', text: 'a3', status: 'done' },
        { question: 'q4', text: 'partial', status: 'streaming' },
    ];
    assert.equal(askContext(turns), 'User: q1\nAssistant: a1\n\nUser: q3\nAssistant: a3');
    assert.equal(askContext(turns, 1), 'User: q3\nAssistant: a3');
    assert.equal(askContext([]), undefined);
});

test('people by company: own company first, the user marked and first in it; personal mail reads Personal', () => {
    assert.equal(companyOfEmail('priya@acme.io'), 'Acme');
    assert.equal(companyOfEmail('sam@shop.co.uk'), 'Shop');
    assert.equal(companyOfEmail('jo@gmail.com'), 'Personal');
    assert.equal(companyOfEmail('nobody'), 'Other');
    const groups = groupAttendees([
        { email: 'priya@acme.io', name: 'Priya Shah' },
        { email: 'kim@natively.ai', name: 'Kim' },
        { email: 'evin@natively.ai', name: 'Evin' },
    ], 'Evin@natively.ai');
    assert.deepEqual(groups.map((g) => g.company), ['Natively', 'Acme']);
    assert.deepEqual(groups[0].people.map((p) => [p.email, p.self]), [['evin@natively.ai', true], ['kim@natively.ai', false]]);
});

test('notes after Stop: Summary, then the sections with the user\'s lines marked; older notes fall back', () => {
    const v3 = enhancedSections({
        tldr: ['Acme signs if SSO ships.'],
        sectionsV3: [{ title: 'Pricing', bullets: [{ text: 'Annual plan', fromUserNotes: true }, { text: 'Forty seats' }, { text: '  ' }] }, { title: 'Empty', bullets: [] }],
    });
    assert.deepEqual(v3, [
        { title: 'Summary', lines: [{ text: 'Acme signs if SSO ships.', mine: false }] },
        { title: 'Pricing', lines: [{ text: 'Annual plan', mine: true }, { text: 'Forty seats', mine: false }] },
    ]);
    // The overview is drawn above the sections (enhancedOverview), never as a Summary of its own.
    assert.deepEqual(enhancedSections({ overview: 'Short call.', keyPoints: ['One'], actionItems: [] }).map((s) => s.title), ['Key points']);
    assert.deepEqual(enhancedSections(null), []);
    assert.equal(enhancedNotesMarkdown('Acme call', v3), '# Acme call\n\n## Summary\n- Acme signs if SSO ships.\n\n## Pricing\n- Annual plan\n- Forty seats');
});

test('find in the transcript: every match in place, case ignored, in order; empty finds nothing', () => {
    const hits = findInTranscript(lines, 'THE');
    assert.deepEqual(hits.map((h) => h.at), [1, 2, 2, 4, 4]);
    for (const h of hits) assert.equal(lines.find((l) => l.at === h.at).text.slice(h.from, h.to).toLowerCase(), 'the');
    assert.deepEqual(findInTranscript([{ text: 'aaaa', at: 9 }], 'aa'), [{ at: 9, from: 0, to: 2 }, { at: 9, from: 2, to: 4 }]);
    assert.deepEqual(findInTranscript(lines, '  '), []);
});

test('listening bars as Granola\'s: a 15% nub in silence, near full when loud, the middle bar liveliest', () => {
    assert.deepEqual(listeningBarHeights(0, () => 0.5), [0.15, 0.15, 0.15]);
    assert.deepEqual(listeningBarHeights(1, () => 0), [0.95, 1, 0.95]);
    const [a, b, c] = listeningBarHeights(0.3, () => 0.5);
    assert.ok(b > a && a === c, `${a} ${b} ${c}`);
});

const langs = {
    croatian: { label: 'Croatian', group: 'Croatian' },
    french: { label: 'French', group: 'French' },
    'english-us': { label: 'English (United States)', group: 'English' },
    auto: { label: 'Auto Detect', group: 'Auto' },
    'english-uk': { label: 'English (United Kingdom)', group: 'English' },
};

test('transcript language: cloud providers list every offered language, Auto then English first; model-bound ones go to Settings', () => {
    const offered = (k) => k !== 'croatian';
    assert.deepEqual(notepadLanguageChoices('natively', langs, offered).map((c) => c.key), ['auto', 'english-uk', 'english-us', 'french']);
    for (const p of ['local-whisper', 'apple-speech', 'nvidia_nim', 'deepgram']) {
        assert.ok(LANGUAGE_RESTRICTED_PROVIDERS.has(p));
        assert.equal(notepadLanguageChoices(p, langs, offered), null, p);
    }
    assert.equal(languageButtonLabel('english-us', langs), 'English');
    assert.equal(languageButtonLabel('auto', langs), 'Auto');
    assert.equal(notepadLanguageChoices('natively', langs, offered)[0].label, 'Auto');
    assert.equal(languageButtonLabel('klingon', langs), 'Language');
});

test('mic button: the saved device while it is there, else the default\'s name', () => {
    const devices = [{ id: 'default', name: 'Default Microphone' }, { id: 'a1', name: 'AirPods (Bluetooth)' }];
    assert.equal(micButtonLabel(devices, 'a1'), 'AirPods (Bluetooth)');
    assert.equal(micButtonLabel(devices, 'AirPods (Bluetooth)'), 'AirPods (Bluetooth)');
    assert.equal(micButtonLabel(devices, 'gone'), 'Default Microphone');
    assert.equal(micButtonLabel([], null), 'Default microphone');
});

test('recipes: two in the row, all of them once All recipes is open', () => {
    const r = ['a', 'b', 'c', 'd'];
    assert.equal(RECIPES_SHOWN, 2);
    assert.deepEqual(visibleRecipes(r, false), ['a', 'b']);
    assert.deepEqual(visibleRecipes(r, true), r);
});

test('"/" menu with templates: commands, then the quick five or name matches, then All templates… last', async () => {
    const { slashEntries } = await import('../notesEditorModel.ts');
    const quick = [{ id: 'a', name: '1 to 1' }, { id: 'b', name: 'Hiring' }];
    const all = [...quick, { id: 'c', name: 'Customer: Discovery' }, { id: 'd', name: 'Hiring (Advanced)' }];
    const kinds = (es) => es.map((e) => e.kind === 'command' ? e.item.id : e.kind === 'template' ? e.id : 'all');
    assert.deepEqual(kinds(slashEntries('', quick, all)), ['heading', 'bulletList', 'taskList', 'a', 'b', 'all']);
    assert.deepEqual(kinds(slashEntries('hir', quick, all)), ['b', 'd', 'all']);
    assert.deepEqual(kinds(slashEntries('disc', quick, all)), ['c', 'all']);
    assert.deepEqual(kinds(slashEntries('list', quick, all)), ['bulletList', 'all']);
});

// 2026-10-31: you and the call transcribed at once used to share one slot for words in
// progress, so the bubble flipped between speakers and one side's final wiped the other's.
const step = (state, speaker, text, at, final, now = at) => applyTranscriptEvent(state, { speaker, text, at, final }, now);
const rowsOf = (state) => liveTranscriptRows(state).map((r) => `${r.speaker}:${r.text}${r.partial ? '…' : ''}`);

test('live transcript: each speaker keeps its own words in progress, in the order they started', () => {
    let s = EMPTY_LIVE_TRANSCRIPT;
    s = step(s, 'interviewer', 'So the', 1000, false);
    s = step(s, 'user', 'Right', 1100, false);
    s = step(s, 'interviewer', 'So the pricing', 1200, false);
    s = step(s, 'user', 'Right, and', 1300, false);
    assert.deepEqual(rowsOf(s), ['interviewer:So the pricing…', 'user:Right, and…']);
});

test('live transcript: a final replaces only its own speaker and stays where it started', () => {
    let s = EMPTY_LIVE_TRANSCRIPT;
    s = step(s, 'interviewer', 'So the', 1000, false);
    s = step(s, 'user', 'Right', 1100, false);
    s = step(s, 'user', 'Right, sure.', 1400, true);
    assert.deepEqual(rowsOf(s), ['interviewer:So the…', 'user:Right, sure.']);
    assert.equal(s.lines[0].at, 1100);
    s = step(s, 'interviewer', 'So the pricing is fine.', 1500, true);
    assert.deepEqual(rowsOf(s), ['interviewer:So the pricing is fine.', 'user:Right, sure.']);
    assert.deepEqual(s.partials, []);
});

test('live transcript: words in progress from a side gone quiet are dropped; lines are capped', () => {
    let s = EMPTY_LIVE_TRANSCRIPT;
    s = step(s, 'user', 'Hang on', 1000, false);
    s = step(s, 'interviewer', 'Later', 20000, false);
    assert.deepEqual(rowsOf(s), ['interviewer:Later…']);
    let c = EMPTY_LIVE_TRANSCRIPT;
    for (let i = 0; i < 5; i++) c = applyTranscriptEvent(c, { speaker: 'user', text: `l${i}`, at: i, final: true }, i, 3);
    assert.deepEqual(c.lines.map((l) => l.text), ['l2', 'l3', 'l4']);
});

test('enhanced notes: a v3 note with no sections shows its Summary once, not again as Key points', () => {
    const bullets = ['Ratcliffe backs Amorim for three years.', 'The squad does not fit his system.'];
    const v3 = enhancedSections({ schemaVersion: 3, overview: 'Long overview.', tldr: bullets, sectionsV3: [], keyPoints: bullets, actionItems: ['x'] });
    assert.deepEqual(v3.map((s) => s.title), ['Summary']);
    assert.deepEqual(v3[0].lines.map((l) => l.text), bullets);
    assert.deepEqual(enhancedSections({ tldr: ['A'], keyPoints: ['B'] }).map((s) => s.title), ['Summary', 'Key points']);
});

test('enhanced notes: the overview shows above the notes as plain paragraphs, and Copy includes it', () => {
    const d = { overview: '## Overview\nThe call covered **pricing** and\nthe _rollout_.\n\nRatcliffe backs Amorim.\n\n  ' };
    assert.deepEqual(enhancedOverview(d), ['The call covered pricing and the rollout.', 'Ratcliffe backs Amorim.']);
    assert.deepEqual(enhancedOverview({ overview: 'snake_case_name stays' }), ['snake_case_name stays']);
    assert.deepEqual(enhancedOverview(null), []);
    assert.equal(enhancedNotesMarkdown('Call', [{ title: 'Summary', lines: [{ text: 'A', mine: false }] }], ['First.', 'Second.']), '# Call\n\nFirst.\n\nSecond.\n\n## Summary\n- A');
});

test('a template with its own Summary section is the Summary; the tldr is not drawn as a second (2026-10-31)', () => {
    // New installs seed General as Summary / Action items / Key points; the notes showed "Summary" twice.
    const note = (title) => ({ schemaVersion: 3, tldr: ['From the tldr'], keyPoints: ['From the tldr'], sectionsV3: [
        { title, bullets: [{ text: 'From the template', fromUserNotes: true }] },
        { title: 'Action items', bullets: [{ text: 'Send it' }] },
    ] });
    const s = enhancedSections(note('Summary'));
    assert.deepEqual(s.map((x) => x.title), ['Summary', 'Action items']);
    assert.deepEqual(s[0].lines, [{ text: 'From the template', mine: true }]);
    assert.deepEqual(enhancedSections(note('Study summary')).map((x) => x.title), ['Summary', 'Study summary', 'Action items']);
    for (const t of ['Summary', ' summary: ', 'TL;DR', 'tldr', 'TL; DR']) assert.equal(isSummaryTitle(t), true, t);
    for (const t of ['Study summary', 'Opportunity summary', 'Summary of risks', '', null]) assert.equal(isSummaryTitle(t), false, String(t));
    // A template Summary with no lines doesn't hide the tldr.
    assert.deepEqual(enhancedSections({ schemaVersion: 3, tldr: ['From the tldr'], sectionsV3: [{ title: 'Summary', bullets: [] }] }).map((x) => x.title), ['Summary']);
});

test('a v3 note with no template shows its decisions and action items (2026-10-31)', () => {
    // No mode active and no notepad template: the notes call still writes the lists, and the
    // notepad showed only the Summary (the Granola benchmark, 21 of 21 meetings).
    const bare = { schemaVersion: 3, tldr: ['Plan agreed'], sectionsV3: [],
        decisions: [{ text: 'Dark mode moves to 4.13', fromUserNotes: true }, { text: '  ' }],
        actionItemsV3: [
            { text: 'Fix the Android crash', owner: 'Ananya', deadline: 'November 9' },
            { text: 'Ask support about refunds' },
        ] };
    assert.deepEqual(enhancedSections(bare), [
        { title: 'Summary', lines: [{ text: 'Plan agreed', mine: false }] },
        { title: 'Decisions', lines: [{ text: 'Dark mode moves to 4.13', mine: true }] },
        { title: 'Action items', lines: [{ text: 'Ananya: Fix the Android crash (by November 9)', mine: false }, { text: 'Ask support about refunds', mine: false }] },
    ]);
    // The same lines as the exports (notesDocument.actionItemLine).
    assert.equal(actionLine({ text: 'Send it', owner: 'Dana', deadline: 'Friday' }), 'Dana: Send it (by Friday)');
    // A template's sections win; the lists stay out of the notes.
    const templated = { ...bare, sectionsV3: [{ title: 'Pricing', bullets: [{ text: 'Flat' }] }] };
    assert.deepEqual(enhancedSections(templated).map((s) => s.title), ['Summary', 'Pricing']);
    assert.deepEqual(fallbackNoteSections(templated), []);
    // Older notes keep their own fallback (key points and action items).
    assert.deepEqual(fallbackNoteSections({ keyPoints: ['A'], decisions: [{ text: 'B' }] }), []);
});
