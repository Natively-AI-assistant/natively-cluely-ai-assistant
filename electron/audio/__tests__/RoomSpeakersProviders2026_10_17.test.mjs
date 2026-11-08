// People sharing the microphone, on every provider whose live stream labels
// voices reliably (2026-10-17): Natively (its relay), Deepgram and Soniox.
// Covers the shared label helpers (sttDiarization.ts), the save-time split
// across provider connections (roomSpeakers.ts: voice numbers restart on a
// reconnect, so only the largest window is split), the Settings list pinned to
// the backend's, and the wiring in each provider and main.ts (from source: the
// providers open real sockets). Google was tried and left out: its stream
// restarts every 4.5 minutes, so every meeting is short windows.
//
// Run (after `npm run build:electron`):
//   node scripts/run-with-env.mjs --default-tmpdir NATIVELY_TEST_USERDATA=natively-test-userdata \
//     --set ELECTRON_RUN_AS_NODE=1 -- electron --test --test-force-exit <this file>
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const dia = require(path.join(REPO, 'dist-electron/electron/audio/sttDiarization.js'));
const room = require(path.join(REPO, 'dist-electron/electron/services/meeting/roomSpeakers.js'));

const many = (n, w = 'word') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const mic = (speakerId, text) => ({ speaker: 'user', text, timestamp: 1, final: true, ...(speakerId ? { speakerId } : {}) });

describe('voice label helpers', () => {
    test('provider labels become canonical ids', () => {
        assert.equal(dia.voiceIdFromLabel('1'), 'speaker_1');
        assert.equal(dia.voiceIdFromLabel(2), 'speaker_2');
        assert.equal(dia.voiceIdFromLabel(' 3 '), 'speaker_3');
        assert.equal(dia.voiceIdFromLabel('spk A'), 'speaker_spk_A');
        for (const bad of [undefined, null, '', '  ', 0, '0', -1, 1.5, {}]) assert.equal(dia.voiceIdFromLabel(bad), undefined, String(bad));
    });

    test('Soniox tokens split into one run per voice; unlabelled pieces join their run', () => {
        const tokens = [
            { text: 'Hi', speaker: '1' }, { text: ' there' , speaker: '1' }, { text: ',' },
            { text: ' sure', speaker: '2' }, { text: ' thing', speaker: '2' }, { text: '.' },
            { text: ' Great', speaker: '1' },
        ];
        assert.deepEqual(dia.runsByVoice(tokens, (t) => t.text, (t) => t.speaker), [
            { text: 'Hi there,', speakerId: 'speaker_1' },
            { text: ' sure thing.', speakerId: 'speaker_2' },
            { text: ' Great', speakerId: 'speaker_1' },
        ]);
        assert.deepEqual(dia.runsByVoice([{ text: 'no labels' }, { text: ' at all' }], (t) => t.text, (t) => t.speaker),
            [{ text: 'no labels at all' }], 'no labels: one run, no id');
        assert.deepEqual(dia.runsByVoice([{ text: '  ' }], (t) => t.text, (t) => t.speaker), [], 'blank runs dropped');
    });

    test('window numbers are unique across the app, never reused by a rebuilt provider', () => {
        const a = dia.nextVoiceEpoch(), b = dia.nextVoiceEpoch(), c = dia.nextVoiceEpoch();
        assert.ok(a < b && b < c, 'strictly increasing');
    });

    test('labels are asked for only where opted in', () => {
        assert.equal(dia.shouldDiarize('user', { roomSpeakers: true, remoteFlag: false }), true);
        assert.equal(dia.shouldDiarize('user', { roomSpeakers: false, remoteFlag: true }), false, 'the remote flag never labels the mic');
        assert.equal(dia.shouldDiarize('interviewer', { roomSpeakers: true, remoteFlag: false }), false, 'the room setting never labels the call');
        assert.equal(dia.shouldDiarize('interviewer', { roomSpeakers: false, remoteFlag: true }), true);
        assert.equal(dia.shouldDiarize('other', { roomSpeakers: true, remoteFlag: true }), false);
    });

    test('connection tags round-trip', () => {
        assert.equal(dia.withVoiceEpoch('speaker_2', 3), 'speaker_2@3');
        assert.equal(dia.withVoiceEpoch('speaker_2', undefined), 'speaker_2');
        assert.deepEqual(dia.parseVoiceId('speaker_2@3'), { voice: 'speaker_2', epoch: '3' });
        assert.deepEqual(dia.parseVoiceId('speaker_2'), { voice: 'speaker_2', epoch: '' });
        assert.equal(dia.canDiarize({ setDiarization() {} }), true);
        assert.equal(dia.canDiarize({}), false);
        assert.equal(dia.canDiarize(null), false);
    });
});

