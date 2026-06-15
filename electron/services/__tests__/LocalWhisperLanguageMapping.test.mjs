import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localWhisperSource = readFileSync(path.resolve(__dirname, '../../audio/LocalWhisperSTT.ts'), 'utf8');
const whisperWorkerSource = readFileSync(path.resolve(__dirname, '../../audio/whisper/whisperWorker.ts'), 'utf8');
const mainSource = readFileSync(path.resolve(__dirname, '../../main.ts'), 'utf8');
const ipcHandlersSource = readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');
const compiledLanguagePath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/audio/whisper/language.js',
);
const compiledModelManagerPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/audio/whisper/modelManager.js',
);

const {
  normalizeLocalWhisperLanguage,
  resolveWhisperLanguage,
  isEnglishOnlyModel,
} = await import(pathToFileURL(compiledLanguagePath).href);
const { normalizeWhisperModelId } = await import(pathToFileURL(compiledModelManagerPath).href);

test('LocalWhisper normalizes Natively recognition keys to BCP47 before worker dispatch', () => {
  assert.equal(normalizeLocalWhisperLanguage('russian'), 'ru-RU');
  assert.equal(normalizeLocalWhisperLanguage('english-us'), 'en-US');
  assert.equal(normalizeLocalWhisperLanguage('english-uk'), 'en-GB');
  assert.equal(normalizeLocalWhisperLanguage('auto'), 'auto');
});

test('Whisper worker resolves Russian from both Natively keys and BCP47 values', () => {
  assert.equal(resolveWhisperLanguage('russian'), 'russian');
  assert.equal(resolveWhisperLanguage('ru-RU'), 'russian');
  assert.equal(resolveWhisperLanguage('english-us'), 'english');
  assert.equal(resolveWhisperLanguage('en-US'), 'english');
  assert.equal(resolveWhisperLanguage('auto'), null);
});

test('LocalWhisper falls back unsupported language values to autodetect', () => {
  assert.equal(normalizeLocalWhisperLanguage('not-a-real-language'), 'auto');
  assert.equal(resolveWhisperLanguage('not-a-real-language'), null);
});

test('English-only local Whisper models are identifiable before language override', () => {
  assert.equal(isEnglishOnlyModel('Xenova/whisper-base.en'), true);
  assert.equal(isEnglishOnlyModel('distil-whisper/distil-large-v3'), true);
  assert.equal(isEnglishOnlyModel('onnx-community/moonshine-base-ONNX'), true);
  assert.equal(isEnglishOnlyModel('Xenova/whisper-base'), false);
});

test('Whisper Large v3 Turbo uses the canonical Transformers.js model id', () => {
  assert.equal(
    normalizeWhisperModelId('onnx-community/whisper-large-v3-turbo-ONNX'),
    'onnx-community/whisper-large-v3-turbo-ONNX',
  );
  assert.equal(
    normalizeWhisperModelId('onnx-community/whisper-large-v3-turbo'),
    'onnx-community/whisper-large-v3-turbo-ONNX',
  );
});

test('LocalWhisper fallback model is multilingual so Russian never defaults to English-only', () => {
  assert.doesNotMatch(mainSource, /localWhisperModel'\)\s*\?\?\s*'Xenova\/whisper-tiny\.en'/);
  assert.doesNotMatch(ipcHandlersSource, /'Xenova\/whisper-tiny\.en'/);
  assert.match(mainSource, /localWhisperModel'\)\s*\?\?\s*'Xenova\/whisper-tiny'/);
  assert.match(ipcHandlersSource, /'Xenova\/whisper-tiny'/);
});

test('LocalWhisper dispatch path stores normalized language values', () => {
  assert.match(
    localWhisperSource,
    /setRecognitionLanguage\(key: string\): void \{ this\.language = normalizeLocalWhisperLanguage\(key\); \}/,
  );
});

test('Whisper worker warns when an English-only model overrides a non-English language', () => {
  assert.match(whisperWorkerSource, /isEnglishOnlyModel\(loadedModelId\)/);
  assert.match(whisperWorkerSource, /overriding requested language/);
  assert.match(whisperWorkerSource, /Select a multilingual Whisper model for Russian transcription/);
});
