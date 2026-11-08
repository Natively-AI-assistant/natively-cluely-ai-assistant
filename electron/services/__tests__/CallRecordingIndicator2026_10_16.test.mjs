// Granola parity round 5 (2026-10-16): the meeting app's own recording
// indicator, read from the Zoom / Teams window tree like the other call facts
// (callFacts.recordingFromTree). Read-only; fixture trees, hand-written like
// the rest of the call-tree fixtures (UNVERIFIED against live apps).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const facts = require(path.join(REPO, 'dist-electron/electron/services/meetingDetection/callFacts.js'));

const node = (role, name = '', description = '', extra = {}) => ({ depth: 1, role, name, description, value: '', id: '', ...extra });
const tree = (nodes, trusted = true) => ({ trusted, truncated: false, windows: [{ title: 'Zoom Meeting', nodes }] });

describe('recordingFromTree', () => {
    test('Zoom\'s recording indicator says the call is being recorded', () => {
        assert.equal(facts.recordingFromTree(tree([node('AXButton', '', 'Computer recording'), node('AXStaticText', 'Recording...')])), true);
        assert.equal(facts.recordingFromTree(tree([node('AXButton', 'Smart recording in progress')])), true);
    });
    test('Teams\' banner says the call is being recorded', () => {
        assert.equal(facts.recordingFromTree(tree([node('AXStaticText', 'Recording and transcription have started')])), true);
        assert.equal(facts.recordingFromTree(tree([node('AXStaticText', 'This meeting is being recorded')])), true);
    });
    test('a stopped or unavailable recording is false; a plain window is null', () => {
        assert.equal(facts.recordingFromTree(tree([node('AXStaticText', 'Recording stopped')])), false);
        assert.equal(facts.recordingFromTree(tree([node('AXButton', 'Mute'), node('AXButton', 'Participants (5)')])), null);
    });
    test('an untrusted or missing tree is null, and a chat panel is never read', () => {
        assert.equal(facts.recordingFromTree(tree([node('AXStaticText', 'Recording...')], false)), null);
        assert.equal(facts.recordingFromTree(null), null);
        assert.equal(facts.recordingFromTree(tree([node('AXGroup', 'Chat', '', { id: 'chat' })])), null);
    });
    test('readCallFacts carries it', () => {
        const solved = { people: [], selfNames: [], selfSpeaking: false };
        assert.equal(facts.readCallFacts('zoom', tree([node('AXStaticText', 'This meeting is being recorded')]), solved).recording, true);
        assert.equal(facts.readCallFacts('zoom', null, solved).recording, null);
    });
});
