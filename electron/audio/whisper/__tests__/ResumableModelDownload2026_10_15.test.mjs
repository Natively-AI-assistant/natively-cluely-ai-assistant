// electron/audio/whisper/__tests__/ResumableModelDownload2026_10_15.test.mjs
//
// THE BUG: transformers.js fetches each model file in one request, with no
// retry, straight to its final name. A connection that drops 2 GB into Large
// v3 Turbo's 2.55 GB encoder throws the attempt away and the next one starts
// from zero; on a network that drops long transfers it never finishes.
//
// THE FIX: resumableDownload.ts fetches the large files first, into a part
// file, and continues a cut transfer with an HTTP Range request. These tests
// drive it against a fake server that drops connections, ignores Range,
// stalls and refuses, and check the bytes that land on disk.
//
// Plain fetch + node:fs against a temp dir (with a space in its path): the
// same code on macOS and Windows. Not executed on Windows.
//
// Run: npm run build:electron && node --test electron/audio/whisper/__tests__/ResumableModelDownload2026_10_15.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rd = await import(
  pathToFileURL(path.resolve(__dirname, '../../../../dist-electron/electron/audio/whisper/resumableDownload.js')).href
);

const REPO = 'onnx-community/whisper-tiny';
const FILE = 'onnx/encoder_model.onnx';
const BODY = Buffer.from(Array.from({ length: 10_000 }, (_, i) => (i * 7) % 251));

let cacheDir;
beforeEach(() => { cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumable dl-')); });
const dest = () => path.join(cacheDir, 'onnx-community', 'whisper-tiny', 'onnx', 'encoder_model.onnx');
const part = () => dest() + rd.PART_FILE_SUFFIX;

/**
 * A fake Hugging Face. `plan` is consumed one GET at a time:
 *   { cutAfter: n }   send n bytes of the requested range, then drop the connection
 *   { ignoreRange }   answer 200 with the whole file whatever was asked
 *   { status: n }     answer with that status and no body
 *   { stall: true }   send nothing until the request is aborted
 *   undefined         send the requested range in full
 */
function fakeServer({ plan = [], headStatus = 200, size = BODY.length } = {}) {
  const gets = [];
  let heads = 0;
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'HEAD') {
      heads += 1;
      return { ok: headStatus === 200, status: headStatus, headers: { get: (h) => (h === 'content-length' ? String(size) : null) } };
    }
    const range = init.headers?.Range ?? null;
    gets.push({ url, range });
    const step = plan.shift() ?? {};
    if (step.status) return { ok: step.status < 300, status: step.status, body: null, headers: { get: () => null } };
    let from = 0;
    if (range && !step.ignoreRange) from = Number(/bytes=(\d+)-/.exec(range)[1]);
    const slice = BODY.subarray(from);
    const signal = init.signal;
    async function* body() {
      if (step.stall) {
        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted'))));
      }
      const limit = step.cutAfter ?? slice.length;
      for (let i = 0; i < limit; i += 1000) yield new Uint8Array(slice.subarray(i, Math.min(limit, i + 1000)));
      if (step.cutAfter !== undefined) throw new Error('socket hang up');
    }
    return { ok: true, status: from > 0 ? 206 : 200, body: body(), headers: { get: () => null } };
  };
  return { fetchImpl, gets, heads: () => heads };
}

const run = (server, extra = {}) => rd.downloadModelFilesResumable({
  cacheDir, repo: REPO, files: [FILE], fetchImpl: server.fetchImpl, sleep: async () => {}, ...extra,
});

test('a clean download lands under the real name, byte for byte, with no part file left', async () => {
  const server = fakeServer();
  const events = [];
  await run(server, { onProgress: (e) => events.push(e) });
  assert.deepEqual(fs.readFileSync(dest()), BODY);
  assert.equal(fs.existsSync(part()), false);
  assert.equal(server.gets[0].url, `https://huggingface.co/${REPO}/resolve/main/onnx/encoder_model.onnx`);
  assert.equal(events.at(-1).status, 'done');
  assert.equal(events.at(-1).file, FILE, 'keyed like transformers.js progress events, so the aggregator adds them up');
  assert.equal(events.at(-1).loaded, BODY.length);
});

test('a dropped connection continues from the last byte instead of starting over', async () => {
  const server = fakeServer({ plan: [{ cutAfter: 4000 }, { cutAfter: 3000 }] });
  await run(server);
  assert.deepEqual(fs.readFileSync(dest()), BODY, 'the joined file is exactly the original');
  assert.deepEqual(server.gets.map(g => g.range), [null, 'bytes=4000-', 'bytes=7000-'],
    'BUG: every retry re-downloads the whole file');
});

