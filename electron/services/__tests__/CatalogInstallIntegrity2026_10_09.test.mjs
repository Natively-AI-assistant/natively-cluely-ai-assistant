/**
 * A catalogue install that reports success must leave the catalogue's bytes on
 * disk. Three ways it did not (reproduced 2026-10-09 before any fix):
 *
 *  - A file already on disk at the declared SIZE was skipped without looking at
 *    its hash, so a damaged file of the right length was "installed" for ever
 *    and no reinstall could repair it.
 *  - A download with no published hash was only hashed, never measured. A
 *    2-byte answer to a 12-byte file was renamed into place and read as
 *    installed.
 *  - A model that needs its config.json rewritten (jina v2) returned ok:true
 *    when the rewrite failed, and any non-empty config.json was reused.
 *
 * Both installers share the logic, so every case runs against both.
 *
 * These are transfer tests on tiny fixture files. They do not load a model and
 * say nothing about inference. Paths go through path.join and the downloader's
 * fetch is injected, so the same assertions hold on macOS and Windows.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const { HuggingFaceModelDownloader } =
  require(path.join(repoRoot, 'dist-electron/electron/services/extensions/HuggingFaceModelDownloader.js'));

/**
 * The build inlines its own copy of the catalogue into each installer bundle,
 * so mutating the separately-built catalogue module changes nothing the
 * installer reads. Compile a private instance of the bundle that also exports
 * its inlined array. A renamed symbol fails here loudly, not silently.
 */
function loadInstallerWithCatalog(relative, symbol) {
  const filename = path.join(repoRoot, 'dist-electron/electron', relative);
  const instance = new Module(filename);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance._compile(
    `${fs.readFileSync(filename, 'utf8')}\nmodule.exports.__fixtureCatalog = ${symbol};\n`,
    filename,
  );
  return instance.exports;
}

const embedding = loadInstallerWithCatalog('services/embeddings/localEmbeddingModelInstaller.js', 'EMBEDDING_MODEL_CATALOG');
const reranker = loadInstallerWithCatalog('services/reranking/localModelInstaller.js', 'RERANKER_MODEL_CATALOG');

const FAMILIES = [
  {
    family: 'embedding',
    catalog: embedding.__fixtureCatalog,
    install: embedding.installEmbeddingCatalogModel,
    check: embedding.checkAndRepairEmbeddingCatalogModel,
    statusOf: embedding.statusOf,
    listedStatusOf: embedding.listedStatusOf,
    // Not the bundled entry: its status may be answered from the app's own
    // resources, which is a different code path from a download.
    plain: () => embedding.__fixtureCatalog.find((m) => !m.bundled),
  },
  {
    family: 'reranker',
    catalog: reranker.__fixtureCatalog,
    install: reranker.installCatalogModel,
    check: reranker.checkAndRepairCatalogModel,
    statusOf: reranker.statusOf,
    listedStatusOf: reranker.listedStatusOf,
    plain: () => reranker.__fixtureCatalog.find((m) => !m.configPatch),
  },
];

// ── the catalogue itself: what can be pinned by hash, is ────────────────────

