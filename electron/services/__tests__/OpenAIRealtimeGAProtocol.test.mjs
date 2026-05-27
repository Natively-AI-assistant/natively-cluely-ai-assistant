import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.resolve(__dirname, '../../audio/OpenAIStreamingSTT.ts'), 'utf8'
);

test('does not send OpenAI-Beta header (beta API removed)', () => {
  assert.doesNotMatch(source, /OpenAI-Beta/);
});

test('sends transcription_session.update not session.update', () => {
  assert.match(source, /type: 'transcription_session\.update'/);
  assert.doesNotMatch(source, /type: 'session\.update'/);
});

test('uses GA input_audio_format field not beta audio.input.format', () => {
  assert.match(source, /input_audio_format: 'pcm16'/);
  assert.doesNotMatch(source, /audio\.input\.format/);
});

test('handles GA transcript delta event name', () => {
  assert.match(source, /conversation\.item\.input_audio_transcription\.delta/);
  assert.doesNotMatch(source, /'transcript\.text\.delta'/);
});

test('handles GA transcript completed event name', () => {
  assert.match(source, /conversation\.item\.input_audio_transcription\.completed/);
  assert.doesNotMatch(source, /'transcript\.text\.done'/);
});

test('stop commits an open ready WebSocket session even without pending accumulator audio', () => {
  assert.match(
    source,
    /public stop\(\): void \{[\s\S]*?this\.isSessionReady\) \{[\s\S]*?if \(this\.pcmAccumulatorLen > 0\) \{[\s\S]*?input_audio_buffer\.append[\s\S]*?\}[\s\S]*?input_audio_buffer\.commit[\s\S]*?\}\s*catch/
  );
  assert.doesNotMatch(
    source,
    /this\.isSessionReady && this\.pcmAccumulatorLen > 0\) \{[\s\S]*?input_audio_buffer\.commit/
  );
});

test('finalize commits an open ready WebSocket session even without pending accumulator audio', () => {
  assert.match(
    source,
    /public finalize\(\): void \{[\s\S]*?if \(this\.ws\?\.readyState !== WebSocket\.OPEN \|\| !this\.isSessionReady\) return;[\s\S]*?try \{[\s\S]*?if \(this\.pcmAccumulatorLen > 0\) \{[\s\S]*?input_audio_buffer\.append[\s\S]*?\}[\s\S]*?input_audio_buffer\.commit[\s\S]*?\} catch/
  );
});
