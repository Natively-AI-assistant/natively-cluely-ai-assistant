// Granola parity, round 2, assist (2026-10-15): "You owe", Brief me, the daily
// brief, the catch-up after back-to-back meetings, and the "Last time" recap
// when a recurring meeting starts (electron/services/assist).
//
// Pure modules and AssistService with injected fakes: no Electron, no
// database, no model, no network. None of this code branches on the
// platform (it reads notes and dates only, and dates are read in UTC or with
// an explicit time zone), so the same assertions hold on macOS and Windows;
// the one platform-shaped limit, the mailto length Windows' shell accepts, is
// applied on both and tested in assistIpc below.
//
// Run under Electron, as `npm test` does:
//   npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test --test-force-exit electron/services/__tests__/AssistFeatures2026_10_15.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../..');
const dist = (rel) => path.join(root, 'dist-electron/electron', rel);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const people = require(dist('services/assist/assistPeople.js'));
const notes = require(dist('services/assist/assistNotes.js'));
const owed = require(dist('services/assist/owedItems.js'));
const briefMod = require(dist('services/assist/meetingBrief.js'));
const daily = require(dist('services/assist/dailyBrief.js'));
const b2b = require(dist('services/assist/backToBack.js'));
const privacy = require(dist('services/assist/assistPrivacy.js'));
const svcMod = require(dist('services/assist/AssistService.js'));
const ipc = require(dist('services/assist/assistIpc.js'));

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const NOW = Date.parse('2026-10-15T09:00:00Z'); // a Thursday
const ME = people.buildUserIdentity({ names: ['Evin John'], emails: ['evin@acme.com'] });

const priya = { email: 'priya@client.com', name: 'Priya Nair' };
const rob = { email: 'rob@client.com', name: 'Rob Lane' };

function meeting(id, startMs, { title = 'Sync', durationMs = 30 * MIN, attendees = [priya], actions = [], decisions = [], openQuestions = [], eventId, recurringEventId, status = 'completed' } = {}) {
  return {
    id,
    title,
    startMs,
    durationMs,
    calendarEventId: eventId ?? `${id}-ev`,
    calendarEvent: { id: eventId ?? `${id}-ev`, title, startTime: new Date(startMs).toISOString(), endTime: new Date(startMs + durationMs).toISOString(), attendees, ...(recurringEventId ? { recurringEventId } : {}), linkedBy: 'start' },
    detailedSummary: { title, overview: `${title} overview.`, actionItemsV3: actions, decisions, openQuestions },
    summaryStatus: status,
    isProcessed: status === 'completed',
  };
}

describe('who "you" is in the notes', () => {
  test('Me, the user\'s name, first name and address are the user; others are not', () => {
    for (const owner of ['Me', 'me', 'I', 'Evin', 'Evin John', 'evin@acme.com', 'Priya and me', 'Rob, Evin']) {
      assert.equal(people.ownerIsUser(owner, ME), true, owner);
    }
    for (const owner of ['Priya', 'Rob Lane', '', undefined, 'Megan', 'Ian', 'Evinson']) {
      assert.equal(people.ownerIsUser(owner, ME), false, String(owner));
    }
  });
  test('a person matches by full name, first name or address', () => {
    assert.equal(people.ownerIsPerson('Priya', priya), true);
    assert.equal(people.ownerIsPerson('Priya Nair', priya), true);
    assert.equal(people.ownerIsPerson('priya', { email: 'priya@client.com' }), true);
    assert.equal(people.ownerIsPerson('Rob', priya), false);
  });
});

describe('deadlines as the notes write them, on the user\'s own day', () => {
  const thu = Date.parse('2026-10-15T14:00:00Z');
  const endOfDay = (iso) => Date.parse(`${iso}T23:59:59.999Z`);
  const p = (text, at = thu, tz = 'UTC') => notes.parseDeadline(text, at, tz);
  test('ISO, month names, weekdays, today/tomorrow, end of week (UTC user)', () => {
    assert.equal(p('2026-10-20'), endOfDay('2026-10-20'));
    assert.equal(p('Oct 20'), endOfDay('2026-10-20'));
    assert.equal(p('by 20th October'), endOfDay('2026-10-20'));
    assert.equal(p('Friday'), endOfDay('2026-10-16'));
    assert.equal(p('by Mon'), endOfDay('2026-10-19'));
    assert.equal(p('tomorrow'), endOfDay('2026-10-16'));
    assert.equal(p('today'), endOfDay('2026-10-15'));
    assert.equal(p('end of week'), endOfDay('2026-10-16'));
    assert.equal(p('end of month'), endOfDay('2026-10-31'));
    assert.equal(p('Jan 5', Date.parse('2026-12-10T10:00:00Z')), endOfDay('2027-01-05'));
  });

  test('a meeting at 23:30 in Los Angeles: "today" is that Thursday there, not the UTC Friday', () => {
    const lateThuLA = Date.parse('2026-10-16T06:30:00Z'); // Thu 15 Oct, 23:30 PDT
    const endThuLA = Date.parse('2026-10-16T06:59:59.999Z'); // Thu 15 Oct 23:59:59.999 PDT
    assert.equal(p('today', lateThuLA, 'America/Los_Angeles'), endThuLA);
    assert.equal(p('tomorrow', lateThuLA, 'America/Los_Angeles'), endThuLA + 24 * 60 * 60 * 1000);
    assert.equal(p('Friday', lateThuLA, 'America/Los_Angeles'), endThuLA + 24 * 60 * 60 * 1000);
    // Read in UTC the same instant is already Friday: what the old reading did.
    assert.equal(p('today', lateThuLA, 'UTC'), endOfDay('2026-10-16'));
  });

  test('just after midnight in Tokyo: "today" is the new Tokyo day, which is still yesterday in UTC', () => {
    const earlyFriTokyo = Date.parse('2026-10-15T15:10:00Z'); // Fri 16 Oct, 00:10 JST
    assert.equal(p('today', earlyFriTokyo, 'Asia/Tokyo'), Date.parse('2026-10-16T14:59:59.999Z'));
    assert.equal(p('2026-10-16', earlyFriTokyo, 'Asia/Tokyo'), Date.parse('2026-10-16T14:59:59.999Z'));
  });

  test('a day that loses an hour to daylight saving still ends at its own midnight', () => {
    // Europe/London leaves summer time on Sun 25 Oct 2026 (a 25-hour day).
    const sun = Date.parse('2026-10-25T09:00:00Z');
    assert.equal(p('today', sun, 'Europe/London'), Date.parse('2026-10-25T23:59:59.999Z'));
    assert.equal(p('Saturday', Date.parse('2026-10-24T09:00:00Z'), 'Europe/London'), Date.parse('2026-10-24T22:59:59.999Z'));
  });

  test('unreadable deadlines are null', () => {
    assert.equal(p('soon'), null);
    assert.equal(p(''), null);
    assert.equal(p(undefined), null);
  });
});