// Hugging Face stores model weights as LFS objects and publishes a sha256 for
// every one, so a weights file with `sha256: null` is checked by length alone:
// a same-length damaged download of it installs. Small text files (config,
// tokenizer) are not LFS, have no published hash, and stay null by design.
// First in the file: the tests below swap fixtures into these same arrays.
const WEIGHTS = /\.(onnx|onnx_data|gguf|safetensors|bin|pt|pth)$/;
for (const { family, catalog } of FAMILIES) {
  test(`${family}: every weights file in the catalogue is pinned by sha256`, () => {
    const unpinned = [];
    for (const model of catalog) {
      for (const file of model.files) {
        if (WEIGHTS.test(file.repoPath) && !/^[a-f0-9]{64}$/.test(String(file.sha256))) {
          unpinned.push(`${model.id}/${file.repoPath}`);
        }
      }
    }
    assert.deepEqual(unpinned, []);
  });
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const signal = () => new AbortController().signal;
const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-install-integrity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const destinationOf = (root, model, repoPath) =>
  path.join(root, ...model.repo.split('/'), ...repoPath.split('/'));

/** Swap a model's file list for fixtures; restored when the test ends. */
function withFiles(t, model, files) {
  const original = { files: model.files, bytes: model.bytes };
  model.files = files;
  model.bytes = files.reduce((n, f) => n + f.bytes, 0);
  t.after(() => Object.assign(model, original));
}

/** A real downloader whose network is a function from repo path to a body. */
function downloaderServing(bodyFor) {
  const calls = [];
  const downloader = new HuggingFaceModelDownloader({
    fetchImpl: async (url) => {
      const repoPath = decodeURIComponent(String(url).split('/resolve/')[1].split('/').slice(1).join('/'));
      calls.push(repoPath);
      return new Response(bodyFor(repoPath));
    },
  });
  return { downloader, calls };
}

// ── an existing file is trusted only if it is the catalogue's file ──────────

for (const { family, install, statusOf, plain } of FAMILIES) {
  test(`${family}: a same-size file with the wrong contents is repaired, not skipped`, async (t) => {
    const model = plain();
    const good = Buffer.from('correct bytes');
    withFiles(t, model, [{ repoPath: 'fixture.bin', bytes: good.length, sha256: sha256(good) }]);
    const root = tmp(t);
    const destination = destinationOf(root, model, 'fixture.bin');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, Buffer.alloc(good.length, 88));

    const { downloader, calls } = downloaderServing(() => good);
    const result = await install(model.id, () => {}, signal(), { rootOverride: root, downloader });

    assert.equal(result.ok, true, result.error);
    assert.deepEqual(calls, ['fixture.bin'], 'the damaged file must be fetched again');
    assert.deepEqual(fs.readFileSync(destination), good);
    assert.equal(statusOf(model, root).state, 'installed');
  });

  test(`${family}: a repair that fails leaves the file that was there`, async (t) => {
    // Deleting first would turn "damaged" into "gone" on a failed retry.
    const model = plain();
    const good = Buffer.from('correct bytes');
    withFiles(t, model, [{ repoPath: 'fixture.bin', bytes: good.length, sha256: sha256(good) }]);
    const root = tmp(t);
    const destination = destinationOf(root, model, 'fixture.bin');
    const damaged = Buffer.alloc(good.length, 88);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, damaged);

    const { downloader } = downloaderServing(() => Buffer.alloc(good.length, 89));
    const result = await install(model.id, () => {}, signal(), { rootOverride: root, downloader });

    assert.equal(result.ok, false);
    assert.match(result.error, /failed verification/);
    assert.deepEqual(fs.readFileSync(destination), damaged, 'the previous file must survive a failed repair');
    assert.equal(fs.existsSync(`${destination}.old`), false, 'no backup debris');
  });

  test(`${family}: a file that already matches is not fetched again`, async (t) => {
    const model = plain();
    const good = Buffer.from('correct bytes');
    withFiles(t, model, [
      { repoPath: 'hashed.bin', bytes: good.length, sha256: sha256(good) },
      { repoPath: 'unhashed.json', bytes: good.length, sha256: null },
    ]);
    const root = tmp(t);
    for (const name of ['hashed.bin', 'unhashed.json']) {
      const destination = destinationOf(root, model, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, good);
    }

    const { downloader, calls } = downloaderServing(() => { throw new Error('must not fetch'); });
    const result = await install(model.id, () => {}, signal(), { rootOverride: root, downloader });

    assert.equal(result.ok, true, result.error);
    assert.deepEqual(calls, []);
  });

  // ── a download is the declared length, hash or no hash ────────────────────

  for (const [label, body] of [['short', '{}'], ['oversized', '{"padding":"0123456789"}']]) {
    test(`${family}: a ${label} download of a file with no published hash is refused`, async (t) => {
      const model = plain();
      withFiles(t, model, [{ repoPath: 'config.json', bytes: 12, sha256: null }]);
      const root = tmp(t);
      const destination = destinationOf(root, model, 'config.json');

      const { downloader } = downloaderServing(() => Buffer.from(body));
      const result = await install(model.id, () => {}, signal(), { rootOverride: root, downloader });

      assert.equal(result.ok, false, 'a wrong-length file must not be reported as installed');
      assert.match(result.error, /config\.json/);
      assert.equal(fs.existsSync(destination), false, 'nothing may be renamed into place');
      assert.notEqual(statusOf(model, root).state, 'installed');
    });
  }

  test(`${family}: a well-formed HTTP answer that is simply too short is refused`, async (t) => {
    // Not a broken stream: the server truthfully declares the 2 bytes it sends.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': '2' });
      res.end('{}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const model = plain();
    withFiles(t, model, [{ repoPath: 'config.json', bytes: 12, sha256: null }]);
    const root = tmp(t);
    const downloader = new HuggingFaceModelDownloader({
      fetchImpl: (_url, options) => fetch(`http://127.0.0.1:${server.address().port}/fixture`, options),
    });
    const result = await install(model.id, () => {}, signal(), { rootOverride: root, downloader });

    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(destinationOf(root, model, 'config.json')), false);
  });

  test(`${family}: a file of the wrong length on disk does not read as installed`, (t) => {
    const model = plain();
    withFiles(t, model, [{ repoPath: 'config.json', bytes: 12, sha256: null }]);
    const root = tmp(t);
    const destination = destinationOf(root, model, 'config.json');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, '{}');

    const status = statusOf(model, root);
    assert.equal(status.state, 'partial', 'bytes are there, so it is not "not-installed" either');
    assert.deepEqual(status.missing, ['config.json']);
  });

  test(`${family}: every catalogue entry installs from its pinned revision, and reinstalls without fetching`, async (t) => {
    const { catalog } = FAMILIES.find((f) => f.family === family);
    const root = tmp(t);
    for (const model of catalog) {
      assert.match(model.revision, /^[a-f0-9]{40}$/);
      const bodies = new Map(model.files.map((f) => [
        f.repoPath,
        Buffer.from(f.repoPath === 'config.json' ? '{"fixture":true}' : `fixture:${f.repoPath}`),
      ]));
      const patched = (f) => Boolean(model.configPatch) && f.repoPath === 'config.json';
      const original = { files: model.files, bytes: model.bytes };
      t.after(() => Object.assign(model, original));
      model.files = original.files.map((f) => ({
        ...f,
        bytes: bodies.get(f.repoPath).length,
        sha256: patched(f) ? null : sha256(bodies.get(f.repoPath)),
      }));
      model.bytes = model.files.reduce((n, f) => n + f.bytes, 0);

      let calls = 0;
      const prefix = `https://huggingface.co/${model.repo}/resolve/${model.revision}/`;
      const downloader = new HuggingFaceModelDownloader({
        fetchImpl: async (url) => {
          assert.ok(String(url).startsWith(prefix), `${model.id}: wrong pin or source: ${url}`);
          const repoPath = String(url).slice(prefix.length).split('/').map(decodeURIComponent).join('/');
          assert.ok(bodies.has(repoPath), `${model.id}: undeclared file ${repoPath}`);
          calls++;
          return new Response(bodies.get(repoPath));
        },
      });
      const opts = { rootOverride: root, downloader };

      const first = await install(model.id, () => {}, signal(), opts);
      assert.equal(first.ok, true, `${model.id}: ${first.error}`);
      assert.equal(calls, model.files.length, `${model.id}: every declared file is fetched once`);
      for (const f of model.files) {
        const onDisk = fs.readFileSync(destinationOf(root, model, f.repoPath));
        if (patched(f)) {
          const config = JSON.parse(onDisk);
          for (const [key, value] of Object.entries(model.configPatch)) assert.deepEqual(config[key], value);
        } else {
          assert.deepEqual(onDisk, bodies.get(f.repoPath), `${model.id}/${f.repoPath}`);
        }
      }
      assert.equal(reportedStatus(family, model, root), 'installed', model.id);

      const again = await install(model.id, () => {}, signal(), opts);
      assert.equal(again.ok, true, `${model.id}: ${again.error}`);
      assert.equal(calls, model.files.length, `${model.id}: an intact install must not fetch anything`);
    }
  });
}

