/**
 * Downloading an extension's model files.
 *
 * The interesting cases here are all ways a download can succeed and still be
 * wrong:
 *
 *  - a server that IGNORES `Range` answers 200 with the whole file; appending
 *    that to a partial produces a corrupt file of a plausible size;
 *  - a moving `main` branch can hand two different revisions to one resumed
 *    download;
 *  - a manifest is downloaded content, so a repo id or path from it can point
 *    the fetch somewhere other than the repo it names.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);

const { HuggingFaceModelDownloader, isSafeRepoId, isSafeRepoPath, buildResolveUrl } =
  require(path.join(repoRoot, 'dist-electron/electron/services/extensions/HuggingFaceModelDownloader.js'));

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'natively-dl-'));
}

const MODEL = {
  key: 'ettin-32m-model',
  format: 'onnx',
  source: 'huggingface',
  repo: 'cross-encoder/ettin-reranker-32m-v1',
  repoPath: 'onnx/model.onnx',
  file: 'ettin-32m-model.onnx',
  approxBytes: 12,
  sha256: null,
  license: { spdx: 'Apache-2.0', url: 'https://x', redistributable: true, commercialUseRestricted: false, requiresAcknowledgement: false },
};

/** A response whose body is a web ReadableStream over `bytes`. */
function bodyResponse(bytes, { status = 200, headers = {} } = {}) {
  const chunks = [bytes];
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    body: new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new Uint8Array(c));
        controller.close();
      },
    }),
  };
}

function metadataResponse(sha) {
  return { ok: true, status: 200, json: async () => ({ sha }), headers: { get: () => null } };
}

// ── path and id safety ────────────────────────────────────────────────────

test('a repo id that is not owner/name is refused', () => {
  assert.ok(isSafeRepoId('cross-encoder/ettin-reranker-32m-v1'));
  assert.ok(isSafeRepoId('jinaai/jina-reranker-v3.5-GGUF'));

  assert.ok(!isSafeRepoId('../../etc/passwd'), 'traversal');
  assert.ok(!isSafeRepoId('https://evil.example/repo'), 'a scheme');
  assert.ok(!isSafeRepoId('owner/name/extra'), 'a third segment');
  assert.ok(!isSafeRepoId('owner'), 'no name');
  assert.ok(!isSafeRepoId('owner\\name'), 'a backslash');
  assert.ok(!isSafeRepoId(''));
});

test('a repo path may have directories but never escape the repo', () => {
  assert.ok(isSafeRepoPath('onnx/model.onnx'));
  assert.ok(isSafeRepoPath('Qwen3-Reranker-0.6B.Q4_K_M.gguf'));

  assert.ok(!isSafeRepoPath('../secrets'), 'traversal');
  assert.ok(!isSafeRepoPath('/etc/passwd'), 'absolute');
  assert.ok(!isSafeRepoPath('a/../../b'), 'traversal mid-path');
  assert.ok(!isSafeRepoPath('file://x'), 'a scheme');
  assert.ok(!isSafeRepoPath('onnx//model.onnx'), 'an empty segment');
});

test('the download URL pins the resolved revision, not a branch name', () => {
  const url = buildResolveUrl('cross-encoder/ettin-reranker-32m-v1', 'abc123', 'onnx/model.onnx');
  assert.equal(url, 'https://huggingface.co/cross-encoder/ettin-reranker-32m-v1/resolve/abc123/onnx/model.onnx');
  assert.ok(!url.includes('/main/'), 'a moving branch would let a resume straddle two revisions');
});

// ── the happy path ────────────────────────────────────────────────────────

test('a download lands at the destination, never a half-written file', async () => {
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);
  const payload = Buffer.from('hello model');

  const dl = new HuggingFaceModelDownloader({
    fetchImpl: async (url) => (String(url).includes('/api/models/')
      ? metadataResponse('deadbeef')
      : bodyResponse(payload, { headers: { 'content-length': String(payload.length) } })),
  });

  const seen = [];
  await dl.download(MODEL, dest, (f) => seen.push(f), new AbortController().signal);

  assert.equal(fs.readFileSync(dest, 'utf8'), 'hello model');
  assert.ok(!fs.existsSync(`${dest}.part`), 'the .part file must be gone');
  assert.equal(seen.at(-1), 1, 'progress must reach 1');
});

test('the pinned revision comes from the repo metadata', async () => {
  const dir = tmpDir();
  const urls = [];
  const dl = new HuggingFaceModelDownloader({
    fetchImpl: async (url) => {
      urls.push(String(url));
      return String(url).includes('/api/models/')
        ? metadataResponse('c0ffee')
        : bodyResponse(Buffer.from('x'), { headers: { 'content-length': '1' } });
    },
  });
  await dl.download(MODEL, path.join(dir, MODEL.file), () => {}, new AbortController().signal);
  assert.ok(urls[1].includes('/resolve/c0ffee/'), `expected the pinned sha, got ${urls[1]}`);
});

test('unresolvable metadata degrades to main rather than failing the download', async () => {
  const dir = tmpDir();
  const urls = [];
  const dl = new HuggingFaceModelDownloader({
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes('/api/models/')) return { ok: false, status: 500, json: async () => ({}), headers: { get: () => null } };
      return bodyResponse(Buffer.from('x'), { headers: { 'content-length': '1' } });
    },
  });
  await dl.download(MODEL, path.join(dir, MODEL.file), () => {}, new AbortController().signal);
  assert.ok(urls[1].includes('/resolve/main/'));
});

