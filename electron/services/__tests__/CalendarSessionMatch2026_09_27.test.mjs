// Which calendar event a Natively session belongs to (calendarSessionMatch.ts).
// A wrong link names the meeting, its speakers and its follow-up recipients
// wrongly, so these pin both halves: a clear winner links, a genuine tie does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const compiled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/services/calendar/calendarSessionMatch.js');
const { matchEventForSession, toEventSnapshot, calendarSpeakerLabels, relinkSpeakerLabels } = require(compiled);

const T0 = Date.parse('2026-09-28T10:00:00Z');
const at = (min) => new Date(T0 + min * 60_000).toISOString();
const person = (name, extra = {}) => ({ email: `${name.toLowerCase().replace(/\s+/g, '.')}@acme.com`, name, ...extra });
const ev = (id, fromMin, toMin, extra = {}) => ({ id, title: id, startTime: at(fromMin), endTime: at(toMin), attendees: [person('Priya Nair')], ...extra });
const match = (events, nowMin) => matchEventForSession(events, T0 + nowMin * 60_000);
const idOf = (m) => (m.kind === 'linked' ? m.event.id : m.kind);

test('a session started around a meeting links to it', () => {
    const events = [ev('standup', 0, 30)];
    assert.equal(idOf(match(events, 0)), 'standup', 'on time');
    assert.equal(idOf(match(events, -9)), 'standup', 'up to 10 min early');
    assert.equal(idOf(match(events, 20)), 'standup', 'late, while it is still on');
    assert.equal(match(events, -11).kind, 'none', 'more than 10 min early is not yet this meeting');
    assert.equal(match(events, 31).kind, 'none', 'after it ended');
});

test('back-to-back: starting at the end of one is for the next', () => {
    const events = [ev('first', 0, 30), ev('second', 30, 60)];
    assert.equal(idOf(match(events, 28)), 'second', 'the ending one yields');
    assert.equal(idOf(match(events, 5)), 'first', 'early in the first, the second is not in its window yet');
});

test('a meeting with people beats a solo focus block at the same time', () => {
    const events = [ev('focus', 0, 120, { attendees: [] }), ev('client call', 0, 45)];
    assert.equal(idOf(match(events, 1)), 'client call');
    assert.equal(idOf(match([ev('focus', 0, 120, { attendees: [] })], 1)), 'focus', 'alone, a solo block still links');
});

test('declined events never match', () => {
    const events = [ev('declined one', 0, 30, { selfResponse: 'declined' }), ev('accepted one', 0, 30, { selfResponse: 'accepted', title: 'accepted one' })];
    assert.equal(idOf(match(events, 0)), 'accepted one');
    assert.equal(match([events[0]], 0).kind, 'none');
});

test('a genuine tie is not guessed', () => {
    const same = match([ev('A', 0, 30), ev('B', 0, 30)], 1);
    assert.equal(same.kind, 'ambiguous', 'two meetings at the same time');
    assert.deepEqual(same.candidates.map((e) => e.id).sort(), ['A', 'B']);

    // Under way for 25 min vs starting in 5: late to one, or early to the other.
    assert.equal(match([ev('long review', 0, 60), ev('next call', 30, 60)], 25).kind, 'ambiguous');
});

test('among several, a clearly nearer start wins', () => {
    // Both under way; the one that just started is the one just joined.
    assert.equal(idOf(match([ev('all hands', 0, 90), ev('breakout', 15, 45)], 16)), 'breakout');
    // Two starting soon, 8 min apart.
    assert.equal(idOf(match([ev('sooner', 2, 30), ev('later', 10, 40)], 0)), 'sooner');
});

test('no candidate: the next meeting within 30 min is offered for a re-check', () => {
    const m = match([ev('soon', 25, 55)], 0);
    assert.equal(m.kind, 'none');
    assert.equal(m.next?.id, 'soon');
    assert.equal(match([ev('far', 45, 75)], 0).next, undefined, 'beyond 30 min');
    assert.equal(match([ev('solo later', 20, 50, { attendees: [] })], 0).next, undefined, 'a solo block is not worth waiting for');
});

test('a snapshot keeps what the meeting needs later, nothing more', () => {
    const snap = toEventSnapshot({ ...ev('call', 0, 30, { link: 'https://meet.google.com/x' }), attendees: [person('Priya Nair', { response: 'accepted', photoUrl: 'https://x' }), { email: '' }] }, 'start');
    assert.deepEqual(snap, {
        id: 'call', title: 'call', startTime: at(0), endTime: at(30), link: 'https://meet.google.com/x',
        attendees: [{ email: 'priya.nair@acme.com', name: 'Priya Nair', response: 'accepted' }],
        linkedBy: 'start',
    });
});

test('speaker names: me always, the other voice only in a 1:1 with a real name', () => {
    const snap = (attendees) => toEventSnapshot({ ...ev('m', 0, 30), attendees }, 'start');
    assert.deepEqual(calendarSpeakerLabels(snap([person('Priya Nair')]), 'Evin John'), { me: 'Evin John', speaker_1: 'Priya Nair' });
    assert.deepEqual(calendarSpeakerLabels(snap([person('Priya Nair'), person('Rob Lane')]), 'Evin John'), { me: 'Evin John' }, 'a group call shares one channel');
    assert.deepEqual(calendarSpeakerLabels(snap([person('Priya Nair'), person('Rob Lane', { response: 'declined' })]), 'Evin John'),
        { me: 'Evin John', speaker_1: 'Priya Nair' }, 'a declined invitee is not in the room');
    assert.deepEqual(calendarSpeakerLabels(snap([{ email: 'x@acme.com' }]), 'Evin John'), { me: 'Evin John' }, 'no display name: stays Speaker 1');
    assert.deepEqual(calendarSpeakerLabels(snap([{ email: 'x@acme.com', name: 'x@acme.com' }]), undefined), null, 'an address is not a name');
    assert.equal(calendarSpeakerLabels(snap([]), ''), null);
});

test('relinking moves the names the old link gave, and never the user\'s own', () => {
    const snap = (id, attendees) => toEventSnapshot({ ...ev(id, 0, 30), attendees }, 'start');
    const priya = snap('a', [person('Priya Nair')]);
    const sam = snap('b', [person('Sam Park')]);
    const auto = { me: 'Evin John', speaker_1: 'Priya Nair' };
    assert.deepEqual(relinkSpeakerLabels(auto, priya, sam, 'Evin John'), { me: 'Evin John', speaker_1: 'Sam Park' }, 'a wrong 1:1 guess corrected');
    assert.deepEqual(relinkSpeakerLabels(auto, priya, null, 'Evin John'), { me: 'Evin John' }, 'unlinked: the other voice is Speaker 1 again');
    assert.deepEqual(relinkSpeakerLabels(undefined, undefined, sam, 'Evin John'), { me: 'Evin John', speaker_1: 'Sam Park' }, 'linked for the first time');
    assert.equal(relinkSpeakerLabels({ speaker_1: 'Priya (client)' }, priya, sam, 'Evin John'), null, 'the user renamed: theirs stays');
    assert.equal(relinkSpeakerLabels(auto, priya, priya, 'Evin John'), null, 'same event: nothing to do');
});
