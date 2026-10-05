// Saved notes that name the user by the Google account's FULL name are carried
// to the first name, through the speaker-rename path: text, owners, the people
// list, speaker labels and evidence attributions change; quotes, a typed rename,
// cross-meeting recall and the memory record do not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { migrateFullNameToFirst, runCalendarNameMigration } = require(path.resolve(here, '../../../dist-electron/electron/services/calendar/calendarNameMigration.js'));

const FULL = 'Evin John Ignatious';
const notes = () => ({
    speakerLabels: { me: FULL, speaker_1: 'Priya' },
    overview: `${FULL} asked what an API is.`,
    tldr: [`${FULL} emphasized the rules.`],
    openQuestions: [{ text: 'Use GraphQL?', owner: FULL, evidence: [{ speakerName: FULL, quote: `I'm ${FULL}, and I asked.` }] }],
    people: [{ name: FULL }, { name: 'Priya' }],
    crossMeeting: { stillOpen: [`${FULL} owes the deck`] },
    meetingMemory: { summary: `${FULL} was there`, participants: [FULL, 'Priya'] },
});

test('the full name becomes the first name in labels, text, owners, people and attributions', () => {
    const out = migrateFullNameToFirst(notes(), FULL);
    assert.deepEqual(out.speakerLabels, { me: 'Evin', speaker_1: 'Priya' });
    assert.equal(out.overview, 'Evin asked what an API is.');
    assert.deepEqual(out.tldr, ['Evin emphasized the rules.']);
    assert.equal(out.openQuestions[0].owner, 'Evin');
    assert.equal(out.openQuestions[0].evidence[0].speakerName, 'Evin');
    assert.deepEqual(out.people.map((p) => p.name), ['Evin', 'Priya']);
});

test('quotes, cross-meeting recall and the memory text are left verbatim', () => {
    const out = migrateFullNameToFirst(notes(), FULL);
    assert.equal(out.openQuestions[0].evidence[0].quote, `I'm ${FULL}, and I asked.`);
    assert.deepEqual(out.crossMeeting, notes().crossMeeting);
    assert.equal(out.meetingMemory.summary, notes().meetingMemory.summary, 'memory text verbatim');
    assert.deepEqual(out.meetingMemory.participants, ['Evin', 'Priya'], 'but its participant names follow');
});

test('a typed rename and a surname on its own are not touched', () => {
    const out = migrateFullNameToFirst({ speakerLabels: { me: 'EJ' }, overview: `${FULL} spoke.`, recipe: 'Ignatious Backs Four Year Fight' }, FULL);
    assert.equal(out.speakerLabels.me, 'EJ');
    assert.equal(out.overview, 'Evin spoke.');
    assert.equal(out.recipe, 'Ignatious Backs Four Year Fight');
});

test('nothing to do: no full name, a one-word name, or no account name', () => {
    assert.equal(migrateFullNameToFirst({ overview: 'Evin spoke.' }, FULL), null);
    assert.equal(migrateFullNameToFirst({ overview: 'Cher spoke.' }, 'Cher'), null);
    assert.equal(migrateFullNameToFirst({ overview: `${FULL} spoke.` }, undefined), null);
    assert.equal(migrateFullNameToFirst(null, FULL), null);
});

// ── The one-time run over saved meetings ─────────────────────────────────────
const store = (meetings) => {
    const log = [];
    let done;
    const rows = new Map(Object.entries(meetings).map(([id, d]) => [id, JSON.stringify({ detailedSummary: d })]));
    return {
        log, rows,
        deps: (over = {}) => ({
            fullName: FULL,
            getDoneFor: () => done,
            setDoneFor: (n) => { done = n; log.push(['done', n]); },
            listMentioning: (text) => [...rows].filter(([, j]) => j.includes(text)).map(([id, summaryJson]) => ({ id, summaryJson })),
            replaceDetailedSummary: (id, d) => { log.push(['write', id]); rows.set(id, JSON.stringify({ detailedSummary: d })); return true; },
            backup: (b) => log.push(['backup', b.map((r) => r.id), b.every((r) => r.summaryJson.includes(FULL))]),
            ...over,
        }),
    };
};

test('run: backs up the originals first, then carries each meeting over, once per name', () => {
    const s = store({ a: { overview: `${FULL} spoke.` }, b: { overview: 'Nothing here.' }, c: { speakerLabels: { me: FULL } } });
    assert.deepEqual(runCalendarNameMigration(s.deps()), ['a', 'c']);
    assert.deepEqual(s.log[0], ['backup', ['a', 'c'], true], 'backup of the untouched originals comes first');
    assert.deepEqual(s.log.slice(1), [['write', 'a'], ['write', 'c'], ['done', FULL]]);
    assert.ok(!s.rows.get('a').includes(FULL) && !s.rows.get('c').includes(FULL));
    assert.deepEqual(runCalendarNameMigration(s.deps()), [], 'second run: already done for this name');
});

test('run: no backup, no change (and not marked done)', () => {
    const s = store({ a: { overview: `${FULL} spoke.` } });
    assert.throws(() => runCalendarNameMigration(s.deps({ backup: () => { throw new Error('disk full'); } })));
    assert.ok(s.rows.get('a').includes(FULL));
    assert.ok(!s.log.some(([k]) => k === 'write' || k === 'done'));
});

test('run: nothing to do without a connected multi-word name', () => {
    const s = store({ a: { overview: `${FULL} spoke.` } });
    assert.deepEqual(runCalendarNameMigration(s.deps({ fullName: undefined })), []);
    assert.deepEqual(runCalendarNameMigration(s.deps({ fullName: 'Cher' })), []);
    assert.equal(s.log.length, 0);
});
