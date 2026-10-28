// Parakeet TDT v2 (English) next to v3, and the downloader both engines share.
//
// Guards:
//  1. v2 is in the catalog as an English-only parakeet-tdt model, and the
//     language rules keep it English-only even though it shares v3's session
//     layout (the Parakeet branch used to be checked before multilingual).
//  2. The ONNX download fetches v2's own repo, not v3's (the repo used to be a
//     hardcoded constant).
//  3. The shared downloader keeps a repo's folder layout (CoreML bundles are
//     folders), pins the revision in the URL, resumes at file granularity and
//     rejects a truncated file.
//
// Run: npm run build:electron && node --test <this file>

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../../../../dist-electron/electron/audio/whisper');
const { MODEL_CATALOG } = await import(pathToFileURL(path.join(dist, 'modelManager.js')).href);
const { getLocalModelLanguageSupport, isEnglishOnlyLocalModel } = await import(
  pathToFileURL(path.join(dist, 'modelLanguageSupport.js')).href
);
const downloads = await import(pathToFileURL(path.join(dist, 'parakeet/downloadFiles.js')).href);

const V2 = 'istupakov/parakeet-tdt-0.6b-v2-onnx';
const V3 = 'istupakov/parakeet-tdt-0.6b-v3-onnx';

describe('Parakeet TDT v2 in the catalog', () => {
  test('is an English-only parakeet-tdt model', () => {
    const v2 = MODEL_CATALOG.find((m) => m.id === V2);
    assert.ok(v2, 'v2 must be in MODEL_CATALOG');
    assert.equal(v2.sessionLayout, 'parakeet-tdt');
    assert.equal(v2.multilingual, false);
    assert.equal(v2.name, 'Parakeet TDT 0.6B v2', 'the Settings family grouping matches names starting "Parakeet"');
    assert.equal(isEnglishOnlyLocalModel(V2), true);
  });

  test('locks the language to English while v3 keeps its 25 languages', () => {
    const v2 = getLocalModelLanguageSupport(V2);
    assert.equal(v2.languageSelectable, false);
    assert.ok(v2.allowedLanguageKeys.every((k) => k.startsWith('english')), v2.allowedLanguageKeys.join(','));

    const v3 = getLocalModelLanguageSupport(V3);
    assert.equal(v3.languageSelectable, true);
    assert.ok(v3.allowedLanguageKeys.includes('auto'));
    assert.ok(v3.allowedLanguageKeys.length > v2.allowedLanguageKeys.length);
  });
});

describe('ONNX download sets', () => {
  test('each export downloads from its own repo, same five files', () => {
    const v2 = downloads.parakeetOnnxDownloadSet(V2);
    const v3 = downloads.parakeetOnnxDownloadSet(V3);
    assert.equal(v2.repo, V2);
    assert.equal(v3.repo, V3);
    assert.deepEqual(v2.files.map((f) => f.path), [...downloads.PARAKEET_TDT_REQUIRED_FILES]);
    assert.deepEqual(v3.files.map((f) => f.path), [...downloads.PARAKEET_TDT_REQUIRED_FILES]);
    assert.equal(downloads.parakeetOnnxDownloadSet().repo, V3, 'the default stays v3 for older callers');
  });

  test('an unknown repo is refused rather than silently fetching v3', () => {
    assert.throws(() => downloads.parakeetOnnxDownloadSet('someone/else-onnx'), /Unknown Parakeet TDT repo/);
  });
});

/** Replaces global fetch with a map of URL -> body for one test. */
function mockFetch(t, bodies, { lieAboutLength = new Set() } = {}) {
  const real = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    const body = bodies[String(url)];
    if (body === undefined) return new Response('missing', { status: 404 });
    const bytes = Buffer.from(body);
    const length = lieAboutLength.has(String(url)) ? bytes.length + 10 : bytes.length;
    return new Response(bytes, { status: 200, headers: { 'content-length': String(length) } });
  };
  t.after(() => { globalThis.fetch = real; });
  return requested;
}

