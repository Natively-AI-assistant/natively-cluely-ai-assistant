// One calendar model across sources (2026-10-15): which sources each platform
// offers, Apple Calendar (EventKit) mapping and permission states, the merge
// that shows a meeting in two calendars once, and CalendarManager reading
// Google and a calendar link side by side.
//
// The platform is always passed in, never read from process.platform, so both
// the darwin and the win32 branches run on any machine. EventKit is faked:
// the real native call is exercised only by its Rust unit tests and a manual
// macOS check. No request leaves the machine.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../../dist-electron/electron/services/calendar/providers');
const compiledManager = path.resolve(here, '../../../dist-electron/electron/services/CalendarManager.js');
const { calendarSourcesFor, createCalendarProviders } = require(path.join(dist, 'registry.js'));
const { mergeCalendarEvents } = require(path.join(dist, 'mergeEvents.js'));
const { mapEventKitEvent, mapEventKitEvents, eventKitAccessOf } = require(path.join(dist, 'appleEventKit.js'));
const { AppleCalendarProvider, CALENDAR_SOURCES_FILE } = require(path.join(dist, 'AppleCalendarProvider.js'));

const tempDirs = [];
after(() => { for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true }); });
const tempDir = (tag) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), `natively-test-${tag}-`));
    tempDirs.push(d);
    return d;
};

function deps(overrides = {}) {
    const changes = [];
    return {
        changes,
        userDataDir: tempDir('calsrc'),
        safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
        openExternal: () => {},
        fetch: async () => { throw new Error('no network in this test'); },
        now: () => Date.parse('2026-11-01T00:00:00Z'),
        onConnectionChanged: () => changes.push('changed'),
        knownSelfEmails: () => [],
        ...overrides,
    };
}

// ─── Registry ───────────────────────────────────────────────────────────────

test('registry: macOS offers Apple Calendar; Windows and anything else do not', () => {
    assert.deepEqual(calendarSourcesFor('darwin'), ['google', 'outlook', 'apple', 'ics']);
    assert.deepEqual(calendarSourcesFor('win32'), ['google', 'outlook', 'ics']);
    assert.deepEqual(calendarSourcesFor('linux'), ['google', 'outlook', 'ics']);

    let loads = 0;
    const loadEventKit = () => { loads++; return null; };
    assert.deepEqual(createCalendarProviders('darwin', deps(), { loadEventKit }).map((p) => p.id), ['outlook', 'apple', 'ics']);
    assert.deepEqual(createCalendarProviders('win32', deps(), { loadEventKit }).map((p) => p.id), ['outlook', 'ics']);
    assert.deepEqual(createCalendarProviders('linux', deps(), { loadEventKit }).map((p) => p.id), ['outlook', 'ics']);
    assert.equal(loads, 0, 'building the list never loads the native module');
});

test('Apple provider built on Windows anyway never touches EventKit', async () => {
    let loads = 0;
    const p = new AppleCalendarProvider(deps(), 'win32', () => { loads++; return fakeEventKit().native; });
    p.init();
    assert.deepEqual(p.status(), { id: 'apple', state: 'unconfigured' });
    assert.equal(p.isConnected(), false);
    await assert.rejects(p.connect(), { message: 'Apple Calendar needs a newer version of Natively.' });
    assert.equal(loads, 0);
});

// ─── Apple Calendar ─────────────────────────────────────────────────────────

function fakeEventKit({ status = 'notDetermined', answer = 'fullAccess', events = [] } = {}) {
    const state = { status, requests: 0, reads: [] };
    return {
        state,
        native: {
            calendarAuthorizationStatus: () => state.status,
            requestCalendarAccess: async () => { state.requests++; state.status = answer; return answer; },
            getCalendarEvents: async (from, to) => { state.reads.push([from, to]); return events; },
        },
    };
}

