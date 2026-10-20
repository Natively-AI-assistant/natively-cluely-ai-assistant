// Granola parity round 2, outputs (2026-10-15): the follow-up email edited in
// place on the meeting page. The edit is saved with the meeting (summary_json's
// detailedSummary.followUpDraft, where the generated draft lives) and survives a
// reopen; Copy / Open in Gmail of an EDITED body records one writing sample per
// meeting for the style profile; an untouched draft records nothing.
//
// Run under the electron runner (better-sqlite3's ABI), after `npm run build:electron`:
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
// Paths go through node:path and os.tmpdir(); no platform branch is involved.
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
const edit = require(dist('services/outputs/followUpEdit.js'));
const style = require(dist('services/outputs/writingStyle.js'));

const DRAFT = { type: 'email', subject: 'Where we landed on pricing', body: 'Hi Sam,\n\nThanks for the time today. We agreed to hold the list price.\n\nBest,\nEvin', tone: 'professional' };
const EDITED = 'Hey Sam,\n\nQuick note: we are holding list price, sheet comes Friday. Shout if anything looks off!\n\nThanks,\nEvin';

describe('applying an edit (pure)', () => {
    test('first edit keeps the model text beside it and stamps the edit', () => {
        const r = edit.applyFollowUpEdit({ schemaVersion: 3, followUpDraft: DRAFT }, { body: EDITED }, 1000);
        assert.equal(r.ok, true);
        assert.equal(r.changed, true);
        assert.equal(r.draft.body, EDITED);
        assert.equal(r.draft.subject, DRAFT.subject, 'an absent subject is left as saved');
        assert.deepEqual(r.draft.generated, { subject: DRAFT.subject, body: DRAFT.body });
        assert.equal(r.draft.editedAt, 1000);
        assert.equal(r.draft.tone, 'professional');
        assert.equal(r.detailed.schemaVersion, 3);
    });
    test('a second edit keeps the ORIGINAL model text; editing back to it clears the edit', () => {
        const once = edit.applyFollowUpEdit({ followUpDraft: DRAFT }, { body: EDITED }, 1);
        const twice = edit.applyFollowUpEdit(once.detailed, { body: `${EDITED}\nP.S. one more` }, 2);
        assert.equal(twice.draft.generated.body, DRAFT.body);
        const back = edit.applyFollowUpEdit(twice.detailed, { body: DRAFT.body }, 3);
        assert.equal(back.draft.generated, undefined);
        assert.equal(back.draft.editedAt, undefined);
    });
    test('subject is one line and capped; unchanged text is not a change; empty body refused; no draft refused', () => {
        const r = edit.applyFollowUpEdit({ followUpDraft: DRAFT }, { subject: '  New\nsubject  ' + 'x'.repeat(400) }, 1);
        assert.ok(!r.draft.subject.includes('\n') && r.draft.subject.length === edit.FOLLOW_UP_SUBJECT_MAX);
        assert.equal(edit.applyFollowUpEdit({ followUpDraft: DRAFT }, { body: DRAFT.body, subject: DRAFT.subject }, 1).changed, false);
        assert.deepEqual(edit.applyFollowUpEdit({ followUpDraft: DRAFT }, { body: '   ' }, 1), { ok: false, reason: 'empty' });
        assert.deepEqual(edit.applyFollowUpEdit({}, { body: 'x' }, 1), { ok: false, reason: 'no_draft' });
    });
    test('an old plain-string draft becomes an object; a draft with no subject stays without one', () => {
        const r = edit.applyFollowUpEdit({ followUpDraft: 'Old body text' }, { body: 'New body text' }, 1);
        assert.equal(r.draft.body, 'New body text');
        assert.equal('subject' in r.draft, false);
    });
    test('a sample only for an edited body', () => {
        assert.equal(edit.followUpSample(DRAFT), null);
        const subjectOnly = edit.applyFollowUpEdit({ followUpDraft: DRAFT }, { subject: 'Another' }, 1).draft;
        assert.equal(edit.followUpSample(subjectOnly), null, 'a new subject says little about how they write');
        assert.deepEqual(edit.followUpSample(edit.applyFollowUpEdit({ followUpDraft: DRAFT }, { body: EDITED }, 1).draft), { finalText: EDITED, draftText: DRAFT.body });
    });
});

