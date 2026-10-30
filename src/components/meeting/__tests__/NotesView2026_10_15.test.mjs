// The meeting page's notes features and the notes window (2026-10-15):
// Source (transcript ±45 s around a note line, quote marked), version tabs,
// the edited-notes warning, "- " points continuing on Enter, and the wiring
// in the components (source contracts; there is no render harness).
//
// Pure renderer logic; no platform branch.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const {
    SOURCE_WINDOW_MS, noteLineTime, toClockMs, meetingStartOf, selectSourceLines, splitOnQuote,
    notesWereEdited, notesLabel, versionTabs, continueListOnEnter, notesContentKey,
} = await import('../notesView.ts');

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(HERE, rel), 'utf8');
const live = (src) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

const T0 = Date.parse('2026-10-15T10:00:00Z');
const at = (s) => T0 + s * 1000;
const transcript = [
    { speaker: 'user', text: 'Shall we start with pricing?', timestamp: at(0) },
    { speaker: 'interviewer', text: 'Sure. The price is 40 per seat.', timestamp: at(30), speakerId: 'speaker_2' },
    { speaker: 'assistant', text: 'An AI answer', timestamp: at(40) },
    { speaker: 'user', text: 'And for 50 seats?', timestamp: at(75) },
    { speaker: 'interviewer', text: 'Same price, billed annually.', timestamp: at(76) },
    { speaker: 'interviewer', text: 'Moving on to security.', timestamp: at(200) },
];

describe('Source: which transcript lines', () => {
    test('the window is ±45 s', () => {
        assert.equal(SOURCE_WINDOW_MS, 45_000);
    });

    test('lines within 45 s either side, in time order, the assistant left out, voices kept', () => {
        const lines = selectSourceLines(transcript, at(30));
        assert.deepEqual(lines.map((l) => l.text), ['Shall we start with pricing?', 'Sure. The price is 40 per seat.', 'And for 50 seats?']);
        assert.equal(lines[1].speaker, 'speaker_2', 'a line attributed to a voice shows as that voice');
    });

    test('both boundaries are included; one millisecond past is not', () => {
        assert.deepEqual(selectSourceLines(transcript, at(45)).map((l) => l.timestamp), [at(0), at(30), at(75), at(76)]);
        assert.ok(!selectSourceLines(transcript, at(45) + 1).some((l) => l.timestamp === at(0)));
        assert.ok(!selectSourceLines(transcript, at(30) - 1).some((l) => l.timestamp === at(75)));
    });

    test('times into the meeting (older notes) are read from the first line', () => {
        assert.equal(meetingStartOf(transcript), at(0));
        assert.equal(toClockMs(30_000, at(0)), at(30));
        assert.equal(toClockMs(at(30), at(0)), at(30));
        assert.deepEqual(selectSourceLines(transcript, 200_000).map((l) => l.text), ['Moving on to security.']);
    });

    test('no time, no lines; nothing nearby, no lines', () => {
        assert.deepEqual(selectSourceLines(transcript, undefined), []);
        assert.deepEqual(selectSourceLines(transcript, NaN), []);
        assert.deepEqual(selectSourceLines([], at(30)), []);
        assert.deepEqual(selectSourceLines(transcript, at(130)), []);
    });

    test('a note line\'s time: its own source time, else its time, else its first evidence', () => {
        assert.equal(noteLineTime({ sourceTimestampMs: 5, evidence: [{ timestampMs: 9 }] }), 5);
        assert.equal(noteLineTime({ timestampMs: 7 }), 7);
        assert.equal(noteLineTime({ evidence: [{ quote: 'x' }, { timestamp: 11 }] }), 11);
        assert.equal(noteLineTime({ evidence: [{ quote: 'no time' }] }), undefined, 'such a line shows no Source');
        assert.equal(noteLineTime({ text: 'x' }), undefined);
        assert.equal(noteLineTime(null), undefined);
    });
});

describe('Source: the quote, marked', () => {
    test('found regardless of case, quote marks and spacing', () => {
        const parts = splitOnQuote('Sure. The price is 40   per seat.', '“the price is 40 per seat”');
        assert.deepEqual(parts, [
            { text: 'Sure. ', match: false },
            { text: 'The price is 40   per seat', match: true },
            { text: '.', match: false },
        ]);
    });
    test('not found, or too short to mean anything: the line stays whole', () => {
        assert.deepEqual(splitOnQuote('Moving on.', 'pricing'), [{ text: 'Moving on.', match: false }]);
        assert.deepEqual(splitOnQuote('Moving on.', 'on'), [{ text: 'Moving on.', match: false }]);
        assert.deepEqual(splitOnQuote('Moving on.', undefined), [{ text: 'Moving on.', match: false }]);
    });
    test('the whole line can be the quote', () => {
        assert.deepEqual(splitOnQuote('And for 50 seats?', 'and for 50 seats?'), [{ text: 'And for 50 seats?', match: true }]);
    });
});