function ekEvent(extra = {}) {
    return {
        eventIdentifier: 'EK-1:ABC',
        externalId: 'uid-shared-1@google.com',
        title: 'Design crit',
        startMs: Date.parse('2026-11-04T15:00:00Z'),
        endMs: Date.parse('2026-11-04T15:45:00Z'),
        occurrenceMs: null,
        isAllDay: false,
        status: 1,
        hasRecurrence: false,
        isDetached: false,
        location: 'https://us02web.zoom.us/j/81234567890?pwd=abc',
        notes: '<p>Bring the <b>mockups</b></p>',
        url: null,
        timeZone: 'Europe/London',
        organizer: { name: 'Ola Berg', url: 'mailto:ola@studio.io', status: 2, kind: 1, isCurrentUser: false },
        attendees: [
            { name: 'Ola Berg', url: 'mailto:ola@studio.io', status: 2, kind: 1, isCurrentUser: false },
            { name: 'Me', url: 'mailto:me@icloud.com', status: 4, kind: 1, isCurrentUser: true },
            { name: 'Studio room', url: 'mailto:room@studio.io', status: 2, kind: 2, isCurrentUser: false },
            { name: 'Kai', url: 'mailto:kai%2Bwork@studio.io', status: 1, kind: 1, isCurrentUser: false },
        ],
        ...extra,
    };
}

test('EventKit mapping: a single meeting', () => {
    const ev = mapEventKitEvent(ekEvent());
    assert.equal(ev.id, 'apple:EK-1:ABC');
    assert.equal(ev.source, 'apple');
    assert.equal(ev.title, 'Design crit');
    assert.equal(ev.startTime, '2026-11-04T15:00:00.000Z');
    assert.equal(ev.endTime, '2026-11-04T15:45:00.000Z');
    assert.deepEqual(ev.attendees.map((a) => [a.email, a.name, a.response]), [
        ['ola@studio.io', 'Ola Berg', 'accepted'],
        ['kai+work@studio.io', 'Kai', 'needsAction'],
    ], 'the user (isCurrentUser) and the room are not attendees');
    assert.equal(ev.selfResponse, 'tentative');
    assert.deepEqual(ev.organizer, { email: 'ola@studio.io', name: 'Ola Berg' });
    assert.deepEqual(ev.meetingKeys, ['zoom:81234567890']);
    assert.match(ev.link, /zoom\.us\/j\/81234567890/);
    assert.equal(ev.description, 'Bring the mockups');
    assert.equal(ev.timeZone, 'Europe/London');
    assert.equal(ev.iCalUID, 'uid-shared-1@google.com');
    assert.equal(ev.recurringEventId, undefined);
});

test('EventKit mapping: occurrences share a series; a moved one keeps its original slot in the id', () => {
    const occ = mapEventKitEvent(ekEvent({ hasRecurrence: true, occurrenceMs: Date.parse('2026-11-04T15:00:00Z') }));
    assert.equal(occ.id, 'apple:EK-1:ABC_20261104T150000Z');
    assert.equal(occ.recurringEventId, 'apple:EK-1:ABC');
    const moved = mapEventKitEvent(ekEvent({ isDetached: true, startMs: Date.parse('2026-11-05T09:00:00Z'), endMs: Date.parse('2026-11-05T09:30:00Z'), occurrenceMs: Date.parse('2026-11-04T15:00:00Z') }));
    assert.equal(moved.id, 'apple:EK-1:ABC_20261104T150000Z');
    assert.equal(moved.startTime, '2026-11-05T09:00:00.000Z');
    assert.equal(moved.recurringEventId, 'apple:EK-1:ABC');
});

test('EventKit mapping: all-day, cancelled, too short and id-less events are skipped; the user\'s address marks "you"', () => {
    assert.equal(mapEventKitEvent(ekEvent({ isAllDay: true })), null);
    assert.equal(mapEventKitEvent(ekEvent({ status: 3 })), null);
    assert.equal(mapEventKitEvent(ekEvent({ endMs: Date.parse('2026-11-04T15:03:00Z') })), null);
    assert.equal(mapEventKitEvent(ekEvent({ eventIdentifier: '' })), null);
    const declinedByAddress = mapEventKitEvent(ekEvent({
        attendees: [{ name: 'Me', url: 'mailto:Me@Work.com', status: 3, kind: 1, isCurrentUser: false }],
    }), { selfEmails: ['me@work.com'] });
    assert.equal(declinedByAddress.selfResponse, 'declined');
    assert.equal(declinedByAddress.attendees, undefined);
    const organisedByMe = mapEventKitEvent(ekEvent({ attendees: [], organizer: { name: 'Me', url: 'mailto:me@icloud.com', status: 2, kind: 1, isCurrentUser: true } }));
    assert.equal(organisedByMe.selfResponse, 'accepted');
    assert.equal(organisedByMe.organizer.self, true);
    assert.deepEqual(mapEventKitEvents(null), []);
    assert.deepEqual(mapEventKitEvents([ekEvent({ eventIdentifier: 'b', startMs: Date.parse('2026-11-04T16:00:00Z'), endMs: Date.parse('2026-11-04T16:30:00Z') }), ekEvent()]).map((e) => e.id), ['apple:EK-1:ABC', 'apple:b']);
});

