// Back to the notepad, and Resume (2026-11-02). A meeting taken in the notepad
// could not be reopened in it after Stop; and no meeting could be continued.
//
//   - each meeting stores what it was taken on (meetings.meeting_surface)
//   - Resume continues the SAME meeting: one row, the lines appended, the
//     original start kept, both running times added, the title, calendar link
//     and the user's notes kept, the old notes kept as an earlier version
//   - a crash mid-resume recovers the whole meeting (both parts)
//   - where Resume shows: overlay meetings on the meeting page, notepad
//     meetings only in the notepad; older meetings count as overlay
//   - the notepad opens on a saved meeting (LiveNotesSession.openSaved)
//   - the start request's audio devices, macOS and Windows branches
//   - Resume does not wait for the first notes: the pass writing them stops
//     before it saves, and the resumed Stop writes them (or recovery, when the
//     resume saved nothing); older short notes are kept as a version too
//
// Run under the electron runner (better-sqlite3's ABI):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test <this file>
// Paths go through node:path / os.tmpdir(); the audio request's platform is
// passed in, so both branches run on either OS.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => path.join(REPO, 'dist-electron/electron', p);
const resume = require(dist('services/meeting/meetingResume.js'));
const { LiveNotesSession } = require(dist('services/meeting/liveNotesSession.js'));
const { planMeetingStart } = require(dist('utils/meetingSurface.js'));
const { isArchivableEarlierNotes, isArchivableNotes } = require(dist('services/meeting/notesVersions.js'));

describe('where Resume lives (pure)', () => {
    test('a notepad meeting resumes in the notepad; an overlay meeting on its page', () => {
        assert.equal(resume.resumeSpot('notepad'), 'notepad');
        assert.equal(resume.resumeSpot('overlay'), 'page');
    });
    test('older meetings (no stored surface) count as overlay meetings', () => {
        for (const v of [undefined, null, '', 'something-else', 42]) {
            assert.equal(resume.savedMeetingSurface(v), 'overlay');
            assert.equal(resume.resumeSpot(v), 'page');
        }
    });
    test('a resume opens what the meeting was taken on (planMeetingStart with the saved surface)', () => {
        assert.deepEqual(planMeetingStart(resume.savedMeetingSurface('notepad'), false), { overlayHidden: true, openNotes: true });
        assert.deepEqual(planMeetingStart(resume.savedMeetingSurface(undefined), false), { overlayHidden: false, openNotes: false });
    });
});

describe('when Resume waits (pure)', () => {
    test('a running meeting blocks Resume and opening the notepad', () => {
        assert.equal(resume.resumeBlockReason({ exists: true, meetingActive: true }), 'meeting-running');
        assert.equal(resume.openInNotepadBlockReason({ exists: true, meetingActive: true }), 'meeting-running');
    });
    test('notes still being written do not hold Resume back (Granola resumes at once)', () => {
        assert.equal(resume.resumeBlockReason({ exists: true, meetingActive: false }), null);
        assert.equal(resume.openInNotepadBlockReason({ exists: true, meetingActive: false }), null);
    });
    test('a meeting that is gone', () => {
        assert.equal(resume.resumeBlockReason({ exists: false, meetingActive: false }), 'not-found');
        assert.equal(resume.openInNotepadBlockReason({ exists: false, meetingActive: false }), 'not-found');
    });
});

describe('the merged meeting (pure)', () => {
    test('saved lines first, then the new; the original start; both running times, not the gap', () => {
        const base = { transcript: [{ text: 'a', timestamp: 100 }, { text: 'b', timestamp: 200 }], usage: [{ q: 1, timestamp: 150 }], startTime: 50, durationMs: 60_000 };
        const live = { transcript: [{ text: 'c', timestamp: 9_000 }], usage: [{ q: 2, timestamp: 9_100 }], durationMs: 30_000 };
        const m = resume.mergeResumedMeeting(base, live);
        assert.deepEqual(m.transcript.map((s) => s.text), ['a', 'b', 'c']);
        assert.deepEqual(m.usage.map((u) => u.q), [1, 2]);
        assert.equal(m.startTime, 50);
        assert.equal(m.durationMs, 90_000);
    });
    test('lines with equal timestamps keep their order', () => {
        const m = resume.mergeResumedMeeting({ transcript: [{ text: 'a', timestamp: 5 }, { text: 'b', timestamp: 5 }], usage: [], startTime: 1, durationMs: 0 }, { transcript: [{ text: 'c', timestamp: 5 }], usage: [], durationMs: 0 });
        assert.deepEqual(m.transcript.map((s) => s.text), ['a', 'b', 'c']);
    });
    test('the title is kept unless it is a placeholder; the calendar link is kept', () => {
        const base = { meetingId: 'm', transcript: [], usage: [], startTime: 1, durationMs: 1, surface: 'overlay', title: 'Q4 launch sync', calendarEventId: 'ev1', calendarEvent: { id: 'ev1', title: 'Q4' }, source: 'calendar' };
        assert.deepEqual(resume.resumeMetadata(base, () => false), { title: 'Q4 launch sync', calendarEventId: 'ev1', calendarEvent: { id: 'ev1', title: 'Q4' }, source: 'calendar' });
        assert.equal(resume.resumeMetadata({ ...base, title: 'Processing...' }, (t) => t === 'Processing...').title, undefined);
        assert.equal(resume.resumeMetadata({ ...base, calendarEvent: { id: 'other' } }, () => false).calendarEvent, undefined, 'a stale event snapshot is not passed');
    });
    test('resumeBaseFrom: no meeting, no base; bad timing falls back safely', () => {
        assert.equal(resume.resumeBaseFrom(null, null), null);
        const b = resume.resumeBaseFrom({ id: 'x', title: '  T ', surface: 'notepad', userNotes: ' ' }, { startTime: NaN, durationMs: -5 });
        assert.equal(b.meetingId, 'x');
        assert.equal(b.title, 'T');
        assert.equal(b.surface, 'notepad');
        assert.equal(b.durationMs, 0);
        assert.ok(b.startTime > 0);
        assert.equal(b.userNotes, undefined, 'blank notes are not notes');
    });
});

