/**
 * Staging a payload, and connecting the subsystem to the running app.
 *
 * Two things are load-bearing here:
 *
 *  1. Wiring the manager in must NOT enable anything. Both seam gates — the
 *     `extensionRerankers` flag AND exactly one enabled reranker extension —
 *     have to survive the connection, or "safe to ship off by default" stops
 *     being true.
 *  2. A staged payload is untrusted content. A symlink inside it would place a
 *     reference to a file outside the extension directory INSIDE the one
 *     directory the broker treats as the extension's own.
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

const { stageFromDirectory, fetchRemoteRegistry } =
  require(path.join(repoRoot, 'dist-electron/electron/services/extensions/ExtensionInstaller.js'));
const { buildInstallPromptText } =
  require(path.join(repoRoot, 'dist-electron/electron/services/extensions/appWiring.js'));
const { RerankerRegistry } =
  require(path.join(repoRoot, 'dist-electron/electron/services/reranking/RerankerRegistry.js'));

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'natively-ext-')); }

const MANIFEST = {
  id: 'ettin-reranker',
  name: 'Ettin Reranker',
  version: '1.0.0',
  apiVersion: '1',
  type: 'reranker',
  entrypoint: 'dist/index.js',
  author: 'community',
  homepage: 'https://github.com/example/x',
  engines: { natively: '>=2.8.0' },
  permissions: ['filesystem.models'],
  models: [],
};

/** A minimal, buildable extension tree. */
function makeSource(overrides = {}) {
  const dir = tmpDir();
  const manifest = { ...MANIFEST, ...overrides };
  fs.writeFileSync(path.join(dir, 'extension.json'), JSON.stringify(manifest));
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'index.js'), '// entry');
  fs.writeFileSync(path.join(dir, 'README.md'), '# readme');
  return { dir, manifest };
}

// ── staging ───────────────────────────────────────────────────────────────

test('a built extension stages into its own directory', () => {
  const { dir } = makeSource();
  const root = tmpDir();
  const res = stageFromDirectory(dir, { rootOverride: root });

  assert.equal(res.ok, true, res.errors?.join('; '));
  assert.ok(res.payloadDir.includes('ettin-reranker'));
  assert.ok(fs.existsSync(path.join(res.payloadDir, 'dist', 'index.js')));
  assert.ok(fs.existsSync(path.join(res.payloadDir, 'extension.json')));
});

test('an unbuilt extension is refused before anything is copied', () => {
  const { dir } = makeSource();
  fs.rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  const root = tmpDir();

  const res = stageFromDirectory(dir, { rootOverride: root });
  assert.equal(res.ok, false);
  // Otherwise it installs cleanly and then fails to start with a
  // module-not-found error that reads like a Natively bug.
  assert.match(res.errors.join(' '), /entrypoint .* does not exist/);
});

test('an entrypoint that escapes the extension directory is refused', () => {
  const { dir } = makeSource({ entrypoint: '../../../etc/passwd' });
  const res = stageFromDirectory(dir, { rootOverride: tmpDir() });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /escapes the extension directory/);
});

test('a symlink anywhere in the payload refuses the whole install', () => {
  const { dir } = makeSource();
  const outside = tmpDir();
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'private');
  try {
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'link.txt'));
  } catch {
    return; // no symlink permission (Windows without Developer Mode): nothing to assert
  }

  const res = stageFromDirectory(dir, { rootOverride: tmpDir() });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /symlink/);
});

test('node_modules IS copied, because the entrypoint needs it at runtime', () => {
  // Skipping it looks like an obvious saving and is a trap: the Ettin extension
  // does `await import('onnxruntime-node')` at init, so an install without
  // node_modules succeeds and then fails to start.
  const { dir } = makeSource();
  fs.mkdirSync(path.join(dir, 'node_modules', 'onnxruntime-node'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'onnxruntime-node', 'index.js'), 'module.exports = {};');

  const res = stageFromDirectory(dir, { rootOverride: tmpDir() });
  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(path.join(res.payloadDir, 'node_modules', 'onnxruntime-node', 'index.js')),
    'a broken install is worse than a large one');
});

test('a native addon is reported, because an ABI mismatch reads as a Natively crash', () => {
  const { dir } = makeSource();
  fs.mkdirSync(path.join(dir, 'node_modules', 'ort', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'ort', 'bin', 'onnxruntime.node'), 'binary');

  const res = stageFromDirectory(dir, { rootOverride: tmpDir() });
  assert.equal(res.ok, true);
  assert.match(res.warnings.join(' '), /native addon/i);
  assert.match(res.warnings.join(' '), /Electron/, 'the warning must say WHICH ABI');
});