describe('versions and the edit warning', () => {
    const current = { mode: { selectedModeName: 'Sales call' } };
    test('no earlier version, no tabs', () => {
        assert.deepEqual(versionTabs(current, []), []);
    });
    test('earlier versions oldest first, then the current notes; same names numbered', () => {
        const tabs = versionTabs(current, [
            { id: 9, label: 'General', createdAt: 300 },
            { id: 4, label: 'General', createdAt: 100 },
            { id: 6, label: 'Sales call', createdAt: 200 },
        ]);
        assert.deepEqual(tabs, [
            { key: 4, label: 'General' },
            { key: 6, label: 'Sales call' },
            { key: 9, label: 'General 2' },
            { key: 'current', label: 'Sales call 2' },
        ]);
    });
    test('labels fall back to the template, then "Notes"', () => {
        assert.equal(notesLabel({ mode: { selectedTemplateType: 'team_meeting' } }), 'Team meeting');
        assert.equal(notesLabel(undefined), 'Notes');
    });
    test('edited = stamped by an edit; nothing else counts', () => {
        assert.equal(notesWereEdited({ userEditedAt: 1760000000000 }), true);
        assert.equal(notesWereEdited({ userEditedAt: 0 }), false);
        assert.equal(notesWereEdited({ userEditedAt: '1' }), false);
        assert.equal(notesWereEdited(undefined), false);
    });
});

describe('notes window: Enter on a point', () => {
    test('continues the point with the same marker and indent', () => {
        const v = '# Pricing\n- 40 per seat';
        assert.deepEqual(continueListOnEnter(v, v.length, v.length), { value: '# Pricing\n- 40 per seat\n- ', caret: v.length + 3 });
        const w = '  * nested';
        assert.deepEqual(continueListOnEnter(w, w.length, w.length), { value: '  * nested\n  * ', caret: w.length + 5 });
    });
    test('an empty point ends the list', () => {
        const v = '- one\n- ';
        assert.deepEqual(continueListOnEnter(v, v.length, v.length), { value: '- one\n', caret: 6 });
    });
    test('an ordinary line, a heading or a selection: a plain Enter', () => {
        assert.equal(continueListOnEnter('plain', 5, 5), null);
        assert.equal(continueListOnEnter('# Heading', 9, 9), null);
        assert.equal(continueListOnEnter('- one', 0, 3), null);
        assert.equal(continueListOnEnter('-no space', 9, 9), null);
    });
});