describe('what the saved notes carry into the resumed notes (pure)', () => {
    const screen = (at, text) => ({ at, until: at, app: 'Zoom', text });
    test('names (the saved ones win), people, screens and a follow-up draft are kept', () => {
        const carry = resume.resumeCarryFrom({
            speakerLabels: { speaker_1: 'Priya', me: 'Evin', blank: '  ' },
            callParticipants: ['Priya', 'Sam'],
            sharedScreens: [screen(10, 'Roadmap slide')],
            followUpDraft: { subject: 'Next steps' },
        });
        assert.deepEqual(carry.speakerLabels, { speaker_1: 'Priya', me: 'Evin' });
        const out = resume.applyResumeCarry({ overview: 'x', speakerLabels: { speaker_1: 'Speaker 1', speaker_2: 'Lars' }, callParticipants: ['Sam', 'Lars'], sharedScreens: [screen(20, 'Pricing table')] }, carry);
        assert.deepEqual(out.speakerLabels, { speaker_1: 'Priya', speaker_2: 'Lars', me: 'Evin' }, 'a rename the user made wins');
        assert.deepEqual(out.callParticipants, ['Priya', 'Sam', 'Lars']);
        assert.deepEqual(out.sharedScreens.map((e) => e.text), ['Roadmap slide', 'Pricing table']);
        assert.deepEqual(out.followUpDraft, { subject: 'Next steps' });
        assert.deepEqual(resume.applyResumeCarry({ followUpDraft: 'new' }, carry).followUpDraft, 'new', 'a draft the new notes wrote stands');
    });
    test('a row still waiting for its notes: the screens Stop saved, and an earlier resume\'s carry', () => {
        const carry = resume.resumeCarryFrom({ actionItems: [], keyPoints: [] }, { sharedScreens: [screen(5, 'Demo')], resumeCarry: { speakerLabels: { speaker_1: 'Priya' } } });
        assert.deepEqual(carry.speakerLabels, { speaker_1: 'Priya' });
        assert.deepEqual(carry.sharedScreens.map((e) => e.text), ['Demo']);
        assert.deepEqual(resume.resumedSharedScreens(carry, [screen(5, 'Demo'), screen(9, 'Later')]).map((e) => e.text), ['Demo', 'Later'], 'each screen once');
    });
    test('nothing to carry: nothing changes', () => {
        assert.equal(resume.resumeCarryFrom({ actionItems: [], keyPoints: [] }, null), undefined);
        const summary = { overview: 'x' };
        assert.equal(resume.applyResumeCarry(summary, undefined), summary);
    });
    test('pending statuses', () => {
        for (const s of ['queued', 'chunking', 'summarizing_chunks', 'reducing', 'validating']) assert.equal(resume.isNotesPendingStatus(s), true, s);
        for (const s of ['completed', 'failed', null, undefined, 3]) assert.equal(resume.isNotesPendingStatus(s), false, String(s));
    });
});

describe('Resume is never folded into another start (MeetingLifecycleQueue.hasPendingStart)', () => {
    const { MeetingLifecycleQueue } = require(dist('audio/meetingLifecycleQueue.js'));
    test('a start queued or under way is pending; once it is done, or a stop follows, it is not', async () => {
        const q = new MeetingLifecycleQueue();
        assert.equal(q.hasPendingStart(), false);
        let release;
        const started = q.start(() => new Promise((r) => { release = r; }));
        assert.equal(q.hasPendingStart(), true);
        await new Promise((r) => setTimeout(r, 0));
        release();
        await started;
        assert.equal(q.hasPendingStart(), false, 'running, not pending: the active meeting blocks Resume itself');
        const stopped = q.stop(async () => {});
        assert.equal(q.hasPendingStart(), false);
        await stopped;
    });
});

