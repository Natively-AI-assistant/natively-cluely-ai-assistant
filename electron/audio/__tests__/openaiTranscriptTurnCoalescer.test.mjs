import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledPath = path.resolve(
    __dirname,
    '../../../dist-electron/electron/audio/openaiTranscriptTurnCoalescer.js',
);

if (!fs.existsSync(compiledPath)) {
    throw new Error(
        `Compiled file not found: ${compiledPath}\n` +
        `Run 'npm run build:electron' before this test suite.`
    );
}

const { OpenAITranscriptTurnCoalescer } = await import(pathToFileURL(compiledPath).href);

describe('OpenAITranscriptTurnCoalescer', () => {
    test('does not emit final on word-level completed events until speech_stopped', () => {
        const c = new OpenAITranscriptTurnCoalescer();
        c.onSpeechStarted();
        c.onCompleted('and');
        c.onCompleted('space');
        c.onCompleted('from');
        c.onCompleted('the');
        assert.strictEqual(c.getPartialText(), 'and space from the');

        const finalText = c.onSpeechStopped();
        assert.strictEqual(finalText, 'and space from the');
    });

    test('accumulates deltas into one partial preview string', () => {
        const c = new OpenAITranscriptTurnCoalescer();
        c.onSpeechStarted();
        assert.strictEqual(c.onDelta('Hello'), 'Hello');
        assert.strictEqual(c.onDelta(', how'), 'Hello, how');
        assert.strictEqual(c.getPartialText(), 'Hello, how');
    });

    test('speech_started flushes orphan turn from prior utterance', () => {
        const c = new OpenAITranscriptTurnCoalescer();
        c.onSpeechStarted();
        c.onCompleted('first sentence');
        const orphan = c.onSpeechStarted();
        assert.strictEqual(orphan, 'first sentence');
        assert.strictEqual(c.getPartialText(), null);
    });

    test('flush emits pending text without speech_stopped (stop()/finalize path)', () => {
        const c = new OpenAITranscriptTurnCoalescer();
        c.onSpeechStarted();
        c.onDelta('trailing words');
        assert.strictEqual(c.flush(), 'trailing words');
        assert.strictEqual(c.getPartialText(), null);
    });

    // Measured live 2026-09-23 (gpt-4o-transcribe, server_vad): speech_stopped
    // arrives FIRST — it is what commits the audio — and the transcription
    // follows it. Before this, the stop returned nothing and the turn's final
    // only surfaced as the orphan of the NEXT speech_started: a turn late.
    test('LIVE ORDER: completed after speech_stopped finalizes the stopped turn', () => {
        const c = new OpenAITranscriptTurnCoalescer();
        c.onSpeechStarted();
        assert.strictEqual(c.onSpeechStopped(), null, 'no text yet at the stop');
        c.onDelta('Why did you');
        assert.strictEqual(c.takeAwaitedFinal(), null, 'deltas alone do not finalize');
        c.onCompleted('Why did you choose Postgres?');
        assert.strictEqual(c.takeAwaitedFinal(), 'Why did you choose Postgres?');
        assert.strictEqual(c.getPartialText(), null);
        assert.strictEqual(c.takeAwaitedFinal(), null, 'one final per stopped turn');
    });

    test('completed arriving BEFORE the stop keeps the original behaviour (no early final)', () => {
        const c = new OpenAITranscriptTurnCoalescer();
        c.onSpeechStarted();
        c.onCompleted('and');
        assert.strictEqual(c.takeAwaitedFinal(), null, 'turn has not stopped');
        assert.strictEqual(c.onSpeechStopped(), 'and');
        c.onCompleted('late');
        assert.strictEqual(c.takeAwaitedFinal(), null, 'stop already produced this turn\'s final');
    });

    test('a new speech_started clears a stale awaiting flag', () => {
        const c = new OpenAITranscriptTurnCoalescer();
        c.onSpeechStarted();
        c.onSpeechStopped();
        c.onSpeechStarted();
        c.onCompleted('next turn word');
        assert.strictEqual(c.takeAwaitedFinal(), null);
    });

    test('reset clears all pending state', () => {
        const c = new OpenAITranscriptTurnCoalescer();
        c.onSpeechStarted();
        c.onCompleted('orphan');
        c.reset();
        assert.strictEqual(c.flush(), null);
    });
});
