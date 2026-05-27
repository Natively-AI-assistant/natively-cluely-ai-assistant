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

    test('reset clears all pending state', () => {
        const c = new OpenAITranscriptTurnCoalescer();
        c.onSpeechStarted();
        c.onCompleted('orphan');
        c.reset();
        assert.strictEqual(c.flush(), null);
    });
});
