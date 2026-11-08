// Read-only meeting-app signals from the Zoom / Teams window tree (and the Meet
// page through the Companion extension): call facts (meeting ID, head count,
// own name) into calendar matching and the roster; mute sync (the mic channel
// carries silence while the user is muted there); screen-share awareness
// (pictures of someone else's share, described for the notes).
//
// Every tree here is SYNTHETIC, hand-written from the apps' published labels
// and from what other tools look for. Each test that reads a tree runs a macOS
// shaped tree (AX roles) and a Windows shaped one (UIA control types) through
// the same code, and the poller runs with platform 'darwin' and 'win32'. None
// of it replaces a recorded tree from a real call per app and OS.
// Run after `NATIVELY_CORE_SMOKE=1 npm run build:electron`:
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
// (the last test loads MeetingPersistence, whose database module is built for Electron).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const dist = (p) => path.join(REPO, 'dist-electron/electron', p);

const { meetingKeyFromTree, participantCountFromTree, readCallFacts } = require(dist('services/meetingDetection/callFacts.js'));
const { selfMuteFromTree, ZOOM_TILE_AUDIO_PHRASES } = require(dist('services/meetingDetection/callMuteState.js'));
const { muteStateOfControlLabel } = require(dist('services/meetingDetection/muteLabels.js'));
const { screenShareFromTree } = require(dist('services/meetingDetection/callScreenShare.js'));
const { solveCallTree } = require(dist('services/meetingDetection/callTreeSolvers.js'));
const { meetingRefOf, meetingIdRefsIn, providerOfKey } = require(dist('services/meetingDetection/meetingLinks.js'));
const { meetingLinkAndKeys } = require(dist('services/calendar/providers/eventShape.js'));
const { DesktopCallSpeakers, MEETING_KEY_SWITCH_READS, POLL_MS } = require(dist('services/meetingDetection/desktopCallSpeakers.js'));
const { CallRoster } = require(dist('services/meetingDetection/callRoster.js'));
const { nameCallLines } = require(dist('services/meetingDetection/nameCallLines.js'));
const { LiveMeetings } = require(dist('services/meetingDetection/liveMeetings.js'));
const { linkSessionToCalendar, cancelSessionCalendarLink } = require(dist('services/calendar/SessionCalendarLinker.js'));
const { MeetingMuteSync, STALE_MS } = require(dist('services/meeting/MeetingMuteSync.js'));
const { ScreenShareContext, CAPTURE_EVERY_MS, KEEP_EVERY_MS, MAX_FAILURES } = require(dist('services/meeting/ScreenShareContext.js'));
const { changedVisibly, nearDuplicate, lumaOf, GRID_W, GRID_H } = require(dist('services/meeting/screenShareFrames.js'));
const { formatSharedScreensBlock, sharedScreenEntries } = require(dist('services/meeting/screenShareNotes.js'));
const { renderNotesPromptContext } = require(dist('services/meeting/meetingNotesContext.js'));
const { notesContextFromParams } = require(dist('services/meeting/MeetingContextAssembler.js'));
const { meetingPeopleReport, wireExtensionMeetingTabs } = require(dist('services/meetingDetection/extensionMeetingTabs.js'));

// ── Tree builders: the same call, shaped as each OS's accessibility layer shows it ──

const ROLE = {
    darwin: { window: 'AXWindow:AXStandardWindow', group: 'AXGroup', text: 'AXStaticText', button: 'AXButton', link: 'AXLink', tile: 'AXGroup', menu: 'AXMenuItem' },
    win32: { window: 'Window', group: 'Group', text: 'Text', button: 'Button', link: 'Hyperlink', tile: 'ListItem', menu: 'MenuItem' },
};
const node = (depth, role, name = '', extra = {}) => ({ depth, role, name, description: '', value: '', id: '', ...extra });
const tree = (windows) => ({ trusted: true, truncated: false, elapsedMs: 10, windows });
const win = (title, nodes) => ({ title, nodes });
const PLATFORMS = ['darwin', 'win32'];

// ── Call facts ──────────────────────────────────────────────────────────────

