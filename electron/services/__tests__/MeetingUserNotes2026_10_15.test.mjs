// Granola parity, stream C (2026-10-15): the user's own notes, typed in the
// notes window during a meeting, survive a quit or crash (live journal),
// reach the notes at Stop and at recovery (`userNotes`), are stored with the
// meeting (meetings.user_notes) so Regenerate passes them again, and are kept
// apart from the notes blob. Earlier versions of the notes are kept (bounded)
// when they are regenerated; ratings are stored locally and exported as JSONL.
//
// Run under the electron runner (better-sqlite3's ABI):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test <this file>
// No platform branch is exercised here: paths go through node:path / os.tmpdir().
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = (p) => path.join(REPO, 'dist-electron/electron', p);
const { LiveMeetingJournal } = require(dist('services/meeting/LiveMeetingJournal.js'));
const versions = require(dist('services/meeting/notesVersions.js'));

test('journal: notes typed before anyone spoke are written on their own', () => {
    const writes = [];
    const j = new LiveMeetingJournal({
        store: () => ({ write: (row) => writes.push(row), remove: () => {} }),
        snapshot: () => ({ transcript: [], usage: [], meta: { userNotes: '# Agenda\n- pricing' } }),
        now: () => 10_000,
        setTimeout: () => 1, clearTimeout: () => {}, log: () => {},
    });
    j.begin('m-notes', 1_000);
    assert.equal(j.flush('quit'), true);
    assert.equal(writes[0].meta.userNotes, '# Agenda\n- pricing');
});

test('journal: blank notes and no lines still write nothing', () => {
    const writes = [];
    const j = new LiveMeetingJournal({
        store: () => ({ write: (row) => writes.push(row), remove: () => {} }),
        snapshot: () => ({ transcript: [], usage: [], meta: { userNotes: '  \n ' } }),
        now: () => 10_000, setTimeout: () => 1, clearTimeout: () => {}, log: () => {},
    });
    j.begin('m-empty', 1_000);
    assert.equal(j.flush('quit'), false);
    assert.equal(writes.length, 0);
});

test('versions: label, hash and pruning (pure)', () => {
    const v3 = (name, tldr) => ({ schemaVersion: 3, tldr: [tldr], mode: { selectedModeName: name, selectedTemplateType: 'sales' } });
    assert.equal(versions.notesVersionLabel(v3('Sales call', 'x')), 'Sales call');
    assert.equal(versions.notesVersionLabel({ mode: { selectedTemplateType: 'team_meeting' } }), 'Team meeting');
    assert.equal(versions.notesVersionLabel({}), 'Notes');
    assert.equal(versions.isArchivableNotes(v3('General', 'a point')), true);
    assert.equal(versions.isArchivableNotes({ schemaVersion: 3, tldr: [], sectionsV3: [] }), false, 'empty notes are not a version');
    assert.equal(versions.isArchivableNotes({ overview: 'legacy', keyPoints: ['k'] }), false, 'V2 notes are not kept as versions');
    // The hash follows what the notes say, not renames or the follow-up draft.
    const a = { ...v3('General', 'point'), speakerLabels: { speaker_1: 'Dana' }, followUpDraft: { body: 'hi' } };
    const b = { ...v3('General', 'point'), speakerLabels: { speaker_1: 'Priya' } };
    assert.equal(versions.notesContentHash(a), versions.notesContentHash(b));
    assert.notEqual(versions.notesContentHash(a), versions.notesContentHash(v3('General', 'another point')));
    assert.equal(versions.notesWereEdited({ userEditedAt: 1700000000000 }), true);
    assert.equal(versions.notesWereEdited({}), false);
    const rows = [1, 2, 3, 4, 5, 6].map((id) => ({ id, createdAt: id * 10 }));
    assert.deepEqual(versions.versionIdsToPrune(rows).sort(), [1, 2], 'the two oldest go; four stay');
    assert.deepEqual(versions.versionIdsToPrune(rows.slice(0, 3)), []);
});

