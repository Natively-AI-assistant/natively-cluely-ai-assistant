// Real-model integration test for NemotronEngine (Task 11 go/no-go gate).
//
// Gated: skipped when the real Nemotron model isn't present (see
// NEMOTRON_TEST_MODEL_DIR below) or the fixture WAV is missing. In this
// environment (Task 11) the real model was downloaded by Task 1's
// inspection spike and is still present at /tmp/nemotron-inspect — this
// test runs for real here, it does not skip.
//
// Import strategy: unlike this directory's other __tests__/*.test.mjs files
// (rnntDecoder.test.mjs / melFrontend.test.mjs / cacheState.test.mjs / etc.,
// which import their target `.ts` file directly — this Electron/Node
// runtime strips TS syntax natively for a single leaf file with no local
// cross-file imports), nemotronEngine.ts itself has FIVE extensionless local
// imports (onnxThreadConfig, melFrontend, cacheState, rnntDecoder,
// tokenizer). Extensionless imports are a CommonJS convention that Node's
// ESM resolver rejects outright (ERR_MODULE_NOT_FOUND — confirmed empirically
// against this runtime while writing this test, not assumed). So this test
// imports the BUILT CommonJS output from dist-electron instead, exactly the
// same technique StartupModelValidation.test.mjs already uses for
// modelManager.js. Run `npm run build:electron` before this test if
// dist-electron is stale — `npm test` does this automatically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nemotronEnginePath = path.resolve(
  __dirname,
  '../../../../../dist-electron/electron/audio/whisper/nemotron/nemotronEngine.js',
);
const { NemotronEngine } = fs.existsSync(nemotronEnginePath)
  ? await import(pathToFileURL(nemotronEnginePath).href)
  : { NemotronEngine: null };
const MODEL_DIR = process.env.NEMOTRON_TEST_MODEL_DIR || '/tmp/nemotron-inspect';
const FIXTURE_WAV = path.join(__dirname, 'fixtures', 'known-phrase-16k-mono.wav');
const KNOWN_PHRASE = 'the quick brown fox jumps over the lazy dog';

/**
 * Minimal WAV (PCM16 mono) -> Float32 reader. Skips the standard 44-byte
 * header (RIFF/WAVE/fmt /data chunk layout as produced by ffmpeg's default
 * `-c:a pcm_s16le` output) and normalizes int16 samples to [-1, 1] by
 * dividing by 32768. No general RIFF chunk-walking — this is deliberately
 * narrow, matching the brief's guidance not to pull in a WAV-parsing
 * dependency for a fixed, self-produced fixture.
 */
function readPcm16Mono(wavPath) {
  const buf = fs.readFileSync(wavPath);
  const dataStart = 44;
  const sampleCount = (buf.length - dataStart) / 2;
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
  }
  return out;
}

function wordOverlap(text, knownPhrase) {
  const words = knownPhrase.split(' ');
  const hits = words.filter((w) => text.includes(w)).length;
  return hits / words.length;
}

const modelPresent = fs.existsSync(MODEL_DIR);
const fixturePresent = fs.existsSync(FIXTURE_WAV);
const enginePresent = NemotronEngine !== null;

test(
  'Nemotron transcribes a known short utterance recognizably',
  { skip: !modelPresent || !fixturePresent || !enginePresent },
  async () => {
    const engine = await NemotronEngine.create(MODEL_DIR, ['cpu']);
    const pcm = readPcm16Mono(FIXTURE_WAV);
    const chunks = await engine.pushAudio(pcm);
    const final = await engine.flush();
    const text = [...chunks, final]
      .filter(Boolean)
      .map((c) => c.text)
      .join(' ')
      .trim()
      .toLowerCase();
    console.log('Nemotron transcribed:', JSON.stringify(text));
    const overlap = wordOverlap(text, KNOWN_PHRASE);
    console.log('Word overlap vs known phrase:', overlap);
    assert.ok(
      overlap >= 0.5,
      `expected at least half the known phrase's words recognizable, got: "${text}"`,
    );
  },
);

if (!modelPresent) {
  test('Nemotron real-model integration test skipped: model dir not found', () => {
    console.log(`[integration.test.mjs] MODEL_DIR ${MODEL_DIR} does not exist — skipping real-model test.`);
  });
}
if (!fixturePresent) {
  test('Nemotron real-model integration test skipped: fixture WAV not found', () => {
    console.log(`[integration.test.mjs] FIXTURE_WAV ${FIXTURE_WAV} does not exist — skipping real-model test.`);
  });
}
if (!enginePresent) {
  test('Nemotron real-model integration test skipped: dist-electron build not found', () => {
    console.log(`[integration.test.mjs] ${nemotronEnginePath} does not exist — run npm run build:electron first.`);
  });
}

export { readPcm16Mono, wordOverlap, KNOWN_PHRASE, MODEL_DIR, FIXTURE_WAV };