for (const os of PLATFORMS) {
    const r = ROLE[os];
    test(`facts (${os}): Zoom's meeting information gives the meeting ID; its count and own name too`, () => {
        const t = tree([win('Zoom Meeting', [
            node(0, r.window, 'Zoom Meeting'),
            node(1, r.group, 'Meeting information'),
            node(2, r.text, 'Meeting ID'),
            node(2, r.text, '812 3456 7890'),
            node(2, r.text, 'Invite link'),
            node(2, r.link, 'https://us02web.zoom.us/j/81234567890?pwd=abc', { url: 'https://us02web.zoom.us/j/81234567890?pwd=abc' }),
            node(1, r.button, 'Participants (4)'),
            node(1, r.tile, 'Priya Nair, Computer audio unmuted'),
            node(1, r.tile, 'Evin John (me), Computer audio muted'),
        ])]);
        assert.equal(meetingKeyFromTree('zoom', t), 'zoom:81234567890');
        assert.equal(participantCountFromTree(t), 4);
        const facts = readCallFacts('zoom', t, solveCallTree('zoom', t));
        assert.equal(facts.selfName, 'Evin John');
        assert.deepEqual(facts.participants, ['Priya Nair']);
    });

    test(`facts (${os}): a Teams join link (by element id) gives the meeting; a link posted in chat never does`, () => {
        const chatOnly = tree([win('Meeting with Priya | Microsoft Teams', [
            node(0, r.window, 'Meeting with Priya | Microsoft Teams'),
            node(1, r.group, 'Chat'),
            node(2, r.link, 'https://teams.microsoft.com/meet/999999999999?p=x', { url: 'https://teams.microsoft.com/meet/999999999999?p=x' }),
            node(2, r.text, 'join this one instead https://teams.microsoft.com/meet/888888888888'),
        ])]);
        assert.equal(meetingKeyFromTree('teams', chatOnly), null, 'chat links are someone else\'s meetings');
        const info = tree([win('Meeting with Priya | Microsoft Teams', [
            node(0, r.window, 'Meeting with Priya | Microsoft Teams'),
            node(1, r.link, 'Join the meeting now', { id: 'meet_invite_block.action.join_link', url: 'https://teams.microsoft.com/meet/241342539466?p=abc' }),
        ])]);
        assert.equal(meetingKeyFromTree('teams', info), 'teams-id:241342539466');
        // A Zoom link in a Teams window is not this call.
        assert.equal(meetingKeyFromTree('zoom', info), null);
    });

    test(`facts (${os}): a Meeting ID pasted in the chat, a chat window or a sentence is never this call`, () => {
        const inChatPane = tree([win('Zoom Meeting', [
            node(0, r.window, 'Zoom Meeting'),
            node(1, r.group, 'Meeting chat'),
            node(2, r.text, 'Meeting ID: 999 8888 7777'),
            node(2, r.text, 'Meeting ID'),
            node(2, r.text, '999 8888 7777'),
            node(1, r.button, 'Participants (3)'),
        ])]);
        assert.equal(meetingKeyFromTree('zoom', inChatPane), null, 'an invite pasted in the chat pane');
        const chatWindow = tree([win('Chat', [
            node(0, r.window, 'Chat'),
            node(1, r.text, 'Meeting ID: 999 8888 7777'),
        ])]);
        assert.equal(meetingKeyFromTree('zoom', chatWindow), null, 'the separate chat window');
        const sentence = tree([win('Zoom Meeting', [
            node(0, r.window, 'Zoom Meeting'),
            node(1, r.text, 'Priya: after this, hop on the other call, Meeting ID: 999 8888 7777, passcode 1234'),
        ])]);
        assert.equal(meetingKeyFromTree('zoom', sentence), null, 'an ID mid-sentence');
        // The call's own information after a chat pane still counts.
        const after = tree([win('Zoom Meeting', [
            node(0, r.window, 'Zoom Meeting'),
            node(1, r.group, 'Meeting chat'),
            node(2, r.text, 'Meeting ID: 999 8888 7777'),
            node(1, r.group, 'Meeting information'),
            node(2, r.text, 'Meeting ID'),
            node(2, r.text, '812 3456 7890'),
        ])]);
        assert.equal(meetingKeyFromTree('zoom', after), 'zoom:81234567890');
    });

    test(`facts (${os}): a Teams "Meeting ID" line, spaced as Teams shows it, and capped or missing counts`, () => {
        const t = tree([win('Microsoft Teams', [
            node(0, r.window, 'Microsoft Teams'),
            node(1, r.text, 'Meeting ID: 241 342 539 466 012'),
            node(1, r.button, '99+ participants'),
        ])]);
        assert.equal(meetingKeyFromTree('teams', t), 'teams-id:241342539466012');
        assert.equal(participantCountFromTree(t), null, 'a capped count is no count');
        assert.equal(meetingKeyFromTree('zoom', t), null, '15 digits is not a Zoom meeting number');
        assert.equal(participantCountFromTree(tree([win('x', [node(0, r.window, 'x'), node(1, r.button, '3 people in this meeting')])])), 3);
        assert.equal(participantCountFromTree(tree([win('x', [node(0, r.window, 'x')])])), null);
        assert.equal(meetingKeyFromTree('zoom', { trusted: false, truncated: false, windows: [] }), null);
    });
}

test('facts: an old Zoom window title carries the meeting ID', () => {
    const t = tree([win('Zoom Meeting ID: 812-3456-7890', [node(0, 'Window', 'Zoom Meeting ID: 812-3456-7890')])]);
    assert.equal(meetingKeyFromTree('zoom', t), 'zoom:81234567890');
});

test('meeting links: Teams numeric IDs are 9 to 20 digits; invite text names Teams meetings by ID', () => {
    assert.equal(meetingRefOf('https://teams.microsoft.com/meet/24134253946601234567?p=a').key, 'teams-id:24134253946601234567');
    assert.equal(meetingRefOf('https://teams.microsoft.com/meet/241342539466012345678'), null, '21 digits');
    assert.equal(providerOfKey('teams-id:24134253946601234567'), 'teams');
    const teamsInvite = 'Microsoft Teams meeting\nJoin: https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0\nMeeting ID: 241 342 539 466\nPasscode: xY12';
    assert.deepEqual(meetingIdRefsIn(teamsInvite).map((r) => r.key), ['teams-id:241342539466']);
    assert.deepEqual(meetingIdRefsIn('Join Zoom Meeting https://zoom.us/j/81234567890\nMeeting ID: 812 3456 7890').map((r) => r.key), ['zoom:81234567890']);
    assert.deepEqual(meetingIdRefsIn('Meeting ID: 241 342 539 466'), [], 'which service is unknown');
    const keys = meetingLinkAndKeys([], [teamsInvite]).meetingKeys;
    assert.ok(keys.includes('teams-id:241342539466') && keys.some((k) => k.startsWith('teams:19:meeting_')), 'the event has both the thread and the ID');
});

