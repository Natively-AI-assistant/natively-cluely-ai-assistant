// Granola parity round 4 (2026-10-16): people sharing the microphone. The mic
// channel's provider voice ids are split at save: the loudest voice stays the
// user, each other real voice becomes "Speaker N" past the ids already in use;
// flicker folds into the user. Pure logic.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const room = require(path.join(REPO, 'dist-electron/electron/services/meeting/roomSpeakers.js'));

const mic = (speakerId, text) => ({ speaker: 'user', text, timestamp: 1, final: true, ...(speakerId ? { speakerId } : {}) });
const them = (text, speakerId) => ({ speaker: 'interviewer', text, timestamp: 1, final: true, ...(speakerId ? { speakerId } : {}) });
const many = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('splitRoomSpeakers', () => {
    test('no voice ids, or one voice: the transcript is returned as is', () => {
        const plain = [mic(undefined, 'hello there'), them('hi')];
        assert.equal(room.splitRoomSpeakers(plain).transcript, plain);
        const one = [mic('0', many(20)), mic('0', many(5)), mic('0', many(5))];
        assert.equal(room.splitRoomSpeakers(one).voices, 0);
    });

    test('the loudest voice stays the user; a second real voice becomes Speaker 2; ids are stripped from mic lines', () => {
        const lines = [mic('0', many(30)), mic('1', many(10)), mic('0', many(10)), mic('1', many(8)), mic('1', many(6)), them('ok')];
        const r = room.splitRoomSpeakers(lines);
        assert.equal(r.voices, 1);
        assert.equal(r.transcript[0].speaker, 'user');
        assert.equal(r.transcript[1].speaker, 'Speaker 2');
        assert.equal(r.transcript[3].speaker, 'Speaker 2');
        assert.equal(r.transcript[4].speaker, 'Speaker 2');
        assert.ok(r.transcript.slice(0, 5).every((l) => !('speakerId' in l)), 'mic voice ids are not stored');
        assert.equal(r.transcript[5], lines[5], 'other-side lines are untouched');
        assert.deepEqual([...r.renamed.entries()], [[1, 'Speaker 2'], [3, 'Speaker 2'], [4, 'Speaker 2']]);
    });

    test('numbers skip the call\'s named people and any speaker_N already on the other side', () => {
        const lines = [mic('a', many(30)), mic('b', many(20)), mic('b', many(5)), mic('b', many(5)), them('x', 'speaker_3')];
        const r = room.splitRoomSpeakers(lines, { usedIds: ['speaker_2'] });
        assert.equal(r.transcript[1].speaker, 'Speaker 4');
    });

    test('a faint voice (under the share or line threshold) folds into the user', () => {
        const byShare = [mic('0', many(50)), mic('1', many(2)), mic('1', many(2)), mic('1', many(2))];
        assert.equal(room.splitRoomSpeakers(byShare).voices, 0);
        const byLines = [mic('0', many(20)), mic('1', many(15)), mic('1', many(15))];
        assert.equal(room.splitRoomSpeakers(byLines).voices, 0);
    });

    test('several room voices get consecutive numbers, loudest first', () => {
        const lines = [
            mic('x', many(40)),
            mic('y', many(20)), mic('y', many(5)), mic('y', many(5)),
            mic('z', many(12)), mic('z', many(5)), mic('z', many(5)),
        ];
        const r = room.splitRoomSpeakers(lines);
        assert.equal(r.voices, 2);
        assert.equal(r.transcript[1].speaker, 'Speaker 2');
        assert.equal(r.transcript[4].speaker, 'Speaker 3');
    });

    test('the "me" label counts as the mic channel too', () => {
        const lines = [{ speaker: 'Me', text: many(30), speakerId: '0' }, { speaker: 'Me', text: many(10), speakerId: '1' }, { speaker: 'Me', text: many(10), speakerId: '1' }, { speaker: 'Me', text: many(10), speakerId: '1' }];
        assert.equal(room.splitRoomSpeakers(lines).transcript[1].speaker, 'Speaker 2');
    });
});

describe('nextSpeakerNumber', () => {
    test('first free number from 2, skipping taken ids', () => {
        assert.equal(room.nextSpeakerNumber(new Set()), 2);
        assert.equal(room.nextSpeakerNumber(new Set(['speaker_2', 'speaker_3'])), 4);
    });
});