/** What the app goes by when it decides whether to LOAD a model. */
function reportedStatus(family, model, root) {
  return FAMILIES.find((f) => f.family === family).statusOf(model, root).state;
}

/** What the model list shows: the same, plus damage a check has proven. */
function listedStatus(family, model, root) {
  return FAMILIES.find((f) => f.family === family).listedStatusOf(model, root);
}

// ── a config.json the catalogue rewrites (reranker only) ────────────────────

const patchedModel = () => reranker.__fixtureCatalog.find((m) => m.configPatch);
const UPSTREAM_CONFIG = '{"a":1}';

function patchedFixture(t, { sha256: declaredHash = null } = {}) {
  const model = patchedModel();
  assert.ok(model, 'the catalogue should still have an entry with a configPatch');
  withFiles(t, model, [{ repoPath: 'config.json', bytes: UPSTREAM_CONFIG.length, sha256: declaredHash }]);
  const root = tmp(t);
  const destination = destinationOf(root, model, 'config.json');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  return { model, root, destination };
}

const assertPatched = (destination, model) => {
  const config = JSON.parse(fs.readFileSync(destination, 'utf8'));
  for (const [key, value] of Object.entries(model.configPatch)) assert.deepEqual(config[key], value);
  return config;
};

test('reranker: a malformed config.json is fetched again and patched', async (t) => {
  const { model, root, destination } = patchedFixture(t);
  fs.writeFileSync(destination, '{bad json}');

  const { downloader, calls } = downloaderServing(() => Buffer.from(UPSTREAM_CONFIG));
  const result = await reranker.installCatalogModel(model.id, () => {}, signal(), { rootOverride: root, downloader });

  assert.equal(result.ok, true, result.error);
  assert.deepEqual(calls, ['config.json']);
  assert.equal(result.configPatched, true);
  assert.equal(assertPatched(destination, model).a, 1, 'the upstream fields survive the patch');
  assert.equal(reranker.statusOf(model, root).state, 'installed');
});