test('EventKit access names: anything unknown is "unsupported"', () => {
    for (const s of ['fullAccess', 'writeOnly', 'denied', 'restricted', 'notDetermined', 'missingUsageDescription', 'unsupported']) assert.equal(eventKitAccessOf(s), s);
    assert.equal(eventKitAccessOf('authorized'), 'unsupported');
    assert.equal(eventKitAccessOf(undefined), 'unsupported');
});

test('Apple provider (darwin): Connect asks once, then reads; the switch survives a restart', async () => {
    const ek = fakeEventKit({ events: [ekEvent()] });
    const d = deps({ knownSelfEmails: () => ['me@work.com'] });
    const p = new AppleCalendarProvider(d, 'darwin', () => ek.native);
    p.init();
    assert.deepEqual(p.status(), { id: 'apple', state: 'disconnected' });
    assert.equal(await p.fetchEvents(0, 1), null, 'nothing is read before Connect');
    assert.equal(ek.state.reads.length, 0);

    await p.connect();
    assert.equal(ek.state.requests, 1);
    assert.deepEqual(p.status(), { id: 'apple', state: 'connected', account: 'Calendars on this Mac' });
    assert.deepEqual(d.changes, ['changed']);
    const events = await p.fetchEvents(10, 20);
    assert.deepEqual(ek.state.reads, [[10, 20]]);
    assert.deepEqual(events.map((e) => e.id), ['apple:EK-1:ABC']);

    const restarted = new AppleCalendarProvider(d, 'darwin', () => ek.native);
    restarted.init();
    assert.equal(restarted.isConnected(), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d.userDataDir, CALENDAR_SOURCES_FILE), 'utf8')), { apple: true });

    await restarted.disconnect();
    assert.equal(restarted.isConnected(), false);
    assert.deepEqual(restarted.status(), { id: 'apple', state: 'disconnected' });
    assert.equal(ek.state.requests, 1, 'turning it off does not touch the permission');
});

test('Apple provider (darwin): refused, add-only and missing purpose string are plain states and sentences', async () => {
    for (const [status, answer, state, message] of [
        ['denied', null, 'notAllowed', 'Natively isn’t allowed to read your calendars. Turn it on in System Settings.'],
        ['restricted', null, 'notAllowed', 'Natively isn’t allowed to read your calendars. Turn it on in System Settings.'],
        ['writeOnly', null, 'notAllowed', 'Natively isn’t allowed to read your calendars. Turn it on in System Settings.'],
        ['notDetermined', 'denied', 'disconnected', 'Natively isn’t allowed to read your calendars. Turn it on in System Settings.'],
        ['missingUsageDescription', null, 'disconnected', 'This copy of Natively can’t ask for calendar access. Install the latest version.'],
    ]) {
        const ek = fakeEventKit({ status, answer: answer ?? status });
        const p = new AppleCalendarProvider(deps(), 'darwin', () => ek.native);
        p.init();
        assert.equal(p.status().state, state, status);
        await assert.rejects(p.connect(), { message }, status);
        assert.equal(p.isConnected(), false);
        assert.equal(ek.state.requests, status === 'notDetermined' ? 1 : 0, `${status}: only an undecided permission is asked`);
    }
    // An older native module without the EventKit functions.
    const old = new AppleCalendarProvider(deps(), 'darwin', () => ({ getAudioDevices() {} }));
    assert.deepEqual(old.status(), { id: 'apple', state: 'unconfigured' });
    // A native module that throws while loading.
    const broken = new AppleCalendarProvider(deps(), 'darwin', () => { throw new Error('dlopen failed'); });
    assert.deepEqual(broken.status(), { id: 'apple', state: 'unconfigured' });
});