describe('wiring (source contracts)', () => {
    const DETAILS = live(read('../../MeetingDetails.tsx'));
    const NOTES_WINDOW = live(read('../../NotesWindow.tsx'));
    const OVERLAY = live(read('../../NativelyInterface.tsx'));
    const AUX = live(read('../../../AuxRoot.tsx'));
    const MAIN = read('../../../main.tsx');
    const SOURCE = live(read('../NoteSource.tsx'));
    const RATING = live(read('../NotesRating.tsx'));

    test('a user-notes line reads in the primary text colour, the rest stay secondary (existing tokens only)', () => {
        assert.match(DETAILS, /bullet\.fromUserNotes \? 'text-text-primary' : 'text-text-secondary'/);
    });

    test('"Your notes" is a tab only when there are notes; it shows them as typed and Copy copies them', () => {
        assert.match(DETAILS, /NOTES_TABS\.filter\(tab => tab !== 'yours' \|\| hasUserNotes\)/);
        // The notepad writes markdown (2026-10-20): read as headings, lists and checkboxes; Copy gives the readable text.
        assert.match(DETAILS, /activeTab === 'yours' && \([\s\S]*?<ReactMarkdown remarkPlugins=\{\[remarkGfm\]\}>\{readableNotesMarkdown\(meeting\.userNotes \|\| ''\)\}<\/ReactMarkdown>/);
        assert.match(DETAILS, /activeTab === 'yours'\) \{\s*textToCopy = readableNotesMarkdown\(meeting\.userNotes \|\| ''\)/);
    });

    test('Source is mounted only for a line with a time; it reads the saved transcript, no model call', () => {
        assert.match(DETAILS, /const at = noteLineTime\(bullet\);\s*if \(at === undefined\) return null;/);
        assert.doesNotMatch(SOURCE, /electronAPI/);
        assert.match(SOURCE, /selectSourceLines\(transcript, time\)/);
        assert.match(SOURCE, /var\(--accent-subtle\)/, 'the mark uses an existing token');
    });

    test('Regenerate over edited notes asks with the in-app confirm, then regenerates; the Pro gate is untouched', () => {
        assert.match(DETAILS, /if \(!confirmed && notesWereEdited\(baseMeeting\.detailedSummary\)\) \{\s*setPendingRegenerate/);
        assert.match(DETAILS, /<ConfirmDialog[\s\S]*?Regenerating replaces the edits you made to these notes\. Your current version stays in its tab\./);
        // The suggestion's refusal reads as before; a refusal from the template
        // picker (2026-10-15, NotesFeedback test) marks that template instead.
        assert.match(DETAILS, /res\?\.error === 'pro_required'\) \{[\s\S]{0,600}else setDetectedNeedsPro\(true\)/);
        assert.doesNotMatch(DETAILS, /window\.confirm\(/);
    });

    test('version tabs swap only the notes; the speaker names stay the meeting\'s', () => {
        assert.match(DETAILS, /\{ \.\.\.shownVersion\.detailedSummary, speakerLabels: baseMeeting\.detailedSummary\?\.speakerLabels \}/);
        assert.match(DETAILS, /<NotesVersionTabs tabs=\{tabs\} active=\{versionKey\}/);
    });

    test('rating: thumbs at the end of V3 notes, against the version shown', () => {
        assert.match(DETAILS, /<NotesRating\s+meetingId=\{meeting\.id\}\s+versionId=\{versionKey === 'current' \? null : versionKey\}/);
        assert.match(RATING, /t\('What was wrong\?'\)/);
        assert.match(RATING, /maxLength=\{500\}/);
    });

    // The overlay's Notes button went on 2026-10-30 (the owner: the notepad is
    // reached from Settings › Overlay); the window stays for the meeting page.
    test('the overlay has no Notes button; the notes window is a light, tooltip-free route', () => {
        assert.doesNotMatch(OVERLAY, /aria-label=\{t\('Notes'\)\}/);
        assert.doesNotMatch(OVERLAY, /notesWindowToggle/);
        assert.match(AUX, /route === 'notes'[\s\S]*?<NotesWindow \/>/);
        assert.match(MAIN, /LIGHT_ROUTES = \[[^\]]*'notes'[^\]]*\]/);
    });

    test('the notes window sends every change, pings typing, and never focuses itself', () => {
        assert.match(NOTES_WINDOW, /liveNotesSetText\?\.\(next\)/);
        assert.match(NOTES_WINDOW, /meetingAutoStopTyping\?\.\(\)/);
        // After Stop the notepad shows the enhanced notes (2026-10-20), with Open meeting.
        assert.match(NOTES_WINDOW, /<NotesEnhanced ref=\{enhancedRef\} meetingId=\{meetingId!\}/);
        assert.match(live(read('../../notes/NotesEnhanced.tsx')), /notesWindowOpenMeeting\?\.\(meetingId\)/);
        assert.doesNotMatch(NOTES_WINDOW, /\.focus\(/);
        // The editor focuses only for a mouse pick, never while the hook types.
        const EDITOR = live(read('../../notes/NotesEditor.tsx'));
        assert.match(EDITOR, /runSlash\(editor, entry\.item\.id, \{ from: open\.from, to: open\.to \}, !hookTypingRef\.current\)/);
        assert.equal((EDITOR.match(/\.focus\(/g) ?? []).length, 1);
    });
});

describe('notesContentKey (the rating reloads for new words, not for a follow-up)', () => {
    const notes = {
        schemaVersion: 3, overview: 'Pricing agreed.', tldr: ['54 seats'],
        sectionsV3: [{ title: 'Pricing', bullets: [{ text: 'annual upfront' }] }],
        actionItemsV3: [{ text: 'Send the order form' }], decisions: [{ text: '24 months' }], openQuestions: [],
    };
    test('a follow-up draft, a speaker rename or bookkeeping does not change it', () => {
        const k = notesContentKey(notes);
        assert.equal(notesContentKey({ ...notes, followUpDraft: { subject: 'Thanks', body: 'Hi Renata' } }), k);
        assert.equal(notesContentKey({ ...notes, speakerLabels: { speaker_1: 'Renata Voss' } }), k);
        assert.equal(notesContentKey({ ...notes, userEditedAt: 123 }), k);
    });
    test('regenerated words change it', () => {
        const k = notesContentKey(notes);
        assert.notEqual(notesContentKey({ ...notes, overview: 'Pricing agreed at 18% off.' }), k);
        assert.notEqual(notesContentKey({ ...notes, sectionsV3: [{ title: 'Pricing', bullets: [{ text: 'quarterly in advance' }] }] }), k);
        assert.notEqual(notesContentKey({ ...notes, actionItemsV3: [{ text: 'Send the order form by Thursday' }] }), k);
    });
});
