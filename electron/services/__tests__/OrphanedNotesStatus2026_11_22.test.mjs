// #778: the meeting page polled forever on notes that were never coming.
//
// A meeting's summary_status says its notes are being written. Nothing but a
// notes pass may leave it there, and every pass in this app ends: each LLM call
// it makes is time-boxed (LLMHelper.generateMeetingSummary), and it writes
// completed or failed when it finishes. The row stayed "being written" for good
// when no pass was writing it:
//
//   - a Regenerate (on a meeting that already had notes, is_processed = 1) cut
//     off by a quit or crash: recovery reads only is_processed = 0 meetings, so
//     the row stayed stuck on every later launch;
//   - such a row reaching this app mid-session (an old profile's meetings are
//     copied in after recovery ran): stuck until the next launch;
//   - recovery throwing before it starts a pass: the row stayed "queued".
//
// The fix: the main process settles a row no pass is writing, at recovery and
// whenever a screen reads it (get-meeting-details). Notes it has stand
// (completed); with none, it reads failed, so the page offers Try again; one
// never written is written by recovery now. A pass still running is never
// touched. Two passes never write one meeting at once, and the notes Try again
// writes are final (recovery does not write them again at the next launch).
//
// Run under the electron runner (better-sqlite3's ABI):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test <this file>
// Platform-independent: paths go through node:path / os.tmpdir().
import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => path.join(REPO, 'dist-electron/electron', p);