test('Apple provider: access revoked after connecting stops the reads', async () => {
    const ek = fakeEventKit({ status: 'fullAccess', events: [ekEvent()] });
    const p = new AppleCalendarProvider(deps(), 'darwin', () => ek.native);
    await p.connect();
    ek.state.status = 'denied';
    assert.equal(p.isConnected(), false);
    assert.equal(p.status().state, 'notAllowed');
    assert.equal(await p.fetchEvents(0, 1), null);
    assert.equal(ek.state.reads.length, 0);
});

// ─── Merge ──────────────────────────────────────────────────────────────────

const at = (iso, mins = 30) => ({ startTime: new Date(iso).toISOString(), endTime: new Date(Date.parse(iso) + mins * 60_000).toISOString() });

test('merge: the same meeting in two sources shows once (shared meeting key, or shared iCalUID)', () => {
    const google = [{ id: 'g1', title: 'Sync', source: 'google', ...at('2026-11-04T15:00:00Z'), meetingKeys: ['meet:abc-defg-hij'], link: 'https://meet.google.com/abc-defg-hij' }];
    const outlook = [
        { id: 'outlook:o1', title: 'Sync', source: 'outlook', ...at('2026-11-04T15:00:00Z'), meetingKeys: ['meet:abc-defg-hij', 'zoom:1'], description: 'From Outlook', organizer: { email: 'x@y.z' } },
        { id: 'outlook:o2', title: 'Other', source: 'outlook', ...at('2026-11-04T16:00:00Z'), iCalUID: 'UID-Shared' },
    ];
    const apple = [
        { id: 'apple:a2', title: 'Other', source: 'apple', ...at('2026-11-04T16:00:00Z'), iCalUID: 'uid-shared', link: 'https://zoom.us/j/9', meetingKeys: ['zoom:9'] },
        { id: 'apple:a3', title: 'Lunch', source: 'apple', ...at('2026-11-04T12:00:00Z') },
    ];
    const merged = mergeCalendarEvents([{ source: 'apple', events: apple }, { source: 'outlook', events: outlook }, { source: 'google', events: google }]);
    assert.deepEqual(merged.map((e) => e.id), ['apple:a3', 'g1', 'outlook:o2']);
    const sync = merged.find((e) => e.id === 'g1');
    assert.equal(sync.link, 'https://meet.google.com/abc-defg-hij', 'the first source keeps its own Join link');
    assert.deepEqual(sync.meetingKeys, ['meet:abc-defg-hij', 'zoom:1'], 'and gains the twin\'s keys');
    assert.equal(sync.description, 'From Outlook');
    assert.deepEqual(sync.organizer, { email: 'x@y.z' });
    const other = merged.find((e) => e.id === 'outlook:o2');
    assert.equal(other.link, 'https://zoom.us/j/9', 'a Join link the kept copy lacked is lent');
});

test('merge: different start, no shared key or UID, or the same source: never merged', () => {
    const a = { id: 'g1', title: 'A', source: 'google', ...at('2026-11-04T15:00:00Z'), meetingKeys: ['meet:abc'], iCalUID: 'u1' };
    const laterSameLink = { id: 'ics:x', title: 'A', source: 'ics', ...at('2026-11-11T15:00:00Z'), meetingKeys: ['meet:abc'], iCalUID: 'u1' };
    const sameTimeOtherMeeting = { id: 'ics:y', title: 'A', source: 'ics', ...at('2026-11-04T15:00:00Z'), meetingKeys: ['meet:zzz'], iCalUID: 'u2' };
    const sameSource = { id: 'g2', title: 'A', source: 'google', ...at('2026-11-04T15:00:00Z'), meetingKeys: ['meet:abc'] };
    assert.equal(mergeCalendarEvents([{ source: 'google', events: [a, sameSource] }, { source: 'ics', events: [laterSameLink, sameTimeOtherMeeting] }]).length, 4);
});

test('merge: one source comes back exactly as it was; none is empty', () => {
    const list = [{ id: 'b', source: 'google', ...at('2026-11-04T16:00:00Z') }, { id: 'a', source: 'google', ...at('2026-11-04T15:00:00Z') }];
    assert.equal(mergeCalendarEvents([{ source: 'google', events: list }, { source: 'ics', events: [] }]), list);
    assert.deepEqual(mergeCalendarEvents([]), []);
});

// ─── CalendarManager ────────────────────────────────────────────────────────

const ICS_URL = 'https://calendar.example.com/feeds/private-abc/basic.ics';