describe('the resumed part numbers its new people past the saved part (pure)', () => {
    const part = { startTime: 1000, durationMs: 500 };
    test('the ids the saved part uses: call ids, kept names, numbered room voices; not the resumed part\'s', () => {
        const used = resume.savedPartSpeakerIds([
            { speaker: 'Speaker 1', speakerId: 'speaker_1', timestamp: 10 },
            { speaker: 'Speaker 3', timestamp: 20 },
            { speaker: 'user', timestamp: 30 },
            { speaker: 'Speaker 7', speakerId: 'speaker_7', timestamp: 1200 },
        ], part, { speaker_4: 'Lars' });
        assert.deepEqual([...used].sort(), ['speaker_1', 'speaker_3', 'speaker_4']);
        assert.equal(resume.isSavedPartLine({ timestamp: 999 }, part), true);
        assert.equal(resume.isSavedPartLine({ timestamp: 1000 }, part), false);
        assert.equal(resume.isSavedPartLine({ timestamp: 999 }, null), false, 'not a resume: no saved part');
        assert.equal(resume.isResumePart(part), true);
        assert.equal(resume.isResumePart({ startTime: 0, durationMs: 1 }), false);
    });
    test('call names: a person the saved part named keeps their id (and rename); a new person gets a free id', () => {
        const full = [
            { speaker: 'interviewer', speakerId: 'speaker_2', timestamp: 10 },
            { speaker: 'interviewer', timestamp: 1100 },
            { speaker: 'interviewer', timestamp: 1200 },
            // A provider voice id that is no name here, but equals the id Sam moves to.
            { speaker: 'interviewer', speakerId: 'speaker_5', timestamp: 1300 },
        ];
        const named = {
            // nameCallLines over the resumed lines numbers from scratch.
            transcript: [{ ...full[1], speakerId: 'speaker_2' }, { ...full[2], speakerId: 'speaker_3' }, full[3]],
            labels: { speaker_2: 'Sam', speaker_3: 'Priya' },
            confidence: { speaker_2: 0.9, speaker_3: 0.8 },
            participants: ['Sam', 'Priya'],
        };
        const out = resume.fitResumedCallNames(full, [1, 2, 3], named, new Set(['speaker_2']), { speaker_2: 'Priya (PM)', speaker_5: 'sam' });
        assert.deepEqual(out.transcript.map((l) => l.speakerId), ['speaker_2', 'speaker_5', 'speaker_3', undefined], 'Sam = saved speaker_5; Priya new → speaker_3 (free); a bare provider id clashing with a name is dropped');
        assert.deepEqual(out.labels, { speaker_5: 'Sam', speaker_3: 'Priya' });
        assert.deepEqual(out.confidence, { speaker_5: 0.9, speaker_3: 0.8 });
        assert.equal(out.transcript[0], full[0], 'the saved line is untouched');
    });
});

describe('which earlier notes are kept as a version (pure)', () => {
    test('a resume keeps V3 notes and the older short notes; Regenerate stays V3-only', () => {
        const older = { overview: 'Launch moves to Nov 18.', keyPoints: ['Billing fix first'], actionItems: [] };
        assert.equal(isArchivableEarlierNotes(older), true);
        assert.equal(isArchivableNotes(older), false, 'Regenerate keeps its rule');
        assert.equal(isArchivableEarlierNotes({ actionItems: [{ text: 'Send deck' }], keyPoints: [] }), true);
        assert.equal(isArchivableEarlierNotes({ schemaVersion: 3, tldr: ['x'], sectionsV3: [] }), true);
    });
    test('the placeholder, failed notes and blanks are never kept', () => {
        for (const d of [null, undefined, 'text', { actionItems: [], keyPoints: [] }, { overview: '  ', keyPoints: ['', '  '] }, { schemaVersion: 3, tldr: [], sectionsV3: [] }]) {
            assert.equal(isArchivableEarlierNotes(d), false, JSON.stringify(d));
        }
    });
});

describe('the notepad on a saved meeting (LiveNotesSession)', () => {
    const make = () => {
        const sent = [];
        const live = [];
        const saved = [];
        const s = new LiveNotesSession({
            setLive: (t) => live.push(t),
            saveEnded: (id, t) => saved.push([id, t]),
            broadcast: (st) => sent.push(st),
            setTimeout: () => 1, clearTimeout: () => {},
        });
        return { s, sent, live, saved };
    };
    test('opens a saved meeting with its notes; refused while a meeting runs', () => {
        const { s, sent } = make();
        assert.equal(s.openSaved('m1', '- my note'), true);
        assert.deepEqual(sent.at(-1), { phase: 'ended', meetingId: 'm1', text: '- my note' });
        s.meetingStarted();
        assert.equal(s.openSaved('m2', 'x'), false, 'the window belongs to the running meeting');
        assert.equal(s.getState().phase, 'live');
    });
    test('an edit to the previous page reaches its saved copy before another meeting opens', () => {
        const { s, saved } = make();
        s.openSaved('m1', 'a');
        s.setText('a, edited');
        s.openSaved('m2', 'b');
        assert.deepEqual(saved, [['m1', 'a, edited']]);
        assert.equal(s.getState().meetingId, 'm2');
    });
    test('a draft typed for the next meeting comes back after a saved meeting was opened over it', () => {
        const { s, sent, live } = make();
        s.setText('agenda for next call');
        s.openSaved('m1', 'old notes');
        s.meetingStarted();
        assert.equal(s.getState().text, 'agenda for next call');
        assert.equal(live.at(-1), 'agenda for next call');
        assert.equal(sent.at(-1).text, 'agenda for next call');
    });
    test('a draft typed for the next meeting survives a Resume and comes back for that meeting', () => {
        const { s } = make();
        s.setText('agenda for Thursday');
        assert.equal(s.meetingStarted({ meetingId: 'm1', text: 'm1 notes' }), 'm1 notes', 'the resumed meeting\'s notes on the page');
        s.meetingEnded('m1', 'm1 notes + more');
        assert.equal(s.meetingStarted(), 'agenda for Thursday');
    });
    test('after a Stop the next meeting still starts with an empty page (unchanged)', () => {
        const { s, sent } = make();
        s.meetingStarted();
        s.setText('notes of meeting 1');
        s.meetingEnded('m1', 'notes of meeting 1');
        s.meetingStarted();
        assert.equal(s.getState().text, '');
        assert.deepEqual(sent.at(-1), { phase: 'live', meetingId: null, text: '' });
    });
    test('Resume keeps the meeting\'s notes: the page\'s own when it shows that meeting, else the saved ones', () => {
        const a = make();
        a.s.openSaved('m1', 'saved');
        a.s.setText('saved + edit not written yet');
        assert.equal(a.s.meetingStarted({ meetingId: 'm1', text: 'saved' }), 'saved + edit not written yet');
        assert.equal(a.live.at(-1), 'saved + edit not written yet');
        const b = make();
        assert.equal(b.s.meetingStarted({ meetingId: 'm9', text: 'from the row' }), 'from the row');
        assert.deepEqual(b.sent.at(-1), { phase: 'live', meetingId: null, text: 'from the row' });
    });
});

