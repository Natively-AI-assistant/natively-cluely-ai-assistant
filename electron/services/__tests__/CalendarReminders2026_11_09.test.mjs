// Calendar reminders (2026-11-09): main refreshes the calendar itself (every
// few minutes, on wake and unlock, never while Undetectable, never over a
// fetch in flight); a failed source keeps its reminders from its last good
// list for a day; a reminder is checked against the wall clock when it fires
// (a Mac asleep does not advance timers); declined meetings and reminders
// switched Off are not reminded; disconnecting a calendar takes its reminders;
// no Start during a Natively meeting, nor under a disguise; every reminder on
// screen stays referenced, closes a few minutes into its meeting, and its
// Start does nothing once the meeting is over.
//
// The pure parts run on fake clocks. CalendarManager runs against a stubbed
// electron (Notification included) with the platform passed to init(), so the
// darwin and win32 readings of a notification's close both run on any machine.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const dist = (p) => path.join(REPO, 'dist-electron/electron/services', p);
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const {
    planReminders, reminderMinutes, REMINDER_SETTING_CHOICES, REMINDER_MINUTE_CHOICES, REMINDERS_OFF,
    reminderFire, reminderContent, reminderStartAllowed, reminderKey, REMINDER_CLOSE_AFTER_START_MS,
} = require(dist('meetingDetection/meetingOffer.js'));
const {
    reminderSourceLists, backgroundRefreshDecision, REMINDER_LAST_GOOD_MAX_AGE_MS, CALENDAR_BACKGROUND_REFRESH_MS,
} = require(dist('calendar/calendarReminderPlan.js'));

const MIN = 60_000;
const NOW = Date.parse('2026-11-09T10:00:00Z');
const at = (ms) => new Date(ms).toISOString();

// ── C4 / C6c: what is planned ──────────────────────────────────────────────

test('a declined meeting is not reminded; tentative, accepted and unanswered ones are', () => {
    const ev = (id, selfResponse) => ({ id, startTime: at(NOW + 30 * MIN), ...(selfResponse ? { selfResponse } : {}) });
    const plan = planReminders([ev('a', 'declined'), ev('b', 'accepted'), ev('c', 'tentative'), ev('d', 'needsAction'), ev('e')], NOW, 2, new Set());
    assert.deepEqual(plan.map((p) => p.event.id), ['b', 'c', 'd', 'e']);
    assert.equal(plan[0].delayMs, 28 * MIN);
});

