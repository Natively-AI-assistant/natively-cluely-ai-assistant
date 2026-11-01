// The notepad has no folders (2026-11-01). Its "Add to folder" button (2026-10-20)
// went when folders lost their launcher view (22d35e0d): a meeting filed there
// went nowhere anyone could see. The session, IPC, preload and main plumbing
// went with it; stored folders are left alone (OrganiseStore is untouched).
// Pure source reads, no platform branches: the same on macOS and Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('the live notes session holds no folders and Stop files nothing', () => {
    const { LiveNotesSession } = require(path.resolve(root, 'dist-electron/electron/services/meeting/liveNotesSession.js'));
    const s = new LiveNotesSession({ setLive() {}, saveEnded() {}, broadcast() {} });
    assert.equal(typeof s.setFolder, 'undefined');
    assert.equal(typeof s.getFolders, 'undefined');
    s.meetingStarted();
    assert.doesNotThrow(() => s.meetingEnded('m1'));
    assert.equal(s.getState().phase, 'ended');
});

test('no folder channel, bridge, type or main hook is left for the notepad', () => {
    assert.doesNotMatch(read('electron/ipcHandlers.ts'), /live-notes:(folders|set-folder|create-folder)/);
    assert.doesNotMatch(read('electron/preload.ts'), /liveNotes(Folders|SetFolder|CreateFolder)/);
    assert.doesNotMatch(read('src/types/electron.d.ts'), /liveNotes(Folders|SetFolder|CreateFolder)/);
    assert.doesNotMatch(read('electron/main.ts'), /fileInFolder|fileMeetingInFolder/);
    assert.doesNotMatch(read('electron/services/meeting/liveNotesSession.ts'), /fileInFolder|folders/);
    // The folders themselves stay: the store still exists for the data already in it.
    assert.match(read('electron/services/organise/organiseService.ts'), /export function organiseStore/);
});