// ── The poller hands the facts on, for both OS branches ─────────────────────

function fakeNative(platform, trees) {
    const zoomPath = platform === 'win32' ? 'C:\\Zoom\\bin\\Zoom.exe' : '/Applications/zoom.us.app/Contents/MacOS/zoom.us';
    let i = 0;
    return {
        holding: true,
        getMicUsers() { return this.holding ? [platform === 'win32' ? { path: zoomPath } : { pid: 900, bundleId: 'us.zoom.xos', path: zoomPath }] : []; },
        getVisibleWindows() { return [{ pid: 900, path: zoomPath }]; },
        async readCallTree() { return trees[Math.min(i++, trees.length - 1)]; },
    };
}
const SELF = { pid: 1, execPath: '/self' };
const zoomCall = (os, { id = null, muted = null, count = null, share = null } = {}) => {
    const r = ROLE[os];
    const nodes = [node(0, r.window, 'Zoom Meeting'), node(1, r.tile, 'Priya Nair, Computer audio unmuted')];
    if (muted !== null) nodes.push(node(1, r.tile, `Evin John, Computer audio ${muted ? 'muted' : 'unmuted'}`));
    if (id) nodes.push(node(1, r.text, `Meeting ID: ${id}`));
    if (count) nodes.push(node(1, r.button, `Participants (${count})`));
    if (share === 'other') nodes.push(node(1, r.text, "You are viewing Priya Nair's screen"));
    if (share === 'self') nodes.push(node(1, r.button, 'Stop Share'));
    return tree([win('Zoom Meeting', nodes)]);
};

for (const platform of PLATFORMS) {
    test(`poller (${platform}): each read's facts reach onFacts; the count reaches the roster; release says null`, async () => {
        const roster = new CallRoster();
        let clock = 5_000_000;
        const reports = [];
        const native = fakeNative(platform, [
            zoomCall(platform, { muted: true, count: 2 }),
            zoomCall(platform, { id: '812 3456 7890', muted: false, count: 2, share: 'other' }),
            zoomCall(platform, { muted: null }),
        ]);
        const speakers = new DesktopCallSpeakers({ platform, native, self: SELF, roster, now: () => clock, selfNames: () => ['Evin John'], onFacts: (r) => reports.push(r), log: () => {} });
        for (let i = 0; i < 3; i++) { assert.equal(await speakers.step(), POLL_MS); clock += POLL_MS; }
        assert.deepEqual(reports.map((r) => r.selfMuted), [true, false, null]);
        assert.deepEqual(reports.map((r) => r.meetingKey), [null, 'zoom:81234567890', 'zoom:81234567890'], 'the key holds once seen');
        assert.equal(reports[1].share.state, 'other');
        assert.equal(reports[1].share.sharerName, 'Priya Nair');
        assert.equal(reports[0].rosterKey, 'zoom-app:900');
        assert.equal(reports[0].platform, platform);
        assert.equal(roster.snapshot('zoom-app:900', 0, Infinity).count, 2);
        native.holding = false;
        clock += 5_000;
        await speakers.step();
        assert.equal(reports.at(-1), null, 'the call is gone');
        speakers.stop();
        assert.equal(reports.filter((r) => r === null).length, 1, 'null is said once');
    });

    test(`poller (${platform}): a different meeting key replaces the held one only after ${MEETING_KEY_SWITCH_READS} reads in a row`, async () => {
        let clock = 0;
        const reports = [];
        const script = [zoomCall(platform, { id: '81234567890' }), zoomCall(platform, { id: '99988877766' }), zoomCall(platform, { id: '81234567890' })];
        for (let i = 0; i < MEETING_KEY_SWITCH_READS; i++) script.push(zoomCall(platform, { id: '99988877766' }));
        const speakers = new DesktopCallSpeakers({ platform, native: fakeNative(platform, script), self: SELF, roster: new CallRoster(), now: () => clock, onFacts: (r) => reports.push(r), log: () => {} });
        for (let i = 0; i < script.length; i++) { await speakers.step(); clock += POLL_MS; }
        const keys = reports.map((r) => r.meetingKey);
        assert.deepEqual(keys.slice(0, 3), ['zoom:81234567890', 'zoom:81234567890', 'zoom:81234567890'], 'one stray read changes nothing');
        assert.equal(keys.at(-1), 'zoom:99988877766');
        speakers.stop();
    });
}