describe('the split across provider connections', () => {
    test('only the largest window is split; a later window where the colleague talks most is never named as you', () => {
        // Window 1 (most of the meeting): speaker_1 is the user. Window 2,
        // after a reconnect: the colleague talks most, under speaker_1.
        const lines = [
            mic('speaker_1@1', many(30)), mic('speaker_2@1', many(8, 'c')), mic('speaker_1@1', many(20)),
            mic('speaker_2@1', many(6, 'c')), mic('speaker_2@1', many(5, 'c')),
            mic('speaker_1@2', many(25, 'c')), mic('speaker_2@2', many(4)), mic('speaker_1@2', many(9, 'c')),
        ];
        const split = room.splitRoomSpeakers(lines);
        assert.equal(split.voices, 1);
        assert.deepEqual(split.transcript.map((l) => l.speaker),
            ['user', 'Speaker 2', 'user', 'Speaker 2', 'Speaker 2', 'user', 'user', 'user'],
            'window 2 stays as before the setting: nobody named, the user never renamed');
        assert.ok(split.transcript.every((l) => !('speakerId' in l)), 'provider voice ids are not kept');
    });

    test('when the later window is the larger one, it is the one split, by its own counts', () => {
        const lines = [
            mic('speaker_1@1', many(10)), mic('speaker_2@1', many(10, 'c')),
            mic('speaker_2@2', many(60)), mic('speaker_1@2', many(12, 'c')), mic('speaker_1@2', many(12, 'c')), mic('speaker_1@2', many(12, 'c')),
        ];
        const split = room.splitRoomSpeakers(lines);
        assert.equal(split.voices, 1);
        assert.deepEqual(split.transcript.map((l) => l.speaker), ['user', 'user', 'user', 'Speaker 2', 'Speaker 2', 'Speaker 2']);
    });

    test('the user alone, renumbered by reconnects, is never split', () => {
        const lines = [mic('speaker_1@1', many(30)), mic('speaker_1@2', many(30)), mic('speaker_2@3', many(30)), mic('speaker_1@4', many(5))];
        assert.equal(room.splitRoomSpeakers(lines).voices, 0);
    });

    test('a single connection behaves exactly as before', () => {
        const lines = [
            mic('speaker_1', many(40)), mic('speaker_2', many(10, 'b')), mic('speaker_2', many(10, 'b')),
            mic('speaker_2', many(10, 'b')), mic('speaker_3', many(2, 'x')),
        ];
        const split = room.splitRoomSpeakers(lines);
        assert.equal(split.voices, 1);
        assert.deepEqual(split.transcript.map((l) => l.speaker), ['user', 'Speaker 2', 'Speaker 2', 'Speaker 2', 'user']);
    });

    test('a third person gets their own number, past the call\'s named people', () => {
        const lines = [
            mic('speaker_1@1', many(50)), mic('speaker_2@1', many(15, 'b')), mic('speaker_2@1', many(15, 'b')), mic('speaker_2@1', many(15, 'b')),
            mic('speaker_3@1', many(12, 'c')), mic('speaker_3@1', many(12, 'c')), mic('speaker_3@1', many(12, 'c')),
        ];
        const split = room.splitRoomSpeakers(lines, { usedIds: ['speaker_2'] });
        assert.equal(split.voices, 2);
        assert.deepEqual(new Set(split.transcript.filter((l) => l.speaker !== 'user').map((l) => l.speaker)), new Set(['Speaker 3', 'Speaker 4']));
    });
});

describe('switching labels off really switches them off', () => {
    test('Soniox: the config frame asks for labels only while they are on', () => {
        const { SonioxStreamingSTT } = require(path.join(REPO, 'dist-electron/electron/audio/SonioxStreamingSTT.js'));
        const stt = new SonioxStreamingSTT('test-key');
        assert.equal('enable_speaker_diarization' in stt.buildConfigFrame(), false, 'off by default');
        stt.setDiarization(true);
        assert.equal(stt.buildConfigFrame().enable_speaker_diarization, true);
        stt.setDiarization(false);
        assert.equal('enable_speaker_diarization' in stt.buildConfigFrame(), false, 'off again after the setting is turned off');
    });

    test('Natively: the auth frame asks the relay only while they are on', () => {
        const { NativelyProSTT } = require(path.join(REPO, 'dist-electron/electron/audio/NativelyProSTT.js'));
        const stt = new NativelyProSTT('test-key', 'mic');
        assert.equal('speaker_labels' in stt.buildLegacyAuthFrame(), false, 'off by default');
        stt.setDiarization(true);
        assert.equal(stt.buildLegacyAuthFrame().speaker_labels, true);
        stt.setDiarization(false);
        assert.equal('speaker_labels' in stt.buildLegacyAuthFrame(), false, 'off again after the setting is turned off');
    });
});

