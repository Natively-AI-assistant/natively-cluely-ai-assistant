const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  AudioMeetingRecorder,
  alignPcm16Chunk,
  createWavHeader,
  mixPcm16Mono,
  resamplePcm16Mono,
} = require('../dist-electron/electron/audio/AudioMeetingRecorder.js');

function pcm(samples) {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
  return buffer;
}

test('audio transforms resample, align, mix, and encode deterministic PCM', () => {
  assert.deepEqual(
    [...resamplePcm16Mono(pcm([0, 1000, 2000, 3000]), 48_000, 24_000).values()],
    [...pcm([0, 2000]).values()],
  );

  const padded = alignPcm16Chunk(pcm([100, 200]), 3, 1);
  assert.equal(padded.paddingSamples, 2);
  assert.deepEqual([...padded.output.values()], [...pcm([0, 0, 100, 200]).values()]);

  const trimmed = alignPcm16Chunk(pcm([100, 200, 300]), 1, 3);
  assert.equal(trimmed.trimmedSamples, 2);
  assert.deepEqual([...trimmed.output.values()], [...pcm([300]).values()]);

  assert.deepEqual(
    [...mixPcm16Mono(pcm([1000, 2000]), pcm([3000])).values()],
    [...pcm([2000, 2000]).values()],
  );

  const header = createWavHeader(960, 24_000, 1);
  assert.equal(header.toString('ascii', 0, 4), 'RIFF');
  assert.equal(header.toString('ascii', 8, 12), 'WAVE');
  assert.equal(header.readUInt32LE(24), 24_000);
  assert.equal(header.readUInt32LE(40), 960);
});

test('recorder preserves queued chunks and finalizes a streamed WAV', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-recorder-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const recorder = new AudioMeetingRecorder(tempDir, 24_000);
  recorder.start(1_000);
  recorder.addChunk('system', pcm(new Array(480).fill(1000)), 24_000, 1_000);
  recorder.addChunk('system', pcm(new Array(480).fill(2000)), 24_000, 1_001);

  const metadata = await recorder.finalize('queued-chunks');
  assert.ok(metadata);
  assert.equal(metadata.sizeBytes, 44 + (960 * 2));
  assert.equal(metadata.durationMs, 40);

  const wav = fs.readFileSync(metadata.path);
  assert.equal(wav.readInt16LE(44), 1000);
  assert.equal(wav.readInt16LE(44 + (479 * 2)), 1000);
  assert.equal(wav.readInt16LE(44 + (480 * 2)), 2000);
  assert.deepEqual(fs.readdirSync(path.join(tempDir, 'recordings', '.tmp')), []);
});

test('empty recordings finalize without leaving temp files', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-recorder-empty-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const recorder = new AudioMeetingRecorder(tempDir);
  recorder.start(1_000);
  assert.equal(await recorder.finalize('empty'), null);
  assert.deepEqual(fs.readdirSync(path.join(tempDir, 'recordings', '.tmp')), []);
});