describe('the start request\'s audio devices, both platforms', async () => {
    const { meetingAudioRequest } = await import(pathToFileURL(path.join(REPO, 'src/lib/meetingAudioRequest.mjs')).href);
    const { isInternalCaptureDevice } = await import(pathToFileURL(path.join(REPO, 'electron/audio/audioDeviceSelection.mjs')).href);
    const base = { savedInput: 'mic-1', savedOutput: 'spk-1', experimentalSck: false, isInternal: isInternalCaptureDevice };
    test('macOS: CoreAudio by default, ScreenCaptureKit only with the experimental switch', () => {
        assert.deepEqual(meetingAudioRequest({ ...base, isMac: true }), { inputDeviceId: 'mic-1', outputDeviceId: 'spk-1', discardSavedInput: false, backend: 'coreaudio' });
        assert.equal(meetingAudioRequest({ ...base, isMac: true, experimentalSck: true }).outputDeviceId, 'sck');
    });
    test('Windows: a synced SCK switch never reaches WASAPI as a device id', () => {
        const r = meetingAudioRequest({ ...base, isMac: false, experimentalSck: true });
        assert.equal(r.outputDeviceId, 'spk-1');
        assert.equal(r.backend, 'default');
    });
    test('both: Natively\'s own tap aggregate saved as a microphone is dropped', () => {
        for (const isMac of [true, false]) {
            const r = meetingAudioRequest({ ...base, savedInput: 'NativelySystemAudioTap', isMac });
            assert.equal(r.inputDeviceId, null);
            assert.equal(r.discardSavedInput, true);
        }
        assert.equal(meetingAudioRequest({ ...base, savedInput: null, savedOutput: null, isMac: false }).inputDeviceId, null);
    });
});

