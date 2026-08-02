import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDefenceConfig } from '../../../dist-electron/electron/defence/config.js';
import { encodeMonoPcmWav, WindowsVadSegmenter } from '../../../dist-electron/electron/defence/windowsAudioCapture.js';

function speechFrame(amplitude = 12_000) {
  const frame = Buffer.alloc(640);
  for (let offset = 0; offset < frame.length; offset += 2) frame.writeInt16LE(amplitude, offset);
  return frame;
}

test('Windows audio and iPhone output-only are the safe defaults', () => {
  const config = loadDefenceConfig({});
  assert.equal(config.input.mode, 'windows-audio');
  assert.equal(config.input.source, 'specific-process-loopback');
  assert.equal(config.input.iphoneOutputOnly, true);
  assert.equal(config.storeAudio, false);
  assert.ok(config.input.vad.silenceMs >= 500 && config.input.vad.silenceMs <= 800);
});

test('mono PCM is encoded as a valid 16 kHz WAV', () => {
  const wav = encodeMonoPcmWav(Buffer.alloc(640));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt16LE(34), 16);
});

test('many PCM frames produce one final utterance and repeated audio is suppressed', () => {
  const config = loadDefenceConfig({ VAD_MIN_SPEECH_MS: '300', VAD_SILENCE_MS: '600', VAD_RMS_THRESHOLD: '0.01' });
  const segmenter = new WindowsVadSegmenter(config.input.vad, 'system-loopback');
  const utterances = []; const duplicates = [];
  segmenter.on('utterance', value => utterances.push(value));
  segmenter.on('duplicate', value => duplicates.push(value));
  const audio = Buffer.concat([...Array(20).fill(0).map(() => speechFrame()), Buffer.alloc(640 * 30)]);
  segmenter.push(audio, performance.now());
  segmenter.push(audio, performance.now() + 1_000);
  assert.equal(utterances.length, 1);
  assert.equal(duplicates.length, 1);
  assert.ok(utterances[0].speechMs >= 300);
  assert.equal(utterances[0].finalizationLatencyMs, 600);
  assert.equal(utterances[0].source, 'system-loopback');
});