describe('downloadParakeetFiles', () => {
  const set = {
    repo: 'FluidInference/example-coreml',
    revision: 'ee09c569f73759e6d44c9bd16766f477b2b36d39',
    files: [
      { path: 'Encoder.mlmodelc/weights/weight.bin', approxBytes: 100 },
      { path: 'parakeet_vocab.json', approxBytes: 10 },
    ],
  };
  const base = `https://huggingface.co/${set.repo}/resolve/${set.revision}`;

  test('keeps the folder layout, uses the pinned revision, ends at 100%', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parakeet-dl-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const requested = mockFetch(t, {
      [`${base}/Encoder.mlmodelc/weights/weight.bin`]: 'weights',
      [`${base}/parakeet_vocab.json`]: '{}',
    });
    const progress = [];
    await downloads.downloadParakeetFiles(dir, set, (p) => progress.push(p));
    assert.equal(fs.readFileSync(path.join(dir, 'Encoder.mlmodelc/weights/weight.bin'), 'utf8'), 'weights');
    assert.equal(fs.readFileSync(path.join(dir, 'parakeet_vocab.json'), 'utf8'), '{}');
    assert.equal(requested.length, 2);
    assert.equal(progress.at(-1), 100);
    assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]), `progress must not go backwards: ${progress}`);
  });

  test('resumes: files already on disk are not fetched again', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parakeet-dl-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, 'Encoder.mlmodelc/weights'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Encoder.mlmodelc/weights/weight.bin'), 'weights');
    const requested = mockFetch(t, { [`${base}/parakeet_vocab.json`]: '{}' });
    await downloads.downloadParakeetFiles(dir, set, () => {});
    assert.deepEqual(requested, [`${base}/parakeet_vocab.json`]);
  });

  test('with exact sizes, a damaged file on disk is fetched again and a short body is refused', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parakeet-dl-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const exact = { ...set, files: [
      { path: 'Encoder.mlmodelc/weights/weight.bin', approxBytes: 7, bytes: 7 },
      { path: 'parakeet_vocab.json', approxBytes: 2, bytes: 2 },
    ] };
    fs.mkdirSync(path.join(dir, 'Encoder.mlmodelc/weights'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Encoder.mlmodelc/weights/weight.bin'), 'wei'); // interrupted earlier copy
    fs.writeFileSync(path.join(dir, 'parakeet_vocab.json'), '{}'); // intact: kept
    const requested = mockFetch(t, {
      [`${base}/Encoder.mlmodelc/weights/weight.bin`]: 'weights',
      [`${base}/parakeet_vocab.json`]: '{', // short, with a content-length that agrees
    });
    await downloads.downloadParakeetFiles(dir, exact, () => {});
    assert.deepEqual(requested, [`${base}/Encoder.mlmodelc/weights/weight.bin`]);
    assert.equal(fs.readFileSync(path.join(dir, 'Encoder.mlmodelc/weights/weight.bin'), 'utf8'), 'weights');

    // A short body still cannot slip in when the pinned size is known.
    fs.rmSync(path.join(dir, 'parakeet_vocab.json'));
    await assert.rejects(downloads.downloadParakeetFiles(dir, exact, () => {}), /expected 2 bytes \(pinned revision\), received 1/);
    assert.equal(fs.existsSync(path.join(dir, 'parakeet_vocab.json')), false);
  });

  test('a truncated file is rejected and leaves nothing behind', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parakeet-dl-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const url = `${base}/Encoder.mlmodelc/weights/weight.bin`;
    mockFetch(t, { [url]: 'weights' }, { lieAboutLength: new Set([url]) });
    await assert.rejects(downloads.downloadParakeetFiles(dir, set, () => {}), /truncated/);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'Encoder.mlmodelc/weights')), []);
  });

  test('the ONNX wrapper fetches v2 from the v2 repo on main', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parakeet-dl-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const bodies = {};
    for (const f of downloads.PARAKEET_TDT_REQUIRED_FILES) bodies[`https://huggingface.co/${V2}/resolve/main/${f}`] = 'x';
    const requested = mockFetch(t, bodies);
    await downloads.downloadParakeetTdtFiles(dir, () => {}, V2);
    assert.equal(requested.length, downloads.PARAKEET_TDT_REQUIRED_FILES.length);
    assert.ok(requested.every((u) => u.includes(`/${V2}/resolve/main/`)), requested.join('\n'));
  });
});