// ── resume ────────────────────────────────────────────────────────────────

test('a resumed download sends Range and appends the 206 tail', async () => {
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);
  fs.writeFileSync(`${dest}.part`, 'hello ');   // 6 bytes already on disk

  let rangeHeader = null;
  const dl = new HuggingFaceModelDownloader({
    fetchImpl: async (url, init) => {
      if (String(url).includes('/api/models/')) return metadataResponse('abc');
      rangeHeader = init?.headers?.Range ?? null;
      return bodyResponse(Buffer.from('model'), { status: 206, headers: { 'content-length': '5' } });
    },
  });

  await dl.download(MODEL, dest, () => {}, new AbortController().signal);
  assert.equal(rangeHeader, 'bytes=6-');
  assert.equal(fs.readFileSync(dest, 'utf8'), 'hello model', 'the tail must append to the partial');
});

test('a server that IGNORES Range restarts from zero instead of corrupting the file', async () => {
  // THE trap. Answering 200 with the whole body and appending it would produce
  // "hello hello model" — wrong, but a plausible size.
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);
  fs.writeFileSync(`${dest}.part`, 'hello ');

  const dl = new HuggingFaceModelDownloader({
    fetchImpl: async (url) => (String(url).includes('/api/models/')
      ? metadataResponse('abc')
      // 200, not 206: the range was ignored.
      : bodyResponse(Buffer.from('hello model'), { status: 200, headers: { 'content-length': '11' } })),
  });

  await dl.download(MODEL, dest, () => {}, new AbortController().signal);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'hello model');
});

test('a 416 discards the partial rather than renaming something unverified', async () => {
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);
  fs.writeFileSync(`${dest}.part`, 'far too much content already');

  let calls = 0;
  const dl = new HuggingFaceModelDownloader({
    logger: { info: () => {}, warn: () => {} },
    fetchImpl: async (url) => {
      if (String(url).includes('/api/models/')) return metadataResponse('abc');
      calls += 1;
      // First attempt 416; the retry then finds no partial and succeeds.
      if (calls === 1) return { ok: false, status: 416, headers: { get: () => null }, body: null };
      return bodyResponse(Buffer.from('ok'), { headers: { 'content-length': '2' } });
    },
  });

  await dl.download(MODEL, dest, () => {}, new AbortController().signal);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'ok');
});

test('progress uses the server length, and a 206 length is the REMAINDER', async () => {
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);
  fs.writeFileSync(`${dest}.part`, 'hello ');   // 6 of 11

  const fractions = [];
  const dl = new HuggingFaceModelDownloader({
    fetchImpl: async (url) => (String(url).includes('/api/models/')
      ? metadataResponse('abc')
      : bodyResponse(Buffer.from('model'), { status: 206, headers: { 'content-length': '5' } })),
  });

  await dl.download(MODEL, dest, (f) => fractions.push(f), new AbortController().signal);
  // 11 total, not 5 — treating the remainder as the total would report >100%.
  assert.ok(fractions.every((f) => f >= 0 && f <= 1), `fractions out of range: ${fractions}`);
  assert.equal(fractions.at(-1), 1);
});

// ── failure ───────────────────────────────────────────────────────────────

test('a persistent HTTP error eventually throws, bounded', async () => {
  const dir = tmpDir();
  let attempts = 0;
  const dl = new HuggingFaceModelDownloader({
    logger: { info: () => {}, warn: () => {} },
    fetchImpl: async (url) => {
      if (String(url).includes('/api/models/')) return metadataResponse('abc');
      attempts += 1;
      return { ok: false, status: 503, headers: { get: () => null }, body: null };
    },
  });

  await assert.rejects(
    () => dl.download(MODEL, path.join(dir, MODEL.file), () => {}, new AbortController().signal),
    /HTTP 503/,
  );
  assert.ok(attempts <= 3, `retries must be bounded, saw ${attempts}`);
});

test('cancellation keeps the partial so the next attempt can resume', async () => {
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);
  const controller = new AbortController();

  const dl = new HuggingFaceModelDownloader({
    logger: { info: () => {}, warn: () => {} },
    fetchImpl: async (url) => {
      if (String(url).includes('/api/models/')) return metadataResponse('abc');
      // Write something, then cancel mid-stream.
      fs.writeFileSync(`${dest}.part`, 'partial');
      controller.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    },
  });

  await assert.rejects(() => dl.download(MODEL, dest, () => {}, controller.signal), /cancelled/);
  assert.ok(fs.existsSync(`${dest}.part`), 'the partial must survive a cancellation');
  assert.ok(!fs.existsSync(dest), 'nothing may appear at the real path');
});

test('an unresolved repo id is refused before any request', async () => {
  const dir = tmpDir();
  let called = false;
  const dl = new HuggingFaceModelDownloader({ fetchImpl: async () => { called = true; throw new Error('should not fetch'); } });

  await assert.rejects(
    () => dl.download({ ...MODEL, repo: null }, path.join(dir, MODEL.file), () => {}, new AbortController().signal),
    /no resolved repository id/,
  );
  assert.equal(called, false, 'a guessed repo id must never be fetched');
});

test('a non-huggingface source is refused', async () => {
  const dir = tmpDir();
  const dl = new HuggingFaceModelDownloader({ fetchImpl: async () => { throw new Error('nope'); } });
  await assert.rejects(
    () => dl.download({ ...MODEL, source: 'ollama' }, path.join(dir, MODEL.file), () => {}, new AbortController().signal),
    /unsupported model source/,
  );
});