test('nameCallLines: a desktop call whose head count never passed two names every other-side line by elimination', () => {
    const roster = new CallRoster();
    roster.report('teams-app:7', [{ name: 'Priya Nair', speaking: false }], 1_000);
    const lines = [{ speaker: 'interviewer', text: 'hello there', timestamp: 2_000 }, { speaker: 'interviewer', text: 'and one more thing', timestamp: 3_000 }];
    const unsure = nameCallLines(lines, 'teams-app:7', 0, 10_000, roster);
    assert.equal(Object.keys(unsure.labels).length, 0, 'no count: the reader may have stopped short');
    roster.noteCount('teams-app:7', 2, 1_500);
    const named = nameCallLines(lines, 'teams-app:7', 0, 10_000, roster);
    assert.deepEqual(named.transcript.map((l) => named.labels[l.speakerId]), ['Priya Nair', 'Priya Nair']);
    const group = new CallRoster();
    group.report('zoom-app:8', [{ name: 'Priya Nair', speaking: false }], 1_000);
    group.noteCount('zoom-app:8', 5, 1_000);
    assert.equal(Object.keys(nameCallLines(lines, 'zoom-app:8', 0, 10_000, group).labels).length, 0, 'five people: not a 1:1');
    const restored = new CallRoster();
    restored.restore('zoom-app:9', { participants: ['Ana'], spans: [], count: 2 }, 0, 10_000);
    assert.equal(restored.snapshot('zoom-app:9', 0, 10_000).count, 2, 'a recovered meeting keeps the count');
    // Same Zoom process: a 1:1 first, then a group call whose count can't be read.
    const sameApp = new CallRoster();
    for (let t = 0; t <= 60_000; t += 500) sameApp.noteCount('zoom-app:10', 2, t);
    sameApp.report('zoom-app:10', [{ name: 'Priya Nair', speaking: false }], 200_000);
    assert.equal(sameApp.snapshot('zoom-app:10', 0, 60_000).count, 2, 'the 1:1 keeps its count');
    assert.equal(sameApp.snapshot('zoom-app:10', 120_000, 300_000).count, undefined, 'the later call never inherits it');
    const later = [{ speaker: 'interviewer', text: 'hello all', timestamp: 210_000 }];
    assert.equal(Object.keys(nameCallLines(later, 'zoom-app:10', 120_000, 300_000, sameApp).labels).length, 0, 'so its lines are not named by elimination');
});

// ── Calendar matching: the window's meeting picks one of overlapping events ──

test('calendar: two overlapping events stay unlinked by time, then the Zoom window\'s meeting ID links the right one', async () => {
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const ev = (id, key) => ({ id, title: id, startTime: iso(now - 60_000), endTime: iso(now + 30 * 60_000), attendees: [{ email: `${id}@x.com` }], meetingKeys: [key] });
    const events = [ev('Pricing review', 'zoom:81234567890'), ev('Hiring sync', 'zoom:55566677788')];
    const calendar = { getConnectionStatus: () => ({ connected: true }), getCachedEvents: () => events, getUpcomingEvents: async () => events };
    const live = new LiveMeetings();
    const metadata = {};
    linkSessionToCalendar(metadata, () => true, calendar, live);
    assert.equal(metadata.calendarEventId, undefined, 'time alone is ambiguous');
    live.set('desktop', [{ key: 'zoom:81234567890', provider: 'zoom', via: 'app', audible: true, seenAt: now, rosterKey: 'zoom-app:900' }]);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(metadata.calendarEventId, 'Pricing review');
    assert.equal(metadata.calendarEvent.linkedBy, 'link');
    assert.equal(metadata.callKey, 'zoom-app:900', 'the names stay on the window reader\'s roster key');
    cancelSessionCalendarLink();
});

// ── Mute ────────────────────────────────────────────────────────────────────

test('mute labels: the control names what pressing it would do; other people\'s controls never count', () => {
    for (const [label, want] of [
        ['Unmute', true], ['Mute', false], ['Unmute my audio', true], ['Mute audio (⌘⇧A)', false], ['Mute (Ctrl+Shift+M)', false],
        ['Turn on microphone', true], ['Turn off microphone (ctrl + d)', false], ['Turn off microphone (⌘ + d)', false],
        ['Mute all', null], ['Ask to unmute', null], ['Mute Priya Nair', null], ['Unmute everyone', null], ['Turn off camera', null], ['', null], [null, null],
    ]) assert.equal(muteStateOfControlLabel(label), want, label);
});

for (const os of PLATFORMS) {
    const r = ROLE[os];
    test(`mute (${os}): Zoom's own tile phrase, in each language Zoom ships, by the user's name or "(me)"`, () => {
        for (const [muted, unmuted] of ZOOM_TILE_AUDIO_PHRASES) {
            const t = tree([win('Zoom Meeting', [node(0, r.window, 'Zoom Meeting'), node(1, r.tile, `Priya Nair, ${unmuted ?? muted}`), node(1, r.tile, `Evin John, ${muted}`)])]);
            assert.deepEqual(selfMuteFromTree('zoom', t, ['Evin John']), { muted: true, via: 'self-tile' }, muted);
            if (unmuted) {
                const live = tree([win('Zoom Meeting', [node(0, r.window, 'Zoom Meeting'), node(1, r.tile, `Evin John, ${unmuted}`)])]);
                assert.equal(selfMuteFromTree('zoom', live, ['Evin John']).muted, false, unmuted);
            }
        }
        const tagged = tree([win('Zoom Meeting', [node(0, r.window, 'Zoom Meeting'), node(1, r.tile, 'Evin (me), Computer audio muted')])]);
        assert.equal(selfMuteFromTree('zoom', tagged, []).muted, true);
        const othersOnly = tree([win('Zoom Meeting', [node(0, r.window, 'Zoom Meeting'), node(1, r.tile, 'Priya Nair, Computer audio muted')])]);
        assert.equal(selfMuteFromTree('zoom', othersOnly, ['Evin John']).muted, null, 'someone else muted says nothing about the user');
    });

    test(`mute (${os}): controls decide when no tile does; disagreement and menus are unknown; Teams' mic button wins`, () => {
        const toolbar = (labels, extra = []) => tree([win('Meeting', [node(0, r.window, 'Meeting'), ...labels.map((l) => node(1, r.button, l)), ...extra])]);
        assert.equal(selfMuteFromTree('teams', toolbar(['Unmute (Ctrl+Shift+M)'])).muted, true);
        assert.equal(selfMuteFromTree('zoom', toolbar(['Mute audio'])).muted, false);
        assert.equal(selfMuteFromTree('zoom', toolbar(['Mute', 'Unmute'])).muted, null, 'a host\'s per-person rows disagree');
        assert.equal(selfMuteFromTree('zoom', tree([win('M', [node(0, r.window, 'M'), node(1, r.menu, 'Unmute')])])).muted, null, 'menus are about someone');
        const teams = toolbar(['Mute', 'Unmute'], [node(1, r.button, 'Unmute', { id: 'microphone-button' })]);
        assert.equal(selfMuteFromTree('teams', teams).muted, true);
        assert.equal(selfMuteFromTree('teams', { trusted: false, truncated: false, windows: [] }).muted, null);
    });
}

