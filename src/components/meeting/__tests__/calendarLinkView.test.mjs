// The notes' calendar menu (CalendarLinkChip): which events the recording
// overlapped, who else was in them, and the timeline strip's marks.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
    overlapMinutes, splitByRecording, otherAttendees, firstName, initials,
    namesAndRest, durationParts, timelineLayout,
} = await import('../calendarLinkView.ts');

const at = (h, m) => new Date(2026, 8, 27, h, m).toISOString();
const ms = (h, m) => new Date(2026, 8, 27, h, m).getTime();
const ev = (id, a, b, attendees = []) => ({ id, startTime: at(...a), endTime: at(...b), attendees });
const span = { startMs: ms(10, 2), endMs: ms(10, 40) };

const interview = ev('e1', [10, 0], [10, 45]);
const review = ev('e2', [10, 45], [11, 15]);
const standup = ev('e3', [9, 30], [9, 45]);
const focus = ev('e4', [9, 0], [10, 0]);

test('overlap is the minutes of the event the recording covered', () => {
    assert.equal(overlapMinutes(interview, span), 38);
    assert.equal(overlapMinutes(review, span), 0, 'starts after the recording ends');
    assert.equal(overlapMinutes(focus, span), 0, 'ends before the recording starts');
    assert.equal(overlapMinutes(interview, null), 0, 'no span, no overlap');
});

test('events split into during and around, keeping their order', () => {
    const { during, around } = splitByRecording([interview, review, standup, focus], span);
    assert.deepEqual(during.map((e) => e.id), ['e1']);
    assert.deepEqual(around.map((e) => e.id), ['e2', 'e3', 'e4']);
});

test('without a span nothing is claimed to be during the recording', () => {
    const { during, around } = splitByRecording([interview, review], null);
    assert.deepEqual(during, []);
    assert.deepEqual(around.map((e) => e.id), ['e1', 'e2']);
});

test('the user is left out of the people, whatever the address case', () => {
    const people = [
        { email: 'Evin@Example.com', name: 'Evin John' },
        { email: 'priya@northwind.dev', name: 'Priya Nair' },
        { email: 'sam@northwind.dev' },
    ];
    assert.deepEqual(otherAttendees(people, 'evin@example.com').map((a) => a.email), ['priya@northwind.dev', 'sam@northwind.dev']);
    assert.equal(otherAttendees(people, undefined).length, 3, 'unknown self keeps everyone');
});

test('names fall back to the address, first names to its local part', () => {
    assert.equal(firstName({ email: 'priya@x.dev', name: 'Priya Nair' }), 'Priya');
    assert.equal(firstName({ email: 'sam.okafor@x.dev' }), 'sam.okafor');
    assert.equal(initials({ email: 'p@x.dev', name: 'Priya Nair' }), 'PN');
    assert.equal(initials({ email: 'p@x.dev', name: 'Priya Nair' }, 1), 'P');
    assert.equal(initials({ email: 'sam.okafor@x.dev' }), 'SO');
});

test('a crowd shows two names and a count', () => {
    const crowd = Array.from({ length: 49 }, (_, i) => ({ email: `p${i}@x.dev`, name: `Person ${i}` }));
    assert.deepEqual(namesAndRest(crowd, 2), { names: ['Person 0', 'Person 1'], rest: 47 });
    assert.deepEqual(namesAndRest(crowd.slice(0, 2), 2), { names: ['Person 0', 'Person 1'], rest: 0 });
});

test('durations split into hours and minutes', () => {
    assert.deepEqual(durationParts(45 * 60_000), { h: 0, m: 45 });
    assert.deepEqual(durationParts(90 * 60_000), { h: 1, m: 30 });
    assert.deepEqual(durationParts(60 * 60_000), { h: 1, m: 0 });
});

test('the strip spans the recording and every event, one lane each in start order', () => {
    const l = timelineLayout([interview, review, standup, focus], span);
    assert.ok(l);
    assert.deepEqual(l.lanes, ['e4', 'e3', 'e1', 'e2']);
    assert.equal(l.at(ms(9, 0)), 0);
    assert.equal(l.at(ms(11, 15)), 1);
    assert.ok(Math.abs(l.width(span.startMs, span.endMs) - 38 / 135) < 1e-9);
});

test('ticks sit on half-hours inside the strip, at most six', () => {
    const l = timelineLayout([interview, review, standup, focus], span);
    const labels = l.ticks.map((t) => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; });
    assert.deepEqual(labels, ['9:00', '9:30', '10:00', '10:30', '11:00']);
});

test('a long day widens the step instead of crowding the strip', () => {
    const l = timelineLayout([ev('a', [8, 10], [9, 0]), ev('b', [13, 0], [14, 20])], { startMs: ms(10, 0), endMs: ms(11, 0) });
    assert.ok(l.ticks.length <= 6);
    for (const t of l.ticks) {
        const d = new Date(t);
        assert.equal(d.getMinutes(), 0, 'whole hours');
        assert.ok(t >= ms(8, 10) && t <= ms(14, 20), 'inside the strip');
    }
});

test('no span or no events, no strip', () => {
    assert.equal(timelineLayout([interview], null), null);
    assert.equal(timelineLayout([], span), null);
});