test('Off is a setting value: nothing is planned, and the default stays 2 minutes', () => {
    assert.equal(REMINDERS_OFF, 0);
    assert.deepEqual([...REMINDER_SETTING_CHOICES], [0, 1, 2, 5]);
    assert.deepEqual([...REMINDER_MINUTE_CHOICES], [1, 2, 5], 'the lead times themselves are unchanged');
    assert.equal(reminderMinutes(0), 0, 'Off is kept');
    assert.equal(reminderMinutes(undefined), 2, 'unset: 2 minutes, as before');
    assert.equal(reminderMinutes(-1), 2);
    assert.deepEqual(planReminders([{ id: 'a', startTime: at(NOW + 30 * MIN) }], NOW, 0, new Set()), []);
    // The setting accepts it, and Settings › Calendar offers it in the same pill row.
    assert.match(read('electron/ipcHandlers.ts'), /REMINDER_SETTING_CHOICES\.includes\(minutes\)/);
    const ui = read('src/components/settings/CalendarSettings.tsx');
    assert.match(ui, /\[0, 1, 2, 5\]\.map\(\(m\) =>/);
    assert.match(ui, /m === 0 \? t\('Off'\)/);
    // "Off" is already translated (the existing i18n tables).
    for (const lang of ['es', 'ja', 'ru', 'zh']) assert.match(read(`src/i18n.${lang}.generated.ts`), /"Off": "/, lang);
});

// ── C3: checked against the wall clock when it fires ────────────────────────

test('a reminder fires only while "starts in N minutes" is still true; late or started ones are skipped', () => {
    const start = NOW + 2 * MIN;
    assert.deepEqual(reminderFire(start, NOW, 2), { kind: 'show' });
    assert.deepEqual(reminderFire(start, NOW + 50_000, 2), { kind: 'show' }, 'within a minute of its time');
    assert.deepEqual(reminderFire(start, NOW + 61_000, 2), { kind: 'skip', reason: 'late' }, 'woken a minute before the meeting');
    assert.deepEqual(reminderFire(start, start, 2), { kind: 'skip', reason: 'started' });
    assert.deepEqual(reminderFire(start, start + 30 * MIN, 2), { kind: 'skip', reason: 'started' }, 'woken after the meeting');
    assert.deepEqual(reminderFire(start, NOW, 0), { kind: 'skip', reason: 'off' }, 'turned Off while it waited');
    assert.deepEqual(reminderFire(start, NOW - 10 * MIN, 2), { kind: 'early', delayMs: 10 * MIN }, 'the wall clock went back: wait');
    assert.deepEqual(reminderFire(start, NOW, 5), { kind: 'skip', reason: 'late' }, 'a lead longer than what is left');
});

// ── C6a / C6d: what it shows, and when its Start counts ─────────────────────

test('no "Start Natively?" during a Natively meeting: Running late only, or nothing', () => {
    const base = { title: 'Acme weekly', lead: '2 minutes', lastTime: null };
    const normal = reminderContent({ ...base, hasAttendees: true, meetingActive: false });
    assert.equal(normal.body, '"Acme weekly" starts in 2 minutes. Start Natively?');
    assert.deepEqual(normal.actions.map((a) => [a.kind, a.text]), [['start', 'Start Meeting'], ['dismiss', 'Dismiss'], ['late', 'Running late']]);
    assert.deepEqual(reminderContent({ ...base, hasAttendees: false, meetingActive: false }).actions.map((a) => a.kind), ['start', 'dismiss']);
    const during = reminderContent({ ...base, hasAttendees: true, meetingActive: true });
    assert.equal(during.body, '"Acme weekly" starts in 2 minutes.');
    assert.deepEqual(during.actions.map((a) => a.kind), ['dismiss', 'late'], 'back to back: the running-late draft stays');
    assert.equal(reminderContent({ ...base, hasAttendees: false, meetingActive: true }), null, 'nothing to offer: not shown');
    assert.equal(reminderContent({ ...base, lastTime: 'Last time: x', hasAttendees: false, meetingActive: false }).body, '"Acme weekly" starts in 2 minutes.\nLast time: x');
});

test('a reminder\'s Start counts until its meeting ends, not the next day', () => {
    const ev = { startTime: at(NOW), endTime: at(NOW + 30 * MIN) };
    assert.equal(reminderStartAllowed(ev, NOW - 2 * MIN), true);
    assert.equal(reminderStartAllowed(ev, NOW + 10 * MIN), true, 'joined late');
    assert.equal(reminderStartAllowed(ev, NOW + 30 * MIN), false, 'over');
    assert.equal(reminderStartAllowed(ev, NOW + 24 * 60 * MIN), false, 'tapped in the Notification Center tomorrow');
    assert.equal(reminderStartAllowed({ startTime: at(NOW) }, NOW + 59 * MIN), true, 'no end: an hour');
    assert.equal(reminderStartAllowed({ startTime: at(NOW) }, NOW + 61 * MIN), false);
    assert.equal(reminderStartAllowed({}, NOW), false);
    assert.equal(REMINDER_CLOSE_AFTER_START_MS, 5 * MIN);
});

// ── C2: a failed source keeps its reminders ─────────────────────────────────

test('reminders come from answered sources, and from a failed one\'s last good list up to a day old', () => {
    const g = [{ id: 'g1' }];
    const o = [{ id: 'o1' }];
    const lastBy = new Map([['google', [{ id: 'g0' }]], ['outlook', o], ['ics', [{ id: 'i0' }]]]);
    const lastAt = new Map([['google', NOW - MIN], ['outlook', NOW - 3 * 60 * MIN], ['ics', NOW - REMINDER_LAST_GOOD_MAX_AGE_MS - 1]]);
    const out = reminderSourceLists(new Map([['google', g], ['outlook', null], ['ics', null]]), lastBy, lastAt, NOW);
    assert.deepEqual(out, [{ source: 'google', events: g }, { source: 'outlook', events: o }], 'ics: last good older than a day, dropped');
    assert.equal(REMINDER_LAST_GOOD_MAX_AGE_MS, 24 * 60 * MIN);
    // A source absent from the results (not connected) contributes nothing.
    assert.deepEqual(reminderSourceLists(new Map(), lastBy, lastAt, NOW), []);
    // Never fetched: nothing.
    assert.deepEqual(reminderSourceLists(new Map([['apple', null]]), lastBy, lastAt, NOW), []);
});

// ── C1: main refreshes by itself ─────────────────────────────────────────────

test('main\'s refresh: never while Undetectable or over a fetch in flight; the timer skips a fresh list, a wake never does', () => {
    const base = { nowMs: NOW, connected: true, egressBlocked: false, inFlight: false, lastLandedAt: NOW - 10 * MIN };
    assert.equal(CALENDAR_BACKGROUND_REFRESH_MS, 5 * MIN);
    assert.equal(backgroundRefreshDecision({ ...base, reason: 'interval' }), 'fetch');
    assert.equal(backgroundRefreshDecision({ ...base, reason: 'interval', lastLandedAt: 0 }), 'fetch', 'never fetched');
    assert.equal(backgroundRefreshDecision({ ...base, reason: 'interval', lastLandedAt: NOW - 30_000 }), 'fresh', 'the Launcher fetched a moment ago');
    for (const reason of ['resume', 'unlock']) {
        assert.equal(backgroundRefreshDecision({ ...base, reason, lastLandedAt: NOW - 30_000 }), 'fetch', reason);
    }
    for (const reason of ['interval', 'resume', 'unlock']) {
        assert.equal(backgroundRefreshDecision({ ...base, reason, egressBlocked: true }), 'blocked', `${reason}: no calendar traffic while Undetectable`);
        assert.equal(backgroundRefreshDecision({ ...base, reason, inFlight: true }), 'in-flight', reason);
        assert.equal(backgroundRefreshDecision({ ...base, reason, connected: false }), 'not-connected', reason);
    }
});

test('the Launcher\'s minute poll reads Undetectable through a ref, and main wires its own refresh', () => {
    const launcher = read('src/components/Launcher.tsx');
    assert.match(launcher, /setInterval\(\(\) => \{ if \(isDetectableRef\.current\) fetchEvents\(\); \}, 60000\)/);
    assert.match(launcher, /isDetectableRef\.current = isDetectable;/);
    assert.doesNotMatch(launcher, /if \(isDetectable\) fetchEvents\(\)/, 'the stale closure is gone');
    const main = read('electron/main.ts');
    assert.match(main, /calMgr\.startBackgroundRefresh\(\(\) => nativePromptsBlocked\(\(\) => appState\.getUndetectable\(\)\)\)/);
    const resume = main.slice(main.indexOf("powerMonitor.on('resume'"), main.indexOf("powerMonitor.on('suspend'"));
    assert.match(resume, /refreshCalendarInBackground\('resume'\)/);
    const unlock = main.slice(main.indexOf("powerMonitor.on('unlock-screen'"), main.indexOf("powerMonitor.on('unlock-screen'") + 600);
    assert.match(unlock, /refreshCalendarInBackground\('unlock'\)/);
    // C6b: the same gate as meeting detection and dictation (Undetectable or a disguise), plus the meeting check.
    assert.match(main, /calMgr\.setNotificationSuppressor\(\s*\(\) => nativePromptsBlocked\(\(\) => appState\.getUndetectable\(\)\) \|\| appState\.getDisguise\(\) !== 'none',\s*\(\) => appState\.getIsMeetingActive\(\),\s*\)/);
});

// ── CalendarManager, end to end against a stubbed electron ─────────────────

const ICS_URL = 'https://calendar.example.com/feeds/private-abc/basic.ics';
const tempDirs = [];
after(() => { for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true }); });
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/** A fresh CalendarManager with a calendar link whose one event starts at `startMs`. */
function loadManager({ startMs, settings = {} }) {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-test-reminders-'));
    tempDirs.push(userData);
    const originalLoad = Module._load;
    const originalFetch = globalThis.fetch;
    const shown = [];
    class FakeNotification {
        static isSupported() { return true; }
        constructor(opts) { this.opts = opts; this.handlers = {}; this.closed = 0; shown.push(this); }
        on(name, fn) { (this.handlers[name] ??= []).push(fn); }
        emit(name, ...args) { for (const fn of this.handlers[name] ?? []) fn(...args); }
        show() {}
        close() { this.closed++; }
    }
    Module._load = function (request, ...args) {
        if (request === 'electron') return {
            app: { getPath: () => userData, isPackaged: false, isReady: () => true },
            safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`enc:${s}`), decryptString: (b) => b.toString().slice(4) },
            shell: { openExternal: async () => {} },
            net: {},
            Notification: FakeNotification,
        };
        return originalLoad.call(this, request, ...args);
    };
    const savedSettings = globalThis.__nativelySettingsManagerV1__;
    globalThis.__nativelySettingsManagerV1__ = { get: (k) => settings[k] };
    const start = new Date(startMs);
    const end = new Date(startMs + 30 * MIN);
    globalThis.fetch = async (url) => {
        if (String(url) !== ICS_URL) throw new Error(`unexpected fetch ${url}`);
        return new Response([
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Work',
            'BEGIN:VEVENT', 'UID:standup', `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, 'SUMMARY:Standup', 'END:VEVENT',
            'END:VCALENDAR',
        ].join('\r\n'));
    };
    const compiled = dist('CalendarManager.js');
    delete require.cache[require.resolve(compiled)];
    const { CalendarManager } = require(compiled);
    const cm = CalendarManager.getInstance();
    // Count the manager's fetches (the link's own cache would hide them).
    const counts = { fetches: 0, fail: false };
    const realFetch = cm.fetchFromSources.bind(cm);
    cm.fetchFromSources = async (...a) => {
        counts.fetches++;
        const results = await realFetch(...a);
        if (counts.fail) for (const k of results.keys()) results.set(k, null);
        return results;
    };
    const restore = () => {
        cm.clearReminderTimers();
        for (const key of [...cm.reminderNotifications.keys()]) cm.closeReminderNotification(key);
        if (cm.backgroundTimer) clearInterval(cm.backgroundTimer);
        Module._load = originalLoad;
        globalThis.fetch = originalFetch;
        globalThis.__nativelySettingsManagerV1__ = savedSettings;
        delete require.cache[require.resolve(compiled)];
    };
    return { cm, counts, shown, restore };
}

test('CalendarManager: a failed fetch keeps the pending reminder; disconnecting the last calendar takes it', async () => {
    const { cm, counts, restore } = loadManager({ startMs: Math.ceil((Date.now() + 30 * MIN) / 1000) * 1000 });
    try {
        cm.init('win32');
        assert.equal(await cm.connectSource('ics', ICS_URL), null);
        await cm.getUpcomingEvents(true);
        assert.equal(cm.pendingReminderKeys().length, 1, 'armed');
        counts.fail = true;
        await cm.getUpcomingEvents(true);
        assert.equal(cm.pendingReminderKeys().length, 1, 'C2: offline is not a cancelled meeting');
        await cm.disconnectSource('ics');
        assert.deepEqual(cm.pendingReminderKeys(), [], 'C5: no calendar, no reminder');
    } finally {
        restore();
    }
});

test('CalendarManager: Off takes every pending reminder at once', async () => {
    const settings = {};
    const { cm, restore } = loadManager({ startMs: Math.ceil((Date.now() + 30 * MIN) / 1000) * 1000, settings });
    try {
        cm.init('darwin');
        assert.equal(await cm.connectSource('ics', ICS_URL), null);
        await cm.getUpcomingEvents(true);
        assert.equal(cm.pendingReminderKeys().length, 1);
        settings.calendarReminderMinutes = 0;
        cm.rescheduleReminders();
        assert.deepEqual(cm.pendingReminderKeys(), []);
    } finally {
        restore();
    }
});

test('CalendarManager: main\'s refresh is gated by Undetectable, skips a fresh list on the timer, and joins a fetch in flight', async () => {
    const { cm, counts, restore } = loadManager({ startMs: Math.ceil((Date.now() + 30 * MIN) / 1000) * 1000 });
    try {
        cm.init('win32');
        assert.equal(await cm.connectSource('ics', ICS_URL), null);
        await cm.getUpcomingEvents(true);
        let blocked = true;
        cm.startBackgroundRefresh(() => blocked, 60 * MIN);
        const before = counts.fetches;
        await cm.refreshInBackground('resume');
        assert.equal(counts.fetches, before, 'Undetectable: no calendar traffic');
        assert.equal(cm.pendingReminderKeys().length, 1, 'yet the wake re-planned the reminder from the last list');
        blocked = false;
        await cm.refreshInBackground('interval');
        assert.equal(counts.fetches, before, 'fetched a moment ago: the timer waits');
        await cm.refreshInBackground('resume');
        assert.equal(counts.fetches, before + 1, 'a wake fetches');
        const launcherFetch = cm.getUpcomingEvents(true);
        await cm.refreshInBackground('unlock');
        await launcherFetch;
        assert.equal(counts.fetches, before + 2, 'the unlock joined the fetch already on its way');
    } finally {
        restore();
    }
});

for (const platform of ['darwin', 'win32']) {
    test(`CalendarManager (${platform}): a reminder fires on time, stays referenced, closes after its start; Start works while the meeting is on`, async () => {
        // Starts 2 minutes and ~1.5 s from now: the 2-minute reminder fires in ~1.5 s.
        const startMs = Math.ceil((Date.now() + 2 * MIN + 1500) / 1000) * 1000;
        const { cm, shown, restore } = loadManager({ startMs });
        try {
            cm.init(platform);
            assert.equal(await cm.connectSource('ics', ICS_URL), null);
            const [ev] = await cm.getUpcomingEvents(true);
            const starts = [];
            cm.on('start-meeting-requested', (e) => starts.push(e.id));
            await new Promise((r) => setTimeout(r, startMs - 2 * MIN - Date.now() + 300));
            assert.equal(shown.length, 1, 'shown');
            const n = shown[0];
            assert.equal(n.opts.title, 'Meeting starting soon');
            assert.match(n.opts.body, /"Standup" starts in 2 minutes\. Start Natively\?/);
            assert.deepEqual(n.opts.actions.map((a) => a.text), ['Start Meeting', 'Dismiss']);
            assert.ok((n.handlers.failed ?? []).length === 1, 'a failed handler (logs)');
            const key = reminderKey(ev);
            assert.ok(cm.reminderNotifications.get(key)?.notification === n, 'kept referenced by occurrence');
            // A timed-out Windows toast is still in the Action Center: kept. On macOS any close is the user's.
            n.emit('close', { reason: 'timedOut' });
            assert.equal(cm.reminderNotifications.has(key), platform === 'win32');
            n.emit('action', { actionIndex: 0 });
            assert.deepEqual(starts, [ev.id], 'Start while the meeting is upcoming');
            // Its close timer: five minutes into the meeting.
            if (platform === 'win32') {
                const entry = cm.reminderNotifications.get(key);
                assert.ok(entry.closeTimer, 'closes itself');
                cm.closeReminderNotification(key);
                assert.equal(n.closed, 1);
            }
            assert.deepEqual(cm.pendingReminderKeys(), [], 'fired once');
        } finally {
            restore();
        }
    });
}

test('CalendarManager: during a Natively meeting a reminder with no one else on it is not shown; Undetectable or a disguise shows none', async () => {
    const startMs = Math.ceil((Date.now() + 2 * MIN + 1500) / 1000) * 1000;
    const a = loadManager({ startMs });
    try {
        a.cm.init('darwin');
        a.cm.setNotificationSuppressor(() => false, () => true);
        assert.equal(await a.cm.connectSource('ics', ICS_URL), null);
        await a.cm.getUpcomingEvents(true);
        await new Promise((r) => setTimeout(r, startMs - 2 * MIN - Date.now() + 300));
        assert.deepEqual(a.cm.pendingReminderKeys(), [], 'its timer fired');
        assert.equal(a.shown.length, 0, 'meeting running: no Start Natively?');
    } finally {
        a.restore();
    }
    // The suppressor is asked first (main: Undetectable || disguise), so nothing is built at all.
    const src = read('electron/services/CalendarManager.ts');
    const show = src.slice(src.indexOf('private showNotification('));
    assert.ok(show.indexOf('this.notificationSuppressed()') < show.indexOf('new Notification('));
    assert.match(show, /Notification\.isSupported\(\)/);
});