test('a part left by an earlier run (quit, cancel, crash) is resumed, not thrown away', async () => {
  fs.mkdirSync(path.dirname(part()), { recursive: true });
  fs.writeFileSync(part(), BODY.subarray(0, 6000));
  const server = fakeServer();
  await run(server);
  assert.deepEqual(server.gets.map(g => g.range), ['bytes=6000-']);
  assert.deepEqual(fs.readFileSync(dest()), BODY);
});

test('a server that ignores Range sends the whole file, and the part is rewritten rather than appended to', async () => {
  fs.mkdirSync(path.dirname(part()), { recursive: true });
  fs.writeFileSync(part(), BODY.subarray(0, 6000));
  const server = fakeServer({ plan: [{ ignoreRange: true }] });
  await run(server);
  assert.deepEqual(fs.readFileSync(dest()), BODY, 'BUG: appending a full body after a partial one corrupts the model');
});

test('a file already under its real name is checked against the server size', async () => {
  fs.mkdirSync(path.dirname(dest()), { recursive: true });
  fs.writeFileSync(dest(), BODY);
  const whole = fakeServer();
  await run(whole);
  assert.equal(whole.gets.length, 0, 'a complete file is not fetched again');

  // One written by transformers.js before this fix and cut short.
  fs.writeFileSync(dest(), BODY.subarray(0, 2100));
  const truncated = fakeServer();
  await run(truncated);
  assert.equal(truncated.gets.length, 1);
  assert.deepEqual(fs.readFileSync(dest()), BODY, 'BUG: a truncated file is trusted and every load fails');
});

test('a connection that goes silent is dropped and resumed', async () => {
  const server = fakeServer({ plan: [{ cutAfter: 5000 }, { stall: true }] });
  await run(server, { idleTimeoutMs: 50 });
  assert.deepEqual(server.gets.map(g => g.range), [null, 'bytes=5000-', 'bytes=5000-']);
  assert.deepEqual(fs.readFileSync(dest()), BODY);
});

test('server errors are retried; a run of failures that adds no bytes gives up and keeps the part', async () => {
  const flaky = fakeServer({ plan: [{ status: 503 }, { cutAfter: 2000 }, { status: 502 }] });
  await run(flaky);
  assert.deepEqual(fs.readFileSync(dest()), BODY);

  fs.rmSync(dest());
  const down = fakeServer({ plan: [{ cutAfter: 3000 }, { status: 503 }, { status: 503 }, { status: 503 }] });
  await assert.rejects(run(down, { maxStalledAttempts: 3 }), /kept failing/);
  assert.equal(fs.statSync(part()).size, 3000, 'the next attempt resumes from here');
  assert.equal(fs.existsSync(dest()), false, 'nothing incomplete is ever under the real name');
});

test('a refusal (403) is not retried', async () => {
  const server = fakeServer({ plan: [{ status: 403 }] });
  await assert.rejects(run(server), /HTTP 403/);
  assert.equal(server.gets.length, 1);
});

test('a file the repo does not have is skipped and left to transformers.js', async () => {
  const server = fakeServer({ headStatus: 404 });
  await run(server);
  assert.equal(server.gets.length, 0);
  assert.equal(fs.existsSync(dest()), false);
});

test('cleanup after an interrupted download keeps the resume points and drops the rest', () => {
  const dir = path.join(cacheDir, 'onnx-community', 'whisper-tiny');
  const files = {
    'onnx/encoder_model.onnx': true,
    'onnx/encoder_model.onnx_data': true,
    'onnx/decoder_model_merged_quantized.onnx.natively-part': true,
    'config.json': false,
    'tokenizer.json': false,
    '.natively-download-incomplete': false,
  };
  for (const rel of Object.keys(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), 'x');
  }
  rd.deleteInterruptedDownloadKeepingParts(dir);
  for (const [rel, kept] of Object.entries(files)) {
    assert.equal(fs.existsSync(path.join(dir, rel)), kept, rel);
  }
});

// 2026-10-15 review: on Windows a scanner briefly holds a freshly closed
// multi-GB file, and the final rename failed the whole download.
test('a rename blocked by a briefly held file is retried; other errors are not', async () => {
  let calls = 0;
  const slept = [];
  await rd.retryWhileLocked(() => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error('operation not permitted'), { code: calls === 1 ? 'EPERM' : 'EBUSY' });
  }, async (ms) => { slept.push(ms); });
  assert.equal(calls, 3);
  assert.equal(slept.length, 2);

  let other = 0;
  await assert.rejects(rd.retryWhileLocked(() => { other += 1; throw Object.assign(new Error('gone'), { code: 'ENOENT' }); }, async () => {}), /gone/);
  assert.equal(other, 1);

  await assert.rejects(rd.retryWhileLocked(() => { throw Object.assign(new Error('held'), { code: 'EACCES' }); }, async () => {}), /held/,
    'a lock that outlasts ~10 s is reported, not waited on forever');
});
