// whisperSilenceGuard.ts: the no-speech and repetition checks transformers.js
// 3.8.1 accepts as options but never runs.
// Run: node --test electron/audio/whisper/__tests__/WhisperSilenceGuard2026_11_18.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { noSpeechProbability, looksLikeLoop, noSpeechTokenId, whisperMaxNewTokens, LOGPROB_FLOOR } = require(
  path.join(repoRoot, 'dist-electron', 'electron', 'audio', 'whisper', 'whisperSilenceGuard.js'),
);

test('no-speech probability is the softmax share of the <|nospeech|> logit', () => {
  const logits = new Float32Array([0, 0, Math.log(2)]); // e^0, e^0, 2 -> 2/4
  assert.ok(Math.abs(noSpeechProbability(logits, 2) - 0.5) < 1e-6);
  assert.ok(Math.abs(noSpeechProbability(logits, 0) - 0.25) < 1e-6);
  assert.equal(noSpeechProbability(logits, undefined), null);
  assert.equal(noSpeechProbability(logits, 3), null);
});

test('large logits do not overflow', () => {
  const p = noSpeechProbability(new Float32Array([1000, 1000]), 1);
  assert.ok(Math.abs(p - 0.5) < 1e-6);
});

test('a repetition loop is caught, a normal sentence is not', () => {
  assert.equal(looksLikeLoop('Thank you. '.repeat(12)), true);
  assert.equal(looksLikeLoop('Can you walk me through how you would scale the database if traffic doubled overnight?'), false);
  assert.equal(looksLikeLoop('Thank you.'), false);
});

test('the no-speech token is found under either name', () => {
  const tok = (entries) => ({ model: { tokens_to_ids: new Map(entries) } });
  assert.equal(noSpeechTokenId(tok([['<|nocaptions|>', 50362]])), 50362);
  assert.equal(noSpeechTokenId(tok([['<|nospeech|>', 50363], ['<|nocaptions|>', 1]])), 50363);
  assert.equal(noSpeechTokenId(tok([])), undefined);
  assert.equal(noSpeechTokenId(undefined), undefined);
});

test('the Whisper token budget follows the audio length and stays inside the 448 window', () => {
  assert.equal(whisperMaxNewTokens(16000 * 2), 112);
  assert.equal(whisperMaxNewTokens(16000 * 5.4), 32 + 216);
  assert.equal(whisperMaxNewTokens(16000 * 30), 440, 'start tokens fit in the 448 positions');
  assert.equal(whisperMaxNewTokens(16000 * 30, 16000, 224), 216, 'and so does a full prompt');
  assert.equal(whisperMaxNewTokens(0), 32);
  assert.equal(whisperMaxNewTokens(NaN), 32);
});

// Distil's no-speech probability is 0.06-0.10 on clicks and coughs, so it let
// "You", "Oh" and "Whoa." through. Measured: real speech -0.22..-2.55, those
// invented words -5.94..-10.36 (2026-11-18).
test('the low-confidence floor sits between real speech and invented words', () => {
  assert.equal(LOGPROB_FLOOR, -4);
  assert.ok(LOGPROB_FLOOR < -2.55, 'below the weakest real speech measured');
  assert.ok(LOGPROB_FLOOR > -5.94, 'above the best-scoring invented word on Distil');
});

test('the worker drops a final under the floor, only after measuring it on that final', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/audio/whisper/whisperWorker.ts'), 'utf8');
  assert.match(src, /if \(logprobFloor !== null && !streaming && text\.trim\(\) && encoderOutputs\) \{[\s\S]{0,80}logprob = await meanLogprob\(text, language, encoderOutputs\);/);
  assert.match(src, /\} else if \(text && logprobFloor !== null && logprob !== null && logprob < logprobFloor\) \{[\s\S]{0,250}text = '';/);
});