describe('You owe: ordering and filtering', () => {
  const ms = [
    meeting('m1', NOW - 10 * DAY, { title: 'Kickoff', actions: [
      { text: 'Send the pricing deck', owner: 'Me', deadline: 'Oct 8' },
      { text: 'Share the security review', owner: 'Priya' },
      { text: 'Book the workshop room', owner: 'Evin' },
    ] }),
    meeting('m2', NOW - 3 * DAY, { title: 'Weekly', actions: [
      { text: 'Book the workshop room.', owner: 'Me' }, // carried over
      { text: 'Draft the SOW', owner: 'Me', deadline: '2026-10-18' },
      { text: 'Update the roadmap', owner: 'Me', status: 'done' },
      { text: 'Write the summary', owner: 'Evin', deadline: 'tomorrow' }, // due Oct 13: overdue
    ] }),
    meeting('m3', NOW - 2 * DAY, { title: 'Processing', status: 'processing', actions: [{ text: 'Should not show', owner: 'Me' }] }),
    meeting('m4', NOW - 40 * DAY, { title: 'Too old', actions: [{ text: 'Ancient', owner: 'Me' }] }),
  ];

  test('only the user\'s open items from written notes within 30 days', () => {
    const list = owed.collectOwedItems(ms, ME, { nowMs: NOW, timeZone: 'UTC' });
    const texts = list.map((i) => i.text);
    assert.ok(!texts.includes('Share the security review'), 'someone else\'s item');
    assert.ok(!texts.includes('Update the roadmap'), 'done in the notes');
    assert.ok(!texts.includes('Should not show'), 'notes still being written');
    assert.ok(!texts.includes('Ancient'), 'past the lookback');
    assert.equal(list.length, 4);
  });

  test('overdue first (most overdue at the top), then due soonest, then oldest; carried items once', () => {
    const list = owed.collectOwedItems(ms, ME, { nowMs: NOW, timeZone: 'UTC' });
    assert.deepEqual(list.map((i) => i.text), ['Send the pricing deck', 'Write the summary', 'Draft the SOW', 'Book the workshop room.']);
    assert.equal(list[0].overdue, true);
    assert.equal(list[1].overdue, true);
    assert.equal(list[2].overdue, false);
    const room = list[3];
    assert.equal(room.meetingId, 'm2', 'linked to the newest mention');
    assert.equal(room.sinceMs, NOW - 10 * DAY, 'aged from the first');
  });

  test('a ticked item is hidden, and comes back only when a later meeting raises it again', () => {
    const key = owed.owedItemKey('Draft the SOW', 'm2');
    const ticked = owed.collectOwedItems(ms, ME, { nowMs: NOW, done: { [key]: NOW - 1 * DAY } });
    assert.ok(!ticked.some((i) => i.text === 'Draft the SOW'));
    const later = [...ms, meeting('m5', NOW - 12 * 60 * MIN, { actions: [{ text: 'Draft the SOW', owner: 'Me' }] })];
    const back = owed.collectOwedItems(later, ME, { nowMs: NOW, done: { [key]: NOW - 1 * DAY } });
    assert.ok(back.some((i) => i.text === 'Draft the SOW' && i.meetingId === 'm5'));
  });

  test('marked done in a later meeting\'s notes: gone', () => {
    const later = [...ms, meeting('m6', NOW - DAY, { actions: [{ text: 'Send the pricing deck', owner: 'Me', status: 'done' }] })];
    assert.ok(!owed.collectOwedItems(later, ME, { nowMs: NOW }).some((i) => i.text === 'Send the pricing deck'));
  });

  test('older V2 notes (plain strings) are read; unowned strings are not the user\'s', () => {
    const v2 = { ...meeting('v2', NOW - DAY), detailedSummary: { actionItems: ['Call the bank'], actionItemsStructured: [{ text: 'Email Rob', owner: 'Me' }] } };
    assert.deepEqual(owed.collectOwedItems([v2], ME, { nowMs: NOW }).map((i) => i.text), ['Email Rob']);
  });
});