test('reranker: a malformed config.json on disk does not read as installed', (t) => {
  const { model, root, destination } = patchedFixture(t);
  fs.writeFileSync(destination, '{bad json}');
  assert.notEqual(reranker.statusOf(model, root).state, 'installed');
});

test('reranker: an already-patched config.json is reused without fetching', async (t) => {
  const { model, root, destination } = patchedFixture(t);
  fs.writeFileSync(destination, JSON.stringify({ a: 1, ...model.configPatch }, null, 2));

  const { downloader, calls } = downloaderServing(() => { throw new Error('must not fetch'); });
  const result = await reranker.installCatalogModel(model.id, () => {}, signal(), { rootOverride: root, downloader });

  assert.equal(result.ok, true, result.error);
  assert.deepEqual(calls, []);
  assertPatched(destination, model);
});

test('reranker: an untouched upstream config.json is patched in place, not fetched again', async (t) => {
  // The state after a crash between the download and the rewrite.
  const { model, root, destination } = patchedFixture(t);
  fs.writeFileSync(destination, UPSTREAM_CONFIG);

  const { downloader, calls } = downloaderServing(() => { throw new Error('must not fetch'); });
  const result = await reranker.installCatalogModel(model.id, () => {}, signal(), { rootOverride: root, downloader });

  assert.equal(result.ok, true, result.error);
  assert.deepEqual(calls, []);
  assert.equal(result.configPatched, true);
  assertPatched(destination, model);
});

test('reranker: an install whose config.json cannot be patched fails', async (t) => {
  // Right length, so it passes the size check, but it is not JSON. Without the
  // patch transformers.js cannot load the model, so "ok" would be a lie.
  const { model, root } = patchedFixture(t);
  const { downloader } = downloaderServing(() => Buffer.from('not js!'));
  const result = await reranker.installCatalogModel(model.id, () => {}, signal(), { rootOverride: root, downloader });

  assert.equal(result.ok, false);
  assert.match(result.error, /config\.json/);
  assert.notEqual(reranker.statusOf(model, root).state, 'installed');
});

test('reranker: a config.json that carries a hash is never patched, and the install says so', async (t) => {
  // Patching verified bytes would make the next install look corrupt. The
  // catalogue never declares this (RerankerModelCatalog test), so reaching it
  // is an authoring mistake that must not pass as a working install.
  const { model, root, destination } = patchedFixture(t, { sha256: sha256(Buffer.from(UPSTREAM_CONFIG)) });
  const { downloader } = downloaderServing(() => Buffer.from(UPSTREAM_CONFIG));
  const result = await reranker.installCatalogModel(model.id, () => {}, signal(), { rootOverride: root, downloader });

  assert.equal(result.ok, false);
  assert.match(result.error, /config\.json/);
  assert.equal(fs.readFileSync(destination, 'utf8'), UPSTREAM_CONFIG, 'the verified file is left exactly as downloaded');
});

// ── damage AFTER install: found when the model is checked, not on every draw ─
//
// The list stays length-only (it redraws constantly), so same-size damage read
// as "installed" for good. A check now runs when a model is activated and from
// the row's own button. It hashes every file: against the published hash where
// there is one, and otherwise against the hash recorded when the file was
// installed, which is the only thing that can vouch for a config or tokenizer.

const RECORD = '.natively-install.json';
const recordPath = (root, model) => path.join(root, ...model.repo.split('/'), RECORD);
const readRecord = (root, model) => JSON.parse(fs.readFileSync(recordPath(root, model), 'utf8'));