test('mute sync: two Meet calls report apart; a muted background call never silences the one the user speaks in', () => {
    let clock = 0;
    const sync = new MeetingMuteSync(() => clock);
    sync.setMeetingActive(true);
    sync.report('meet', true, 'meet:aaa-bbbb-ccc');
    assert.equal(sync.isMuted(), true);
    sync.report('meet', false, 'meet:ddd-eeee-fff');
    sync.report('meet', true, 'meet:aaa-bbbb-ccc'); // the muted tab's next heartbeat
    assert.equal(sync.isMuted(), false, 'the calls disagree: live');
    clock += STALE_MS + 1;
    sync.report('meet', true, 'meet:aaa-bbbb-ccc');
    assert.equal(sync.isMuted(), true, 'the other tab went quiet (closed): only the muted call is left');
    sync.clear('meet', 'meet:aaa-bbbb-ccc');
    assert.equal(sync.isMuted(), false);
});

test('mute sync: unknown, stale, off or outside a meeting is never muted; muted gives silence of the same length', () => {
    let clock = 0;
    const sync = new MeetingMuteSync(() => clock);
    const seen = [];
    sync.onChange((s) => seen.push(s));
    const chunk = Buffer.from([1, 2, 3, 4, 5, 6]);
    sync.report('zoom-app', true);
    assert.equal(sync.isMuted(), false, 'no meeting running');
    sync.setMeetingActive(true);
    sync.report('zoom-app', true);
    assert.equal(sync.isMuted(), true);
    const out = sync.gate(chunk);
    assert.equal(out.length, chunk.length);
    assert.ok(out.every((b) => b === 0));
    assert.deepEqual([...chunk], [1, 2, 3, 4, 5, 6], 'the real chunk is untouched');
    sync.report('zoom-app', null);
    assert.equal(sync.gate(chunk), chunk, 'unknown: the real audio');
    sync.report('zoom-app', true);
    clock += STALE_MS + 1;
    assert.equal(sync.isMuted(), false, 'a stale report counts as unknown');
    sync.report('teams-app', true);
    sync.setEnabled(false);
    assert.equal(sync.isMuted(), false, 'the setting off');
    sync.setEnabled(true);
    assert.equal(sync.isMuted(), true);
    sync.clear('teams-app');
    assert.equal(sync.isMuted(), false);
    sync.report('meet', true);
    sync.report('zoom-app', false);
    assert.equal(sync.isMuted(), false, 'the desktop app holding the mic wins over a Meet tab');
    sync.setMeetingActive(false);
    assert.deepEqual(seen.map((s) => [s.muted, s.app]), [[true, 'zoom-app'], [false, null], [true, 'zoom-app'], [false, null], [true, 'teams-app'], [false, null], [true, 'teams-app'], [false, null], [true, 'meet'], [false, null]]);
});

test('Meet through the extension: the report carries the user\'s mute; malformed is unknown; it reaches the mute sync', () => {
    assert.equal(meetingPeopleReport({ key: 'meet:abc-defg-hij', people: [], selfMuted: true }).selfMuted, true);
    assert.equal(meetingPeopleReport({ key: 'meet:abc-defg-hij', people: [], selfMuted: 'yes' }).selfMuted, null);
    assert.equal(meetingPeopleReport({ key: 'meet:abc-defg-hij', people: [] }).selfMuted, null, 'an older extension');
    let people = null;
    const calls = [];
    const channel = { onMeetingTabs() {}, onMeetingPeople(fn) { people = fn; }, setMeetingTabsWanted() {} };
    wireExtensionMeetingTabs(channel, true, new LiveMeetings(), new CallRoster(), (key, muted) => calls.push([key, muted]));
    people({}, { key: 'meet:abc-defg-hij', people: [{ name: 'Priya', speaking: false }], selfMuted: true });
    people({}, { key: 'zoom:81234567890', people: [], selfMuted: true });
    assert.deepEqual(calls, [['meet:abc-defg-hij', true]], 'only a Meet page speaks for Meet');
});

// ── Screen share ────────────────────────────────────────────────────────────

