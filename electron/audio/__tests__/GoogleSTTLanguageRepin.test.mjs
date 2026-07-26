// Behavior tests for GoogleSTT's auto-mode language re-pinning and the
// stale-stream guards that make mid-meeting language switches seamless.
//
// Why: with alternativeLanguageCodes, Google recognizes alternate languages
// slower and worse than the primary. When a meeting switches en → ru, the
// stream used to stay pinned to en-US primary forever. Now two consecutive
// FINAL results in another language re-pin the primary (old primary joins
// the alternates). Separately, restarts used to lose 1s+ of audio because
// the abandoned stream's async 'close' event nulled the NEW stream's state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distAudio = path.resolve(__dirname, '../../../dist-electron/electron/audio');

const { GoogleSTT } = await import(path.join(distAudio, 'GoogleSTT.js'));

function makeFakeClient(streams) {
    return {
        streamingRecognize(request) {
            const st = new EventEmitter();
            st.request = request;
            st.writable = true;
            st.destroyed = false;
            st.ended = false;
            st.written = [];
            st.write = (b) => st.written.push(b);
            st.end = () => { st.ended = true; };
            st.destroy = () => { st.destroyed = true; };
            streams.push(st);
            return st;
        },
    };
}

function finalResult(transcript, languageCode) {
    return {
        results: [{
            alternatives: [{ transcript, confidence: 0.9 }],
            isFinal: true,
            languageCode,
        }],
    };
}

async function makeAutoModeSTT(streams) {
    const stt = new GoogleSTT('test');
    stt.client = makeFakeClient(streams);
    stt.setRecognitionLanguage('auto');
    await new Promise(r => setTimeout(r, 300)); // 250ms debounce in setRecognitionLanguage
    stt.start();
    return stt;
}

test('two consecutive finals in another language re-pin the primary', async () => {
    const streams = [];
    const stt = await makeAutoModeSTT(streams);
    try {
        assert.equal(streams.length, 1);
        // require('electron') is unavailable under node --test, so auto mode
        // falls back to the fr/es/de defaults — deterministic for this test.
        assert.equal(streams[0].request.config.languageCode, 'en-US');
        assert.deepEqual(streams[0].request.config.alternativeLanguageCodes, ['fr-FR', 'es-ES', 'de-DE']);

        streams[0].emit('data', finalResult('привет', 'ru-ru'));
        assert.equal(streams.length, 1, 'one mismatched final must NOT re-pin yet');

        streams[0].emit('data', finalResult('как дела', 'ru-ru'));
        assert.equal(streams.length, 2, 'second consecutive mismatched final re-pins');
        assert.equal(streams[1].request.config.languageCode, 'ru-RU');
        assert.deepEqual(
            streams[1].request.config.alternativeLanguageCodes,
            ['en-US', 'fr-FR', 'es-ES'],
            'old primary joins the alternates so switching back still works',
        );
        assert.ok(streams[0].ended && !streams[0].destroyed, 'old stream is ended (flushes finals), not destroyed');
    } finally {
        stt.stop();
    }
});

test('a matching final resets the mismatch streak', async () => {
    const streams = [];
    const stt = await makeAutoModeSTT(streams);
    try {
        streams[0].emit('data', finalResult('привет', 'ru-ru'));
        streams[0].emit('data', finalResult('hello again', 'en-us')); // resets streak
        streams[0].emit('data', finalResult('ещё раз', 'ru-ru'));
        assert.equal(streams.length, 1, 'non-consecutive mismatches must not re-pin');
    } finally {
        stt.stop();
    }
});

test('switching back re-pins again in the other direction', async () => {
    const streams = [];
    const stt = await makeAutoModeSTT(streams);
    try {
        streams[0].emit('data', finalResult('привет', 'ru-ru'));
        streams[0].emit('data', finalResult('как дела', 'ru-ru'));
        streams[1].emit('data', finalResult('ok back to english', 'en-us'));
        streams[1].emit('data', finalResult('yes english', 'en-us'));
        assert.equal(streams.length, 3);
        assert.equal(streams[2].request.config.languageCode, 'en-US');
        assert.deepEqual(streams[2].request.config.alternativeLanguageCodes, ['ru-RU', 'fr-FR', 'es-ES']);
    } finally {
        stt.stop();
    }
});

test("an abandoned stream's late close/end/data must not clobber the new stream", async () => {
    const streams = [];
    const stt = await makeAutoModeSTT(streams);
    try {
        const transcripts = [];
        stt.on('transcript', t => transcripts.push(t.text));

        streams[0].emit('data', finalResult('привет', 'ru-ru'));
        streams[0].emit('data', finalResult('как дела', 'ru-ru'));
        assert.equal(streams.length, 2);

        // The old stream closes asynchronously AFTER the swap — this used to
        // null this.stream and stall transcription until a lazy reconnect.
        streams[0].emit('close');
        streams[0].emit('end');
        assert.equal(stt.stream, streams[1], 'new stream must survive stale close/end');

        // A late final from the old stream is pre-swap speech — still forwarded,
        // but it must not trigger another re-pin.
        streams[0].emit('data', finalResult('хвост фразы', 'ru-ru'));
        streams[0].emit('data', finalResult('ещё хвост', 'ru-ru'));
        assert.equal(streams.length, 2, 'stale stream finals must not re-pin');
        assert.ok(transcripts.includes('хвост фразы'));

        // Stale errors are swallowed (the abandoned stream erroring out is
        // expected); the 'error' listener above would throw the test otherwise.
        stt.on('error', () => { throw new Error('stale error must not be re-emitted'); });
        streams[0].emit('error', Object.assign(new Error('CANCELLED'), { code: 1 }));
    } finally {
        stt.stop();
    }
});

test('manual (non-auto) language selection never re-pins', async () => {
    const streams = [];
    const stt = new GoogleSTT('test');
    stt.client = makeFakeClient(streams);
    stt.setRecognitionLanguage('russian');
    await new Promise(r => setTimeout(r, 300));
    stt.start();
    try {
        assert.equal(streams[0].request.config.languageCode, 'ru-RU');
        streams[0].emit('data', finalResult('hello', 'en-us'));
        streams[0].emit('data', finalResult('hello again', 'en-us'));
        assert.equal(streams.length, 1, 'explicit language choice is authoritative');
    } finally {
        stt.stop();
    }
});