/** A fresh CalendarManager against a stubbed electron and fetch. Events sit past 24h (no reminder timers). */
function loadManager({ googleTokens } = {}) {
    const userData = tempDir('calmgr');
    const originalLoad = Module._load;
    const originalFetch = globalThis.fetch;
    const savedEnv = Object.fromEntries(['MICROSOFT_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET'].map((k) => [k, process.env[k]]));
    delete process.env.MICROSOFT_CALENDAR_CLIENT_ID;
    process.env.GOOGLE_CALENDAR_CLIENT_ID = 'test-desktop-client.apps.googleusercontent.com';
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'test-desktop-secret';
    Module._load = function (request, ...args) {
        if (request === 'electron') return {
            app: { getPath: () => userData, isPackaged: false },
            safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`enc:${s}`), decryptString: (b) => b.toString().slice(4) },
            shell: { openExternal: async () => {} },
            net: {},
            Notification: class { on() {} show() {} },
        };
        return originalLoad.call(this, request, ...args);
    };
    const start = new Date(Math.ceil((Date.now() + 26 * 3600_000) / 60_000) * 60_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const net = { icsCalls: 0 };
    globalThis.fetch = async (url) => {
        const u = String(url);
        if (u === ICS_URL) {
            net.icsCalls++;
            return new Response([
                'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Side project',
                'BEGIN:VEVENT', 'UID:shared-standup', `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, 'SUMMARY:Standup (feed copy)',
                'LOCATION:https://meet.google.com/abc-defg-hij', 'END:VEVENT',
                'BEGIN:VEVENT', 'UID:feed-only', `DTSTART:${stamp(new Date(start.getTime() + 3600_000))}`, `DTEND:${stamp(new Date(end.getTime() + 3600_000))}`, 'SUMMARY:Feed only', 'END:VEVENT',
                'END:VCALENDAR',
            ].join('\r\n'));
        }
        if (u.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList')) {
            return new Response(JSON.stringify({ items: [{ id: 'me@example.com', primary: true, selected: true }] }));
        }
        if (/^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/[^/]+\/events\?/.test(u)) {
            return new Response(JSON.stringify({ items: [{
                id: 'g-standup', summary: 'Standup', start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() },
                hangoutLink: 'https://meet.google.com/abc-defg-hij', iCalUID: 'different-uid@google.com',
            }] }));
        }
        throw new Error(`unexpected fetch ${u}`);
    };
    if (googleTokens) fs.writeFileSync(path.join(userData, 'calendar_tokens.enc'), Buffer.from(`enc:${JSON.stringify(googleTokens)}`));
    delete require.cache[require.resolve(compiledManager)];
    const { CalendarManager } = require(compiledManager);
    const restore = () => {
        Module._load = originalLoad;
        globalThis.fetch = originalFetch;
        for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        delete require.cache[require.resolve(compiledManager)];
    };
    return { cm: CalendarManager.getInstance(), net, userData, restore };
}

test('CalendarManager (win32): Google, Outlook and the link; no Apple row', async () => {
    // Outlook is "unconfigured" only in a build with no client ID baked in (CI);
    // a build made from a .env that has one (a release machine) offers it.
    const outlookBaked = Boolean(require(path.join(dist, 'microsoftGraph.js')).microsoftClientConfig({}).clientId);
    const { cm, restore } = loadManager();
    try {
        cm.init('win32');
        assert.deepEqual(cm.getSourceStatuses(), [
            { id: 'google', state: 'disconnected' },
            { id: 'outlook', state: outlookBaked ? 'disconnected' : 'unconfigured' },
            { id: 'ics', state: 'disconnected' },
        ]);
        assert.equal(await cm.connectSource('apple'), 'This calendar isn’t available on this computer.');
        if (!outlookBaked) {
            assert.equal(await cm.connectSource('outlook'), 'Outlook sign-in isn’t available in this version of Natively yet.');
        }
        assert.deepEqual(cm.getConnectionStatus(), { connected: false });
        assert.deepEqual(await cm.getUpcomingEvents(true), []);
    } finally {
        restore();
    }
});

test('CalendarManager (darwin): the Apple row is listed, between Outlook and the link', () => {
    const { cm, restore } = loadManager();
    try {
        cm.init('darwin');
        const statuses = cm.getSourceStatuses();
        assert.deepEqual(statuses.map((s) => s.id), ['google', 'outlook', 'apple', 'ics']);
        // Whatever the machine running the test allows: a state the row knows, never an error.
        assert.ok(['disconnected', 'unconfigured', 'notAllowed'].includes(statuses[2].state), statuses[2].state);
    } finally {
        restore();
    }
});

test('CalendarManager: a calendar link alone connects the calendar; with Google the shared meeting shows once', async () => {
    const { cm, net, restore } = loadManager({ googleTokens: { accessToken: 'at', refreshToken: 'rt', expiryDate: Date.now() + 3600_000, email: 'me@example.com', name: 'Mia Chen' } });
    try {
        const connectedEvents = [];
        cm.on('connection-changed', (v) => connectedEvents.push(v));
        cm.init('win32');
        assert.equal(await cm.connectSource('ics', ICS_URL.replace('https://', 'webcal://')), null);
        assert.deepEqual(connectedEvents, [true]);

        const events = await cm.getUpcomingEvents(true);
        assert.deepEqual(events.map((e) => [e.source, e.title]), [
            ['google', 'Standup'],
            ['ics', 'Feed only'],
        ], 'the feed\'s copy of the standup (same start, same Meet link) is merged into Google\'s');
        assert.deepEqual(cm.getCachedEvents(60_000).map((e) => e.id), events.map((e) => e.id));
        assert.deepEqual(cm.getConnectionStatus(), { connected: true, email: 'me@example.com', name: 'Mia Chen' });

        const statuses = cm.getSourceStatuses();
        assert.equal(statuses[0].state, 'connected');
        assert.equal(statuses[0].account, 'Mia Chen');
        assert.deepEqual(statuses[0].lastRefresh?.ok, true);
        assert.equal(statuses[2].state, 'connected');
        assert.equal(statuses[2].account, 'Side project');
        assert.equal(statuses[2].lastRefresh?.ok, true);
        assert.ok(!JSON.stringify(statuses).includes('private-abc'), 'the secret link never reaches the renderer');

        // The link goes away: so do its events, at once.
        await cm.disconnectSource('ics');
        assert.deepEqual(cm.getCachedEvents(60_000).map((e) => e.source), ['google']);
        assert.ok(net.icsCalls >= 1);
    } finally {
        restore();
    }
});

test('CalendarManager: with only the link connected, the Launcher still has a calendar', async () => {
    const { cm, restore } = loadManager();
    try {
        cm.init('win32');
        assert.equal(await cm.connectSource('ics', ICS_URL), null);
        assert.deepEqual(cm.getConnectionStatus(), { connected: true });
        const events = await cm.getUpcomingEvents(true);
        assert.deepEqual(events.map((e) => e.title), ['Standup (feed copy)', 'Feed only']);
        assert.ok(events.every((e) => e.source === 'ics' && e.id.startsWith('ics:')));
        await cm.disconnectSource('ics');
        assert.deepEqual(cm.getConnectionStatus(), { connected: false });
        assert.equal(cm.getCachedEvents(60_000), null);
    } finally {
        restore();
    }
});

// ─── Packaging (macOS): what Apple Calendar needs to ask at all ────────────

test('macOS packaging: the Calendars entitlement on the app, both purpose strings in Info.plist and the dev plist patch', () => {
    const root = path.resolve(here, '../../..');
    const entitlements = fs.readFileSync(path.join(root, 'build/entitlements.mac.plist'), 'utf8');
    assert.match(entitlements, /<key>com\.apple\.security\.personal-information\.calendars<\/key>\s*<true\/>/);
    // Helpers never read the calendar: the inherit plist stays without it.
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'build/entitlements.mac.inherit.plist'), 'utf8'), /personal-information\.calendars/);
    const extendInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build.mac.extendInfo;
    for (const key of ['NSCalendarsFullAccessUsageDescription', 'NSCalendarsUsageDescription']) {
        assert.ok(typeof extendInfo[key] === 'string' && extendInfo[key].length > 20, key);
        assert.doesNotMatch(extendInfo[key], /undetectable/i);
    }
    const patch = fs.readFileSync(path.join(root, 'scripts/patch-electron-plist.js'), 'utf8');
    assert.match(patch, /'NSCalendarsFullAccessUsageDescription', 'NSCalendarsUsageDescription'/);
});