describe('notes left "being written" by a pass that is gone (#778)', () => {
    let tmpDir;
    let MeetingPersistence;
    let DatabaseManager;
    const originalLoad = Module._load;
    const created = new Set();

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-orphan-notes-'));
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
    });
    // Every test removes its meetings: a pending one left behind would be
    // picked up (and waited on) by the next test's recovery pass.
    afterEach(() => {
        for (const id of created) { try { DatabaseManager.getInstance().deleteMeeting(id); } catch { /* gone */ } }
        created.clear();
    });
    after(() => {
        Module._load = originalLoad;
        delete process.env.NATIVELY_MEETING_SUMMARY_V3;
        delete process.env.NATIVELY_MEETING_MODE_AUTODETECT;
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    const session = () => ({
        flushInterimTranscript() {},
        getSessionStartTime: () => Date.now(),
        markMeetingStart() {},
        getMeetingMetadata: () => null,
        getPersistableTranscript: () => [],
        getPersistableUsage: () => [],
        getFullSessionContext: () => '',
        reset() {},
    });
    // Every LLM call waits forever: a pass that is still running.
    const hangingLlm = () => {
        let calls = 0;
        const never = new Promise(() => {});
        const helper = new Proxy({}, { get: () => async () => { calls += 1; await never; return ''; } });
        return { helper, calls: () => calls };
    };
    // Answers the way the notes pipeline expects (as in MeetingUserNotes2026_10_15).
    const workingLlm = () => {
        let calls = 0;
        const helper = new Proxy({
            generateMeetingSummary: async (prompt) => {
                calls += 1;
                if (/ONE chronological transcript chunk/.test(String(prompt))) {
                    return JSON.stringify({
                        chunkIndex: 0, timeRange: { startMs: 0, endMs: 1 }, brief: 'The launch moves to Nov 18.',
                        topics: ['launch'],
                        decisions: [{ text: 'Move the launch to Nov 18', confidence: 'high', evidence: [{ speakerName: 'Speaker 1', timestampMs: 2000, quote: 'Yes, to the 18th.' }] }],
                        actionItems: [], openQuestions: [], risks: [], people: [], importantQuotes: [], modeSpecificFindings: {},
                    });
                }
                return JSON.stringify({ overview: 'Launch moves to Nov 18.', keyPoints: ['Billing fix first'], actionItems: ['Draft release notes'] });
            },
        }, { get: (o, k) => (k in o ? o[k] : async () => '') });
        return { helper, calls: () => calls };
    };
    const waitFor = async (pred, ms = 4000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { if (pred()) return true; await new Promise((r) => setTimeout(r, 25)); }
        return pred();
    };
    const within = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(() => r('still running'), ms))]);
    const transcript = (start) => ['Can we hold the launch?', 'Yes, to the 18th.', 'Billing fix first.', 'Agreed.']
        .map((text, i) => ({ speaker: i % 2 ? 'interviewer' : 'user', text, timestamp: start + 1000 * (i + 1), origin: 'stt', final: true }));

    /** A meeting saved with these notes, this status, and processed or not. */
    const savedMeeting = (id, detailedSummary, summaryStatus, { processed = true, title = 'Q4 launch sync' } = {}) => {
        const start = Date.now() - 600_000;
        DatabaseManager.getInstance().saveMeeting({
            id, title, date: new Date(start).toISOString(), duration: '10:00',
            summary: processed ? '' : 'Generating summary...', detailedSummary, transcript: transcript(start), usage: [],
            isProcessed: processed, summaryStatus,
        }, start, 600_000);
        created.add(id);
        return id;
    };
    const notes = { schemaVersion: 3, overview: 'Launch moves to Nov 18.', tldr: ['Launch moves to Nov 18.'], sectionsV3: [], actionItems: [], keyPoints: [] };
    const noNotes = { actionItems: [], keyPoints: [] };
    const db = () => DatabaseManager.getInstance();
    const statusOf = (id) => db().getMeetingDetails(id).summaryStatus;
    // Straight from the file, so this reads the same before and after the fix.
    const processedOf = (id) => {
        const Database = require('better-sqlite3');
        const file = new Database(path.join(tmpDir, 'natively.db'), { readonly: true });
        try { return file.prepare('SELECT is_processed FROM meetings WHERE id = ?').get(id)?.is_processed === 1; } finally { file.close(); }
    };
    const PENDING = ['queued', 'chunking', 'summarizing_chunks', 'reducing', 'validating'];
    const pending = (id) => PENDING.includes(statusOf(id));

    /** Regenerate starts in one app run, which then ends without it finishing. */
    const regenerateCutOff = async (id) => {
        const llm = hangingLlm();
        const dying = new MeetingPersistence(session(), llm.helper);
        void dying.regenerateSavedMeeting(id);
        assert.ok(await waitFor(() => llm.calls() > 0), 'the Regenerate is writing');
        assert.ok(pending(id), 'and the row says so');
    };

    describe('at the next launch (recovery)', () => {
        test('a Regenerate cut off by a quit: the notes it was replacing stand', async () => {
            const id = savedMeeting('orphan-with-notes', notes, 'completed');
            await regenerateCutOff(id);

            await new MeetingPersistence(session(), hangingLlm().helper).recoverUnprocessedMeetings();

            const now = db().getMeetingDetails(id);
            assert.equal(now.summaryStatus, 'completed', 'the page leaves the skeleton for the notes');
            assert.equal(now.detailedSummary.overview, 'Launch moves to Nov 18.', 'the notes are untouched');
            assert.equal(now.title, 'Q4 launch sync');
        });

        test('a Try again cut off by a quit, on notes that had failed: it reads failed, so Try again shows again', async () => {
            const id = savedMeeting('orphan-no-notes', noNotes, 'failed');
            await regenerateCutOff(id);

            await new MeetingPersistence(session(), hangingLlm().helper).recoverUnprocessedMeetings();

            assert.equal(statusOf(id), 'failed');
        });

        test('every stage a pass can be cut off in is settled, not only "queued"', async () => {
            for (const stage of PENDING) {
                const id = savedMeeting(`orphan-${stage}`, notes, stage);
                await new MeetingPersistence(session(), hangingLlm().helper).recoverUnprocessedMeetings();
                assert.equal(statusOf(id), 'completed', stage);
            }
        });

        test('a Regenerate still running in this app is left alone by a recovery pass', async () => {
            const id = savedMeeting('live-regenerate', notes, 'completed');
            const llm = hangingLlm();
            const mp = new MeetingPersistence(session(), llm.helper);
            void mp.regenerateSavedMeeting(id);
            assert.ok(await waitFor(() => llm.calls() > 0));

            // finishNotesAfterDroppedResume runs recovery mid-session, on the same instance.
            await mp.recoverUnprocessedMeetings();

            assert.ok(pending(id), `the running pass still owns the status (${statusOf(id)})`);
        });

        test('a meeting whose notes were never written is left to recovery (it writes them)', async () => {
            const id = savedMeeting('never-written', noNotes, 'queued', { processed: false, title: 'Processing...' });
            const llm = hangingLlm();
            void new MeetingPersistence(session(), llm.helper).recoverUnprocessedMeetings();
            assert.ok(await waitFor(() => llm.calls() > 0), 'recovery is writing its notes');
            assert.ok(pending(id), 'and the row still says so: that pass is real');
        });

        test('recovery that throws before it starts a pass: the meeting reads failed, not "queued" for the session', async () => {
            const id = savedMeeting('recovery-throws', noNotes, 'queued', { processed: false, title: 'Processing...' });
            const mp = new MeetingPersistence(session(), workingLlm().helper);
            // The pass throws out of recovery without settling the row itself. (The
            // compiled MeetingPersistence carries its own DatabaseManager, so the
            // failure is put on the pass, not on this file's copy of the database.)
            mp.processAndSaveMeeting = async () => { throw new Error('pass threw before it settled the row'); };
            await mp.recoverUnprocessedMeetings();
            const now = db().getMeetingDetails(id);
            assert.equal(now.summaryStatus, 'failed', 'the page shows Try again');
            assert.notEqual(now.title, 'Processing...', 'not the placeholder title');
            assert.equal(processedOf(id), false, 'still unprocessed: the next launch tries again');
        });
    });

    describe('when a screen reads the meeting (get-meeting-details)', () => {
        test('a saved meeting left "being written" mid-session: settled on read, notes stand', () => {
            const id = savedMeeting('read-stuck', notes, 'reducing');
            const mp = new MeetingPersistence(session(), hangingLlm().helper);

            assert.equal(mp.settleAbandonedNotes(id), true);
            assert.equal(statusOf(id), 'completed');
            assert.equal(db().getMeetingDetails(id).detailedSummary.overview, 'Launch moves to Nov 18.');
            assert.equal(mp.settleAbandonedNotes(id), false, 'nothing left to settle');
        });

        test('with no notes it reads failed (Try again)', () => {
            const id = savedMeeting('read-stuck-empty', noNotes, 'queued');
            assert.equal(new MeetingPersistence(session(), hangingLlm().helper).settleAbandonedNotes(id), true);
            assert.equal(statusOf(id), 'failed');
        });

        test('a Regenerate running now is never settled under it', async () => {
            const id = savedMeeting('read-live', notes, 'completed');
            const llm = hangingLlm();
            const mp = new MeetingPersistence(session(), llm.helper);
            void mp.regenerateSavedMeeting(id);
            assert.ok(await waitFor(() => llm.calls() > 0));

            assert.equal(mp.settleAbandonedNotes(id), false);
            assert.ok(pending(id));
        });

        test('a meeting never written, read after recovery ran: recovery writes it now, not at the next launch', async () => {
            const mp = new MeetingPersistence(session(), workingLlm().helper);
            await mp.recoverUnprocessedMeetings(); // startup recovery, before the meeting arrives
            const id = savedMeeting('read-unwritten', noNotes, 'queued', { processed: false, title: 'Processing...' });

            assert.equal(mp.settleAbandonedNotes(id), false, 'nothing settled: a pass is starting');
            assert.ok(await waitFor(() => processedOf(id) === true), 'recovery wrote the notes');
            assert.ok(!pending(id), `and the row says so (${statusOf(id)})`);
        });

        test('that read writes only the meeting read, never every other unprocessed meeting', async () => {
            const mp = new MeetingPersistence(session(), workingLlm().helper);
            await mp.recoverUnprocessedMeetings();
            // A meeting whose notes failed at Stop: the next launch tries it again, a page read does not.
            const other = savedMeeting('other-failed', noNotes, 'failed', { processed: false });
            const id = savedMeeting('read-unwritten-2', noNotes, 'queued', { processed: false, title: 'Processing...' });

            mp.settleAbandonedNotes(id);
            assert.equal(mp.settleAbandonedNotes(id), false, 'a second read finds the pass running');
            assert.ok(await waitFor(() => processedOf(id) === true));
            assert.equal(statusOf(other), 'failed');
            assert.equal(processedOf(other), false, 'untouched');
        });

        test('reading a finished meeting changes nothing', () => {
            const id = savedMeeting('read-done', notes, 'completed');
            assert.equal(new MeetingPersistence(session(), hangingLlm().helper).settleAbandonedNotes(id), false);
            assert.equal(new MeetingPersistence(session(), hangingLlm().helper).settleAbandonedNotes('no-such-meeting'), false);
        });

        test('get-meeting-details settles through MeetingPersistence before it answers', () => {
            const src = fs.readFileSync(path.join(REPO, 'electron/ipcHandlers.ts'), 'utf8');
            const handler = src.slice(src.indexOf("safeHandle('get-meeting-details'"), src.indexOf("safeHandle('get-meeting-details'") + 1200);
            assert.match(handler, /settleAbandonedNotes\(id\)/);
            const mgr = fs.readFileSync(path.join(REPO, 'electron/IntelligenceManager.ts'), 'utf8');
            assert.match(mgr, /settleAbandonedNotes\(meetingId: string\): boolean \{\s*return this\.persistence\.settleAbandonedNotes\(meetingId\);/);
        });
    });

    describe('one pass per meeting, and Try again is final', () => {
        test('a second Regenerate while one runs is refused, so the first keeps the status', async () => {
            const id = savedMeeting('double-regenerate', notes, 'completed');
            const llm = hangingLlm();
            const mp = new MeetingPersistence(session(), llm.helper);
            void mp.regenerateSavedMeeting(id);
            assert.ok(await waitFor(() => llm.calls() > 0));
            const callsBefore = llm.calls();

            assert.equal(await within(mp.regenerateSavedMeeting(id), 1000), false, 'refused at once');
            assert.equal(llm.calls(), callsBefore, 'no second pass started');
            assert.ok(pending(id), 'the first pass still owns the status');
        });

        test('recovery never starts a pass on a meeting a Regenerate is writing', async () => {
            const id = savedMeeting('regen-unprocessed', noNotes, 'failed', { processed: false });
            const llm = hangingLlm();
            const mp = new MeetingPersistence(session(), llm.helper);
            void mp.regenerateSavedMeeting(id);
            assert.ok(await waitFor(() => llm.calls() > 0));
            const callsBefore = llm.calls();

            assert.notEqual(await within(mp.recoverUnprocessedMeetings(), 1000), 'still running', 'recovery passed over it');
            assert.equal(llm.calls(), callsBefore, 'no second pass');
        });

        test('Try again on a meeting whose first notes failed: the notes it writes are final', async () => {
            const id = savedMeeting('try-again', noNotes, 'failed', { processed: false });
            const llm = workingLlm();
            assert.equal(await new MeetingPersistence(session(), llm.helper).regenerateSavedMeeting(id), true);
            assert.equal(statusOf(id), 'completed');
            assert.equal(processedOf(id), true, 'processed: recovery leaves it alone');
            const written = JSON.stringify(db().getMeetingDetails(id).detailedSummary);

            // Next launch.
            const later = workingLlm();
            await new MeetingPersistence(session(), later.helper).recoverUnprocessedMeetings();
            assert.equal(later.calls(), 0, 'recovery wrote nothing');
            assert.equal(JSON.stringify(db().getMeetingDetails(id).detailedSummary), written, 'the notes Try again wrote stand');
        });

        test('a failed Try again leaves the meeting to recovery at the next launch', async () => {
            const id = savedMeeting('try-again-fails', noNotes, 'failed', { processed: false });
            const empty = new Proxy({}, { get: () => async () => '' });
            assert.equal(await new MeetingPersistence(session(), empty).regenerateSavedMeeting(id), false);
            assert.equal(statusOf(id), 'failed');
            assert.equal(processedOf(id), false);
        });
    });
});
