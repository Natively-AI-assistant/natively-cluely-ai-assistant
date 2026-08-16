// Real-model integration test for NemotronEngine (Task 11 go/no-go gate).
//
// Gated: skipped when the real Nemotron model isn't present (see MODEL_DIR
// below) or the fixture WAV is missing.
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
import os from 'os';
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

// final-review-fix1 round, I3: MODEL_DIR used to default to
// '/tmp/nemotron-inspect', a one-off directory from Task 1's inspection
// spike. On any other machine (CI, a fresh clone, this same machine after
// /tmp is cleared) that directory doesn't exist, `{ skip: !modelPresent }`
// below registers as a PASSING skip, and this branch's headline go/no-go
// evidence silently stops being checked anywhere, with no signal that it
// stopped. Fixed to default to wherever the app actually stores a
// downloaded model — the same `getModelsDir()`-joined-with-model-id path
// modelManager.ts's isModelCached()/isNemotronModelCached() use — so the
// test runs for real (not skipped) for any developer who has downloaded the
// model through the app's normal flow.
//
// modelManager.ts's real getModelsDir() calls `require('electron').app.getPath(
// 'userData')`, which is unusable here: this test runs under `electron --test`
// with ELECTRON_RUN_AS_NODE=1 (this repo's own `npm test`), where
// `require('electron').app` is undefined (confirmed empirically against
// this exact invocation — same reason LocalReranker.ts's resolveModelPath()
// already documents a HOME-based ELECTRON_RUN_AS_NODE fallback for the
// identical problem). So the OS default userData root is recomputed
// directly here, matching Electron's own per-platform default
// (`path.join(appDataRoot, app.name)`, with app.name defaulting to
// package.json's `name` field, "natively", before any app.setName()
// override runs — verified against this machine's real, dev-mode (`npm
// start`) `~/Library/Application Support/natively/whisper-models/...`
// directory). A packaged (electron-builder) build may instead resolve the
// capitalized `productName` ("Natively") — not re-verified against a
// packaged install here — but macOS and Windows filesystems are both
// case-insensitive by default, so 'natively' still resolves to the same
// directory either way; only case-sensitive Linux filesystems could diverge,
// and Linux packaging isn't in this project's scope (see CLAUDE.md).
function defaultAppUserDataDir() {
  const appName = 'natively';
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), appName);
}

// Reuse the real catalog id (not a duplicated string literal) when the
// build is present, so this test's default path can never drift out of
// sync with modelManager.ts's own MODEL_CATALOG entry.
const modelManagerPath = path.resolve(
  __dirname,
  '../../../../../dist-electron/electron/audio/whisper/modelManager.js',
);
const NEMOTRON_MODEL_ID_FALLBACK = 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4';
let nemotronModelId = NEMOTRON_MODEL_ID_FALLBACK;
if (fs.existsSync(modelManagerPath)) {
  const { MODEL_CATALOG } = await import(pathToFileURL(modelManagerPath).href);
  const entry = MODEL_CATALOG.find((m) => m.sessionLayout === 'nemotron-rnnt');
  if (entry) nemotronModelId = entry.id;
}

// NEMOTRON_TEST_MODEL_DIR remains available as an explicit override for
// local development (e.g. pointing at a one-off inspection directory).
const MODEL_DIR = process.env.NEMOTRON_TEST_MODEL_DIR
  || path.join(defaultAppUserDataDir(), 'whisper-models', nemotronModelId);
const FIXTURE_WAV = path.join(__dirname, 'fixtures', 'known-phrase-16k-mono.wav');
const KNOWN_PHRASE = 'the quick brown fox jumps over the lazy dog';

/**
 * Minimal WAV (PCM16 mono) -> Float32 reader. Walks RIFF chunks to find the
 * real `data` chunk rather than assuming a fixed 44-byte header — this
 * fixture's own ffmpeg-produced file has a `LIST`/INFO metadata chunk
 * between `fmt ` and `data` (an `ISFT` encoder tag), so `data` actually
 * starts at byte 78, not 44 (confirmed by walking this exact file: `fmt `
 * chunk at 12, `LIST` chunk of size 26 at 36, `data` chunk at 70 with its
 * payload starting at 78). A fixed 44-byte assumption silently read 17
 * samples (34 bytes) of ASCII metadata as bogus leading audio. No WAV
 * parsing dependency — this is a small, self-contained chunk walk, still
 * matching the brief's guidance not to pull in a library for a
 * fixed, self-produced fixture.
 */
function readPcm16Mono(wavPath) {
  const buf = fs.readFileSync(wavPath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${wavPath} is not a RIFF/WAVE file`);
  }
  let offset = 12;
  let dataStart = -1;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      dataStart = offset + 8;
      dataSize = chunkSize;
      break;
    }
    // Chunks are word-aligned: a chunk with an odd size has one pad byte.
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (dataStart < 0) throw new Error(`${wavPath}: no 'data' chunk found`);
  const sampleCount = Math.floor(Math.min(dataSize, buf.length - dataStart) / 2);
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
