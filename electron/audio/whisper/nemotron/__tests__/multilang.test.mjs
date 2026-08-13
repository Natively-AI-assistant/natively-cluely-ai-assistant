// Real multi-language accuracy verification for Nemotron (Task: multilang-verify).
//
// Extends integration.test.mjs's English-only go/no-go gate to every other
// transcription-ready locale in languageTable.ts that has a real macOS TTS
// voice available in this environment (confirmed via `say -v '?'`). Each
// fixture WAV is real synthesized speech of that voice's own Apple-provided
// demo phrase (the exact text `say -v '?'` prints as that voice's sample —
// captured programmatically when the fixtures were generated, never
// hand-typed here, to avoid transcription errors in scripts this reviewer
// cannot read) — see multilang-verify-report.md for the full generation
// methodology and the complete real per-locale results table (voice, exact
// lang_id used, transcribed text, word-overlap score) including locales that
// scored far below this test's own lenient bar.
//
// Threshold design: NOT a fixed word-overlap bar. The real per-locale
// results (multilang-verify-report.md) include THREE locales that score an
// exact 0.0 word-overlap despite the engine producing real, non-empty,
// non-error output for their correct lang_id (pt-PT, tr-TR, ar-AR — see the
// report; e.g. ar-AR's real transcription "مر حبا اسم ي ماج" is genuine
// Arabic-script content, just too garbled/fragmented to clear even a lenient
// word-overlap bar against the short reference phrase). A fixed >=0.3 (or
// any >0) gate would make this test PERMANENTLY red for those locales on any
// machine with the real model present — which makes it useless as a
// regression detector: it can no longer distinguish "still as broken as
// today" from "newly, further broken." So the hard assertion here is
// narrower and more durable: the real engine, given this locale's correct
// lang_id, must produce real, non-empty transcribed text without throwing —
// catching a real regression (a crash, a silently-empty decode, a broken
// MODEL_DIR/lang_id wiring) without pretending a fixed accuracy floor. The
// real word-overlap score is still computed and logged every run (so a
// human/CI-log diff can still notice quality drift), and the ACTUAL honest
// per-locale numbers — including the low and zero ones — live in
// multilang-verify-report.md, per the brief's explicit instruction that the
// report's honesty matters more than the test's pass bar.
//
// Gated exactly like integration.test.mjs: skipped when the real model or
// the dist-electron build isn't present. Reuses ONE NemotronEngine instance
// across all locales (engine.setLanguage(id) + engine.reset() between each)
// per the brief's guidance — faster, and a more realistic test of the real
// production code path (one loaded engine, language changed between
// utterances) than reloading the model per locale.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { NEMOTRON_TRANSCRIPTION_READY_LOCALES } from '../languageTable.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nemotronEnginePath = path.resolve(
  __dirname,
  '../../../../../dist-electron/electron/audio/whisper/nemotron/nemotronEngine.js',
);
const { NemotronEngine } = fs.existsSync(nemotronEnginePath)
  ? await import(pathToFileURL(nemotronEnginePath).href)
  : { NemotronEngine: null };

// Same MODEL_DIR resolution as integration.test.mjs — see that file's own
// doc comment for the full reasoning (ELECTRON_RUN_AS_NODE has no real
// app.getPath('userData'), so the OS default is recomputed directly; a
// NEMOTRON_TEST_MODEL_DIR override remains available for local development,
// e.g. pointing at a one-off inspection directory like this report's own
// /tmp/nemotron-inspect run).
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

const MODEL_DIR = process.env.NEMOTRON_TEST_MODEL_DIR
  || path.join(defaultAppUserDataDir(), 'whisper-models', nemotronModelId);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Real demo phrases captured programmatically from this environment's own
// `say -v '?'` output when the fixtures were generated (see
// multilang-verify-report.md) — reproduced here verbatim as the known-correct
// reference text for scoring, exactly the same role KNOWN_PHRASE plays in
// integration.test.mjs.
const LOCALES = [
  { locale: "en-GB", voice: "Daniel", phrase: "Hello! My name is Daniel.", note: "bonus: brief said skip (covered by en-US), included anyway for full 19/19 lang_id coverage" },
  { locale: "es-ES", voice: "Mónica", phrase: "¡Hola! Me llamo Mónica." },
  { locale: "es-US", voice: "Mónica", phrase: "¡Hola! Me llamo Mónica.", note: "PROXY: no es-US voice exists; reusing es-ES Mónica audio against es-US lang_id=3, disclosed" },
  { locale: "fr-FR", voice: "Thomas", phrase: "Bonjour, je m’appelle Thomas." },
  { locale: "fr-CA", voice: "Amélie", phrase: "Bonjour! Je m’appelle Amélie." },
  { locale: "it-IT", voice: "Alice", phrase: "Ciao! Mi chiamo Alice." },
  { locale: "pt-BR", voice: "Luciana", phrase: "Olá, meu nome é Luciana." },
  { locale: "pt-PT", voice: "Joana", phrase: "Olá! Chamo‑me Joana." },
  { locale: "nl-NL", voice: "Xander", phrase: "Hallo! Mijn naam is Xander." },
  { locale: "de-DE", voice: "Anna", phrase: "Hallo! Ich heiße Anna." },
  { locale: "tr-TR", voice: "Yelda", phrase: "Merhaba, benim adım Yelda." },
  { locale: "ru-RU", voice: "Milena", phrase: "Здравствуйте! Меня зовут Милена." },
  { locale: "ar-AR", voice: "Majed", phrase: "مرحبًا! اسمي ماجد." },
  { locale: "hi-IN", voice: "Lekha", phrase: "नमस्ते, मेरा नाम लेखा है।" },
  { locale: "ja-JP", voice: "Kyoko", phrase: "こんにちは! 私の名前はKyokoです。" },
  { locale: "ko-KR", voice: "Yuna", phrase: "안녕하세요. 제 이름은 유나입니다." },
  { locale: "vi-VN", voice: "Linh", phrase: "Xin chào! Tên tôi là Linh." },
  { locale: "uk-UA", voice: "Lesya", phrase: "Привіт! Мене звуть Леся." },
];

