// Review of the 2026-11-09 calendar reminder fixes:
//  - one Google calendar failing among several keeps its last good items
//    (its reminders and list), instead of counting as an empty calendar;
//  - a manual refresh no longer clears the reminder timers before its fetch
//    (a reminder due during the fetch was lost);
//  - a fetch that started before the last applied one is not applied over it
//    (the Launcher's minute fetch and main's can overlap).
// CalendarManager runs against a stubbed electron and fetch, with the
// platform passed to init(); no request leaves the machine.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => path.join(REPO, 'dist-electron/electron/services', p);
const { lastGoodCalendarItems, REMINDER_LAST_GOOD_MAX_AGE_MS } = require(dist('calendar/calendarReminderPlan.js'));

const MIN = 60_000;
const tempDirs = [];
after(() => { for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true }); });

test('a failed calendar\'s last good items stand in, up to a day old, less what has ended', () => {
    const now = Date.parse('2026-11-09T10:00:00Z');
    const items = [
        { id: 'ended', end: { dateTime: '2026-11-09T09:00:00Z' } },
        { id: 'later', end: { dateTime: '2026-11-09T12:00:00Z' } },
    ];
    assert.deepEqual(lastGoodCalendarItems({ items, at: now - 5 * MIN }, now, now).map((i) => i.id), ['later']);
    assert.deepEqual(lastGoodCalendarItems({ items, at: now - REMINDER_LAST_GOOD_MAX_AGE_MS - 1 }, now, now), [], 'too old');
    assert.deepEqual(lastGoodCalendarItems(undefined, now, now), [], 'never fetched');
});

/** A CalendarManager signed in to Google with two synced calendars, each with one event. */
function loadGoogle({ startA, startB }) {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-test-calreview-'));
    tempDirs.push(userData);
    const originalLoad = Module._load;
    const originalFetch = globalThis.fetch;
    const savedEnv = { id: process.env.GOOGLE_CALENDAR_CLIENT_ID, secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET };
    process.env.GOOGLE_CALENDAR_CLIENT_ID = 'test-desktop-client.apps.googleusercontent.com';
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'test-desktop-secret';
    Module._load = function (request, ...args) {
        if (request === 'electron') return {
            app: { getPath: () => userData, isPackaged: false, isReady: () => true },
            safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`enc:${s}`), decryptString: (b) => b.toString().slice(4) },
            shell: { openExternal: async () => {} },
            net: {},
            Notification: class { static isSupported() { return true; } on() {} show() {} close() {} },
        };
        return originalLoad.call(this, request, ...args);
    };
    const savedSettings = globalThis.__nativelySettingsManagerV1__;
    globalThis.__nativelySettingsManagerV1__ = { get: () => undefined };
    fs.writeFileSync(path.join(userData, 'calendar_tokens.enc'), Buffer.from(`enc:${JSON.stringify({ accessToken: 'at', refreshToken: 'rt', expiryDate: Date.now() + 3600_000, email: 'me@example.com' })}`));
    const net = { failB: false };
    const event = (id, start) => ({ id, iCalUID: `${id}@x`, summary: id, start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(start + 30 * MIN).toISOString() } });
    globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/users/me/calendarList')) {
            return new Response(JSON.stringify({ items: [{ id: 'me@example.com', primary: true, selected: true }, { id: 'team@group.calendar.google.com', selected: true }] }));
        }
        if (u.includes('/calendars/me%40example.com/events')) return new Response(JSON.stringify({ items: [event('a', startA)] }));
        if (u.includes('/calendars/team%40group.calendar.google.com/events')) {
            if (net.failB) return new Response(JSON.stringify({ error: { status: 'UNAVAILABLE' } }), { status: 503 });
            return new Response(JSON.stringify({ items: [event('b', startB)] }));
        }
        throw new Error(`unexpected fetch ${u}`);
    };
    const compiled = dist('CalendarManager.js');
    delete require.cache[require.resolve(compiled)];
    const { CalendarManager } = require(compiled);
    const cm = CalendarManager.getInstance();
    const restore = () => {
        cm.clearReminderTimers();
        Module._load = originalLoad;
        globalThis.fetch = originalFetch;
        globalThis.__nativelySettingsManagerV1__ = savedSettings;
        for (const [k, v] of [['GOOGLE_CALENDAR_CLIENT_ID', savedEnv.id], ['GOOGLE_CALENDAR_CLIENT_SECRET', savedEnv.secret]]) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
        delete require.cache[require.resolve(compiled)];
    };
    return { cm, net, restore };
}

for (const platform of ['darwin', 'win32']) {
    test(`CalendarManager (${platform}): one Google calendar failing keeps its event and its reminder`, async () => {
        const now = Date.now();
        const { cm, net, restore } = loadGoogle({ startA: now + 30 * MIN, startB: now + 40 * MIN });
        try {
            cm.init(platform);
            assert.deepEqual((await cm.getUpcomingEvents(true)).map((e) => e.id).sort(), ['a', 'b']);
            assert.equal(cm.pendingReminderKeys().length, 2);
            net.failB = true;
            const events = await cm.getUpcomingEvents(true);
            assert.deepEqual(events.map((e) => e.id).sort(), ['a', 'b'], 'the team calendar\'s meeting is still listed (was dropped)');
            assert.equal(cm.pendingReminderKeys().length, 2, 'and still reminded (was cancelled)');
        } finally {
            restore();
        }
    });
}

test('CalendarManager: a manual refresh keeps the reminders armed while its fetch is on its way', async () => {
    const now = Date.now();
    const { cm, restore } = loadGoogle({ startA: now + 30 * MIN, startB: now + 40 * MIN });
    try {
        cm.init('win32');
        await cm.getUpcomingEvents(true);
        assert.equal(cm.pendingReminderKeys().length, 2);
        const real = cm.fetchFromSources.bind(cm);
        let release;
        const gate = new Promise((r) => { release = r; });
        cm.fetchFromSources = async (...a) => { await gate; return real(...a); };
        const refreshing = cm.refreshState();
        await new Promise((r) => setImmediate(r));
        assert.equal(cm.pendingReminderKeys().length, 2, 'armed during the fetch (were all cleared)');
        release();
        assert.equal(await refreshing, true);
        assert.equal(cm.pendingReminderKeys().length, 2);
    } finally {
        restore();
    }
});

test('CalendarManager: an older fetch finishing last is not applied over a newer one', async () => {
    const now = Date.now();
    const { cm, restore } = loadGoogle({ startA: now + 30 * MIN, startB: now + 40 * MIN });
    try {
        cm.init('darwin');
        await cm.getUpcomingEvents(true);
        const ev = (id, start) => ({ id, title: id, startTime: new Date(start).toISOString(), endTime: new Date(start + 30 * MIN).toISOString(), source: 'google' });
        const answers = [];
        cm.fetchFromSources = () => new Promise((resolve) => answers.push(resolve));
        const older = cm.getUpcomingEvents(true);
        await new Promise((r) => setTimeout(r, 5));      // the newer one starts later
        const newer = cm.getUpcomingEvents(true);
        answers[1](new Map([['google', [ev('moved', now + 50 * MIN)]]]));
        await newer;
        answers[0](new Map([['google', [ev('cancelled', now + 20 * MIN)]]]));
        await older;
        assert.deepEqual(cm.getCachedEvents(60_000).map((e) => e.id), ['moved'], 'the newer list stands');
        assert.equal(cm.pendingReminderKeys().length, 1);
        assert.match(cm.pendingReminderKeys()[0], /^moved\|/, 'no reminder for the cancelled meeting');
    } finally {
        restore();
    }
});
