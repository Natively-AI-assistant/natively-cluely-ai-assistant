// The "meeting detected" offer (2026-10-15, services/meetingDetection/
// meetingOffer.ts): one offer per call on two synced surfaces (the launcher's
// panel and the OS notification), Start / Not now, the optional 10 s
// automatic start, and the calendar reminder's lead time. Fake clock and
// timers; the notification's close is read per OS (Windows also closes a
// toast that timed out, which is not a no).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const dist = (p) => path.join(REPO, 'dist-electron/electron/services', p);
const {
    MeetingOffers, offerNotificationText, closeMeansNotNow, reminderMinutes, reminderLeadText, REMINDER_MINUTE_CHOICES,
} = require(dist('meetingDetection/meetingOffer.js'));
const { wireMeetingDetection } = require(dist('meetingDetection/wireMeetingDetection.js'));

function rig({ auto = false, focused = false, active = false } = {}) {
    let t = 1_000_000;
    const timers = new Map();
    let seq = 0;
    const state = { active, auto, focused, panel: [], notes: [], closed: 0, starts: [] };
    const offers = new MeetingOffers({
        isMeetingActive: () => state.active,
        requestStart: (r) => state.starts.push(r),
        autoStart: () => state.auto,
        showPanel: (o) => state.panel.push(o),
        notify: (n) => { state.notes.push(n); return true; },
        closeNotification: () => { state.closed++; },
        launcherFocused: () => state.focused,
        now: () => t,
        setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id; },
        clearTimeout: (id) => timers.delete(id),
    });
    const advance = (ms) => {
        t += ms;
        for (const [id, timer] of [...timers]) {
            if (timer.at <= t) { timers.delete(id); timer.fn(); }
        }
    };
    return { offers, state, advance, timers, now: () => t };
}

const CALL = { app: 'Zoom', title: null, body: 'A Zoom call started.', start: { via: 'detected' } };
const EVENT = { app: 'Google Meet', title: 'Meet abc', body: '"Weekly sync" is on in Google Meet.', start: { title: 'Weekly sync', calendarEventId: 'sync', via: 'detected' } };

test('an offer shows on the panel and, with the launcher not in front, as a notification', () => {
    const { offers, state } = rig();
    const view = offers.offer(EVENT);
    assert.equal(view.title, 'Weekly sync', 'the calendar event names it');
    assert.equal(view.app, 'Google Meet');
    assert.equal(view.autoStartAt, null);
    assert.deepEqual(state.panel, [view]);
    assert.equal(state.notes.length, 1);
    assert.equal(state.notes[0].title, 'Start Natively?');
    assert.equal(state.notes[0].action, 'Start Natively');
    // No event: the call's own name, else nothing (the panel says "<App> call").
    assert.equal(offers.offer({ ...CALL, title: 'Standup' }).title, 'Standup');
    assert.equal(offers.offer(CALL).title, null);
});

test('with the launcher in front, its panel is enough: no notification', () => {
    const { offers, state } = rig({ focused: true });
    offers.offer(CALL);
    assert.equal(state.panel.length, 1);
    assert.equal(state.notes.length, 0);
});

test('Start on the panel starts once, linked to the event, and clears both surfaces', () => {
    const { offers, state } = rig();
    const view = offers.offer(EVENT);
    assert.equal(offers.start(view.id), true);
    assert.deepEqual(state.starts, [EVENT.start]);
    assert.equal(state.panel.at(-1), null, 'panel cleared');
    assert.ok(state.closed >= 1, 'notification closed');
    assert.equal(offers.start(view.id), false, 'a second press does nothing');
    assert.equal(state.starts.length, 1);
});

test('Not now on either surface clears the offer; a stale id does nothing', () => {
    const { offers, state } = rig();
    const a = offers.offer(CALL);
    state.notes[0].onDismiss();
    assert.equal(offers.view(), null);
    assert.equal(state.panel.at(-1), null);
    const b = offers.offer(CALL);
    offers.dismiss(a.id);
    assert.equal(offers.view()?.id, b.id, 'the old offer\'s Not now leaves the new one');
    offers.dismiss(b.id);
    assert.equal(offers.view(), null);
    assert.deepEqual(state.starts, []);
});