describe('a task\'s newest state wins (closed later = not owed)', () => {
  test('You owe: closed in a later meeting with no owner written: gone; reopened later: back', () => {
    const ms = [
      meeting('o1', NOW - 6 * DAY, { actions: [{ text: 'Send the deck', owner: 'Me' }] }),
      meeting('o2', NOW - 3 * DAY, { actions: [{ text: 'Send the deck', status: 'done' }] }),
    ];
    assert.equal(owed.collectOwedItems(ms, ME, { nowMs: NOW, timeZone: 'UTC' }).length, 0);
    const reopened = [...ms, meeting('o3', NOW - DAY, { actions: [{ text: 'Send the deck', owner: 'Evin' }] })];
    const list = owed.collectOwedItems(reopened, ME, { nowMs: NOW, timeZone: 'UTC' });
    assert.deepEqual(list.map((i) => [i.text, i.meetingId, i.sinceMs]), [['Send the deck', 'o3', NOW - DAY]]);
  });

  test('You owe: the same words owned by someone else do not close the user\'s task', () => {
    const ms = [
      meeting('p1', NOW - 6 * DAY, { actions: [{ text: 'Send the deck', owner: 'Me' }] }),
      meeting('p2', NOW - 3 * DAY, { actions: [{ text: 'Send the deck', owner: 'Priya', status: 'done' }] }),
    ];
    assert.equal(owed.collectOwedItems(ms, ME, { nowMs: NOW, timeZone: 'UTC' }).length, 1);
  });

  test('Brief me: a task they closed in a later meeting is not listed from an older open copy', () => {
    const ms = [
      meeting('b1', NOW - 10 * DAY, { attendees: [priya], actions: [{ text: 'Send the SOW draft', owner: 'Priya' }, { text: 'Book the venue', owner: 'Priya' }] }),
      meeting('b2', NOW - 5 * DAY, { attendees: [priya], actions: [{ text: 'Send the SOW draft', owner: 'Priya Nair', status: 'done' }] }),
    ];
    const ev = { id: 'next', title: 'Check-in', startTime: '2026-10-15T10:00:00Z', attendees: [priya] };
    const brief = briefMod.assembleMeetingBrief({ event: ev, meetings: ms, identity: ME, nowMs: NOW });
    assert.deepEqual(brief.people[0].theirOpenItems.map((i) => i.text), ['Book the venue']);
  });

  test('Brief me: a later "done" with no owner written closes their task', () => {
    const ms = [
      meeting('c1', NOW - 10 * DAY, { attendees: [priya], actions: [{ text: 'Share pricing', owner: 'Priya' }] }),
      meeting('c2', NOW - 5 * DAY, { attendees: [priya], actions: [{ text: 'Share pricing', status: 'done' }] }),
    ];
    const ev = { id: 'next', title: 'Check-in', startTime: '2026-10-15T10:00:00Z', attendees: [priya] };
    assert.deepEqual(briefMod.assembleMeetingBrief({ event: ev, meetings: ms, identity: ME, nowMs: NOW }).people[0].theirOpenItems, []);
  });
});

describe('Brief me: assembled from local notes', () => {
  const series = 'acmeweekly';
  const history = [
    meeting('h1', NOW - 14 * DAY, { title: 'Acme weekly', eventId: `${series}_20261001T090000Z`, recurringEventId: series, attendees: [priya, rob], actions: [{ text: 'Send the SOW draft', owner: 'Priya' }] }),
    meeting('h2', NOW - 7 * DAY, { title: 'Acme weekly', eventId: `${series}_20261008T090000Z`, recurringEventId: series, attendees: [priya, rob],
      actions: [{ text: 'Share the pilot metrics', owner: 'Me', deadline: 'Friday' }, { text: 'Confirm the budget', owner: 'Rob' }],
      decisions: ['Pilot starts in November'], openQuestions: ['Who signs off on security?'] }),
    meeting('other', NOW - 2 * DAY, { title: 'Unrelated', attendees: [{ email: 'sam@else.com', name: 'Sam' }], actions: [{ text: 'Not for this brief', owner: 'Me' }] }),
  ];
  const event = {
    id: `${series}_20261015T100000Z`, title: 'Acme weekly', startTime: '2026-10-15T10:00:00Z', endTime: '2026-10-15T10:30:00Z',
    recurringEventId: series,
    attendees: [priya, rob, { email: 'evin@acme.com', name: 'Evin John' }, { email: 'declined@x.com', response: 'declined' }],
  };

  test('people (not the user, not who declined), last met, what they still owe', () => {
    const brief = briefMod.assembleMeetingBrief({ event, meetings: history, identity: ME, nowMs: NOW });
    assert.deepEqual(brief.people.map((p) => p.email), ['priya@client.com', 'rob@client.com']);
    const p = brief.people[0];
    assert.equal(p.lastMet.meetingId, 'h2');
    assert.equal(p.meetingsCount, 2);
    assert.deepEqual(p.theirOpenItems.map((i) => i.text), ['Send the SOW draft']);
    assert.deepEqual(brief.people[1].theirOpenItems.map((i) => i.text), ['Confirm the budget']);
  });

  test('last time for the series, and the user\'s items from meetings with these people only', () => {
    const brief = briefMod.assembleMeetingBrief({ event, meetings: history, identity: ME, nowMs: NOW });
    assert.equal(brief.lastTime.meetingId, 'h2');
    assert.ok(brief.lastTime.bullets.length >= 2);
    assert.deepEqual(brief.yourOpenItems.map((i) => i.text), ['Share the pilot metrics']);
  });

  test('talking points without a model come from the items; the prompt input carries no transcript', () => {
    const brief = briefMod.assembleMeetingBrief({ event, meetings: history, identity: ME, nowMs: NOW });
    assert.equal(brief.talkingPointsFrom, 'notes');
    assert.ok(brief.talkingPoints.length >= 2 && brief.talkingPoints.length <= 4);
    assert.ok(brief.talkingPoints.some((t) => t.includes('Share the pilot metrics')));
    assert.ok(brief.talkingPoints.some((t) => t.includes('Who signs off on security?')));
    const input = briefMod.briefPromptInput(brief, 'Agenda: pilot.');
    assert.match(input, /Upcoming meeting: Acme weekly/);
    assert.match(input, /they owe: Send the SOW draft/);
    assert.doesNotMatch(input, /Not for this brief/);
  });

  test('the model\'s JSON is validated and cut to four points', () => {
    assert.equal(briefMod.validateTalkingPoints({}).ok, false);
    assert.equal(briefMod.validateTalkingPoints({ talkingPoints: [] }).ok, false);
    const v = briefMod.validateTalkingPoints({ talkingPoints: ['- one', '2. two', 'three', 'four', 'five', 7] });
    assert.deepEqual(v.data, ['one', 'two', 'three', 'four']);
  });
});