describe('the user\'s notes with the meeting (database)', () => {
    let tmpDir;
    let MeetingPersistence;
    let DatabaseManager;
    let Database;
    let ratings;
    const originalLoad = Module._load;
    const NOTE = 'ZEBRA-NOTE pricing is 40 per seat?';

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-user-notes-'));
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
        ratings = require(dist('services/meeting/notesRatings.js'));
        Database = require('better-sqlite3');
    });
    after(() => {
        Module._load = originalLoad;
        delete process.env.NATIVELY_MEETING_SUMMARY_V3;
        delete process.env.NATIVELY_MEETING_MODE_AUTODETECT;
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    /** Records every model call (prompt + content); answers a chunk with atoms, anything else with V2 notes. */
    const llmRecording = (calls) => new Proxy({
        generateMeetingSummary: async (prompt, context) => {
            const all = `${prompt}\n${context}`;
            calls.push(all);
            if (/ONE chronological transcript chunk/.test(String(prompt))) {
                return JSON.stringify({
                    chunkIndex: 0, timeRange: { startMs: 0, endMs: 1 }, brief: 'The pricing deck goes out by Friday.',
                    topics: ['pricing'],
                    decisions: [{ text: 'Send the pricing deck by Friday', confidence: 'high', fromUserNotes: true, evidence: [{ speakerName: 'Speaker 1', timestampMs: 4000, quote: 'pricing deck by Friday' }] }],
                    actionItems: [], openQuestions: [], risks: [], people: [], importantQuotes: [], modeSpecificFindings: {},
                });
            }
            return JSON.stringify({ overview: 'Pricing deck by Friday.', keyPoints: ['Deck by Friday'], actionItems: ['Send the deck'] });
        },
    }, { get: (o, k) => (k in o ? o[k] : async () => '') });

    const fourLines = (start) => [
        { speaker: 'user', text: 'Can you send the pricing deck by Friday?', timestamp: start + 1000, origin: 'stt', final: true },
        { speaker: 'interviewer', text: 'Yes, I will send the pricing deck by Friday.', timestamp: start + 4000, origin: 'stt', final: true },
        { speaker: 'user', text: 'Great, and the renewal terms too.', timestamp: start + 8000, origin: 'stt', final: true },
        { speaker: 'interviewer', text: 'Sure, renewal terms as well.', timestamp: start + 12000, origin: 'stt', final: true },
    ];
    const fakeSession = (startedAt, transcript, metadata) => {
        let lines = [...transcript];
        let meta = metadata;
        let start = startedAt;
        return {
            flushInterimTranscript() {},
            getSessionStartTime: () => start,
            markMeetingStart: (at) => { start = at; },
            getMeetingMetadata: () => meta,
            // Stop and the live copy save the whole meeting (2026-10-15).
            getPersistableTranscript: () => lines,
            getPersistableUsage: () => [],
            getFullSessionContext: () => '',
            reset() { lines = []; meta = null; },
        };
    };
    const readDb = (fn) => {
        const db = new Database(path.join(tmpDir, 'natively.db'), { readonly: true });
        try { return fn(db); } finally { db.close(); }
    };
    const waitFor = async (pred, ms = 3000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { if (pred()) return true; await new Promise((r) => setTimeout(r, 25)); }
        return pred();
    };

    test('autosave round trip: typed notes reach the live copy, a quit keeps them, recovery hands them to the notes', async () => {
        const start = Date.now() - 30_000;
        const quitting = new MeetingPersistence(fakeSession(start, fourLines(start), { title: 'Pricing' }), llmRecording([]));
        const id = quitting.beginLiveMeeting(start);
        quitting.setLiveUserNotes(NOTE);
        assert.equal(quitting.getLiveUserNotes(), NOTE);
        assert.equal(quitting.flushLiveMeeting('quit'), true);
        const meta = readDb((db) => JSON.parse(db.prepare('SELECT meta_json FROM live_meeting_journal WHERE id = ?').get(id).meta_json));
        assert.equal(meta.userNotes, NOTE, 'the notes are on disk with the live meeting');

        // Next launch: a fresh process recovers it.
        const calls = [];
        await new MeetingPersistence(fakeSession(Date.now(), [], null), llmRecording(calls)).recoverUnprocessedMeetings();
        assert.ok(calls.some((c) => c.includes('ZEBRA-NOTE')), 'the recovered notes were written with the user\'s notes');
        const row = readDb((db) => db.prepare('SELECT user_notes, is_processed FROM meetings WHERE id = ?').get(id));
        assert.equal(row.user_notes, NOTE);
        assert.equal(row.is_processed, 1);
        assert.equal(DatabaseManager.getInstance().getMeetingDetails(id).userNotes, NOTE, 'the meeting page reads them as typed');
    });

    test('a live meeting with notes but no words yet is kept for recovery, not dropped', async () => {
        const db = DatabaseManager.getInstance();
        const now = Date.now();
        db.writeLiveMeeting({ id: 'live-notes-only', startedAt: now - 60_000, updatedAt: now, transcript: [], usage: [], meta: { startTime: now - 60_000, durationMs: 60_000, userNotes: '- ask about SSO' } });
        await new MeetingPersistence(fakeSession(now, [], null), llmRecording([])).recoverUnprocessedMeetings();
        assert.equal(readDb((d) => d.prepare('SELECT user_notes FROM meetings WHERE id = ?').get('live-notes-only')?.user_notes), '- ask about SSO');
    });

    test('Stop: userNotes reach processAndSaveMeeting, are stored with the meeting, and the live buffer is emptied', async () => {
        const start = Date.now() - 30_000;
        const calls = [];
        const mp = new MeetingPersistence(fakeSession(start, fourLines(start), { title: 'Pricing' }), llmRecording(calls));
        const id = mp.beginLiveMeeting(start);
        mp.setLiveUserNotes(NOTE);
        const result = await mp.stopMeeting();
        assert.equal(result.meetingId, id);
        assert.equal(mp.getLiveUserNotes(), '', 'the next meeting starts with an empty page');
        assert.equal(readDb((d) => d.prepare('SELECT user_notes FROM meetings WHERE id = ?').get(id).user_notes), NOTE, 'saved with the placeholder');
        await waitFor(() => readDb((d) => d.prepare('SELECT is_processed FROM meetings WHERE id = ?').get(id).is_processed) === 1);
        assert.ok(calls.some((c) => c.includes('ZEBRA-NOTE')), 'the notes prompt carried the user\'s notes');
        assert.equal(readDb((d) => d.prepare('SELECT user_notes FROM meetings WHERE id = ?').get(id).user_notes), NOTE, 'the final save keeps them');
    });

    test('Stop with no notes: nothing stored, the prompts carry no notes block (identical to today)', async () => {
        const start = Date.now() - 30_000;
        const calls = [];
        const mp = new MeetingPersistence(fakeSession(start, fourLines(start), { title: 'Plain' }), llmRecording(calls));
        const id = mp.beginLiveMeeting(start);
        mp.setLiveUserNotes('   ');
        await mp.stopMeeting();
        await waitFor(() => readDb((d) => d.prepare('SELECT is_processed FROM meetings WHERE id = ?').get(id).is_processed) === 1);
        assert.equal(readDb((d) => d.prepare('SELECT user_notes FROM meetings WHERE id = ?').get(id).user_notes), null);
        assert.ok(!calls.some((c) => c.includes("THE USER'S OWN NOTES")), 'no notes block');
    });

    test('Regenerate passes the stored notes again and keeps the notes it replaces as a version', async () => {
        const db = DatabaseManager.getInstance();
        const start = Date.now() - 300_000;
        const previous = { schemaVersion: 3, title: 'Pricing', tldr: ['Earlier notes'], overview: 'Earlier.', sectionsV3: [], mode: { selectedModeName: 'General', selectedTemplateType: 'general' }, actionItems: [], keyPoints: [] };
        db.saveMeeting({
            id: 'regen-1', title: 'Pricing', date: new Date(start).toISOString(), duration: '5:00', summary: '',
            detailedSummary: previous, transcript: fourLines(start), usage: [], isProcessed: true, summaryStatus: 'completed', userNotes: NOTE,
        }, start, 300_000);
        const calls = [];
        const ok = await new MeetingPersistence(fakeSession(Date.now(), [], null), llmRecording(calls)).regenerateSavedMeeting('regen-1');
        assert.ok(calls.some((c) => /ONE chronological transcript chunk/.test(c) && c.includes('ZEBRA-NOTE')), 'the chunk prompt carried the stored notes');
        assert.ok(calls.some((c) => c.includes('fromUserNotes: true on a section finding')), 'and asked which lines come from them');
        assert.equal(ok, true, 'regenerated');
        const kept = db.getNotesVersions('regen-1');
        assert.equal(kept.length, 1);
        assert.equal(kept[0].label, 'General');
        assert.deepEqual(kept[0].detailedSummary.tldr, ['Earlier notes']);
        const now = db.getMeetingDetails('regen-1');
        assert.equal(now.userNotes, NOTE, 'the user\'s notes are not part of the notes blob Regenerate replaced');
        assert.equal(now.detailedSummary.decisions[0].fromUserNotes, true, 'fromUserNotes survives to the saved notes');
    });

    test('an explicit userNotes for Regenerate wins over the stored one', async () => {
        const calls = [];
        await new MeetingPersistence(fakeSession(Date.now(), [], null), llmRecording(calls)).regenerateSavedMeeting('regen-1', { userNotes: 'OTTER-NOTE' });
        assert.ok(calls.some((c) => c.includes('OTTER-NOTE')));
        assert.ok(!calls.some((c) => c.includes('ZEBRA-NOTE')));
    });

    test('versions are bounded per meeting (oldest dropped) and go with the meeting', () => {
        const db = DatabaseManager.getInstance();
        // After the versions the Regenerate tests above kept (stamped Date.now()).
        const base = Date.now() + 60_000;
        for (let i = 0; i < 6; i++) {
            db.archiveNotesVersion('regen-1', { schemaVersion: 3, tldr: [`v${i}`], mode: { selectedModeName: i % 2 ? 'Sales call' : 'General' } }, base + i);
        }
        const kept = db.getNotesVersions('regen-1');
        assert.equal(kept.length, versions.MAX_ARCHIVED_NOTES_VERSIONS);
        assert.deepEqual(kept.map((v) => v.detailedSummary.tldr[0]), ['v2', 'v3', 'v4', 'v5'], 'oldest first, the oldest gone');
    });

    test('an edit by hand is stamped, so Regenerate asks first', () => {
        const db = DatabaseManager.getInstance();
        assert.equal(versions.notesWereEdited(db.getMeetingDetails('regen-1').detailedSummary), false);
        db.updateMeetingSummary('regen-1', { overview: 'My own overview' });
        assert.equal(versions.notesWereEdited(db.getMeetingDetails('regen-1').detailedSummary), true);
    });

    test('ratings: stored per version of the notes, changed in place, comment only with a thumbs down', () => {
        const db = DatabaseManager.getInstance();
        let t = 5_000_000;
        const now = () => ++t;
        assert.equal(ratings.rateMeetingNotes(db, { meetingId: 'regen-1', rating: 'up', comment: 'ignored' }, now), true);
        assert.deepEqual(ratings.getMeetingNotesRating(db, 'regen-1'), { rating: 'up', comment: null });
        assert.equal(ratings.rateMeetingNotes(db, { meetingId: 'regen-1', rating: 'down', comment: '  Missed the   pricing decision ' }, now), true);
        assert.deepEqual(ratings.getMeetingNotesRating(db, 'regen-1'), { rating: 'down', comment: 'Missed the pricing decision' }, 'one rating per version, replaced');
        const v = db.getNotesVersions('regen-1')[0];
        assert.equal(ratings.getMeetingNotesRating(db, 'regen-1', v.id), null, 'an earlier version has its own rating');
        assert.equal(ratings.rateMeetingNotes(db, { meetingId: 'regen-1', rating: 'up', versionId: v.id }, now), true);
        assert.equal(ratings.rateMeetingNotes(db, { meetingId: 'regen-1', rating: 'meh' }, now), false);
        assert.equal(ratings.rateMeetingNotes(db, { meetingId: 'no-such-meeting', rating: 'up' }, now), false);
        const rows = readDb((d) => d.prepare("SELECT rating, comment, mode, notes_hash FROM meeting_notes_ratings WHERE meeting_id = 'regen-1' ORDER BY created_at").all());
        assert.equal(rows.length, 2);
        assert.equal(rows[0].comment, 'Missed the pricing decision');
        assert.equal(rows[0].notes_hash.length, 32);
    });

    test('JSONL export: one line per rating with the transcript segments, the user\'s notes and the rated notes', () => {
        const db = DatabaseManager.getInstance();
        const out = path.join(tmpDir, 'judge export with spaces');
        const { file, count } = ratings.exportRatedNotesJsonl(db, out, { now: () => Date.parse('2026-10-15T12:00:00Z') });
        assert.equal(count, 2);
        assert.equal(path.dirname(file), path.resolve(out));
        assert.match(path.basename(file), /^natively-rated-notes-2026-10-15T12-00-00-000Z\.jsonl$/, 'no ":" in the name (Windows)');
        const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        const down = lines.find((l) => l.rating === 'down');
        assert.equal(down.schema, 'natively.rated_notes.v1');
        assert.equal(down.meetingId, 'regen-1');
        assert.equal(down.comment, 'Missed the pricing decision');
        assert.equal(down.ratedVersion, 'current');
        assert.equal(down.userNotes, NOTE);
        assert.equal(down.segments.length, 4);
        assert.deepEqual(Object.keys(down.segments[0]).sort(), ['speaker', 'text', 'timestamp']);
        assert.ok(down.notes && down.notes.schemaVersion === 3);
        const up = lines.find((l) => l.rating === 'up');
        assert.equal(typeof up.ratedVersion, 'number', 'the rated earlier version is found by its hash');
        assert.throws(() => ratings.exportRatedNotesJsonl(db, '  '), /folder/);
    });

    test('deleting the meeting takes its versions and ratings with it', () => {
        const db = DatabaseManager.getInstance();
        assert.equal(db.deleteMeeting('regen-1'), true);
        assert.equal(readDb((d) => d.prepare("SELECT COUNT(*) AS n FROM meeting_notes_versions WHERE meeting_id = 'regen-1'").get().n), 0);
        assert.equal(readDb((d) => d.prepare("SELECT COUNT(*) AS n FROM meeting_notes_ratings WHERE meeting_id = 'regen-1'").get().n), 0);
    });
});