for (const os of PLATFORMS) {
    const r = ROLE[os];
    test(`share (${os}): someone else's share, the user's own (which always wins), or none`, () => {
        const viewing = tree([win('Zoom Meeting', [node(0, r.window, 'Zoom Meeting'), node(1, r.text, "You are viewing Priya Nair's screen"), node(1, r.button, 'View Options')])]);
        assert.deepEqual(screenShareFromTree('zoom', viewing), { state: 'other', windowTitle: 'Zoom Meeting', sharerName: 'Priya Nair' });
        const teamsViewer = tree([win('Meeting | Microsoft Teams', [node(0, r.window, 'Meeting | Microsoft Teams'), node(1, r.button, 'Zoom in'), node(1, r.button, 'Zoom out'), node(1, r.button, 'Open in new window')])]);
        assert.deepEqual(screenShareFromTree('teams', teamsViewer), { state: 'other', windowTitle: 'Meeting | Microsoft Teams' });
        assert.equal(screenShareFromTree('teams', tree([win('T', [node(0, r.window, 'T'), node(1, r.text, 'Priya Nair is presenting')])])).sharerName, 'Priya Nair');
        const presenting = tree([win('Zoom Meeting', [node(0, r.window, 'Zoom Meeting'), node(1, r.text, "You are viewing Priya Nair's screen")]), win('zoom share toolbar window', [node(0, r.window, '')])]);
        assert.deepEqual(screenShareFromTree('zoom', presenting), { state: 'self' });
        assert.equal(screenShareFromTree('teams', tree([win('T', [node(0, r.window, 'T'), node(1, r.button, 'Stop presenting')])])).state, 'self');
        assert.equal(screenShareFromTree('teams', tree([win('T', [node(0, r.window, 'T'), node(1, r.text, 'You are presenting')])])).state, 'self');
        assert.equal(screenShareFromTree('zoom', tree([win('Z', [node(0, r.window, 'Z'), node(1, r.button, 'x', { id: 'ZMMTToolbarContentIdentifierPauseShare' })])])).state, 'self');
        assert.equal(screenShareFromTree('zoom', zoomCall(os)).state, 'none');
        assert.equal(screenShareFromTree('zoom', null).state, 'none');
    });
}

const fp = (fill, w = 1600, h = 900) => ({ width: w, height: h, luma: typeof fill === 'function' ? Uint8Array.from({ length: GRID_W * GRID_H }, (_, i) => fill(i)) : new Uint8Array(GRID_W * GRID_H).fill(fill) });

test('frames: a new slide changed, a few moving faces did not, a cursor is the same screen', () => {
    const slide = fp((i) => (i % 7) * 30);
    assert.equal(changedVisibly(null, slide), true);
    assert.equal(changedVisibly(slide, fp((i) => ((i + 3) % 7) * 30)), true, 'another slide');
    // A strip of faces beside the share: 60 of 2304 cells, each a little brighter or darker.
    const faces = fp((i) => Math.max(0, (i % 7) * 30 + (i < 60 ? (i % 2 ? 40 : -20) : 0)));
    assert.equal(changedVisibly(slide, faces), false, 'moving faces are not a new screen');
    assert.equal(changedVisibly(slide, fp((i) => (i % 7) * 30, 1200, 900)), true, 'the window was resized');
    assert.equal(nearDuplicate(slide, fp((i) => (i % 7) * 30 + (i === 5 ? 20 : 0))), true);
    assert.equal(nearDuplicate(slide, faces), false);
    // BGRA and RGBA read the same.
    const bgra = Uint8Array.from([10, 200, 30, 255, 0, 0, 0, 255]);
    const rgba = Uint8Array.from([30, 200, 10, 255, 0, 0, 0, 255]);
    assert.deepEqual([...lumaOf(bgra, 2, 1)], [...lumaOf(rgba, 2, 1)]);
});

function shareHarness({ enabled = true, frames, describe } = {}) {
    let clock = 1_000_000;
    const timers = [];
    const removed = [];
    const described = [];
    const published = [];
    let n = 0;
    const ctx = new ScreenShareContext({
        enabled: () => enabled,
        capture: async (title) => {
            const f = frames(n++, title);
            if (!f) return null;
            return { fingerprint: f, save: async () => `/frames/${n}.jpg` };
        },
        describe: describe ?? (async (p, hint) => { described.push([p, hint]); return `slide ${described.length}`; }),
        remove: (p) => removed.push(p),
        onEntries: (e) => published.push(e),
        now: () => clock,
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimeout: () => {},
        log: () => {},
    });
    const share = (state, extra = {}) => ({ app: 'zoom', share: { state, windowTitle: 'Zoom Meeting', sharerName: 'Priya Nair', ...extra }, at: clock });
    return { ctx, timers, removed, described, published, share, advance: (ms) => { clock += ms; }, set enabled(v) { enabled = v; } };
}