test('a notification\'s Start acts even after the panel moved on, but never over a running meeting', () => {
    const { offers, state } = rig();
    offers.offer(CALL);
    const first = state.notes[0];
    state.active = true;
    first.onStart();
    assert.deepEqual(state.starts, []);
    state.active = false;
    first.onStart();
    assert.deepEqual(state.starts, [{ via: 'detected' }]);
});

test('Start automatically: counts down 10 s, then starts unless Not now; the countdown is in the notification', () => {
    const { offers, state, advance, now } = rig({ auto: true });
    const view = offers.offer(CALL);
    assert.equal(view.autoStartAt, now() + 10_000);
    assert.equal(state.notes[0].title, 'Starting Natively');
    assert.equal(state.notes[0].body, 'A Zoom call started.\nNatively starts in 10 seconds.');
    assert.equal(state.notes[0].action, 'Start now');
    advance(9_999);
    assert.deepEqual(state.starts, []);
    advance(1);
    assert.deepEqual(state.starts, [{ via: 'detected' }]);
    assert.equal(offers.view(), null);

    // Not now stops it.
    const r2 = rig({ auto: true });
    const v2 = r2.offers.offer(CALL);
    r2.advance(4_000);
    r2.offers.dismiss(v2.id);
    r2.advance(20_000);
    assert.deepEqual(r2.state.starts, []);

    // A meeting started some other way meanwhile: no second start.
    const r3 = rig({ auto: true });
    r3.offers.offer(CALL);
    r3.state.active = true;
    r3.advance(10_000);
    assert.deepEqual(r3.state.starts, []);

    // The launcher clears the offer when its own meeting starts.
    const r4 = rig({ auto: true });
    r4.offers.offer(CALL);
    r4.offers.clear('meeting started');
    r4.advance(10_000);
    assert.deepEqual(r4.state.starts, []);
});

test('off by default: no countdown runs; an unanswered offer clears itself after two minutes', () => {
    const { offers, state, advance, timers } = rig();
    offers.offer(CALL);
    assert.equal(timers.size, 1, 'only the expiry');
    advance(120_000);
    assert.equal(offers.view(), null);
    assert.deepEqual(state.starts, []);
});

test('a new call replaces the earlier offer and its countdown', () => {
    const { offers, state, advance } = rig({ auto: true });
    offers.offer(CALL);
    advance(8_000);
    const second = offers.offer(EVENT);
    advance(2_000);
    assert.deepEqual(state.starts, [], 'the first countdown was cancelled');
    advance(8_000);
    assert.deepEqual(state.starts, [EVENT.start]);
    assert.equal(offers.view(), null);
    assert.ok(second.id);
});

test('the notification\'s close is Not now on macOS; on Windows only when the user closed it', () => {
    assert.equal(closeMeansNotNow('darwin', undefined), true);
    assert.equal(closeMeansNotNow('win32', 'userCanceled'), true);
    assert.equal(closeMeansNotNow('win32', 'timedOut'), false, 'timed out into the Action Center');
    assert.equal(closeMeansNotNow('win32', 'applicationHidden'), false);
    assert.equal(closeMeansNotNow('win32', undefined), false);
    assert.deepEqual(offerNotificationText('x', false, 10_000), { title: 'Start Natively?', body: 'x', action: 'Start Natively' });
});