/** One file with a published hash and one without, like every real entry. */
function installedFixture(t, family) {
  const entry = FAMILIES.find((f) => f.family === family);
  const model = entry.plain();
  const bodies = {
    'weights.bin': Buffer.from('weights:0123456789abcdef0123456789abcdef'),
    'tokenizer.json': Buffer.from('{"tokens":["alpha","beta","gamma"]}'),
  };
  withFiles(t, model, [
    { repoPath: 'weights.bin', bytes: bodies['weights.bin'].length, sha256: sha256(bodies['weights.bin']) },
    { repoPath: 'tokenizer.json', bytes: bodies['tokenizer.json'].length, sha256: null },
  ]);
  const root = tmp(t);
  return { ...entry, model, bodies, root, at: (repoPath) => destinationOf(root, model, repoPath) };
}

/** Overwrite a file with different bytes of the SAME length. */
function damageInPlace(file) {
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(file, Buffer.alloc(bytes.length, 0x58));
}

for (const { family } of FAMILIES) {
  test(`${family}: an install records a hash for every file, published or not`, async (t) => {
    const { model, bodies, root, install } = installedFixture(t, family);
    const { downloader } = downloaderServing((repoPath) => bodies[repoPath]);
    const result = await install(model.id, () => {}, signal(), { rootOverride: root, downloader });
    assert.equal(result.ok, true, result.error);

    const record = readRecord(root, model);
    assert.equal(record.revision, model.revision);
    for (const [repoPath, body] of Object.entries(bodies)) {
      assert.deepEqual(record.files[repoPath], { bytes: body.length, sha256: sha256(body) }, repoPath);
    }
  });

  test(`${family}: an intact model is checked without fetching anything`, async (t) => {
    const { model, bodies, root, install, check } = installedFixture(t, family);
    const { downloader, calls } = downloaderServing((repoPath) => bodies[repoPath]);
    const opts = { rootOverride: root, downloader };
    await install(model.id, () => {}, signal(), opts);
    calls.length = 0;

    const phases = new Set();
    const result = await check(model.id, (p) => phases.add(p.phase), signal(), opts);
    assert.deepEqual({ ok: result.ok, repaired: result.repaired }, { ok: true, repaired: [] });
    assert.deepEqual(calls, []);
    assert.deepEqual([...phases], ['checking'], 'the row is told this is a check, not a download');
  });

  test(`${family}: same-size damage to a file with NO published hash is found and repaired`, async (t) => {
    const { model, bodies, root, install, check, at } = installedFixture(t, family);
    const { downloader, calls } = downloaderServing((repoPath) => bodies[repoPath]);
    const opts = { rootOverride: root, downloader };
    await install(model.id, () => {}, signal(), opts);
    calls.length = 0;
    damageInPlace(at('tokenizer.json'));
    assert.equal(reportedStatus(family, model, root), 'installed', 'precondition: the list cannot see it');

    const result = await check(model.id, () => {}, signal(), opts);
    assert.deepEqual({ ok: result.ok, repaired: result.repaired }, { ok: true, repaired: ['tokenizer.json'] });
    assert.deepEqual(calls, ['tokenizer.json'], 'only the damaged file is fetched');
    assert.deepEqual(fs.readFileSync(at('tokenizer.json')), bodies['tokenizer.json']);
    assert.equal(reportedStatus(family, model, root), 'installed');
  });

  test(`${family}: damage that cannot be repaired is listed as such, and nothing is deleted or withdrawn`, async (t) => {
    const { model, bodies, root, install, check, at } = installedFixture(t, family);
    const working = downloaderServing((repoPath) => bodies[repoPath]);
    await install(model.id, () => {}, signal(), { rootOverride: root, downloader: working.downloader });
    damageInPlace(at('weights.bin'));
    const damaged = fs.readFileSync(at('weights.bin'));

    const offline = new HuggingFaceModelDownloader({ fetchImpl: async () => { throw new Error('offline'); } });
    const failed = await check(model.id, () => {}, signal(), { rootOverride: root, downloader: offline });
    assert.equal(failed.ok, false);
    assert.deepEqual(fs.readFileSync(at('weights.bin')), damaged, 'the file that was there is left alone');
    const listed = listedStatus(family, model, root);
    assert.equal(listed.state, 'partial', 'the list must not go back to calling a proven-damaged model installed');
    assert.deepEqual(listed.missing, ['weights.bin']);
    // The app itself still goes by length. This is the model that was serving
    // a minute ago; a repair that failed (offline) must not leave the user
    // with no reranker or no embedder at the next launch.
    assert.equal(reportedStatus(family, model, root), 'installed', 'a failed repair must not withdraw a model that was working');

    working.calls.length = 0;
    const repaired = await check(model.id, () => {}, signal(), { rootOverride: root, downloader: working.downloader });
    assert.deepEqual({ ok: repaired.ok, repaired: repaired.repaired }, { ok: true, repaired: ['weights.bin'] });
    assert.deepEqual(working.calls, ['weights.bin']);
    assert.equal(listedStatus(family, model, root).state, 'installed');
  });

  test(`${family}: Download on a model listed as damaged fetches only the damaged file`, async (t) => {
    // The row offers Download once a repair has failed. It must not start the
    // whole model over.
    const { model, bodies, root, install, check, at } = installedFixture(t, family);
    const working = downloaderServing((repoPath) => bodies[repoPath]);
    await install(model.id, () => {}, signal(), { rootOverride: root, downloader: working.downloader });
    damageInPlace(at('tokenizer.json'));
    const offline = new HuggingFaceModelDownloader({ fetchImpl: async () => { throw new Error('offline'); } });
    await check(model.id, () => {}, signal(), { rootOverride: root, downloader: offline });
    assert.equal(listedStatus(family, model, root).state, 'partial');

    working.calls.length = 0;
    const again = await install(model.id, () => {}, signal(), { rootOverride: root, downloader: working.downloader });
    assert.equal(again.ok, true);
    assert.deepEqual(working.calls, ['tokenizer.json']);
    assert.deepEqual(fs.readFileSync(at('tokenizer.json')), bodies['tokenizer.json']);
    assert.equal(listedStatus(family, model, root).state, 'installed');
  });

  test(`${family}: a cancelled check reports that, and marks nothing damaged`, async (t) => {
    const { model, bodies, root, install, check } = installedFixture(t, family);
    const working = downloaderServing((repoPath) => bodies[repoPath]);
    await install(model.id, () => {}, signal(), { rootOverride: root, downloader: working.downloader });
    const controller = new AbortController();
    controller.abort();
    working.calls.length = 0;
    const result = await check(model.id, () => {}, controller.signal, { rootOverride: root, downloader: working.downloader });
    assert.deepEqual({ ok: result.ok, error: result.error }, { ok: false, error: 'cancelled' });
    assert.deepEqual(working.calls, []);
    assert.equal(listedStatus(family, model, root).state, 'installed');
  });

  test(`${family}: an install from before hashes were recorded is checked, then given a record`, async (t) => {
    const { model, bodies, root, install, check } = installedFixture(t, family);
    const { downloader, calls } = downloaderServing((repoPath) => bodies[repoPath]);
    const opts = { rootOverride: root, downloader };
    await install(model.id, () => {}, signal(), opts);
    fs.rmSync(recordPath(root, model)); // what every existing user has
    calls.length = 0;

    const result = await check(model.id, () => {}, signal(), opts);
    assert.deepEqual({ ok: result.ok, repaired: result.repaired }, { ok: true, repaired: [] });
    assert.deepEqual(calls, []);
    assert.equal(readRecord(root, model).files['tokenizer.json'].sha256, sha256(bodies['tokenizer.json']));
  });

  test(`${family}: a record written for another revision never marks a file damaged`, async (t) => {
    const { model, bodies, root, install, check } = installedFixture(t, family);
    const { downloader, calls } = downloaderServing((repoPath) => bodies[repoPath]);
    const opts = { rootOverride: root, downloader };
    await install(model.id, () => {}, signal(), opts);
    const stale = readRecord(root, model);
    stale.revision = '0'.repeat(40);
    stale.files['tokenizer.json'].sha256 = 'f'.repeat(64);
    fs.writeFileSync(recordPath(root, model), JSON.stringify(stale));
    calls.length = 0;

    const result = await check(model.id, () => {}, signal(), opts);
    assert.deepEqual({ ok: result.ok, repaired: result.repaired }, { ok: true, repaired: [] });
    assert.deepEqual(calls, []);
    assert.equal(readRecord(root, model).revision, model.revision, 'and it is replaced by a current one');
  });

  test(`${family}: an unreadable record is treated as no record`, async (t) => {
    const { model, bodies, root, install, check } = installedFixture(t, family);
    const { downloader, calls } = downloaderServing((repoPath) => bodies[repoPath]);
    const opts = { rootOverride: root, downloader };
    await install(model.id, () => {}, signal(), opts);
    fs.writeFileSync(recordPath(root, model), '{not json');
    calls.length = 0;
    assert.equal(reportedStatus(family, model, root), 'installed');
    const result = await check(model.id, () => {}, signal(), opts);
    assert.deepEqual({ ok: result.ok, repaired: result.repaired }, { ok: true, repaired: [] });
    assert.deepEqual(calls, []);
  });

  test(`${family}: checking a model that is not installed says so and fetches nothing`, async (t) => {
    const { model, bodies, root, check } = installedFixture(t, family);
    const { downloader, calls } = downloaderServing((repoPath) => bodies[repoPath]);
    const result = await check(model.id, () => {}, signal(), { rootOverride: root, downloader });
    assert.equal(result.ok, false);
    assert.deepEqual(calls, [], 'a check repairs what was installed; it never starts a download of its own');
  });
}

