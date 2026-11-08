// Granola parity round 2 (2026-10-15): "Regenerate as" any template on the
// meeting page, with the Pro gate exactly as before (notesTemplateGate.ts),
// and the blind A/B Compare of two versions of the notes (notesCompare.ts):
// random order, nothing naming the template or model until the pick, stored
// locally beside the thumbs ratings, revealed after the pick.
//
// Run under the electron runner (better-sqlite3's ABI):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
// No platform branch: nothing here differs between macOS and Windows.
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
const { regenerateGate } = require(dist('services/meeting/notesTemplateGate.js'));
const { NotesComparisons, blindNotes, blindOrder, settlePick } = require(dist('services/meeting/notesCompare.js'));

const MODES = { m_general: 'general', m_sales: 'sales', m_tech: 'technical-interview' };
const gateDeps = (pro) => ({ templateOfMode: (id) => MODES[id], isProOrTrialActive: () => pro });

describe('Regenerate as: the Pro gate is the one it was', () => {
    test('a plain regenerate is never gated', () => {
        assert.equal(regenerateGate({}, gateDeps(false)), null);
        assert.equal(regenerateGate(undefined, gateDeps(false)), null);
    });
    test('without Pro: any non-general template is refused; General is allowed', () => {
        assert.equal(regenerateGate({ modeId: 'm_sales' }, gateDeps(false)), 'pro_required');
        assert.equal(regenerateGate({ modeId: 'm_tech' }, gateDeps(false)), 'pro_required');
        assert.equal(regenerateGate({ templateType: 'sales' }, gateDeps(false)), 'pro_required');
        assert.equal(regenerateGate({ modeId: 'm_general' }, gateDeps(false)), null);
        assert.equal(regenerateGate({ templateType: 'general' }, gateDeps(false)), null);
    });
    test('an unknown mode, or a lookup that throws, is gated like any non-general one', () => {
        assert.equal(regenerateGate({ modeId: 'gone' }, gateDeps(false)), 'pro_required');
        assert.equal(regenerateGate({ modeId: 'gone', templateType: 'general' }, gateDeps(false)), null, 'falls back to the given template, as before');
        assert.equal(regenerateGate({ modeId: 'm_sales' }, { templateOfMode: () => { throw new Error('db'); }, isProOrTrialActive: () => false }), 'pro_required');
    });
    test('with Pro or a live trial: every template', () => {
        for (const modeId of Object.keys(MODES)) assert.equal(regenerateGate({ modeId }, gateDeps(true)), null);
        assert.equal(regenerateGate({ modeId: 'gone' }, gateDeps(true)), null);
    });
    test('the IPC handler goes through the gate (and is not bypassed)', () => {
        const src = fs.readFileSync(path.join(REPO, 'electron/ipcHandlers.ts'), 'utf8');
        const start = src.indexOf("safeHandle('regenerate-meeting-summary'");
        const body = src.slice(start, src.indexOf('safeHandle(', start + 10));
        assert.match(body, /regenerateGate\(\{ modeId, templateType(, noteTemplateId)? \}/);
        assert.match(body, /if \(refused\) return \{ success: false, error: refused \}/);
        assert.ok(body.indexOf('regenerateGate(') < body.indexOf('mgr.regenerateMeetingSummary('), 'gate before the regenerate');
    });
});

describe('Compare: blind order and blind notes (pure)', () => {
    const notes = (name, model, tldr) => ({
        schemaVersion: 3, tldr: [tldr], overview: '', sections: [],
        mode: { selectedModeName: name, selectedTemplateType: name.toLowerCase() },
        generation: { provider: 'openai', model }, speakerLabels: { s1: 'Dana' }, userEditedAt: 5,
    });
    const store = (current, versions) => ({
        current,
        versions: [...versions],
        getMeetingDetails(id) { return id === 'm1' ? { id, detailedSummary: this.current } : null; },
        getNotesVersions(id) { return id === 'm1' ? this.versions : []; },
        saved: [],
        saveNotesComparison(r) { this.saved.push(r); return true; },
        deleteNotesVersion(id, vid) { const n = this.versions.length; this.versions = this.versions.filter((v) => !(id === 'm1' && v.id === vid)); return this.versions.length < n; },
        replaceDetailedSummary(id, d) { if (id !== 'm1') return false; this.current = d; return true; },
    });

    test('blindOrder follows the random source', () => {
        assert.equal(blindOrder(() => 0.1), true);
        assert.equal(blindOrder(() => 0.9), false);
    });

    test('blind notes keep the content and drop the template, model, provider and names', () => {
        const b = blindNotes(notes('Sales call', 'gpt-x', 'Deck by Friday'));
        assert.deepEqual(b.tldr, ['Deck by Friday']);
        for (const f of ['mode', 'generation', 'speakerLabels', 'userEditedAt']) assert.equal(f in b, false, f);
        assert.doesNotMatch(JSON.stringify(b), /Sales call|gpt-x|openai/);
    });

    test('both orders happen, and the start response names nothing', () => {
        const cur = notes('General', 'model-g', 'General summary');
        const old = notes('Sales call', 'model-s', 'Sales summary');
        const orders = new Set();
        let i = 0;
        const c = new NotesComparisons(store(cur, [{ id: 7, label: 'Sales call', createdAt: 1, detailedSummary: old }]), { newId: () => `c${i++}` });
        for (let n = 0; n < 200; n++) {
            const s = c.start('m1', [7, null]);
            assert.ok(s);
            orders.add(s.a.tldr[0]);
            const wire = JSON.stringify(s);
            assert.doesNotMatch(wire, /model-g|model-s|openai|Sales call|"version"|"label"|"mode"|"generation"/);
            assert.deepEqual(Object.keys(s).sort(), ['a', 'b', 'id']);
        }
        assert.deepEqual([...orders].sort(), ['General summary', 'Sales summary'], 'A is sometimes the current notes, sometimes the earlier ones');
    });

    test('nothing to compare: the same version twice, a missing one, identical words', () => {
        const cur = notes('General', 'g', 'Same words');
        const c = new NotesComparisons(store(cur, [{ id: 3, label: 'General', createdAt: 1, detailedSummary: notes('General', 'h', 'Same words') }, { id: 4, label: 'x', createdAt: 2, detailedSummary: notes('Sales', 'h', 'Other') }]));
        assert.equal(c.start('m1', [null, null]), null);
        assert.equal(c.start('m1', [99, null]), null);
        assert.equal(c.start('nope', [4, null]), null);
        assert.equal(c.start('m1', [3, null]), null, 'the same words under another model are not a comparison');
        assert.ok(c.start('m1', [4, null]));
    });

    test('the pick is stored with both sides and then reveals which was which; a second pick does nothing', () => {
        const cur = notes('General', 'model-g', 'General summary');
        const old = notes('Sales call', 'model-s', 'Sales summary');
        const s = store(cur, [{ id: 7, label: 'Sales call', createdAt: 1, detailedSummary: old }]);
        const c = new NotesComparisons(s, { random: () => 0.9, now: () => 1234, newId: () => 'cmp' });
        const started = c.start('m1', [7, null]);
        assert.equal(started.a.tldr[0], 'Sales summary', 'random 0.9: first given is A');
        assert.equal(c.pick('cmp', 'maybe'), null);
        const r = c.pick('cmp', 'B', '  more   specific  ');
        assert.equal(r.choice, 'B');
        assert.deepEqual(r.a, { version: 7, label: 'Sales call', provider: 'openai', model: 'model-s' });
        assert.deepEqual(r.b, { version: 'current', label: 'General', provider: 'openai', model: 'model-g' });
        assert.equal(r.saved, true);
        assert.equal(s.saved.length, 1);
        assert.equal(s.saved[0].choice, 'b');
        assert.equal(s.saved[0].reason, 'more specific');
        assert.equal(s.saved[0].aLabel, 'Sales call');
        assert.equal(s.saved[0].createdAt, 1234);
        assert.equal(c.pick('cmp', 'A'), null, 'answered once');
        assert.equal(r.removed, 7, 'the current notes won: the earlier version and its tab are gone');
        assert.equal(r.promoted, null);
        assert.deepEqual(s.versions, []);
        assert.equal(s.current, cur, 'the current notes are untouched');
    });
});

describe('Compare: the pick settles the tabs (2026-11-03)', () => {
    const notes = (name, tldr, extra = {}) => ({ schemaVersion: 3, tldr: [tldr], mode: { selectedModeName: name }, ...extra });
    const store = (current, versions) => ({
        current,
        versions: [...versions],
        getMeetingDetails(id) { return id === 'm1' ? { id, detailedSummary: this.current } : null; },
        getNotesVersions(id) { return id === 'm1' ? this.versions : []; },
        saveNotesComparison() { return true; },
        deleteNotesVersion(id, vid) { const n = this.versions.length; this.versions = this.versions.filter((v) => v.id !== vid); return this.versions.length < n; },
        replaceDetailedSummary(id, d) { this.current = d; return true; },
    });
    const v = (id, d, createdAt = id) => ({ id, label: d.mode.selectedModeName, createdAt, detailedSummary: d });

    test('settlePick (pure): the loser goes; an earlier winner over the current notes is promoted; same does nothing', () => {
        assert.deepEqual(settlePick('A', 7, null), { drop: null, promote: 7 });
        assert.deepEqual(settlePick('B', 7, null), { drop: 7, promote: null });
        assert.deepEqual(settlePick('A', null, 7), { drop: 7, promote: null });
        assert.deepEqual(settlePick('B', null, 7), { drop: null, promote: 7 });
        assert.deepEqual(settlePick('A', 3, 4), { drop: 4, promote: null });
        assert.equal(settlePick('same', 7, null), null);
        assert.equal(settlePick('A', 7, 7), null);
    });

    test('an earlier version beats the current notes: it becomes the notes, keeps the meeting\'s own fields, and its tab goes', () => {
        const cur = notes('1 to 1', 'Current', { speakerLabels: { s1: 'Dana' }, sharedScreens: [{ at: 1 }], meetingMemory: { m: 1 } });
        const old = notes('General', 'Older', { speakerLabels: { s1: 'speaker 1' } });
        const other = notes('General', 'Oldest');
        const s = store(cur, [v(1, other), v(2, old)]);
        const c = new NotesComparisons(s, { random: () => 0.9, newId: () => 'x' });
        c.start('m1', [2, null]);
        const r = c.pick('x', 'A');
        assert.equal(r.removed, 'current');
        assert.equal(r.promoted, 2);
        assert.equal(r.meetingId, 'm1');
        assert.deepEqual(s.current.tldr, ['Older']);
        assert.deepEqual(s.current.speakerLabels, { s1: 'Dana' }, 'renames made since stay');
        assert.deepEqual(s.current.sharedScreens, [{ at: 1 }]);
        assert.deepEqual(s.current.meetingMemory, { m: 1 });
        assert.deepEqual(s.versions.map((x) => x.id), [1], 'the promoted tab is not left as a duplicate; other tabs stay');
    });

    test('About the same deletes nothing', () => {
        const cur = notes('1 to 1', 'Current');
        const s = store(cur, [v(2, notes('General', 'Older'))]);
        const c = new NotesComparisons(s, { newId: () => 'x' });
        c.start('m1', [2, null]);
        const r = c.pick('x', 'same');
        assert.equal(r.removed, null);
        assert.equal(s.versions.length, 1);
        assert.equal(s.current, cur);
    });

    test('notes changed since the comparison opened (a Regenerate in between): nothing is deleted', () => {
        const cur = notes('1 to 1', 'Current');
        const s = store(cur, [v(2, notes('General', 'Older'))]);
        const c = new NotesComparisons(s, { random: () => 0.9, newId: () => 'x' });
        c.start('m1', [2, null]);
        s.current = notes('1 to 1', 'Regenerated meanwhile');
        const r = c.pick('x', 'A');
        assert.equal(r.removed, null);
        assert.equal(r.saved, true, 'the pick itself is still kept');
        assert.deepEqual(s.current.tldr, ['Regenerated meanwhile']);
        assert.equal(s.versions.length, 1);
    });

    test('a store that fails to write keeps everything and never throws', () => {
        const cur = notes('1 to 1', 'Current');
        const s = store(cur, [v(2, notes('General', 'Older'))]);
        s.replaceDetailedSummary = () => { throw new Error('disk'); };
        const c = new NotesComparisons(s, { random: () => 0.9, newId: () => 'x' });
        c.start('m1', [2, null]);
        const r = c.pick('x', 'A');
        assert.equal(r.removed, null);
        assert.equal(s.versions.length, 1);
        assert.equal(s.current, cur);
    });
});

describe('Compare: stored locally beside the ratings (database)', () => {
    let tmpDir;
    let DatabaseManager;
    let Database;
    const originalLoad = Module._load;

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-notes-compare-'));
        process.env.NATIVELY_TEST_USERDATA = tmpDir;
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
        ({ DatabaseManager } = require(dist('db/DatabaseManager.js')));
        Database = require('better-sqlite3');
    });
    after(() => {
        Module._load = originalLoad;
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    const readDb = (fn) => {
        const db = new Database(path.join(tmpDir, 'natively.db'), { readonly: true });
        try { return fn(db); } finally { db.close(); }
    };
    const v3 = (name, model, tldr) => ({
        schemaVersion: 3, title: 'Sync', tldr: [tldr], overview: '', whatChanged: [], decisions: [], actionItems: [], openQuestions: [], risks: [], sections: [],
        sourceQuality: { warnings: [] }, mode: { selectedModeName: name, selectedTemplateType: name.toLowerCase() }, generation: { strategy: 'direct', provider: 'gemini', model, startedAt: '2026-10-15T10:00:00Z' },
    });

    test('round trip: a pick is a row with both sides; reveal matches; deleting the meeting takes it', () => {
        const db = DatabaseManager.getInstance();
        db.saveMeeting({
            id: 'cmp-1', title: 'Sync', date: '2026-10-15T10:00:00.000Z', duration: '5:00', summary: '',
            detailedSummary: v3('General', 'model-g', 'General summary'),
            transcript: [{ speaker: 'user', text: 'hello there', timestamp: 1, origin: 'stt' }], usage: [], isProcessed: true,
        }, Date.now(), 300000);
        const vid = db.archiveNotesVersion('cmp-1', v3('Sales', 'model-s', 'Sales summary'));
        assert.equal(typeof vid, 'number');
        const c = new NotesComparisons(db, { random: () => 0.1, now: () => 777 });
        const s = c.start('cmp-1', [vid, null]);
        assert.ok(s, 'two versions to compare');
        assert.equal(s.a.tldr[0], 'General summary', 'random 0.1: the second given is A');
        const r = c.pick(s.id, 'same');
        assert.equal(r.saved, true);
        assert.equal(r.a.version, 'current');
        assert.equal(r.b.version, vid);
        const rows = db.listNotesComparisons();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].choice, 'same');
        assert.equal(rows[0].aLabel, 'General');
        assert.equal(rows[0].bModel, 'model-s');
        assert.equal(rows[0].reason, null);
        assert.equal(rows[0].aHash.length, 32);
        assert.equal(db.saveNotesComparison({ ...rows[0], choice: 'better' }), false);
        // Re-opening the database runs the schema again: idempotent, the row stays.
        assert.equal(readDb((d) => d.prepare("SELECT COUNT(*) AS n FROM meeting_notes_comparisons WHERE meeting_id = 'cmp-1'").get().n), 1);
        assert.equal(db.getNotesVersions('cmp-1').length, 1, 'About the same keeps both');
        // A second comparison the earlier version wins: it becomes the notes, its row goes.
        const c2 = new NotesComparisons(db, { random: () => 0.9 });
        const s2 = c2.start('cmp-1', [vid, null]);
        const r2 = c2.pick(s2.id, 'A');
        assert.equal(r2.removed, 'current');
        assert.deepEqual(db.getMeetingDetails('cmp-1').detailedSummary.tldr, ['Sales summary']);
        assert.equal(db.getNotesVersions('cmp-1').length, 0);
        assert.equal(db.deleteNotesVersion('cmp-1', vid), false, 'already gone');
        assert.equal(db.deleteMeeting('cmp-1'), true);
        assert.equal(readDb((d) => d.prepare("SELECT COUNT(*) AS n FROM meeting_notes_comparisons WHERE meeting_id = 'cmp-1'").get().n), 0);
    });

    test('the table is created on an existing database by the idempotent schema step', () => {
        const src = fs.readFileSync(path.join(REPO, 'electron/db/DatabaseManager.ts'), 'utf8');
        const fn = src.slice(src.indexOf('private ensureMeetingNotesSchema'), src.indexOf('public saveNotesComparison'));
        assert.match(fn, /CREATE TABLE IF NOT EXISTS meeting_notes_comparisons/);
        assert.match(fn, /ON DELETE CASCADE/);
    });
});