describe('Daily brief', () => {
  const day = { startMs: Date.parse('2026-10-15T00:00:00Z'), endMs: Date.parse('2026-10-16T00:00:00Z') };
  const history = [
    meeting('w1', NOW - 7 * DAY, { title: 'Acme weekly', eventId: 'wk_20261008T100000Z', recurringEventId: 'wk', actions: [{ text: 'Share the metrics', owner: 'Rob' }] , decisions: ['Ship on Monday'] }),
    meeting('r1', NOW - 3 * DAY, { title: 'Intro call', attendees: [rob], actions: [{ text: 'Send the contract', owner: 'Me', deadline: '2026-10-10' }] }),
  ];
  const events = [
    { id: 'late', title: 'Later today', startTime: '2026-10-15T16:00:00Z', endTime: '2026-10-15T16:30:00Z', attendees: [{ email: 'new@person.com', name: 'Dana Fox' }] },
    { id: 'wk_20261015T100000Z', title: 'Acme weekly', startTime: '2026-10-15T10:00:00Z', endTime: '2026-10-15T10:30:00Z', recurringEventId: 'wk', attendees: [priya] },
    { id: 'rob', title: 'Rob catch-up', startTime: '2026-10-15T12:00:00Z', endTime: '2026-10-15T12:30:00Z', attendees: [rob] },
    { id: 'done', title: 'Already over', startTime: '2026-10-15T07:00:00Z', endTime: '2026-10-15T07:30:00Z', attendees: [rob] },
    { id: 'tomorrow', title: 'Tomorrow', startTime: '2026-10-16T10:00:00Z', endTime: '2026-10-16T10:30:00Z' },
  ];

  test('today\'s remaining meetings in order, one line of context each', () => {
    const b = daily.buildDailyBrief({ events, meetings: history, identity: ME, nowMs: NOW, day, timeZone: 'UTC' });
    assert.deepEqual(b.meetings.map((m) => m.eventId), ['wk_20261015T100000Z', 'rob', 'late']);
    assert.match(b.meetings[0].context, /^Last time: /);
    assert.equal(b.meetings[0].recurring, true);
    assert.equal(b.meetings[0].contextMeetingId, 'w1');
    assert.equal(b.meetings[1].context, 'Last met Rob on Mon 12 Oct: Intro call');
    assert.equal(b.meetings[2].context, 'First meeting with Dana');
    assert.equal(b.meetings[2].contextMeetingId, null);
  });
});

describe('Catch-up after back-to-back meetings', () => {
  const gapMs = b2b.catchUpGapMs(undefined);
  const block = [
    meeting('a', NOW - 150 * MIN, { title: 'Standup', durationMs: 30 * MIN, decisions: ['Freeze on Friday'], actions: [{ text: 'Fix the login bug', owner: 'Me' }] }),
    meeting('b', NOW - 110 * MIN, { title: 'Design review', durationMs: 40 * MIN, decisions: ['Use the new nav'] }), // gap 10 min
    meeting('c', NOW - 60 * MIN, { title: 'Client call', durationMs: 45 * MIN, actions: [{ text: 'Send the recap', owner: 'Evin', deadline: 'today' }, { text: 'Their task', owner: 'Priya' }] }), // gap 10 min
  ];

  test('the gap setting is read safely (default 15 minutes, 1 to 60)', () => {
    assert.equal(gapMs, 15 * MIN);
    assert.equal(b2b.catchUpGapMs(5), 5 * MIN);
    assert.equal(b2b.catchUpGapMs(500), 60 * MIN);
    assert.equal(b2b.catchUpGapMs('x'), 15 * MIN);
  });

  test('two or more meetings with short gaps make a block; decisions and the user\'s items across them', () => {
    const found = b2b.findCatchUpBlock(block, { nowMs: NOW, gapMs, meetingActive: false });
    assert.equal(found.key, 'a|b|c');
    const cu = b2b.buildCatchUp(found, ME);
    assert.deepEqual(cu.decisions.map((d) => d.text), ['Freeze on Friday', 'Use the new nav']);
    assert.deepEqual(cu.yourActions.map((d) => d.text), ['Fix the login bug', 'Send the recap']);
  });

  test('a long gap breaks the block; one meeting alone is no block', () => {
    const spaced = [block[0], { ...block[2], startMs: NOW - 60 * MIN }].map((m, i) => (i === 0 ? { ...m, startMs: NOW - 180 * MIN } : m));
    assert.equal(b2b.findCatchUpBlock(spaced, { nowMs: NOW, gapMs, meetingActive: false }), null);
    assert.equal(b2b.findCatchUpBlock([block[2]], { nowMs: NOW, gapMs, meetingActive: false }), null);
  });

  test('not while a meeting runs, not while notes are still written, not after 12 hours', () => {
    assert.equal(b2b.findCatchUpBlock(block, { nowMs: NOW, gapMs, meetingActive: true }), null);
    const writing = [...block.slice(0, 2), { ...block[2], summaryStatus: 'processing', isProcessed: false }];
    assert.equal(b2b.findCatchUpBlock(writing, { nowMs: NOW, gapMs, meetingActive: false }), null);
    assert.equal(b2b.findCatchUpBlock(block, { nowMs: NOW + 13 * 60 * MIN, gapMs, meetingActive: false }), null);
  });

  test('a smaller gap setting splits the same day', () => {
    assert.equal(b2b.findCatchUpBlock(block, { nowMs: NOW, gapMs: b2b.catchUpGapMs(5), meetingActive: false }), null);
  });
});

describe('privacy: notes reach a model only when allowed', () => {
  test('post-call summary scope off: only a local model', () => {
    assert.equal(privacy.notesMayUseModel(undefined, false), true);
    assert.equal(privacy.notesMayUseModel({ post_call_summary: true }, false), true);
    assert.equal(privacy.notesMayUseModel({ post_call_summary: false }, false), false);
    assert.equal(privacy.notesMayUseModel({ post_call_summary: false }, true), true);
  });
});

function fakeDeps(over = {}) {
  const kv = new Map();
  const sent = [];
  const timers = [];
  const calls = { model: 0 };
  const deps = {
    loadMeetings: () => over.meetings ?? [],
    kvGet: (k) => kv.get(k) ?? null,
    kvSet: (k, v) => kv.set(k, v),
    identity: () => ME,
    setting: (k) => (over.settings ?? {})[k],
    meetingActive: () => false,
    modelAllowed: () => over.modelAllowed ?? true,
    generateTalkingPoints: over.noModel ? undefined : async (system, user, shape, validate) => {
      calls.model++;
      calls.last = { system, user, shape };
      return validate({ talkingPoints: ['Ask Priya about the SOW draft', 'Agree the pilot start date'] }).data;
    },
    broadcast: (channel, payload) => sent.push({ channel, payload }),
    now: () => over.now ?? NOW,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
  };
  return { deps, kv, sent, timers, calls };
}