describe('one learned sample per meeting', () => {
    test('a newer edit of the same meeting replaces the older sample; other meetings keep theirs', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-fu-style-'));
        try {
            const svc = new style.WritingStyleService({ dir });
            assert.equal(svc.recordFollowUp(EDITED, DRAFT.body, 'm1'), true);
            assert.equal(svc.recordFollowUp(`${EDITED} Also, see you Tuesday.`, DRAFT.body, 'm1'), true);
            assert.equal(svc.recordFollowUp(EDITED.replace('Sam', 'Priya'), DRAFT.body, 'm2'), true);
            const list = svc.listSamples();
            assert.equal(list.length, 2);
            assert.ok(list.some((s) => s.preview.includes('see you Tuesday')));
            assert.equal(svc.recordFollowUp(DRAFT.body, DRAFT.body, 'm3'), false, 'unedited');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('saved with the meeting, through the IPC handler', () => {
    let tmpDir;
    let DatabaseManager;
    let ipc;
    const handlers = new Map();
    const SENDER = { id: 1 };
    const originalLoad = Module._load;

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-fu-edit-'));
        process.env.NATIVELY_TEST_USERDATA = tmpDir;
        const electronStub = {
            app: { getPath: () => tmpDir, isPackaged: false, isReady: () => true, getVersion: () => '0.0.0', getLocale: () => 'en-US', on: () => {}, once: () => {}, whenReady: () => Promise.resolve(), focus: () => {} },
            BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
            safeStorage: { isEncryptionAvailable: () => false },
            dialog: {}, shell: {}, ipcMain: { handle: () => {}, on: () => {} },
            Notification: class { static isSupported() { return false; } on() {} show() {} },
        };
        Module._load = function (request, parent, isMain) {
            if (request === 'electron') return electronStub;
            return originalLoad.call(this, request, parent, isMain);
        };
        ({ DatabaseManager } = require(dist('db/DatabaseManager.js')));
        ipc = require(dist('services/outputs/outputsIpc.js'));
        const appState = {
            getWindowHelper: () => ({ getLauncherWindow: () => ({ isDestroyed: () => false, webContents: SENDER }) }),
            getUndetectable: () => false,
            processingHelper: { getLLMHelper: () => null },
        };
        ipc.registerOutputsIpc(appState, (channel, fn) => handlers.set(channel, fn));
        const start = Date.now() - 600_000;
        DatabaseManager.getInstance().saveMeeting({
            id: 'fu-1', title: 'Pricing', date: new Date(start).toISOString(), duration: '10:00', summary: '',
            detailedSummary: { schemaVersion: 3, title: 'Pricing', tldr: ['Held list price'], sectionsV3: [], actionItems: [], keyPoints: [], followUpDraft: DRAFT, mode: { selectedModeId: 'mode-sales' } },
            transcript: [], usage: [], isProcessed: true, summaryStatus: 'completed',
        }, start, 600_000);
        // Ran under no recorded mode: it counts as General (2026-10-19).
        DatabaseManager.getInstance().saveMeeting({
            id: 'fu-2', title: 'No mode', date: new Date(start).toISOString(), duration: '10:00', summary: '',
            detailedSummary: { schemaVersion: 3, title: 'No mode', tldr: [], sectionsV3: [], actionItems: [], keyPoints: [], followUpDraft: DRAFT },
            transcript: [], usage: [], isProcessed: true, summaryStatus: 'completed',
        }, start, 600_000);
    });
    after(() => {
        Module._load = originalLoad;
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    const save = (payload, sender = SENDER) => handlers.get('outputs:followup-save')({ sender }, payload);

    test('only the launcher may save', async () => {
        const res = await save({ meetingId: 'fu-1', body: EDITED }, { id: 99 });
        assert.equal(res.ok, false);
        assert.equal(DatabaseManager.getInstance().getMeetingDetails('fu-1').detailedSummary.followUpDraft.body, DRAFT.body);
    });
    test('the edit is saved and is what a reopened meeting shows; nothing is learned until it is used', async () => {
        const res = await save({ meetingId: 'fu-1', subject: 'Holding list price', body: EDITED });
        assert.equal(res.ok, true);
        assert.equal(res.recorded, false);
        const reopened = DatabaseManager.getInstance().getMeetingDetails('fu-1').detailedSummary;
        assert.equal(reopened.followUpDraft.body, EDITED);
        assert.equal(reopened.followUpDraft.subject, 'Holding list price');
        assert.equal(reopened.followUpDraft.generated.body, DRAFT.body);
        assert.deepEqual(reopened.tldr, ['Held list price'], 'the notes themselves are untouched');
        assert.equal(reopened.userEditedAt, undefined, 'editing the email does not mark the notes as hand-edited');
        assert.equal(ipc.getWritingStyleService('mode-sales').status().learnedCount, 0);
    });
    test('Copy (used) of the edited email records it once as a writing sample', async () => {
        const res = await save({ meetingId: 'fu-1', used: true });
        assert.equal(res.ok, true);
        assert.equal(res.recorded, true);
        await save({ meetingId: 'fu-1', used: true });
        const st = ipc.getWritingStyleService('mode-sales').status();
        assert.equal(st.learnedCount, 1, 'deduped: the same meeting adds one sample');
        assert.ok(ipc.getWritingStyleService('mode-sales').listSamples()[0].preview.startsWith('Hey Sam,'));
        assert.equal(ipc.getWritingStyleService('mode-other').status().sampleCount, 0, 'only the mode the meeting ran under learns');
    });
    test('a meeting with no recorded mode counts as General: its edits teach General, and the page asks General (2026-10-19)', async () => {
        const general = ipc.meetingStyleModeId({});
        assert.ok(general, 'the built-in General mode');
        assert.equal(ipc.meetingStyleModeId({ mode: { selectedModeId: 'mode-sales' } }), 'mode-sales', 'a recorded mode wins');
        const res = await save({ meetingId: 'fu-2', body: EDITED, used: true });
        assert.equal(res.ok, true);
        assert.equal(res.recorded, true);
        assert.equal(ipc.getWritingStyleService(general).status().learnedCount, 1);
        const forMeeting = (id) => handlers.get('outputs:style-get-for-meeting')({ sender: SENDER }, id);
        assert.equal((await forMeeting('fu-2')).learnedCount, 1, "General's samples");
        assert.equal((await forMeeting('fu-1')).learnedCount, 1, "Sales' samples, not General's");
        assert.equal(await forMeeting('no-such-meeting'), null);
        assert.equal(await handlers.get('outputs:style-get-for-meeting')({ sender: { id: 99 } }, 'fu-2'), null, 'launcher only');
    });
    test('the style calls are per mode: each names its mode, none answers without one', async () => {
        const call = (ch, ...args) => handlers.get(ch)({ sender: SENDER }, ...args);
        assert.equal(await call('outputs:style-get'), null);
        assert.deepEqual(await call('outputs:style-list'), []);
        assert.equal((await call('outputs:style-add', undefined, EDITED)).ok, false);
        const added = await call('outputs:style-add', 'mode-tech', 'Hi team,\n\nShort update: the build is green and the release goes out Monday.\n\nCheers,\nEvin');
        assert.equal(added.ok, true);
        assert.equal((await call('outputs:style-get', 'mode-tech')).pastedCount, 1);
        assert.equal((await call('outputs:style-get', 'mode-sales')).pastedCount, 0);
        assert.equal(handlers.has('outputs:style-set-enabled'), false, 'no on/off: samples are used when there are any');
    });
    test('an emptied body is refused and the saved email stays', async () => {
        const res = await save({ meetingId: 'fu-1', body: '  ' });
        assert.equal(res.ok, false);
        assert.ok(!/\d{3}/.test(res.message));
        assert.equal(DatabaseManager.getInstance().getMeetingDetails('fu-1').detailedSummary.followUpDraft.body, EDITED);
    });
    test('an unknown meeting is refused in plain words', async () => {
        const res = await save({ meetingId: 'nope', body: 'x' });
        assert.equal(res.ok, false);
        assert.match(res.message, /could not be found/);
    });
});