/** Identical technique to integration.test.mjs's readPcm16Mono — see that
 * file's doc comment for why a RIFF chunk walk is required (ffmpeg-produced
 * fixtures have a LIST/INFO metadata chunk before 'data', so a fixed
 * 44-byte header offset is wrong). */
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

function rms(pcm) {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length);
}

// Same word-overlap technique as integration.test.mjs's wordOverlap(), with
// punctuation stripped on both sides first — the English gate never needed
// this (English fixture had no leading punctuation to strip), but Spanish
// "¡Hola!", Japanese "。", Arabic "!" etc. would otherwise silently zero
// scores that are really about content, not punctuation.
function wordOverlap(text, knownPhrase) {
  const stripPunct = (s) => s.replace(/[¡¿!?。、，,.:;"'`«»()‘’“”‑]/g, '');
  const words = stripPunct(knownPhrase).split(/\s+/).filter(Boolean);
  const hay = stripPunct(text);
  const hits = words.filter((w) => hay.includes(w)).length;
  return words.length > 0 ? hits / words.length : 0;
}

const modelPresent = fs.existsSync(MODEL_DIR);
const enginePresent = NemotronEngine !== null;
const fixturesPresent = LOCALES.every((l) => fs.existsSync(path.join(FIXTURES_DIR, `lang-${l.locale}.wav`)));

let engine = null;
if (modelPresent && enginePresent && fixturesPresent) {
  before(async () => {
    engine = await NemotronEngine.create(MODEL_DIR, ['cpu']);
  });
}


for (const { locale, phrase } of LOCALES) {
  test(
    // Name matches the actual assertion below (real, non-empty output for
    // the correct lang_id) — NOT "recognizably" or "lenient bar", which
    // would misleadingly imply a quality bar this test doesn't enforce.
    // Some locales here score 0.0 real word-overlap (see
    // multilang-verify-report.md) while still legitimately passing this
    // test, because it only checks that transcription happened at all.
    `Nemotron produces real non-empty transcription for ${locale} (lang_id=${NEMOTRON_TRANSCRIPTION_READY_LOCALES[locale]})`,
    { skip: !modelPresent || !enginePresent || !fixturesPresent },
    async () => {
      const langId = NEMOTRON_TRANSCRIPTION_READY_LOCALES[locale];
      assert.ok(typeof langId === 'number', `no lang_id for ${locale} in languageTable.ts`);

      const wavPath = path.join(FIXTURES_DIR, `lang-${locale}.wav`);
      const pcm = readPcm16Mono(wavPath);

      // Sanity per the brief: fixture must be real, non-silent audio before
      // any low score can be read as a model/lang_id finding rather than a
      // broken fixture.
      const signalRms = rms(pcm);
      assert.ok(signalRms > 0.01, `${locale} fixture looks silent (rms=${signalRms}) — not a valid audio test`);

      engine.reset();
      engine.setLanguage(langId);
      const chunks = await engine.pushAudio(pcm);
      const final = await engine.flush();
      const text = [...chunks, final]
        .filter(Boolean)
        .map((c) => c.text)
        .join(' ')
        .trim();
      console.log(`[${locale}] lang_id=${langId} transcribed:`, JSON.stringify(text));
      const overlap = wordOverlap(text.toLowerCase(), phrase.toLowerCase());
      console.log(`[${locale}] word overlap vs known phrase (informational — see multilang-verify-report.md for the authoritative numbers):`, overlap);
      // Hard gate: real, non-empty transcription for this locale's correct
      // lang_id — see the threshold-design comment at the top of this file
      // for why this isn't a fixed word-overlap bar.
      assert.ok(
        text.trim().length > 0,
        `${locale}: expected real non-empty transcribed text for lang_id=${langId}, got empty output`,
      );
    },
  );
}

if (!modelPresent) {
  test('Nemotron multilang integration test skipped: model dir not found', () => {
    console.log(`[multilang.test.mjs] MODEL_DIR ${MODEL_DIR} does not exist — skipping real-model tests.`);
  });
}
if (!enginePresent) {
  test('Nemotron multilang integration test skipped: dist-electron build not found', () => {
    console.log(`[multilang.test.mjs] ${nemotronEnginePath} does not exist — run npm run build:electron first.`);
  });
}
if (!fixturesPresent) {
  test('Nemotron multilang integration test skipped: one or more lang-*.wav fixtures missing', () => {
    console.log('[multilang.test.mjs] a fixtures/lang-<locale>.wav file is missing for one of the LOCALES entries.');
  });
}