test('snapshots: someone else shares: changed or 30 s pictures are described, the same screen just runs longer, files deleted', async () => {
    const slideA = fp((i) => (i % 7) * 30);
    const slideB = fp((i) => ((i + 3) % 7) * 30);
    const seq = [slideA, slideA, slideA, slideA, slideB];
    const h = shareHarness({ frames: (i) => seq[Math.min(i, seq.length - 1)] });
    h.ctx.update(h.share('other'));
    assert.equal(h.timers.length, 1);
    assert.equal(h.timers[0].ms, 0, 'the first picture at once');
    await h.ctx.tick(); // A: new → described
    h.advance(CAPTURE_EVERY_MS); h.ctx.update(h.share('other')); await h.ctx.tick(); // A again, 10 s: skipped
    h.advance(CAPTURE_EVERY_MS); h.ctx.update(h.share('other')); await h.ctx.tick(); // 20 s: skipped
    h.advance(KEEP_EVERY_MS - 2 * CAPTURE_EVERY_MS); h.ctx.update(h.share('other')); await h.ctx.tick(); // 30 s: kept, same screen → extended
    h.advance(CAPTURE_EVERY_MS); h.ctx.update(h.share('other')); await h.ctx.tick(); // B: changed → described
    assert.equal(h.described.length, 2);
    assert.match(h.described[0][1], /Priya Nair shared in a Zoom call/);
    const entries = h.ctx.entries();
    assert.deepEqual(entries.map((e) => e.text), ['slide 1', 'slide 2']);
    assert.equal(entries[0].until - entries[0].at, KEEP_EVERY_MS, 'the 30 s picture extended slide 1');
    assert.equal(entries[0].sharer, 'Priya Nair');
    assert.equal(entries[0].app, 'Zoom');
    assert.equal(h.removed.length, 2, 'every described picture is deleted');
    assert.deepEqual(h.published.at(-1), entries);
});

test('snapshots: a picture that cannot be saved or described counts as a failure, never rejects, and pauses after three', async () => {
    let clock = 1_000_000;
    let saves = 0;
    const timers = [];
    const ctx = new ScreenShareContext({
        enabled: () => true,
        capture: async () => ({ fingerprint: fp((i) => (i * 13 + saves * 41) % 255), save: async () => { saves++; throw new Error('ENOSPC'); } }),
        describe: async () => 'never',
        remove: () => {},
        onEntries: () => {},
        now: () => clock,
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimeout: () => {},
        log: () => {},
    });
    const update = () => ctx.update({ app: 'teams', share: { state: 'other', windowTitle: 'Meeting | Microsoft Teams', sharerName: 'Ana' }, at: clock });
    for (let i = 0; i < 5; i++) {
        update();
        await ctx.tick(); // must resolve, not reject
        clock += KEEP_EVERY_MS;
    }
    assert.equal(saves, MAX_FAILURES, 'paused after three failed saves');
    // The timer path swallows anything that still escapes.
    const fired = timers.at(-1);
    if (fired) await new Promise((resolve) => { fired.fn(); setImmediate(resolve); });

    let calls = 0;
    const describeFails = new ScreenShareContext({
        enabled: () => true,
        capture: async () => ({ fingerprint: fp((i) => (i * 7 + calls * 53) % 255), save: async () => '/f.jpg' }),
        describe: async () => { calls++; throw new Error('model down'); },
        remove: () => {},
        onEntries: () => {},
        now: () => clock,
        setTimeout: () => 1,
        clearTimeout: () => {},
        log: () => {},
    });
    for (let i = 0; i < 5; i++) {
        describeFails.update({ app: 'zoom', share: { state: 'other', windowTitle: 'Zoom Meeting', sharerName: 'Ana' }, at: clock });
        await describeFails.tick();
        clock += KEEP_EVERY_MS;
    }
    assert.equal(calls, MAX_FAILURES, 'a failing model is not called every 10 s all meeting');
});

test('snapshots: the same slide shared next by someone else is a new entry with the new sharer', async () => {
    const slide = fp((i) => (i % 5) * 40);
    const h = shareHarness({ frames: () => slide });
    h.ctx.update(h.share('other'));
    await h.ctx.tick();
    h.advance(KEEP_EVERY_MS);
    h.ctx.update(h.share('other', { sharerName: 'Ana Lima' }));
    await h.ctx.tick();
    const entries = h.ctx.entries();
    assert.deepEqual(entries.map((e) => e.sharer), ['Priya Nair', 'Ana Lima']);
    assert.equal(entries[0].until, entries[0].at, 'the first sharer\'s entry is not stretched over the second');
});

test('snapshots: never while the user presents, never stale, never with the setting off; failures pause until the share changes', async () => {
    const slide = fp(100);
    let presentMidway = null;
    const h = shareHarness({ frames: () => slide, describe: async () => { presentMidway?.(); return 'x'; } });
    h.ctx.update(h.share('self'));
    assert.equal(h.timers.length, 0, 'presenting: no timer');
    await h.ctx.tick();
    assert.equal(h.ctx.entries().length, 0);
    h.ctx.update(h.share('other'));
    h.advance(6_000);
    await h.ctx.tick();
    assert.equal(h.ctx.entries().length, 0, 'a reading older than 5 s is no share');
    h.ctx.update(h.share('other'));
    h.enabled = false;
    await h.ctx.tick();
    assert.equal(h.ctx.entries().length, 0, 'setting off');
    h.enabled = true;
    // The user starts presenting while a picture is being described: it is thrown away.
    presentMidway = () => h.ctx.update(h.share('self'));
    await h.ctx.tick();
    assert.equal(h.ctx.entries().length, 1, 'described before the switch was seen');
    const failing = shareHarness({ frames: () => null });
    failing.ctx.update(failing.share('other'));
    for (let i = 0; i < MAX_FAILURES + 2; i++) await failing.ctx.tick();
    let calls = 0;
    const counting = shareHarness({ frames: () => { calls++; return null; } });
    counting.ctx.update(counting.share('other'));
    for (let i = 0; i < MAX_FAILURES + 2; i++) await counting.ctx.tick();
    assert.equal(calls, MAX_FAILURES, 'paused after three failures in a row');
    counting.ctx.update(counting.share('other', { sharerName: 'Rob Lane' }));
    await counting.ctx.tick();
    assert.equal(calls, MAX_FAILURES + 1, 'a new share tries again');
    counting.ctx.stop();
    counting.ctx.update(counting.share('other', { sharerName: 'Ana' }));
    await counting.ctx.tick();
    assert.equal(calls, MAX_FAILURES + 1, 'stopped for good at the meeting end');
});

