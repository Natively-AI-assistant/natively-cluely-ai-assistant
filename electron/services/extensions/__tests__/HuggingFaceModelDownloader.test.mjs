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
  fs.writeFileSync(`${dest}.part.rev`, 'abc');  // ...from THIS revision; unstamped is stale

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
  fs.writeFileSync(`${dest}.part.rev`, 'abc');

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
  fs.writeFileSync(`${dest}.part.rev`, 'abc');

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
  fs.writeFileSync(`${dest}.part.rev`, 'abc');

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

test('re-downloading over an existing file replaces it', async () => {
  // ModelStore.download() does not skip a model that is already `ready`, so this
  // path is reachable in normal use. POSIX rename replaces silently; Windows
  // does not when anything holds the old file open, which is why the
  // destination is unlinked first.
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);
  fs.writeFileSync(dest, 'an older version of the weights');

  const dl = new HuggingFaceModelDownloader({
    fetchImpl: async (url) => (String(url).includes('/api/models/')
      ? metadataResponse('abc')
      : bodyResponse(Buffer.from('new weights'), { headers: { 'content-length': '11' } })),
  });

  await dl.download(MODEL, dest, () => {}, new AbortController().signal);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'new weights');
  assert.ok(!fs.existsSync(`${dest}.part`));
});

test('a partial from a DIFFERENT revision is discarded, not resumed onto', async () => {
  // The nasty one. Pinning the sha within one download() call does not help a
  // partial left by an earlier session: resuming appends a new revision's tail
  // to an old revision's head. That file is corrupt, plausible in size, and for
  // any manifest entry with sha256:null it PASSES verification, because
  // ModelStore.verify() treats an unknown hash as "record it" not "check it".
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);
  fs.writeFileSync(`${dest}.part`, 'OLD-REVISION-HEAD');
  fs.writeFileSync(`${dest}.part.rev`, 'oldsha111');

  let rangeSeen;
  const dl = new HuggingFaceModelDownloader({
    logger: { info: () => {}, warn: () => {} },
    fetchImpl: async (url, init) => {
      if (String(url).includes('/api/models/')) return metadataResponse('newsha222');
      rangeSeen = init?.headers?.Range ?? null;
      return bodyResponse(Buffer.from('complete new file'), { headers: { 'content-length': '17' } });
    },
  });

  await dl.download(MODEL, dest, () => {}, new AbortController().signal);
  assert.equal(rangeSeen, null, 'a stale partial must not be resumed onto');
  assert.equal(fs.readFileSync(dest, 'utf8'), 'complete new file');
});

test('an UNSTAMPED partial is treated as stale', async () => {
  // It predates this mechanism; there is no way to know which revision wrote it.
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);
  fs.writeFileSync(`${dest}.part`, 'mystery bytes');

  let rangeSeen;
  const dl = new HuggingFaceModelDownloader({
    logger: { info: () => {}, warn: () => {} },
    fetchImpl: async (url, init) => {
      if (String(url).includes('/api/models/')) return metadataResponse('abc');
      rangeSeen = init?.headers?.Range ?? null;
      return bodyResponse(Buffer.from('fresh'), { headers: { 'content-length': '5' } });
    },
  });
  await dl.download(MODEL, dest, () => {}, new AbortController().signal);
  assert.equal(rangeSeen, null);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'fresh');
});

test('a partial from the SAME revision is still resumed', async () => {
  // The fix must not throw away legitimate resume — that is the whole point of
  // keeping the partial on cancellation.
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);
  fs.writeFileSync(`${dest}.part`, 'hello ');
  fs.writeFileSync(`${dest}.part.rev`, 'samesha');

  let rangeSeen;
  const dl = new HuggingFaceModelDownloader({
    fetchImpl: async (url, init) => {
      if (String(url).includes('/api/models/')) return metadataResponse('samesha');
      rangeSeen = init?.headers?.Range ?? null;
      return bodyResponse(Buffer.from('model'), { status: 206, headers: { 'content-length': '5' } });
    },
  });
  await dl.download(MODEL, dest, () => {}, new AbortController().signal);
  assert.equal(rangeSeen, 'bytes=6-');
  assert.equal(fs.readFileSync(dest, 'utf8'), 'hello model');
  assert.ok(!fs.existsSync(`${dest}.part.rev`), 'the stamp is cleaned up on success');
});

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

