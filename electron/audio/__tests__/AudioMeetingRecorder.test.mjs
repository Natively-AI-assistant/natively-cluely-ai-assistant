import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/audio/AudioMeetingRecorder.js');
const {
  AudioMeetingRecorder,
  MEETING_RECORDING_SAMPLE_RATE,
  createWavHeader,
  mixPcm16Mono,
  resamplePcm16Mono,
} = await import(pathToFileURL(modulePath).href);

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function pcm(...samples) {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
  return buffer;
}

test('PCM helpers resample, mix without clipping, and emit a valid mono WAV header', () => {
  const resampled = resamplePcm16Mono(pcm(0, 1000, 2000, 3000), 48_000, 24_000);
  assert.equal(resampled.length, 4, '48 kHz to 24 kHz should halve the sample count');

  const mixed = mixPcm16Mono(pcm(30_000, -30_000), pcm(30_000, -30_000));
  assert.equal(mixed.readInt16LE(0), 30_000, 'two active channels are averaged instead of clipping');
  assert.equal(mixed.readInt16LE(2), -30_000);

  const header = createWavHeader(8, MEETING_RECORDING_SAMPLE_RATE, 1);
  assert.equal(header.toString('ascii', 0, 4), 'RIFF');
  assert.equal(header.toString('ascii', 8, 12), 'WAVE');
  assert.equal(header.readUInt32LE(24), 24_000);
  assert.equal(header.readUInt16LE(22), 1);
  assert.equal(header.readUInt32LE(40), 8);
});

test('recorder streams both channels into an atomically staged mixed WAV', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-recorder-'));
  tempDirs.push(userData);
  const recorder = new AudioMeetingRecorder(userData);
  recorder.start(1_000);
  recorder.addChunk('system', pcm(10_000, 10_000, 10_000, 10_000), 24_000, 1_000);
  recorder.addChunk('mic', pcm(2_000, 2_000, 2_000, 2_000), 24_000, 1_000);

  const result = await recorder.finalize('meeting-safe-1');
  assert.ok(result, 'a recording with PCM input should finalize');
  assert.match(path.basename(result.path), /^meeting-safe-1-[a-f0-9-]+\.publish-pending\.wav$/i);
  assert.equal(result.sampleRate, 24_000);
  assert.equal(result.durationMs, 0, 'four 24 kHz samples round to less than one millisecond');

  const wav = fs.readFileSync(result.path);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readInt16LE(44), 6_000, 'system and mic samples should be averaged');
  assert.equal(fs.readdirSync(path.join(userData, 'recordings', '.tmp')).length, 0, 'temp PCM and staged WAV files should be removed');
});

test('unsafe meeting IDs are rejected without writing outside the recordings directory', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-recorder-safe-id-'));
  tempDirs.push(userData);
  const recorder = new AudioMeetingRecorder(userData);
  recorder.start(0);
  recorder.addChunk('mic', pcm(1000, 1000), 24_000, 0);

  const result = await recorder.finalize('../escape');
  assert.equal(result, null);
  assert.equal(fs.existsSync(path.join(userData, 'escape.wav')), false);
  await new Promise((resolve) => setImmediate(resolve));
});