describe('AssistService', () => {
  const series = 'acmeweekly';
  const history = [
    meeting('h2', NOW - 7 * DAY, { title: 'Acme weekly', eventId: `${series}_20261008T090000Z`, recurringEventId: series, attendees: [priya],
      actions: [{ text: 'Share the pilot metrics', owner: 'Me' }, { text: 'Send the SOW draft', owner: 'Priya' }], decisions: ['Pilot starts in November'] }),
  ];
  const event = { id: `${series}_20261015T100000Z`, title: 'Acme weekly', startTime: '2026-10-15T10:00:00Z', recurringEventId: series, attendees: [priya] };

  test('Brief me: the model writes the talking points once, then they are cached per event', async () => {
    const { deps, calls } = fakeDeps({ meetings: history });
    const svc = new svcMod.AssistService(deps);
    const first = await svc.getMeetingBrief(event);
    assert.equal(first.talkingPointsFrom, 'model');
    assert.equal(calls.model, 1);
    assert.doesNotMatch(calls.last.user, /transcript/i);
    const again = await svc.getMeetingBrief(event);
    assert.deepEqual(again.talkingPoints, first.talkingPoints);
    assert.equal(calls.model, 1, 'cached');
    await svc.getMeetingBrief(event, { refresh: true });
    assert.equal(calls.model, 2, 'refresh asks again');
  });

  test('privacy: notes kept from cloud models means no model call, the list-only brief', async () => {
    const { deps, calls } = fakeDeps({ meetings: history, modelAllowed: false });
    const brief = await new svcMod.AssistService(deps).getMeetingBrief(event);
    assert.equal(calls.model, 0);
    assert.equal(brief.modelSkipped, 'privacy');
    assert.equal(brief.talkingPointsFrom, 'notes');
    assert.ok(brief.talkingPoints.length > 0);
  });

  test('nothing known about the meeting: no model call at all', async () => {
    const { deps, calls } = fakeDeps({ meetings: [] });
    await new svcMod.AssistService(deps).getMeetingBrief({ id: 'x', title: 'New', startTime: '2026-10-15T10:00:00Z', attendees: [{ email: 'a@b.com' }] });
    assert.equal(calls.model, 0);
  });

  test('catch-up: off in Settings means none; dismissed means none', () => {
    const blk = [
      meeting('a', NOW - 100 * MIN, { durationMs: 30 * MIN, decisions: ['One'] }),
      meeting('b', NOW - 60 * MIN, { durationMs: 30 * MIN, decisions: ['Two'] }),
    ];
    const on = new svcMod.AssistService(fakeDeps({ meetings: blk }).deps);
    const cu = on.getCatchUp();
    assert.equal(cu.key, 'a|b');
    on.dismissCatchUp(cu.key);
    assert.equal(on.getCatchUp(), null);
    const off = new svcMod.AssistService(fakeDeps({ meetings: blk, settings: { assistCatchUpEnabled: false } }).deps);
    assert.equal(off.getCatchUp(), null);
  });

  test('events from the renderer are kept to known fields with bounded strings', () => {
    const [e] = svcMod.sanitizeEvents([{ id: 'x', startTime: '2026-10-15T10:00:00Z', title: 'T'.repeat(900), attendees: [{ email: 'a@b.com', evil: 1 }], extra: 'x' }, { id: 'bad', startTime: 'not a date' }, null]);
    assert.equal(e.title.length, 500);
    assert.deepEqual(e.attendees, [{ email: 'a@b.com' }]);
    assert.equal('extra' in e, false);
    assert.equal(svcMod.sanitizeEvents('nope').length, 0);
  });
});

describe('Last time at meeting start: the caller is wired, and it never delays the start', () => {
  const series = 'acmeweekly';
  const history = [
    meeting('h2', NOW - 7 * DAY, { title: 'Acme weekly', eventId: `${series}_20261008T090000Z`, recurringEventId: series, attendees: [priya],
      actions: [{ text: 'Share the pilot metrics', owner: 'Me' }], decisions: ['Pilot starts in November'] }),
  ];

  test('main calls it right after the calendar link and ends it with the meeting', () => {
    const main = read('electron/main.ts');
    const link = main.indexOf('linkSessionToCalendar(metadata, () => this.isMeetingActive);');
    const start = main.indexOf('getAssistService()?.noteMeetingStarted(metadata');
    assert.ok(link > 0 && start > link && start - link < 600, 'noteMeetingStarted follows the link');
    const endFn = main.indexOf('private async endMeetingTransition');
    const nextFn = main.indexOf('\n  private ', endFn + 10);
    const end = main.indexOf('getAssistService()?.noteMeetingEnded()', endFn);
    assert.ok(endFn > 0 && end > endFn && (nextFn < 0 || end < nextFn), 'noteMeetingEnded runs when the meeting ends');
    // Not awaited: the start never waits on it.
    assert.doesNotMatch(main, /await\s+getAssistService\(\)\?\.noteMeetingStarted/);
  });

  test('a link that lands seconds later is found on a later check, and the recap is sent once', () => {
    const { deps, sent, timers } = fakeDeps({ meetings: history });
    const svc = new svcMod.AssistService(deps);
    const metadata = { title: 'Acme weekly' };
    svc.noteMeetingStarted(metadata, () => true);
    assert.equal(timers.length, svcMod.LIVE_RECAP_CHECKS_MS.length);
    timers[0].fn(); // not linked yet
    assert.equal(sent.length, 0);
    metadata.calendarEventId = `${series}_20261015T100000Z`;
    metadata.calendarEvent = { id: metadata.calendarEventId, title: 'Acme weekly', recurringEventId: series, attendees: [priya] };
    timers[1].fn();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].channel, 'assist:last-time-recap');
    assert.equal(sent[0].payload.recap.meetingId, 'h2');
    timers[2].fn();
    assert.equal(sent.length, 1, 'sent once');
    assert.equal(svc.getLiveRecap().recap.meetingId, 'h2');
    svc.dismissLiveRecap();
    assert.equal(svc.getLiveRecap(), null);
    assert.equal(sent.at(-1).payload, null, 'closing it closes it everywhere');
  });

  test('a meeting that ended (or another started) gets nothing', () => {
    const { deps, sent, timers } = fakeDeps({ meetings: history });
    const svc = new svcMod.AssistService(deps);
    let live = true;
    const metadata = { calendarEventId: `${series}_20261015T100000Z`, calendarEvent: { id: `${series}_20261015T100000Z`, recurringEventId: series, attendees: [priya] } };
    svc.noteMeetingStarted(metadata, () => live);
    live = false;
    timers[0].fn();
    assert.equal(sent.length, 0);
  });

  test('a one-off meeting with no earlier series meeting: nothing, and the checks stop', () => {
    const { deps, sent, timers } = fakeDeps({ meetings: history });
    const svc = new svcMod.AssistService(deps);
    svc.noteMeetingStarted({ calendarEventId: 'oneoff', calendarEvent: { id: 'oneoff', title: 'Coffee', attendees: [rob] } }, () => true);
    timers[0].fn();
    assert.equal(sent.length, 0);
    assert.equal(svc.getLiveRecap(), null);
  });

  test('ending the meeting clears a recap that was showing', () => {
    const { deps, sent, timers } = fakeDeps({ meetings: history });
    const svc = new svcMod.AssistService(deps);
    svc.noteMeetingStarted({ calendarEventId: `${series}_20261015T100000Z`, calendarEvent: { id: `${series}_20261015T100000Z`, recurringEventId: series } }, () => true);
    timers[0].fn();
    assert.equal(sent.length, 1);
    svc.noteMeetingEnded();
    assert.equal(sent.at(-1).payload, null);
    assert.equal(svc.getLiveRecap(), null);
  });
});