test('a slow BODY is not aborted by the connect timeout', async () => {
  // Regression. AbortSignal.timeout() cannot be cancelled, so composing it into
  // fetch's signal aborts the whole request including the body. A real 128MB
  // download aborted twice at 30s and only survived because resume caught it.
  // The timer must be cleared once the headers land.
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);

  const dl = new HuggingFaceModelDownloader({
    logger: { info: () => {}, warn: () => {} },
    fetchImpl: async (url, init) => {
      if (String(url).includes('/api/models/')) return metadataResponse('abc');
      const signal = init?.signal;
      return {
        ok: true,
        status: 200,
        headers: { get: (k) => (k.toLowerCase() === 'content-length' ? '4' : null) },
        body: new ReadableStream({
          async start(controller) {
            // Emit slowly, and assert the request signal stays unaborted
            // throughout — that is the whole property under test.
            for (const byte of [1, 2, 3, 4]) {
              await new Promise((r) => setTimeout(r, 15));
              assert.equal(signal?.aborted, false, 'the body must not be on the connect clock');
              controller.enqueue(new Uint8Array([byte]));
            }
            controller.close();
          },
        }),
      };
    },
  });

  await dl.download(MODEL, dest, () => {}, new AbortController().signal);
  assert.equal(fs.readFileSync(dest).length, 4);
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

// ── an UNRESOLVED revision must never be stamped ──────────────────────────
// resolveRevision() returns null on any non-2xx, bad JSON, or its 20s timeout.
// The download still proceeds against the default branch, but treating that
// fallback as a revision is what makes two different HEADs look identical.

test('a failed revision lookup leaves the partial UNSTAMPED', async () => {
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);

  const dl = new HuggingFaceModelDownloader({
    logger: { info: () => {}, warn: () => {} },
    fetchImpl: async (url) => (String(url).includes('/api/models/')
      ? { ok: false, status: 503, json: async () => ({}), headers: { get: () => null } }
      : bodyResponse(Buffer.from('body'), { headers: { 'content-length': '4' } })),
  });

  await dl.download(MODEL, dest, () => {}, new AbortController().signal);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'body');
  assert.ok(!fs.existsSync(`${dest}.part.rev`), 'no stamp survives a completed download');
});

test('two consecutive failed lookups do NOT resume onto each other', async () => {
  // The dangerous case: stamping the literal 'main' twice makes bytes from two
  // genuinely different HEADs compare equal and get concatenated.
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);
  // A partial left by a previous session that also could not resolve.
  fs.writeFileSync(`${dest}.part`, 'old-head-prefix');
  fs.writeFileSync(`${dest}.part.rev`, 'main');

  let rangeSeen = 'unset';
  const dl = new HuggingFaceModelDownloader({
    logger: { info: () => {}, warn: () => {} },
    fetchImpl: async (url, init) => {
      if (String(url).includes('/api/models/')) {
        return { ok: false, status: 500, json: async () => ({}), headers: { get: () => null } };
      }
      rangeSeen = init?.headers?.Range ?? null;
      return bodyResponse(Buffer.from('whole'), { headers: { 'content-length': '5' } });
    },
  });

  await dl.download(MODEL, dest, () => {}, new AbortController().signal);
  assert.equal(rangeSeen, null, 'must refetch from zero, never Range-resume an unprovable partial');
  assert.equal(fs.readFileSync(dest, 'utf8'), 'whole');
});

// ── replacing an existing model must never destroy it first ───────────────

test('re-downloading over an existing model replaces it and leaves no debris', async () => {
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);
  fs.writeFileSync(dest, 'the previously working model');

  const dl = new HuggingFaceModelDownloader({
    logger: { info: () => {}, warn: () => {} },
    fetchImpl: async (url) => (String(url).includes('/api/models/')
      ? metadataResponse('cafe1234')
      : bodyResponse(Buffer.from('replacement'), { headers: { 'content-length': '11' } })),
  });

  await dl.download(MODEL, dest, () => {}, new AbortController().signal);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'replacement');
  assert.ok(!fs.existsSync(`${dest}.old`), 'the move-aside backup is cleaned up on success');
  assert.ok(!fs.existsSync(`${dest}.part`), 'no partial is left behind');
  assert.ok(!fs.existsSync(`${dest}.part.rev`), 'no stamp is left behind');
});

test('a failed replace keeps BOTH the old model and the resumable partial', async () => {
  // The Windows case the friendly EPERM message exists for: an extension still
  // holds the old file open. Simulated by making the final rename throw.
  const dir = tmpDir();
  const dest = path.join(dir, MODEL.file);
  fs.writeFileSync(dest, 'the previously working model');

  // Thrown on EVERY attempt: the downloader retries, so a one-shot failure
  // would simply be recovered and prove nothing about the failure path.
  const realRename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(from).endsWith('.part')) {
      const e = new Error('in use');
      e.code = 'EBUSY';
      throw e;
    }
    return realRename(from, to);
  };

  try {
    const dl = new HuggingFaceModelDownloader({
      logger: { info: () => {}, warn: () => {} },
      fetchImpl: async (url) => (String(url).includes('/api/models/')
        ? metadataResponse('cafe1234')
        : bodyResponse(Buffer.from('replacement'), { headers: { 'content-length': '11' } })),
    });
    await assert.rejects(
      () => dl.download(MODEL, dest, () => {}, new AbortController().signal),
      /in use|EBUSY/i,
    );
  } finally {
    fs.renameSync = realRename;
  }

  assert.equal(
    fs.readFileSync(dest, 'utf8'),
    'the previously working model',
    'the user must not be left with no model at all',
  );
  assert.ok(fs.existsSync(`${dest}.part.rev`), 'the stamp survives so the finished .part is resumable');
});