test('wired in: prompts blocked means no panel and no countdown either; otherwise the panel gets the offer', () => {
    let blocked = true;
    let t = 0;
    const panel = [];
    const notes = [];
    const starts = [];
    const pending = [];
    const detector = wireMeetingDetection({
        platform: 'win32',
        native: { getMicUsers: () => [{ path: 'C:\\z\\Zoom.exe' }], getVisibleWindows: () => [] },
        self: { pid: 1, execPath: 'C:\\n\\Natively.exe' },
        isMeetingActive: () => false,
        promptsBlocked: () => blocked,
        events: () => null,
        requestStart: (r) => starts.push(r),
        notify: (n) => { notes.push(n); return true; },
        showPanel: (o) => panel.push(o),
        launcherFocused: () => false,
        autoStart: () => true,
        setTimeout: (fn, ms) => { pending.push({ fn, at: t + ms }); return pending.length; },
        clearTimeout: () => {},
        live: { list: () => [], keys: () => [], on: () => {}, off: () => {} },
        now: () => t,
    });
    const tick = (ms) => { t += ms; detector.tick(); };
    tick(0); tick(5000);
    assert.deepEqual([panel.length, notes.length, pending.length], [0, 0, 0], 'Undetectable or a disguise: nothing, no countdown');
    blocked = false;
    // Gone a minute, then a new call.
    const d2 = wireMeetingDetection({
        platform: 'darwin',
        native: { getMicUsers: () => [{ bundleId: 'app.tuple.app' }], getVisibleWindows: () => [] },
        self: { pid: 1, execPath: '/Applications/Natively.app/Contents/MacOS/Natively' },
        isMeetingActive: () => false,
        promptsBlocked: () => false,
        events: () => null,
        requestStart: (r) => starts.push(r),
        notify: (n) => { notes.push(n); return true; },
        showPanel: (o) => panel.push(o),
        launcherFocused: () => true,
        live: { list: () => [], keys: () => [], on: () => {}, off: () => {} },
        now: () => t,
    });
    d2.tick(); t += 5000; d2.tick();
    assert.equal(panel.length, 1);
    assert.equal(panel[0].app, 'Tuple');
    assert.equal(panel[0].autoStartAt, null, 'Start automatically is off unless set');
    assert.equal(notes.length, 0, 'launcher in front');
});

test('calendar reminder lead time: 1, 2 or 5 minutes, 2 when unset or invalid', () => {
    assert.deepEqual([...REMINDER_MINUTE_CHOICES], [1, 2, 5]);
    assert.equal(reminderMinutes(undefined), 2);
    assert.equal(reminderMinutes(5), 5);
    assert.equal(reminderMinutes(1), 1);
    assert.equal(reminderMinutes(3), 2);
    assert.equal(reminderMinutes('5'), 2);
    assert.equal(reminderLeadText(1), '1 minute');
    assert.equal(reminderLeadText(5), '5 minutes');
    // The reminder reads the setting and says the chosen time.
    const src = fs.readFileSync(path.join(REPO, 'electron/services/CalendarManager.ts'), 'utf8');
    assert.match(src, /reminderMinutes\(SettingsManager\.getInstance\(\)\.get\('calendarReminderMinutes'\)\)/);
    assert.match(src, /planReminders\(events, now, leadMinutes, this\.remindedOccurrences\)/);
    assert.doesNotMatch(src, /starts in 2 minutes/);
});

test('the launcher notice shows the event title or "<App> call", and whole seconds left', async () => {
    const { offerHeadline, offerSecondsLeft } = await import(pathToFileURL(path.join(REPO, 'src/lib/meetingOfferView.mjs')).href);
    assert.equal(offerHeadline({ title: 'Weekly sync', app: 'Zoom' }), 'Weekly sync');
    assert.equal(offerHeadline({ title: null, app: 'Zoom' }), 'Zoom call');
    assert.equal(offerHeadline({ title: '  ', app: 'Google Meet' }), 'Google Meet call');
    assert.equal(offerSecondsLeft({ autoStartAt: null }, 0), null);
    assert.equal(offerSecondsLeft({ autoStartAt: 10_000 }, 0), 10);
    assert.equal(offerSecondsLeft({ autoStartAt: 10_000 }, 9_100), 1);
    assert.equal(offerSecondsLeft({ autoStartAt: 10_000 }, 12_000), 0);
    // The notice reuses the update card's corner toast tokens and slide.
    const toast = fs.readFileSync(path.join(REPO, 'src/components/MeetingOfferToast.tsx'), 'utf8');
    assert.match(toast, /from '\.\/UpdateModal'/);
    assert.match(toast, /placement="bottom-right"/);
    assert.match(toast, /startMeetingOffer/);
    assert.match(toast, /dismissMeetingOffer/);
});