describe('assist IPC', () => {
  test('only short mailto links open (Windows cuts long ones); no other scheme', () => {
    assert.equal(ipc.isOpenableMailto('mailto:a@b.com?subject=Hi%20there&body=Line%0D%0ATwo'), true);
    assert.equal(ipc.isOpenableMailto('https://evil.example'), false);
    assert.equal(ipc.isOpenableMailto('file:///etc/passwd'), false);
    assert.equal(ipc.isOpenableMailto('mailto:a@b.com\r\nbcc:x'), false);
    assert.equal(ipc.isOpenableMailto(`mailto:a@b.com?body=${'x'.repeat(2000)}`), false);
    assert.equal(ipc.isOpenableMailto(42), false);
  });

  test('registers every channel, and opens nothing but a mailto link', async () => {
    const handlers = new Map();
    const opened = [];
    ipc.registerAssistIpc((ch, fn) => handlers.set(ch, fn), {
      getSetting: () => undefined,
      setSetting: () => true,
      sender: () => ({ name: 'Evin', email: 'evin@acme.com', google: true }),
      openExternal: async (url) => { opened.push(url); },
    });
    for (const ch of ['assist:get-daily-brief', 'assist:get-meeting-brief', 'assist:get-catch-up', 'assist:dismiss-catch-up', 'assist:get-live-recap', 'assist:dismiss-live-recap', 'assist:get-catch-up-enabled', 'assist:set-catch-up-enabled', 'assist:get-sender', 'assist:open-mail-draft']) {
      assert.ok(handlers.has(ch), ch);
    }
    assert.equal((await handlers.get('assist:open-mail-draft')({}, 'https://x.example')).ok, false);
    assert.equal((await handlers.get('assist:open-mail-draft')({}, 'mailto:a@b.com?subject=Hi')).ok, true);
    assert.deepEqual(opened, ['mailto:a@b.com?subject=Hi']);
    assert.equal(await handlers.get('assist:get-catch-up-enabled')({}), true, 'unset = on');
    assert.deepEqual(await handlers.get('assist:set-catch-up-enabled')({}, 'yes'), { success: false });
  });

  test('main configures the service with the notes privacy gate and the notes provider routing', () => {
    const main = read('electron/main.ts');
    assert.match(main, /configureAssistService\(\{/);
    assert.match(main, /notesMayUseModel\(scopes, !!llm\?\.isUsingOllama\?\.\(\)\)/);
    assert.match(main, /generateStructured\(\{/);
    const handlers = read('electron/ipcHandlers.ts');
    assert.match(handlers, /registerAssistIpc\(safeHandle,/);
  });
});

describe('the reminder\'s Running late reaches the launcher, also during a meeting', () => {
  const win = require(dist('services/assist/reminderDraftWindow.js'));
  const fakeLauncher = () => {
    const calls = [];
    return { calls, isDestroyed: () => false, show: () => calls.push('show'), showInactive: () => calls.push('showInactive'), focus: () => calls.push('focus'), webContents: { send: (c, p) => calls.push(['send', c, p.kind, p.event.id]) } };
  };
  const ev = { id: 'e1', title: 'Acme weekly' };

  test('no meeting: the launcher comes up the usual way', () => {
    const l = fakeLauncher(); const seen = [];
    assert.equal(win.showLauncherForReminderDraft({ launcher: l, meetingActive: false, undetectable: false, centerAndShow: () => seen.push('center'), reassertStealth: () => seen.push('stealth') }, ev), true);
    assert.deepEqual(l.calls, [['send', 'assist:reminder-draft', 'running_late', 'e1']]);
    assert.deepEqual(seen, ['center']);
  });

  test('during a meeting: the launcher window itself is shown (not the overlay)', () => {
    const l = fakeLauncher(); const seen = [];
    win.showLauncherForReminderDraft({ launcher: l, meetingActive: true, undetectable: false, centerAndShow: () => seen.push('center'), reassertStealth: () => seen.push('stealth') }, ev);
    assert.deepEqual(l.calls.slice(1), ['show', 'focus']);
    assert.deepEqual(seen, [], 'centerAndShow would bring up the overlay');
  });

  test('during a meeting in Undetectable: shown without focus, stealth re-applied', () => {
    const l = fakeLauncher(); const seen = [];
    win.showLauncherForReminderDraft({ launcher: l, meetingActive: true, undetectable: true, centerAndShow: () => seen.push('center'), reassertStealth: () => seen.push('stealth') }, ev);
    assert.deepEqual(l.calls.slice(1), ['showInactive']);
    assert.deepEqual(seen, ['stealth']);
  });

  test('no launcher: nothing happens', () => {
    assert.equal(win.showLauncherForReminderDraft({ launcher: null, meetingActive: true, undetectable: false, centerAndShow() {}, reassertStealth() {} }, ev), false);
  });

  test('main uses it for the calendar reminder\'s action', () => {
    const main = read('electron/main.ts');
    const at = main.indexOf("calMgr.on('reminder-draft-requested'");
    assert.ok(at > 0);
    assert.match(main.slice(at, at + 600), /showLauncherForReminderDraft\(/);
  });
});

describe('third review (2026-10-15)', () => {
  const sam = { email: 'sam@else.com', name: 'Sam Reed' };

  test('catch-up reads the user\'s tasks at their newest state across the block', () => {
    const blk = [
      meeting('x1', NOW - 150 * MIN, { title: 'Standup', durationMs: 30 * MIN, actions: [{ text: 'Fix the login bug', owner: 'Me' }, { text: 'Write the release note', owner: 'Me' }] }),
      meeting('x2', NOW - 110 * MIN, { title: 'Review', durationMs: 40 * MIN, actions: [{ text: 'Fix the login bug', owner: 'Evin', status: 'done' }, { text: 'Write the release note', owner: 'Me', deadline: 'today' }] }),
    ];
    const found = b2b.findCatchUpBlock(blk, { nowMs: NOW, gapMs: b2b.catchUpGapMs(15), meetingActive: false });
    const cu = b2b.buildCatchUp(found, ME);
    assert.deepEqual(cu.yourActions.map((a) => [a.text, a.meetingId, a.deadline]), [['Write the release note', 'x2', 'today']]);
  });

  test('an ownerless "done" closes same-worded tasks only from related meetings', () => {
    const unrelated = [
      meeting('u1', NOW - 6 * DAY, { attendees: [priya], actions: [{ text: 'Send the deck', owner: 'Me' }] }),
      meeting('u2', NOW - 3 * DAY, { attendees: [sam], actions: [{ text: 'Send the deck', status: 'done' }] }),
    ];
    assert.equal(owed.collectOwedItems(unrelated, ME, { nowMs: NOW, timeZone: 'UTC' }).length, 1, 'another meeting\'s deck');
    const sharedAttendee = [unrelated[0], meeting('u3', NOW - 3 * DAY, { attendees: [sam, priya], actions: [{ text: 'Send the deck', status: 'done' }] })];
    assert.equal(owed.collectOwedItems(sharedAttendee, ME, { nowMs: NOW, timeZone: 'UTC' }).length, 0);
    const sameSeries = [
      meeting('s1', NOW - 6 * DAY, { attendees: [], eventId: 'wk_20261009T100000Z', recurringEventId: 'wk', actions: [{ text: 'Send the deck', owner: 'Me' }] }),
      meeting('s2', NOW - 3 * DAY, { attendees: [], eventId: 'wk_20261012T100000Z', actions: [{ text: 'Send the deck', status: 'done' }] }),
    ];
    assert.equal(owed.collectOwedItems(sameSeries, ME, { nowMs: NOW, timeZone: 'UTC' }).length, 0, 'series read from the instance id');
    assert.equal(notes.meetingsRelated(unrelated[0], unrelated[1]), false);
  });

  test('Brief me looks back as far as the task keys are chained, from one shared constant', () => {
    assert.equal(briefMod.BRIEF_LOOKBACK_DAYS, notes.ASSIST_LONGEST_LOOKBACK_DAYS);
  });

  test('a repeat without a deadline keeps the deadline and the meeting that set it', () => {
    const ms = [
      meeting('d1', Date.parse('2026-10-05T10:00:00Z'), { actions: [{ text: 'Send the quote', owner: 'Me', deadline: 'Friday' }] }), // Mon 5 Oct -> Fri 9 Oct
      meeting('d2', Date.parse('2026-10-12T10:00:00Z'), { actions: [{ text: 'Send the quote', owner: 'Me' }] }), // Mon 12 Oct, no deadline
    ];
    const [item] = owed.collectOwedItems(ms, ME, { nowMs: NOW, timeZone: 'UTC' });
    assert.equal(item.deadline, 'Friday');
    assert.equal(item.dueMs, Date.parse('2026-10-09T23:59:59.999Z'), 'not Fri 16 Oct');
    assert.equal(item.overdue, true);
    assert.equal(item.meetingId, 'd2', 'still opened from the newest mention');
  });
});

describe('fourth review: a "done" closes a task only in its own chain of related meetings', () => {
  const clientA = { email: 'ana@client-a.com', name: 'Ana Ruiz' };
  const clientB = { email: 'ben@client-b.com', name: 'Ben Ode' };
  const self = { email: 'evin@acme.com', name: 'Evin John' };

  test('catch-up: "Send the deck" done in client B\'s meeting leaves client A\'s open', () => {
    const blk = [
      meeting('ca', NOW - 150 * MIN, { title: 'Client A', durationMs: 30 * MIN, attendees: [clientA, self], actions: [{ text: 'Send the deck', owner: 'Me' }] }),
      meeting('cb', NOW - 110 * MIN, { title: 'Client B', durationMs: 40 * MIN, attendees: [clientB, self], actions: [{ text: 'Send the deck', owner: 'Me', status: 'done' }] }),
    ];
    const found = b2b.findCatchUpBlock(blk, { nowMs: NOW, gapMs: b2b.catchUpGapMs(15), meetingActive: false });
    const cu = b2b.buildCatchUp(found, ME);
    assert.deepEqual(cu.yourActions.map((a) => [a.text, a.meetingId]), [['Send the deck', 'ca']]);
  });

  test('the user\'s own address on both invites does not make them related', () => {
    const a = meeting('ra', NOW - DAY, { attendees: [clientA, self] });
    const b = meeting('rb', NOW - DAY + MIN, { attendees: [clientB, self] });
    assert.equal(notes.meetingsRelated(a, b, ME.emails), false);
    assert.equal(notes.meetingsRelated(a, { ...b, calendarEvent: { ...b.calendarEvent, attendees: [clientA] } }, ME.emails), true);
  });

  test('You owe: same words in unrelated meetings are two tasks; closing one leaves the other; ticks are per task', () => {
    const ms = [
      meeting('oa', NOW - 5 * DAY, { attendees: [clientA], actions: [{ text: 'Send the deck', owner: 'Me' }] }),
      meeting('ob', NOW - 4 * DAY, { attendees: [clientB], actions: [{ text: 'Send the deck', owner: 'Me' }] }),
      meeting('ob2', NOW - 2 * DAY, { attendees: [clientB], actions: [{ text: 'Send the deck', owner: 'Evin', status: 'done' }] }),
    ];
    const list = owed.collectOwedItems(ms, ME, { nowMs: NOW, timeZone: 'UTC' });
    assert.deepEqual(list.map((i) => i.meetingId), ['oa']);
    const both = owed.collectOwedItems(ms.slice(0, 2), ME, { nowMs: NOW, timeZone: 'UTC' });
    assert.equal(both.length, 2);
    assert.notEqual(both[0].key, both[1].key);
    const tickedA = owed.collectOwedItems(ms.slice(0, 2), ME, { nowMs: NOW, timeZone: 'UTC', done: { [owed.owedItemKey('Send the deck', 'oa')]: NOW } });
    assert.deepEqual(tickedA.map((i) => i.meetingId), ['ob']);
  });

  test('Brief me: their task done in an unrelated meeting still shows', () => {
    const priyaB = { ...priya };
    const ms = [
      meeting('ba', NOW - 6 * DAY, { attendees: [priya], actions: [{ text: 'Share the plan', owner: 'Priya' }] }),
      meeting('bb', NOW - 3 * DAY, { attendees: [clientB], actions: [{ text: 'Share the plan', owner: 'Priya', status: 'done' }] }),
    ];
    const ev = { id: 'next', title: 'Check-in', startTime: '2026-10-15T10:00:00Z', attendees: [priyaB] };
    assert.deepEqual(briefMod.assembleMeetingBrief({ event: ev, meetings: ms, identity: ME, nowMs: NOW }).people[0].theirOpenItems.map((i) => i.meetingId), ['ba']);
  });
});

describe('fifth review: a task\'s tick key is the same in every view and over time', () => {
  // Raised 25 days ago with Priya, repeated 3 days ago: the launcher (30 days)
  // and Brief me (180) see different oldest meetings in their windows.
  const ms = [
    meeting('k0', NOW - 60 * DAY, { attendees: [priya], actions: [{ text: 'Unrelated older task', owner: 'Priya' }] }),
    meeting('k1', NOW - 25 * DAY, { attendees: [priya], actions: [{ text: 'Send the pilot plan', owner: 'Me' }] }),
    meeting('k2', NOW - 3 * DAY, { attendees: [priya], actions: [{ text: 'Send the pilot plan', owner: 'Evin' }] }),
  ];
  const event = { id: 'next', title: 'Priya sync', startTime: new Date(NOW + 60 * MIN).toISOString(), attendees: [priya] };

  // The launcher's tick list (You owe, then Loose Ends) came out 2026-10-17;
  // a tick it stored before then still closes the task in Brief me.
  test('a stored tick closes the task in Brief me', async () => {
    const { deps } = fakeDeps({ meetings: ms, modelAllowed: false });
    const svc = new svcMod.AssistService(deps);
    const key = owed.owedItemKey('Send the pilot plan', 'k1');
    const before = await svc.getMeetingBrief(event);
    assert.deepEqual(before.yourOpenItems.map((i) => i.key), [key], 'keyed by the meeting that first raised it');
    deps.kvSet(svcMod.KV_OWED_DONE, JSON.stringify({ [key]: NOW }));
    assert.equal((await svc.getMeetingBrief(event)).yourOpenItems.length, 0);
  });

  test('the key does not change as the launcher\'s window slides past the raising meeting (35 days on)', () => {
    const now = owed.collectOwedItems(ms, ME, { nowMs: NOW, timeZone: 'UTC' });
    const later = [...ms, meeting('k3', NOW + 34 * DAY, { attendees: [priya], actions: [{ text: 'Send the pilot plan', owner: 'Me' }] })];
    const after = owed.collectOwedItems(later, ME, { nowMs: NOW + 35 * DAY, timeZone: 'UTC' });
    assert.equal(now[0].key, owed.owedItemKey('Send the pilot plan', 'k1'));
    assert.equal(after[0].key, now[0].key, 'k1 is past 30 days but still names the task');
    // A tick made now still hides it 35 days later unless a meeting after the tick raised it.
    const tickedAt = NOW;
    const hidden = owed.collectOwedItems(ms, ME, { nowMs: NOW + 35 * DAY, timeZone: 'UTC', lookbackDays: 40, done: { [now[0].key]: tickedAt } });
    assert.equal(hidden.length, 0);
  });

  test('a task last mentioned outside the view\'s window is not shown there', () => {
    const old = [meeting('z1', NOW - 40 * DAY, { attendees: [priya], actions: [{ text: 'Old promise', owner: 'Me' }] })];
    assert.equal(owed.collectOwedItems(old, ME, { nowMs: NOW, timeZone: 'UTC' }).length, 0);
    assert.equal(owed.collectOwedItems(old, ME, { nowMs: NOW, timeZone: 'UTC', lookbackDays: 180 }).length, 1);
  });

  test('ticks saved under the old text-only key still hide the task', () => {
    const list = owed.collectOwedItems(ms, ME, { nowMs: NOW, timeZone: 'UTC', done: { [owed.legacyOwedItemKey('Send the pilot plan')]: NOW } });
    assert.equal(list.length, 0);
  });
});