describe('which providers can label voices', () => {
    const SOURCES = {
        deepgram: 'electron/audio/DeepgramStreamingSTT.ts',
        soniox: 'electron/audio/SonioxStreamingSTT.ts',
        natively: 'electron/audio/NativelyProSTT.ts',
    };
    const CANNOT = [
        'electron/audio/ElevenLabsStreamingSTT.ts', 'electron/audio/OpenAIStreamingSTT.ts', 'electron/audio/RestSTT.ts',
        'electron/audio/NvidiaNimStreamingSTT.ts', 'electron/audio/AppleSpeechSTT.ts',
        'electron/audio/LocalWhisperSTT.ts', 'electron/audio/GoogleSTT.ts',
    ];

    test('the Settings list is the backend\'s list', () => {
        const ui = read('src/components/settings/roomSpeakersProviders.ts');
        const m = /ROOM_SPEAKERS_PROVIDERS[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(ui);
        assert.ok(m, 'ROOM_SPEAKERS_PROVIDERS found');
        const uiSet = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
        assert.deepEqual([...uiSet].sort(), [...dia.DIARIZING_STT_PROVIDERS].sort());
        assert.deepEqual([...dia.DIARIZING_STT_PROVIDERS].sort(), Object.keys(SOURCES).sort());
    });

    test('each listed provider can be asked; the others cannot', () => {
        for (const [id, rel] of Object.entries(SOURCES)) assert.match(read(rel), /public setDiarization\(enabled: boolean\): void/, id);
        for (const rel of CANNOT) assert.doesNotMatch(read(rel), /setDiarization\(/, rel);
    });

    test('Soniox: labels are a config field, finals split by voice, the old single final without', () => {
        const src = read(SOURCES.soniox);
        assert.match(src, /if \(this\.diarize\) config\.enable_speaker_diarization = true;/);
        assert.match(src, /const runs = this\.diarize \? runsByVoice\(finalTokens, .*\) : \[\];/);
        assert.match(src, /speakerId: run\.speakerId, voiceEpoch \}/, 'the connection\'s own window, not a field read later');
        assert.match(src, /const voiceEpoch = nextVoiceEpoch\(\);/);
    });

    test('Deepgram: each connection keeps its own window number', () => {
        const src = read(SOURCES.deepgram);
        assert.match(src, /const voiceEpoch = nextVoiceEpoch\(\);/);
        assert.match(src, /\.\.\.\(speakerId \? \{ speakerId, voiceEpoch \} : \{\}\)/);
        assert.doesNotMatch(src, /this\.voiceEpoch/);
    });

    test('Natively: the flag rides in the auth frame; labels and both connection counts come back', () => {
        const src = read(SOURCES.natively);
        assert.match(src, /\.\.\.\(this\.diarize \? \{ speaker_labels: true \} : \{\}\)/);
        assert.match(src, /const socketEpoch = nextVoiceEpoch\(\);/, 'each socket its own window');
        assert.match(src, /const speakerId = voiceIdFromLabel\(msg\.speaker\)/);
        assert.match(src, /voiceEpoch: socketEpoch \* 1000 \+ upstream/);
        // The relay frame (regional relays, dormant) does not carry it.
        const relayFrame = src.slice(src.indexOf('private buildAuthFrame('), src.indexOf('private contextTermsField('));
        assert.doesNotMatch(relayFrame, /speaker_labels/);
    });

    test('main.ts: labels follow the setting at every meeting start, both ways, before any stream opens', () => {
        const main = read('electron/main.ts');
        assert.doesNotMatch(main, /dg\.setDiarization/, 'no Deepgram-only switch-on left');
        assert.doesNotMatch(main, /setDiarization\(true\)/, 'never switched on unconditionally');
        const body = main.slice(main.indexOf('private applyVoiceLabels('), main.indexOf('private createSTTProvider('));
        assert.match(body, /stt\.setDiarization\(shouldDiarize\(speaker, \{/, 'set to the setting, so OFF switches it off');
        assert.match(body, /roomSpeakers: SettingsManager\.getInstance\(\)\.get\('roomSpeakersEnabled'\) === true/);
        assert.match(body, /remoteFlag: stt instanceof DeepgramStreamingSTT && isIntelligenceFlagEnabled\('speakerDiarizationV1'\)/, 'the old flag keeps its Deepgram-only scope');
        // A fresh provider, before its start().
        const atBuild = main.indexOf('this.applyVoiceLabels(stt, speaker);');
        assert.ok(atBuild > 0 && main.indexOf('stt.start();', atBuild) > atBuild);
        // Every meeting start, before the channels (and their streams) start.
        const userAt = main.indexOf("this.applyVoiceLabels(this.googleSTT_User, 'user');");
        const sysAt = main.indexOf("this.applyVoiceLabels(this.googleSTT, 'interviewer');");
        const reconfigureAt = main.indexOf('await this.reconfigureAudio(followedInput');
        const startAt = main.indexOf("this.startCaptureChannels('startMeeting')");
        assert.ok(userAt > 0 && sysAt > 0, 'applied at meeting start');
        // reconfigureAudio() starts the channels itself once the meeting is
        // active, so the setting must land before it, not just before
        // startCaptureChannels: a change on a live stream restarts it.
        assert.ok(reconfigureAt > userAt && reconfigureAt > sysAt && startAt > reconfigureAt, 'applied before the first stream can start');
        assert.equal(main.split("this.applyVoiceLabels(this.googleSTT_User, 'user');").length - 1, 1, 'once per meeting start, never on a live stream');
        assert.match(main, /const speakerId = segment\.speakerId && speaker === 'user'\s*\? withVoiceEpoch\(segment\.speakerId, segment\.voiceEpoch\)\s*: segment\.speakerId;/);
    });
});