test('embedding: checking the bundled model never downloads a second copy of it', async (t) => {
  // Its files come from the app's own resources, which are pruned and are not
  // the catalogue's byte-for-byte; they are covered by the package, not by this.
  const bundled = embedding.__fixtureCatalog.find((m) => m.bundled);
  assert.ok(bundled, 'the catalogue should still have a bundled entry');
  const root = tmp(t);
  assert.equal(embedding.statusOf(bundled, root).state, 'installed', 'precondition: served from resources/models');
  const { downloader, calls } = downloaderServing(() => Buffer.from('never served'));
  const result = await embedding.checkAndRepairEmbeddingCatalogModel(bundled.id, () => {}, signal(), { rootOverride: root, downloader });
  assert.deepEqual({ ok: result.ok, repaired: result.repaired }, { ok: true, repaired: [] });
  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(path.join(root, ...bundled.repo.split('/'))), false, 'nothing is written beside it');
});

test('reranker: a check accepts a rewritten config.json, whose length is no longer the published one', async (t) => {
  const { model, root, destination } = patchedFixture(t);
  const { downloader, calls } = downloaderServing(() => UPSTREAM_CONFIG);
  const opts = { rootOverride: root, downloader };
  assert.equal((await reranker.installCatalogModel(model.id, () => {}, signal(), opts)).ok, true);
  assertPatched(destination, model);
  assert.notEqual(fs.statSync(destination).size, UPSTREAM_CONFIG.length, 'precondition: the patch changed its length');
  calls.length = 0;

  const intact = await reranker.checkAndRepairCatalogModel(model.id, () => {}, signal(), opts);
  assert.deepEqual({ ok: intact.ok, repaired: intact.repaired }, { ok: true, repaired: [] });
  assert.deepEqual(calls, []);
  assert.equal(readRecord(root, model).files['config.json'], undefined, 'its hash is not recorded: the bytes are the installer\'s own');

  // A config that stops being usable is already visible to the list (it reads
  // as partial and offers Download), so it is not the check's to repair.
  fs.writeFileSync(destination, '{broken');
  assert.equal(reranker.statusOf(model, root).state, 'partial');
  const refused = await reranker.checkAndRepairCatalogModel(model.id, () => {}, signal(), opts);
  assert.equal(refused.ok, false);
  assert.deepEqual(calls, []);
});