test('a reinstall replaces the payload rather than merging into it', () => {
  const { dir } = makeSource();
  const root = tmpDir();
  const first = stageFromDirectory(dir, { rootOverride: root });
  fs.writeFileSync(path.join(first.payloadDir, 'stale.js'), 'from an older version');

  const second = stageFromDirectory(dir, { rootOverride: root });
  assert.equal(second.ok, true);
  // A stale module beside a new entrypoint is a very confusing failure.
  assert.ok(!fs.existsSync(path.join(second.payloadDir, 'stale.js')));
});

test('a directory with no manifest is refused', () => {
  const res = stageFromDirectory(tmpDir(), { rootOverride: tmpDir() });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /extension\.json/);
});

// ── the remote registry is metadata only ──────────────────────────────────

test('the registry returns metadata, and an unreachable one is not an error', async () => {
  const payload = {
    version: 1,
    extensions: [
      { id: 'ettin-reranker', repo: 'evinjohnn/natively-ettin-reranker', latestVersion: '1.0.0', apiVersion: '1', category: 'reranker', modelLicenses: ['Apache-2.0'] },
      { id: 'broken' },  // no repo — dropped
    ],
  };
  const ok = await fetchRemoteRegistry('https://example/registry.json', async () => ({
    ok: true, status: 200, json: async () => payload,
  }));
  assert.equal(ok.ok, true);
  assert.equal(ok.entries.length, 1);
  assert.equal(ok.entries[0].repo, 'evinjohnn/natively-ettin-reranker');
  // Nothing resembling a payload URL or code is carried across this boundary.
  assert.deepEqual(
    Object.keys(ok.entries[0]).sort(),
    ['apiVersion', 'category', 'id', 'latestVersion', 'modelLicenses', 'repo'],
  );

  const down = await fetchRemoteRegistry('https://example/registry.json', async () => { throw new Error('offline'); });
  assert.deepEqual(down, { entries: [], ok: false });
});

// ── the trust prompt ──────────────────────────────────────────────────────

test('the install prompt names every permission and every licence restriction', () => {
  const { message, detail } = buildInstallPromptText({
    extensionId: 'jina-reranker-v35',
    name: 'Jina Reranker v3.5',
    version: '1.0.0',
    author: 'community',
    homepage: 'https://github.com/example/jina',
    permissions: ['filesystem.models', 'process.spawn', 'network.localhost'],
    highRiskPermissions: ['process.spawn'],
    models: [{
      key: 'jina-reranker-v3.5-Q4_K_M',
      approxBytes: 396709504,
      spdx: 'CC-BY-NC-4.0',
      licenseUrl: 'https://huggingface.co/x',
      commercialUseRestricted: true,
      requiresAcknowledgement: true,
    }],
    communityMaintained: true,
  });

  assert.match(message, /Install Jina Reranker v3\.5\?/);
  // The sandbox is not a boundary against a hostile extension, so this dialog is
  // what actually stands between the user and code they did not write.
  assert.match(detail, /Run the programs listed in its manifest/, 'process.spawn must be described in words');
  assert.match(detail, /community extension/i);
  assert.match(detail, /NON-COMMERCIAL USE ONLY/);
  assert.match(detail, /CC-BY-NC-4\.0/);
  assert.match(detail, /397 MB/);
  assert.match(detail, /Nothing downloads until you ask/);
});

// ── wiring must not open the gates ────────────────────────────────────────

test('attaching an extension source does not bypass the flag', () => {
  // This is the whole safety argument for shipping the wiring while the flag is
  // still default-off.
  const source = {
    list: () => [{ id: 'ettin-reranker', enabled: true, manifest: { type: 'reranker' } }],
    running: () => [],
    load: async () => {},
    rerank: async () => null,
  };
  const off = new RerankerRegistry({ isEnabled: () => false, source, logger: { warn: () => {} } });
  assert.equal(off.resolvePort(), null, 'the flag alone still gates it');

  const on = new RerankerRegistry({ isEnabled: () => true, source, logger: { warn: () => {} } });
  assert.ok(on.resolvePort(), 'both gates passed');
});

test('two enabled rerankers still refuse rather than picking one', () => {
  const warnings = [];
  const registry = new RerankerRegistry({
    isEnabled: () => true,
    source: {
      list: () => [
        { id: 'ettin-reranker', enabled: true, manifest: { type: 'reranker' } },
        { id: 'qwen3-reranker', enabled: true, manifest: { type: 'reranker' } },
      ],
      running: () => [], load: async () => {}, rerank: async () => null,
    },
    logger: { warn: (m) => warnings.push(String(m)) },
  });
  assert.equal(registry.resolvePort(), null);
  assert.match(warnings.join(' '), /refusing to choose/);
});
