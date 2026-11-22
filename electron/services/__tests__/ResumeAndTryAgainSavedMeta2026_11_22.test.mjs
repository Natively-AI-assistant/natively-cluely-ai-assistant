// What was saved with a meeting at Stop (its recovery metadata: calendar link,
// mode, the call's names, screens, typed notes, template, a resume's carry) is
// for writing its FIRST notes. Two paths read it wrong:
//
//   - Resume asked "are its notes written?" with details.isProcessed, which
//     getMeetingDetails never returned. Every resume took the saved metadata
//     as still pending and merged it into the carry, so names and people the
//     notes no longer had came back when a meeting was resumed.
//   - Try again on a meeting whose notes failed at Stop ran Regenerate, which
//     reads none of it. Since #778 those notes are final (recovery no longer
//     writes them over), so the meeting kept notes without its calendar event,
//     mode, call names or template, for good. A plain Try again now writes the
//     first notes the way recovery would; a Regenerate the user aimed at a
//     template or mode still runs as one.
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

describe('what was saved with a meeting at Stop is for its first notes only', () => {
    let tmpDir;
    let MeetingPersistence;
    let DatabaseManager;
    const originalLoad = Module._load;
    const created = new Set();

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-saved-meta-'));
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
    const transcript = (start) => ['Can we hold the launch?', 'Yes, to the 18th.', 'Billing fix first.', 'Agreed.']
        .map((text, i) => ({ speaker: i % 2 ? 'interviewer' : 'user', text, timestamp: start + 1000 * (i + 1), origin: 'stt', final: true }));
    const db = () => DatabaseManager.getInstance();
    const START = Date.now() - 600_000;
    const event = { id: 'evt-board-review', title: 'Board review', startTime: new Date(START).toISOString(), endTime: new Date(START + 1_800_000).toISOString(), attendees: [] };

    /** A meeting saved with these notes; `saved` is what Stop kept with it. */
    const meeting = (id, { processed, detailedSummary, status, saved }) => {
        db().saveMeeting({
            id, title: processed ? 'Q4 launch sync' : 'Untitled Session', date: new Date(START).toISOString(), duration: '10:00',
            summary: '', detailedSummary, transcript: transcript(START), usage: [],
            isProcessed: processed, summaryStatus: status,
        }, START, 600_000);
        // A processed save clears it: set afterwards, as a Try again (before this
        // fix) or a Regenerate leaves it on a meeting it marks processed.
        if (saved) db().setMeetingRecoveryMeta(id, { startTime: START, durationMs: 600_000, ...saved });
        created.add(id);
        return id;
    };
    const notesWithPriya = { schemaVersion: 3, overview: 'Launch moves to Nov 18.', tldr: ['Launch moves to Nov 18.'], sectionsV3: [], actionItems: [], keyPoints: [], callParticipants: ['Priya'] };
    const staleCarry = { resumeCarry: { callParticipants: ['Guest who left'] } };

    describe('getMeetingDetails says whether the notes are written', () => {
        test('processed and not', () => {
            const done = meeting('details-done', { processed: true, detailedSummary: notesWithPriya, status: 'completed' });
            const failed = meeting('details-failed', { processed: false, detailedSummary: { actionItems: [], keyPoints: [] }, status: 'failed' });
            assert.equal(db().getMeetingDetails(done).isProcessed, true);
            assert.equal(db().getMeetingDetails(failed).isProcessed, false);
        });
    });

    describe('Resume', () => {
        test('a meeting whose notes are written: the carry comes from the notes, not from what Stop saved', () => {
            const id = meeting('resume-written', { processed: true, detailedSummary: notesWithPriya, status: 'completed', saved: staleCarry });
            const base = new MeetingPersistence(session(), workingLlm().helper).loadResumeBase(id);
            assert.ok(base, 'resumable');
            assert.deepEqual(base.carry?.callParticipants, ['Priya'], 'the guest the notes no longer have stays out');
        });

        test('a meeting resumed before its notes were written still takes what Stop saved', () => {
            const id = meeting('resume-pending', { processed: false, detailedSummary: { actionItems: [], keyPoints: [] }, status: 'failed', saved: staleCarry });
            const base = new MeetingPersistence(session(), workingLlm().helper).loadResumeBase(id);
            assert.deepEqual(base?.carry?.callParticipants, ['Guest who left']);
        });
    });

    describe('Try again on a meeting whose notes failed at Stop', () => {
        const failedAtStop = (id) => meeting(id, {
            processed: false, detailedSummary: { actionItems: [], keyPoints: [] }, status: 'failed',
            saved: { title: 'Board review', calendarEventId: event.id, calendarEvent: event, source: 'calendar' },
        });

        test('writes the first notes with what was saved: the meeting gets its calendar event', async () => {
            const id = failedAtStop('try-again-calendar');
            const llm = workingLlm();
            assert.equal(await new MeetingPersistence(session(), llm.helper).regenerateSavedMeeting(id), true);
            assert.ok(llm.calls() > 0, 'notes were written');

            const now = db().getMeetingDetails(id);
            assert.equal(now.summaryStatus, 'completed');
            assert.equal(now.isProcessed, true, 'final: recovery leaves it alone');
            assert.equal(now.calendarEventId, event.id, 'linked to its calendar event');
            assert.equal(now.calendarEvent?.title, 'Board review');
            assert.equal(db().getMeetingRecoveryMeta(id), null, 'what was saved for the first notes is used up');
        });

        test('the next launch writes nothing over them', async () => {
            const id = failedAtStop('try-again-final');
            assert.equal(await new MeetingPersistence(session(), workingLlm().helper).regenerateSavedMeeting(id), true);
            const written = JSON.stringify(db().getMeetingDetails(id).detailedSummary);
            const later = workingLlm();
            await new MeetingPersistence(session(), later.helper).recoverUnprocessedMeetings();
            assert.equal(later.calls(), 0);
            assert.equal(JSON.stringify(db().getMeetingDetails(id).detailedSummary), written);
        });

        test('it fails the way Stop fails: Try again stays, and the meeting still gets its calendar event', async () => {
            const id = failedAtStop('try-again-fails');
            // Every notes call fails; the rest of LLMHelper answers as the working fake does.
            const down = new Proxy({ generateMeetingSummary: async () => { throw new Error('provider down'); } }, { get: (o, k) => (k in o ? o[k] : async () => '') });
            assert.equal(await new MeetingPersistence(session(), down).regenerateSavedMeeting(id), false);
            const now = db().getMeetingDetails(id);
            assert.equal(now.summaryStatus, 'failed', 'the page offers Try again');
            assert.equal(now.calendarEventId, event.id);
        });

        test('a Regenerate aimed at a template is the user\'s choice: it runs as a Regenerate', async () => {
            const id = failedAtStop('try-again-template');
            assert.equal(await new MeetingPersistence(session(), workingLlm().helper).regenerateSavedMeeting(id, { noteTemplateId: null }), true);
            assert.ok(db().getMeetingRecoveryMeta(id), 'not the first-notes pass (that one uses up what was saved)');
            assert.equal(db().getMeetingDetails(id).isProcessed, true, 'its notes are final all the same (#778)');
        });

        test('not while a Resume of the meeting runs (its Stop writes the notes)', async () => {
            const id = failedAtStop('try-again-resumed');
            const llm = workingLlm();
            const mp = new MeetingPersistence(session(), llm.helper);
            mp.resumeBase = { meetingId: id };
            assert.equal(await mp.regenerateSavedMeeting(id), false);
            assert.equal(llm.calls(), 0);
            assert.equal(db().getMeetingDetails(id).summaryStatus, 'failed');
        });
    });
});