// ── where the check is wired in ─────────────────────────────────────────────
//
// The routines above are only worth anything if activation runs them BEFORE it
// trusts the model, and if the row's button reaches them. Driving the real
// handlers would need a real model and the network, so this pins the order in
// the source; the behaviour itself was exercised in a live session.

const sourceOf = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

function handlerBody(source, channel) {
  const start = source.indexOf(`safeHandle('${channel}'`);
  assert.ok(start >= 0, `${channel} should be handled`);
  const next = source.indexOf('safeHandle(', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

test('activating a reranker checks its files before the choice is saved or tested', () => {
  const body = handlerBody(sourceOf('electron/ipcHandlers.ts'), 'reranker:use-local-model');
  const check = body.indexOf('checkLocalRerankerFiles(');
  assert.ok(check >= 0, 'activation should check the files');
  assert.ok(check < body.indexOf("settings.set('reranker'"), 'before the setting is written');
  assert.ok(check < body.indexOf('reranker.rerank('), 'and before the self-test');
});

test('activating an embedding model checks its files before the probe', () => {
  const body = handlerBody(sourceOf('electron/ipcHandlers.ts'), 'embedding:use-local-model');
  const check = body.indexOf('checkLocalEmbeddingFiles(');
  assert.ok(check >= 0, 'activation should check the files');
  assert.ok(check < body.indexOf('new LocalEmbeddingProvider('), 'before the probe loads the model');
  assert.ok(check < body.indexOf("settings.set('localEmbeddingModelId'"), 'and before the setting is written');
});

test('a failed repair does not stop the embedding provider finding the model it was running', async (t) => {
  // resolveEmbeddingModelPath is what LocalEmbeddingProvider loads from. While
  // the damage flag was folded into statusOf, a repair that failed offline made
  // this return null, and the next launch had no embedder at all.
  const { model, bodies, root, install, check, at } = installedFixture(t, 'embedding');
  const working = downloaderServing((repoPath) => bodies[repoPath]);
  await install(model.id, () => {}, signal(), { rootOverride: root, downloader: working.downloader });
  const before = embedding.resolveEmbeddingModelPath(model, root);
  assert.ok(before, 'precondition: an installed model resolves');
  damageInPlace(at('weights.bin'));
  const offline = new HuggingFaceModelDownloader({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await check(model.id, () => {}, signal(), { rootOverride: root, downloader: offline })).ok, false);
  assert.equal(embedding.resolveEmbeddingModelPath(model, root), before);
});

test('the retrieval path never reads the install record', () => {
  // statusOf runs on every retrieval (isRerankerExplicitlySelected) and inside
  // the embedding provider. The record is for the list and the check.
  for (const relative of ['electron/services/reranking/localModelInstaller.ts', 'electron/services/embeddings/localEmbeddingModelInstaller.ts']) {
    const source = sourceOf(relative);
    const start = source.indexOf('export function statusOf(');
    const body = source.slice(start, source.indexOf('\nexport ', start + 1));
    assert.ok(start >= 0 && body.length > 0, `${relative} should export statusOf`);
    assert.doesNotMatch(body, /flaggedDamaged|readInstallRecord/, `${relative}: statusOf must stay a stat`);
  }
});

test('activating a reranker saves over the setting as it is AFTER the check, not before', () => {
  // The check can take minutes when it repairs. A snapshot taken before it and
  // written back afterwards undid whatever else was saved meanwhile.
  const body = handlerBody(sourceOf('electron/ipcHandlers.ts'), 'reranker:use-local-model');
  const read = body.indexOf("settings.get('reranker')");
  assert.ok(read > body.indexOf('checkLocalRerankerFiles('), 'the setting is read after the check');
  assert.equal(body.indexOf("settings.get('reranker')", read + 1), -1, 'and only once');
});

test('a model is not removed while its files are being downloaded or checked', () => {
  const ipc = sourceOf('electron/ipcHandlers.ts');
  for (const [channel, lock, remove] of [
    ['reranker:remove-local-model', 'localModelDownloads.has(id)', 'removeCatalogModel(id)'],
    ['embedding:remove-local-model', 'localEmbeddingDownloads.has(id)', 'removeEmbeddingCatalogModel(id)'],
  ]) {
    const body = handlerBody(ipc, channel);
    assert.ok(body.includes(lock), `${channel} should consult the in-flight lock`);
    assert.ok(body.indexOf(lock) < body.indexOf(remove), `${channel}: before anything is deleted`);
  }
});

test('no installer or downloader text reaches a model row as it is', () => {
  // "HTTP 404 fetching https://...", a pair of digests, "ENOSPC: ...": worded
  // by modelTransferFailure.ts, logged in full.
  const ipc = sourceOf('electron/ipcHandlers.ts');
  for (const channel of ['reranker:install-local-model', 'embedding:install-local-model']) {
    const body = handlerBody(ipc, channel);
    assert.doesNotMatch(body, /message:\s*(result\.error|String\(e)/, `${channel} must not pass the raw reason through`);
    assert.match(body, /modelDownloadFailure\(/, `${channel} should word the failure`);
  }
  for (const channel of ['reranker:verify-local-model', 'embedding:verify-local-model', 'reranker:use-local-model', 'embedding:use-local-model']) {
    assert.match(handlerBody(ipc, channel), /fileCheckFailure\(model\.name, files\)/, `${channel} should word a failed check`);
  }
});

test('the Check files button reaches a handler in both families', () => {
  const ipc = sourceOf('electron/ipcHandlers.ts');
  const preload = sourceOf('electron/preload.ts');
  for (const [channel, call, routine] of [
    ['reranker:verify-local-model', 'verifyLocalRerankerModel', 'checkLocalRerankerFiles('],
    ['embedding:verify-local-model', 'verifyLocalEmbeddingModel', 'checkLocalEmbeddingFiles('],
  ]) {
    assert.ok(handlerBody(ipc, channel).includes(routine), `${channel} should run the check`);
    assert.ok(preload.includes(`${call}: (id: string) => ipcRenderer.invoke('${channel}', id)`), `${call} should be exposed`);
  }
  assert.ok(sourceOf('src/components/settings/RerankerSettings.tsx').includes('verifyLocalRerankerModel'));
  assert.ok(sourceOf('src/components/settings/EmbeddingSettings.tsx').includes('verifyLocalEmbeddingModel'));
});