test('snapshots: a description started before the user presented is discarded when the picture was taken after', async () => {
    const h = shareHarness({ frames: () => fp(50) });
    h.ctx.update(h.share('other'));
    const realCapture = h.ctx.deps.capture;
    h.ctx.deps.capture = async (t) => { const f = await realCapture(t); h.ctx.update(h.share('self')); return f; };
    await h.ctx.tick();
    assert.equal(h.described.length, 0);
    assert.equal(h.ctx.entries().length, 0);
});

// ── Notes ───────────────────────────────────────────────────────────────────

test('notes: shared screens become their own bounded block with rules; malformed entries are dropped', () => {
    const at = Date.UTC(2026, 9, 15, 10, 30);
    const raw = [
        { at: at + 120_000, until: at + 120_000, app: 'Teams', text: 'Roadmap slide: Q4 launch, 3 milestones' },
        { at, until: at + 90_000, app: 'Zoom', sharer: 'Priya Nair', text: 'Pricing table: Basic $10, Pro $25' },
        { at: 'x', text: 'bad' },
        null,
    ];
    assert.equal(sharedScreenEntries(raw).length, 2);
    const block = formatSharedScreensBlock(raw, { timeZone: 'UTC' });
    assert.match(block, /^SHARED SCREENS/);
    assert.match(block, /- 10:30–10:31, Priya Nair's screen in Zoom: Pricing table/);
    assert.match(block, /- 10:32, a shared screen in Teams: Roadmap slide/);
    assert.equal(formatSharedScreensBlock([]), '');
    const many = Array.from({ length: 60 }, (_, i) => ({ at: at + i * 30_000, until: at + i * 30_000, app: 'Zoom', text: 'w '.repeat(500) }));
    assert.ok(formatSharedScreensBlock(many).length <= 6_500);
    const ctx = notesContextFromParams({ sharedScreensBlock: block });
    const rendered = renderNotesPromptContext(ctx);
    assert.match(rendered, /SHARED SCREENS[\s\S]*HOW TO USE SHARED SCREENS/);
    assert.equal(renderNotesPromptContext(notesContextFromParams({})), '', 'nothing shared: prompts unchanged');
});

test('recovery: the app\'s own name and the shared screens survive a quit', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-app-signals-'));
    const stub = {
        app: { getPath: () => tmp, isPackaged: false, isReady: () => true, getVersion: () => '0.0.0', on: () => {}, whenReady: () => Promise.resolve() },
        BrowserWindow: { getAllWindows: () => [] }, safeStorage: { isEncryptionAvailable: () => false },
        shell: {}, ipcMain: { handle: () => {}, on: () => {} }, Notification: class { static isSupported() { return false; } on() {} show() {} },
    };
    const load = Module._load;
    Module._load = function (request, parent, isMain) { return request === 'electron' ? stub : load.call(this, request, parent, isMain); };
    let recoveryMetadataFor;
    try { ({ recoveryMetadataFor } = require(dist('MeetingPersistence.js'))); } finally { Module._load = load; }
    const { metadata } = recoveryMetadataFor({}, { startTime: 0, durationMs: 1, callSelfName: 'Evin John', sharedScreens: [{ at: 1, until: 1, app: 'Zoom', text: 'x' }] });
    assert.equal(metadata.callSelfName, 'Evin John');
    assert.equal(metadata.sharedScreens.length, 1);
});

// ── Wiring in main (source checks: main.ts can't run outside Electron) ─────

test('main wiring: the mic chunk goes through the mute gate on its way to speech; snapshots stay off under Undetectable', () => {
    const main = fs.readFileSync(path.join(REPO, 'electron/main.ts'), 'utf8');
    // The notepad's Pause (2026-10-20) wraps the same silence around it.
    assert.match(main, /const heard = this\.transcriptionPause\.gate\(meetingMuteSync\.gate\(chunk\)\);[\s\S]{0,200}this\.googleSTT_User\?\.write\(heard\);/);
    assert.match(main, /this\.sttGap\.onAudio\('mic', heard, gapRate\)/);
    assert.match(main, /get\('screenShareSnapshots'\) === true && !nativePromptsBlocked\(\(\) => this\.isUndetectable\)/);
    assert.match(main, /this\.stopDesktopCallSpeakers\(\);/, 'the meeting end stops the reader, the snapshots and the mute');
    assert.doesNotMatch(main, /desktopCallSpeakers[\s\S]{0,200}isIntelligenceFlagEnabled\('speakerLabelsV1'\)\) return;/, 'mute and snapshots do not depend on Speaker labels');
});