describe('resuming a saved meeting (database)', () => {
    let tmpDir;
    let MeetingPersistence;
    let DatabaseManager;
    let Database;
    const originalLoad = Module._load;

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-resume-'));
        process.env.NATIVELY_TEST_USERDATA = tmpDir;
        process.env.NATIVELY_MEETING_SUMMARY_V3 = 'false';
        process.env.NATIVELY_MEETING_MODE_AUTODETECT = 'false';
        const electronStub = {
            app: { getPath: () => tmpDir, isPackaged: false, isReady: () => true, getVersion: () => '0.0.0', on: () => {}, once: () => {}, whenReady: () => Promise.resolve() },
            BrowserWindow: { getAllWindows: () => [] },
            safeStorage: { isEncryptionAvailable: () => false },
            shell: {}, ipcMain: { handle: () => {}, on: () => {} },
            Notification: class { static isSupported() { return false; } on() {} show() {} },
        };
        Module._load = function (request, parent, isMain) {
            if (request === 'electron') return electronStub;
            return originalLoad.call(this, request, parent, isMain);
        };
        ({ MeetingPersistence } = require(dist('MeetingPersistence.js')));
        ({ DatabaseManager } = require(dist('db/DatabaseManager.js')));
        Database = require('better-sqlite3');
    });
    after(() => {
        Module._load = originalLoad;
        delete process.env.NATIVELY_MEETING_SUMMARY_V3;
        delete process.env.NATIVELY_MEETING_MODE_AUTODETECT;
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    const llm = () => new Proxy({
        generateMeetingSummary: async () => JSON.stringify({ overview: 'Launch moves to Nov 18.', keyPoints: ['Billing fix first'], actionItems: ['Draft release notes'] }),
    }, { get: (o, k) => (k in o ? o[k] : async () => '') });
    const lines = (start, words) => words.map((text, i) => ({ speaker: i % 2 ? 'interviewer' : 'user', text, timestamp: start + 1000 * (i + 1), origin: 'stt', final: true }));
    const fakeSession = (startedAt, transcript, metadata) => {
        let ls = [...transcript];
        let meta = metadata;
        let start = startedAt;
        return {
            flushInterimTranscript() {},
            getSessionStartTime: () => start,
            markMeetingStart: (at) => { start = at; },
            getMeetingMetadata: () => meta,
            getPersistableTranscript: () => ls,
            getPersistableUsage: () => [],
            getFullSessionContext: () => '',
            reset() { ls = []; meta = null; },
            // Test-only: the running session's new lines.
            push(l) { ls.push(l); },
        };
    };
    const readDb = (fn) => {
        const db = new Database(path.join(tmpDir, 'natively.db'), { readonly: true });
        try { return fn(db); } finally { db.close(); }
    };
    const waitFor = async (pred, ms = 4000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { if (pred()) return true; await new Promise((r) => setTimeout(r, 25)); }
        return pred();
    };
    const processed = (id) => readDb((d) => d.prepare('SELECT is_processed FROM meetings WHERE id = ?').get(id)?.is_processed) === 1;
    const v3Notes = (point) => ({ schemaVersion: 3, tldr: [point], sectionsV3: [], mode: { selectedModeName: 'General', selectedTemplateType: 'general' } });

    /** A notepad meeting, stopped and processed: returns its id and start. */
    const savedNotepadMeeting = async (title) => {
        const start = Date.now() - 600_000;
        const mp = new MeetingPersistence(fakeSession(start, lines(start, ['Can we hold the launch?', 'Yes, to the 18th.', 'Billing fix first.', 'Agreed.']), { title }), llm());
        const id = mp.beginLiveMeeting(start, { surface: 'notepad' });
        mp.setLiveUserNotes('- launch date?');
        const r = await mp.stopMeeting();
        assert.equal(r.meetingId, id);
        assert.ok(await waitFor(() => processed(id)));
        return { id, start };
    };

    test('Stop stores what the meeting was taken on; the meeting page reads it', async () => {
        const { id } = await savedNotepadMeeting('Q4 launch sync');
        assert.equal(readDb((d) => d.prepare('SELECT meeting_surface FROM meetings WHERE id = ?').get(id).meeting_surface), 'notepad');
        assert.equal(DatabaseManager.getInstance().getMeetingDetails(id).surface, 'notepad');
    });

    test('an older meeting has no surface: Resume lives on its page', () => {
        const db = DatabaseManager.getInstance();
        db.saveMeeting({ id: 'legacy-1', title: 'Old', date: new Date().toISOString(), duration: '1:00', summary: '', detailedSummary: { actionItems: [], keyPoints: [] }, transcript: [], usage: [], isProcessed: true }, Date.now() - 60_000, 60_000);
        const d = db.getMeetingDetails('legacy-1');
        assert.equal(d.surface, undefined);
        assert.equal(resume.resumeSpot(d.surface), 'page');
    });

    test('Resume continues the same meeting: one row, lines appended, start kept, times added, notes kept, old notes a version', async () => {
        const { id, start } = await savedNotepadMeeting('Q4 launch sync');
        const db = DatabaseManager.getInstance();
        // The notes as V3 (only V3 notes are kept as versions).
        db.replaceDetailedSummary(id, v3Notes('Launch moves to Nov 18.'));
        const before = db.getMeetingTiming(id);
        const countBefore = readDb((d) => d.prepare('SELECT COUNT(*) AS n FROM meetings').get().n);

        const resumeAt = Date.now() - 20_000;
        const session = fakeSession(resumeAt, [], null);
        const mp = new MeetingPersistence(session, llm());
        const base = mp.loadResumeBase(id);
        assert.equal(base.surface, 'notepad');
        assert.equal(base.userNotes, '- launch date?');
        assert.equal(mp.beginLiveMeeting(resumeAt, { resume: base }), id, 'the same id');
        assert.equal(mp.resumedMeetingId, id);
        assert.equal(mp.getLiveUserNotes(), '- launch date?', 'the meeting\'s notes are the running notes');
        mp.setLiveUserNotes('- launch date?\n- demo video owner');
        for (const l of lines(resumeAt, ['One more thing: the demo video.', 'Priya owns it.'])) session.push(l);

        const r = await mp.stopMeeting();
        assert.equal(r.meetingId, id);
        assert.ok(await waitFor(() => processed(id)));
        assert.equal(readDb((d) => d.prepare('SELECT COUNT(*) AS n FROM meetings').get().n), countBefore, 'no second meeting');
        const after = db.getMeetingDetails(id);
        assert.deepEqual(after.transcript.map((t) => t.text), ['Can we hold the launch?', 'Yes, to the 18th.', 'Billing fix first.', 'Agreed.', 'One more thing: the demo video.', 'Priya owns it.']);
        const timing = db.getMeetingTiming(id);
        assert.equal(timing.startTime, start, 'the original start');
        assert.ok(timing.durationMs >= before.durationMs + 19_000 && timing.durationMs < before.durationMs + 60_000, `both running times, not the gap (${timing.durationMs})`);
        assert.equal(after.title, 'Q4 launch sync', 'the title is kept');
        assert.equal(after.userNotes, '- launch date?\n- demo video owner');
        assert.equal(after.surface, 'notepad');
        const versions = db.getNotesVersions(id);
        assert.equal(versions.length, 1, 'the earlier notes are kept as a version');
        assert.deepEqual(versions[0].detailedSummary.tldr, ['Launch moves to Nov 18.']);
        assert.equal(mp.resumedMeetingId, null, 'the next meeting starts new');
    });

    test('a resume stopped within a second leaves the saved meeting as it was', async () => {
        const { id } = await savedNotepadMeeting('Short resume');
        const db = DatabaseManager.getInstance();
        const before = db.getMeetingDetails(id);
        const mp = new MeetingPersistence(fakeSession(Date.now(), [], null), llm());
        mp.beginLiveMeeting(Date.now(), { resume: mp.loadResumeBase(id) });
        const r = await mp.stopMeeting();
        assert.equal(r.meetingId, id, 'the page still shows that meeting');
        assert.equal(r.memoryEligibleCount, 0, 'nothing to index again');
        const after = db.getMeetingDetails(id);
        assert.equal(after.transcript.length, before.transcript.length);
        assert.equal(after.summaryStatus, before.summaryStatus);
    });

    test('a crash mid-resume recovers the whole meeting, under its id, with its start', async () => {
        const { id, start } = await savedNotepadMeeting('Crash resume');
        const db = DatabaseManager.getInstance();
        const prior = db.getMeetingTiming(id).durationMs;
        const resumeAt = Date.now() - 15_000;
        const session = fakeSession(resumeAt, [], null);
        const crashing = new MeetingPersistence(session, llm());
        crashing.beginLiveMeeting(resumeAt, { resume: crashing.loadResumeBase(id) });
        for (const l of lines(resumeAt, ['After the break: pricing.', 'Forty per seat.'])) session.push(l);
        crashing.noteLiveChange(true);
        assert.equal(crashing.flushLiveMeeting('quit'), true);
        const live = readDb((d) => d.prepare('SELECT transcript_json, meta_json FROM live_meeting_journal WHERE id = ?').get(id));
        assert.equal(JSON.parse(live.transcript_json).length, 6, 'the live copy holds both parts');
        assert.equal(JSON.parse(live.meta_json).resumed.startTime, start);

        // Next launch.
        await new MeetingPersistence(fakeSession(Date.now(), [], null), llm()).recoverUnprocessedMeetings();
        assert.ok(await waitFor(() => processed(id)));
        const after = db.getMeetingDetails(id);
        assert.equal(after.transcript.length, 6);
        assert.equal(after.transcript.at(-1).text, 'Forty per seat.');
        const timing = db.getMeetingTiming(id);
        assert.equal(timing.startTime, start);
        assert.ok(timing.durationMs >= prior + 14_000, 'the earlier running time is kept');
        assert.equal(after.title, 'Crash resume');
        assert.equal(readDb((d) => d.prepare('SELECT COUNT(*) AS n FROM live_meeting_journal WHERE id = ?').get(id).n), 0);
    });

    test('older short notes are kept as a version when a resumed meeting is rewritten', async () => {
        const { id } = await savedNotepadMeeting('Older notes');
        const db = DatabaseManager.getInstance();
        const before = db.getMeetingDetails(id).detailedSummary;
        assert.notEqual(before.schemaVersion, 3, 'this run wrote the older format');
        assert.ok(before.overview || before.keyPoints?.length, 'and something is in it');
        const resumeAt = Date.now() - 10_000;
        const session = fakeSession(resumeAt, [], null);
        const mp = new MeetingPersistence(session, llm());
        mp.beginLiveMeeting(resumeAt, { resume: mp.loadResumeBase(id) });
        for (const l of lines(resumeAt, ['Back again.', 'One more point.'])) session.push(l);
        await mp.stopMeeting();
        assert.ok(await waitFor(() => processed(id)));
        const versions = db.getNotesVersions(id);
        assert.equal(versions.length, 1);
        assert.equal(versions[0].detailedSummary.overview, before.overview);
    });

    // An LLM whose calls wait until release(); after that every call answers at once.
    const gatedLlm = () => {
        let release;
        const gate = new Promise((r) => { release = r; });
        let calls = 0;
        const helper = new Proxy({
            generateMeetingSummary: async () => {
                calls += 1;
                await gate;
                return JSON.stringify({ overview: `Notes pass ${calls}.`, keyPoints: ['Billing fix first'], actionItems: [] });
            },
        }, { get: (o, k) => (k in o ? o[k] : async () => '') });
        return { helper, release: () => release(), calls: () => calls };
    };
    const status = (id) => readDb((d) => d.prepare('SELECT summary_status, title, is_processed FROM meetings WHERE id = ?').get(id));

    test('Resume while the first notes are still being written: that pass stops, the resumed Stop writes the notes', async () => {
        const start = Date.now() - 600_000;
        const g = gatedLlm();
        const session = fakeSession(start, lines(start, ['Can we hold the launch?', 'Yes, to the 18th.', 'Billing fix first.', 'Agreed.']), { title: 'Takeover sync' });
        // One MeetingPersistence, as in the app (IntelligenceManager holds one).
        const mp = new MeetingPersistence(session, g.helper);
        const id = mp.beginLiveMeeting(start, { surface: 'notepad' });
        await mp.stopMeeting();
        assert.ok(await waitFor(() => g.calls() === 1), 'the first notes call is waiting');
        assert.equal(status(id).is_processed, 0);
        const countBefore = readDb((d) => d.prepare('SELECT COUNT(*) AS n FROM meetings').get().n);

        const base = mp.loadResumeBase(id);
        assert.equal(base.title, 'Takeover sync', 'the title from what Stop saved, not "Processing..."');
        const resumeAt = Date.now() - 20_000;
        assert.equal(mp.beginLiveMeeting(resumeAt, { resume: base }), id);
        // The first pass finishes its call now: it must not save.
        g.release();
        await new Promise((r) => setTimeout(r, 150));
        assert.equal(status(id).is_processed, 0, 'the superseded pass saved nothing');
        assert.notEqual(status(id).summary_status, 'failed', 'and did not mark the notes failed');

        for (const l of lines(resumeAt, ['One more thing: the demo video.', 'Priya owns it.'])) session.push(l);
        const r = await mp.stopMeeting();
        assert.equal(r.meetingId, id);
        assert.ok(await waitFor(() => processed(id)));
        const after = DatabaseManager.getInstance().getMeetingDetails(id);
        assert.equal(after.transcript.length, 6, 'both parts');
        assert.equal(after.title, 'Takeover sync');
        assert.equal(after.surface, 'notepad');
        assert.equal(after.summaryStatus, 'completed');
        assert.equal(DatabaseManager.getInstance().getNotesVersions(id).length, 0, 'no notes existed to keep');
        assert.equal(readDb((d) => d.prepare('SELECT COUNT(*) AS n FROM meetings').get().n), countBefore, 'no second meeting');
    });

    test('a resume stopped at once while the first notes were being written: the notes are still written', async () => {
        const start = Date.now() - 600_000;
        const g = gatedLlm();
        const session = fakeSession(start, lines(start, ['Can we hold the launch?', 'Yes, to the 18th.', 'Billing fix first.', 'Agreed.']), { title: 'Dropped resume' });
        const mp = new MeetingPersistence(session, g.helper);
        const id = mp.beginLiveMeeting(start, { surface: 'overlay' });
        await mp.stopMeeting();
        assert.ok(await waitFor(() => g.calls() === 1));
        mp.beginLiveMeeting(Date.now(), { resume: mp.loadResumeBase(id) });
        const r = await mp.stopMeeting();
        assert.equal(r.meetingId, id);
        g.release();
        assert.ok(await waitFor(() => processed(id)), 'recovery wrote the notes the resume stopped');
        const after = DatabaseManager.getInstance().getMeetingDetails(id);
        assert.equal(after.title, 'Dropped resume');
        assert.equal(after.transcript.length, 4);
        assert.equal(after.summaryStatus, 'completed');
    });

    test('the resumed notes keep the saved speaker names, people, screens and follow-up draft', async () => {
        const { id } = await savedNotepadMeeting('Carry names');
        const db = DatabaseManager.getInstance();
        const saved = db.getMeetingDetails(id).detailedSummary;
        db.replaceDetailedSummary(id, {
            ...saved,
            speakerLabels: { speaker_1: 'Priya' },
            callParticipants: ['Priya'],
            sharedScreens: [{ at: 1, until: 2, app: 'Zoom', text: 'Roadmap slide' }],
            followUpDraft: { subject: 'Launch', body: 'Edited by hand' },
        });
        const seen = [];
        const helper = new Proxy({
            generateMeetingSummary: async (_p, text) => { seen.push(String(text)); return JSON.stringify({ overview: 'Launch on the 18th.', keyPoints: ['Billing first'], actionItems: [] }); },
        }, { get: (o, k) => (k in o ? o[k] : async () => '') });
        const resumeAt = Date.now() - 10_000;
        const session = fakeSession(resumeAt, [], null);
        const mp = new MeetingPersistence(session, helper);
        mp.beginLiveMeeting(resumeAt, { resume: mp.loadResumeBase(id) });
        for (const l of lines(resumeAt, ['One more point.', 'Priya agrees.'])) session.push(l);
        await mp.stopMeeting();
        assert.ok(await waitFor(() => processed(id)));
        const after = db.getMeetingDetails(id).detailedSummary;
        assert.deepEqual(after.speakerLabels?.speaker_1, 'Priya');
        assert.deepEqual(after.callParticipants, ['Priya']);
        assert.deepEqual(after.sharedScreens.map((e) => e.text), ['Roadmap slide']);
        assert.deepEqual(after.followUpDraft, { subject: 'Launch', body: 'Edited by hand' });
        assert.ok(seen.some((t) => t.includes('Priya')), 'the notes were written with the saved name');
    });

    test('a crash mid-resume keeps the saved names (the live copy carries them)', async () => {
        const { id } = await savedNotepadMeeting('Carry crash');
        const db = DatabaseManager.getInstance();
        db.replaceDetailedSummary(id, { ...db.getMeetingDetails(id).detailedSummary, speakerLabels: { speaker_1: 'Priya' } });
        const resumeAt = Date.now() - 10_000;
        const session = fakeSession(resumeAt, [], null);
        const crashing = new MeetingPersistence(session, llm());
        crashing.beginLiveMeeting(resumeAt, { resume: crashing.loadResumeBase(id) });
        for (const l of lines(resumeAt, ['After the break.', 'Pricing next.'])) session.push(l);
        crashing.noteLiveChange(true);
        assert.equal(crashing.flushLiveMeeting('quit'), true);
        await new MeetingPersistence(fakeSession(Date.now(), [], null), llm()).recoverUnprocessedMeetings();
        assert.ok(await waitFor(() => processed(id)));
        assert.equal(db.getMeetingDetails(id).detailedSummary.speakerLabels?.speaker_1, 'Priya');
    });

    test('a crash mid-resume with no new lines leaves the saved meeting and its notes; notes typed are kept', async () => {
        const { id } = await savedNotepadMeeting('No new lines');
        const db = DatabaseManager.getInstance();
        const before = db.getMeetingDetails(id);
        const resumeAt = Date.now() - 10_000;
        const crashing = new MeetingPersistence(fakeSession(resumeAt, [], null), llm());
        crashing.beginLiveMeeting(resumeAt, { resume: crashing.loadResumeBase(id) });
        crashing.setLiveUserNotes('- launch date?\n- typed during the resume');
        crashing.noteLiveChange(true);
        assert.equal(crashing.flushLiveMeeting('quit'), true);
        await new MeetingPersistence(fakeSession(Date.now(), [], null), llm()).recoverUnprocessedMeetings();
        const after = db.getMeetingDetails(id);
        assert.equal(after.transcript.length, before.transcript.length);
        assert.deepEqual(after.detailedSummary, before.detailedSummary, 'the notes were not rewritten');
        assert.equal(db.getNotesVersions(id).length, 0);
        assert.equal(after.userNotes, '- launch date?\n- typed during the resume');
        assert.equal(readDb((d) => d.prepare('SELECT COUNT(*) AS n FROM live_meeting_journal WHERE id = ?').get(id).n), 0);
    });

    test('a resume dropped after a Regenerate it took over: the status does not stay "queued"', async () => {
        const { id } = await savedNotepadMeeting('Stuck status');
        const db = DatabaseManager.getInstance();
        db.updateSummaryStatus(id, 'queued'); // what a Regenerate in flight leaves
        const mp = new MeetingPersistence(fakeSession(Date.now(), [], null), llm());
        mp.beginLiveMeeting(Date.now(), { resume: mp.loadResumeBase(id) });
        await mp.stopMeeting();
        assert.equal(db.getMeetingDetails(id).summaryStatus, 'completed');
    });

    test('a dropped resume while a recovery pass runs: one more pass writes the notes after it', async () => {
        const start = Date.now() - 600_000;
        const g = gatedLlm();
        const session = fakeSession(start, lines(start, ['Can we hold the launch?', 'Yes, to the 18th.', 'Billing fix first.', 'Agreed.']), { title: 'Busy recovery' });
        const mp = new MeetingPersistence(session, g.helper);
        const id = mp.beginLiveMeeting(start, { surface: 'overlay' });
        await mp.stopMeeting();
        assert.ok(await waitFor(() => g.calls() === 1));
        // A recovery pass already under way (it passed this meeting while it was claimed).
        let endPass;
        mp.recovering = new Promise((r) => { endPass = r; }).finally(() => { mp.recovering = null; });
        mp.beginLiveMeeting(Date.now(), { resume: mp.loadResumeBase(id) });
        await mp.stopMeeting();
        g.release();
        await new Promise((r) => setTimeout(r, 100));
        assert.equal(processed(id), false, 'waits for the running pass');
        endPass();
        assert.ok(await waitFor(() => processed(id)), 'then writes the notes');
        assert.equal(DatabaseManager.getInstance().getMeetingDetails(id).title, 'Busy recovery');
    });

    test('a new voice on the mic in the resumed part never takes a saved person\'s number (or rename)', async () => {
        const { SettingsManager } = require(dist('services/SettingsManager.js'));
        SettingsManager.getInstance().set('roomSpeakersEnabled', true);
        try {
            const mic = (start, rows) => rows.map(([voice, text], i) => ({ speaker: 'user', speakerId: voice, text, timestamp: start + 1000 * (i + 1), origin: 'stt', final: true }));
            const talk = [['speaker_0', 'So the launch plan is the main thing today and we should go through it'], ['speaker_1', 'I can take the billing part of the launch plan'], ['speaker_0', 'Good, then pricing after that and the release notes too'], ['speaker_1', 'Billing needs two more days to finish properly'], ['speaker_0', 'Then the eighteenth works for everyone here I think'], ['speaker_1', 'Yes the eighteenth works for billing as well']];
            const start = Date.now() - 600_000;
            const first = new MeetingPersistence(fakeSession(start, mic(start, talk), { title: 'Room sync' }), llm());
            const id = first.beginLiveMeeting(start, { surface: 'overlay' });
            await first.stopMeeting();
            assert.ok(await waitFor(() => processed(id)));
            const db = DatabaseManager.getInstance();
            assert.ok(db.getMeetingDetails(id).transcript.some((l) => l.speaker === 'Speaker 2'), 'the first part found a second voice');
            // The user names that voice.
            db.replaceDetailedSummary(id, { ...db.getMeetingDetails(id).detailedSummary, speakerLabels: { speaker_2: 'Lars' } });

            // The resumed part: the provider numbers voices from scratch, and a different colleague talks.
            const resumeAt = Date.now() - 20_000;
            const session = fakeSession(resumeAt, [], null);
            const mp = new MeetingPersistence(session, llm());
            mp.beginLiveMeeting(resumeAt, { resume: mp.loadResumeBase(id) });
            for (const l of mic(resumeAt, talk)) session.push(l);
            await mp.stopMeeting();
            assert.ok(await waitFor(() => processed(id)));
            const after = db.getMeetingDetails(id);
            const resumed = after.transcript.filter((l) => l.timestamp >= resumeAt);
            const saved = after.transcript.filter((l) => l.timestamp < resumeAt);
            assert.ok(saved.some((l) => l.speaker === 'Speaker 2'), 'the saved part keeps its Speaker 2');
            assert.ok(resumed.some((l) => l.speaker === 'Speaker 3'), 'the new voice is Speaker 3');
            assert.ok(!resumed.some((l) => l.speaker === 'Speaker 2'), 'not Speaker 2 (Lars)');
            assert.equal(after.detailedSummary.speakerLabels?.speaker_2, 'Lars');
            assert.equal(after.detailedSummary.speakerLabels?.speaker_3, undefined);
        } finally {
            SettingsManager.getInstance().set('roomSpeakersEnabled', false);
        }
    });

    test('a new meeting after a resume gets a new id (no carry-over)', async () => {
        const { id } = await savedNotepadMeeting('Carry-over');
        const mp = new MeetingPersistence(fakeSession(Date.now() - 10_000, lines(Date.now() - 10_000, ['x', 'y', 'z']), null), llm());
        mp.beginLiveMeeting(Date.now() - 10_000, { resume: mp.loadResumeBase(id) });
        await mp.stopMeeting();
        const next = mp.beginLiveMeeting(Date.now());
        assert.notEqual(next, id);
        assert.equal(mp.resumedMeetingId, null);
    });
});
