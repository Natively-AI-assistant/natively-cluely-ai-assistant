/**
 * Phase 1: the two invariants that the rest of the system leans on.
 *
 *   1. `ExtensionContext` carries model dir + logger + config and NOTHING else.
 *      No fs, no net, no process, and nothing that transitively reaches them.
 *   2. A model whose manifest sets `requiresAcknowledgement` cannot be loaded
 *      without a matching `LicenseLedger` entry — including when its bytes are
 *      already on disk.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);

const base = path.join(repoRoot, 'dist-electron/electron/services/extensions');
const { ExtensionManager } = require(path.join(base, 'ExtensionManager.js'));
const { ExtensionRegistry } = require(path.join(base, 'ExtensionRegistry.js'));
const { ModelStore } = require(path.join(base, 'ModelStore.js'));
const { LicenseLedger } = require(path.join(base, 'LicenseLedger.js'));
const { CrashSupervisor } = require(path.join(base, 'ExtensionHost.js'));
const { EXTENSION_CONTEXT_KEYS } = require(path.join(base, 'types.js'));
const { processSingleton, resetProcessSingleton } = require(path.join(base, 'singleton.js'));

const APP_VERSION = '2.8.8';

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-ext-'));
  return dir;
}

const NC_LICENSE = {
  spdx: 'CC-BY-NC-4.0',
  url: 'https://huggingface.co/example/jina-reranker-v3.5-GGUF',
  redistributable: false,
  commercialUseRestricted: true,
  requiresAcknowledgement: true,
};

function ncModel() {
  return {
    key: 'jina-reranker-v3.5-Q4_K_M',
    format: 'gguf',
    source: 'huggingface',
    repo: 'example/jina-reranker-v3.5-GGUF',
    file: 'jina-reranker-v3.5-Q4_K_M.gguf',
    approxBytes: 397000000,
    sha256: null,
    license: NC_LICENSE,
  };
}

function manifest(root) {
  return {
    id: 'jina-reranker',
    name: 'Jina Reranker v3.5',
    version: '1.0.0',
    apiVersion: '1',
    type: 'reranker',
    entrypoint: 'dist/index.js',
    author: 'community',
    homepage: 'https://github.com/example/natively-jina-reranker',
    engines: { natively: '>=2.8.0' },
    permissions: ['filesystem.models', 'process.spawn', 'network.localhost'],
    allowedBinaries: ['llama-server'],
    models: [ncModel()],
    config: { modelSize: '150m' },
  };
}

function makeManager(root) {
  const registry = new ExtensionRegistry({
    filePath: path.join(root, 'registry.json'),
    appVersion: APP_VERSION,
  });
  const ledger = new LicenseLedger(path.join(root, 'licenses.json'));
  const modelStore = new ModelStore({ ledger, rootOverride: root });
  const manager = new ExtensionManager({
    registry,
    modelStore,
    appVersion: APP_VERSION,
    confirmInstall: async () => true,
    supervisor: new CrashSupervisor(),
    rootOverride: root,
  });
  return { registry, ledger, modelStore, manager };
}

// ---------------------------------------------------------------------------
// 1. ExtensionContext surface
// ---------------------------------------------------------------------------

test('ExtensionContext exposes exactly modelDir, logger, config and the extension id', async () => {
  const root = tmpRoot();
  const { manager } = makeManager(root);
  const payload = path.join(root, 'payload');
  fs.mkdirSync(payload, { recursive: true });

  const installed = await manager.install({
    manifestJson: manifest(root),
    source: 'github:example/natively-jina-reranker@v1.0.0',
    payloadDir: payload,
  });
  assert.equal(installed.ok, true, installed.ok ? '' : installed.errors.join('; '));

  const ctx = manager.buildContext(installed.record);
  assert.deepEqual(Object.keys(ctx).sort(), [...EXTENSION_CONTEXT_KEYS].sort());

  // The whole point of the boundary: no ambient authority reaches the extension.
  for (const forbidden of ['fs', 'net', 'http', 'https', 'process', 'child_process', 'require', 'electron']) {
    assert.equal(forbidden in ctx, false, `ExtensionContext must not expose "${forbidden}"`);
  }
  assert.equal(typeof ctx.modelDir, 'string');
  assert.equal(typeof ctx.logger.warn, 'function');
});

test('the context config is a frozen copy, so an extension cannot mutate the stored record', async () => {
  const root = tmpRoot();
  const { manager, registry } = makeManager(root);
  const payload = path.join(root, 'payload');
  fs.mkdirSync(payload, { recursive: true });

  const installed = await manager.install({
    manifestJson: manifest(root),
    source: 'test',
    payloadDir: payload,
  });
  const ctx = manager.buildContext(installed.record);

  assert.throws(() => { ctx.config.modelSize = 'hacked'; }, TypeError);
  assert.equal(registry.get('jina-reranker').config.modelSize, '150m');
});

// ---------------------------------------------------------------------------
// 2. Licence gate
// ---------------------------------------------------------------------------

test('a model requiring acknowledgement will not load without a ledger entry', () => {
  const root = tmpRoot();
  const { modelStore } = makeManager(root);
  const model = ncModel();

  const gate = modelStore.isLoadAllowed('jina-reranker', model);
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /CC-BY-NC-4\.0/);
  assert.equal(modelStore.status('jina-reranker', model).state, 'blocked-unacknowledged');
});

test('the gate holds even when the file is already on disk', () => {
  const root = tmpRoot();
  const { modelStore } = makeManager(root);
  const model = ncModel();

  // Simulate a user who dropped the weights in themselves.
  const target = modelStore.resolve('jina-reranker', model);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'not really a model but non-empty');

  // Bytes present, but the licence was never acknowledged.
  assert.equal(modelStore.status('jina-reranker', model).state, 'blocked-unacknowledged');
});

test('acknowledging unblocks exactly that model, and is recorded with licence and timestamp', () => {
  const root = tmpRoot();
  const { modelStore, ledger } = makeManager(root);
  const model = ncModel();

  ledger.acknowledge('jina-reranker', model.key, model.license.spdx);

  const entry = ledger.get('jina-reranker', model.key);
  assert.equal(entry.spdx, 'CC-BY-NC-4.0');
  assert.equal(entry.modelKey, model.key);
  assert.ok(!Number.isNaN(Date.parse(entry.acknowledgedAt)));

  assert.equal(modelStore.isLoadAllowed('jina-reranker', model).allowed, true);
  // A different model of the same extension is still blocked.
  const other = { ...ncModel(), key: 'jina-reranker-v3.5-Q8' };
  assert.equal(modelStore.isLoadAllowed('jina-reranker', other).allowed, false);
});

test('a licence that changed since acknowledgement counts as unacknowledged', () => {
  const root = tmpRoot();
  const { modelStore, ledger } = makeManager(root);
  const model = ncModel();
  ledger.acknowledge('jina-reranker', model.key, 'Apache-2.0');

  // The user agreed to different terms than the manifest now states.
  assert.equal(modelStore.isLoadAllowed('jina-reranker', model).allowed, false);
});

test('a corrupt ledger reads as empty, never as blanket consent', () => {
  const root = tmpRoot();
  const file = path.join(root, 'licenses.json');
  fs.writeFileSync(file, '{ this is not json');
  const ledger = new LicenseLedger(file);
  assert.equal(ledger.hasAcknowledged('jina-reranker', 'anything'), false);
  assert.deepEqual(ledger.list(), []);
});

test('a download is refused before it starts when the licence is unacknowledged', async () => {
  const root = tmpRoot();
  const { modelStore } = makeManager(root);
  await assert.rejects(
    () => modelStore.download('jina-reranker', ncModel(), () => {}, new AbortController().signal),
    /requires acknowledgement/,
  );
});

test('a manifest cannot place a model file outside the extension model directory', () => {
  const root = tmpRoot();
  const { modelStore } = makeManager(root);
  for (const file of ['../escape.gguf', 'sub/model.gguf', '/etc/passwd', '..']) {
    assert.throws(
      () => modelStore.resolve('jina-reranker', { ...ncModel(), file }),
      /unsafe file name/,
      `file ${JSON.stringify(file)} should be refused`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. Lifecycle + supervision
// ---------------------------------------------------------------------------

test('no extension is enabled on install', async () => {
  const root = tmpRoot();
  const { manager } = makeManager(root);
  const payload = path.join(root, 'payload');
  fs.mkdirSync(payload, { recursive: true });

  const installed = await manager.install({ manifestJson: manifest(root), source: 'test', payloadDir: payload });
  assert.equal(installed.record.enabled, false);
});

test('a refused install writes nothing to the registry', async () => {
  const root = tmpRoot();
  const registry = new ExtensionRegistry({ filePath: path.join(root, 'registry.json'), appVersion: APP_VERSION });
  const modelStore = new ModelStore({ ledger: new LicenseLedger(path.join(root, 'licenses.json')), rootOverride: root });
  const manager = new ExtensionManager({
    registry, modelStore, appVersion: APP_VERSION,
    confirmInstall: async () => false, rootOverride: root,
  });
  const payload = path.join(root, 'payload');
  fs.mkdirSync(payload, { recursive: true });

  const result = await manager.install({ manifestJson: manifest(root), source: 'test', payloadDir: payload });
  assert.equal(result.ok, false);
  assert.equal(registry.list().length, 0);
});

test('a confirmer that throws is a refusal, not consent', async () => {
  const root = tmpRoot();
  const registry = new ExtensionRegistry({ filePath: path.join(root, 'registry.json'), appVersion: APP_VERSION });
  const modelStore = new ModelStore({ ledger: new LicenseLedger(path.join(root, 'licenses.json')), rootOverride: root });
  const manager = new ExtensionManager({
    registry, modelStore, appVersion: APP_VERSION,
    confirmInstall: async () => { throw new Error('dialog blew up'); },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    rootOverride: root,
  });
  const payload = path.join(root, 'payload');
  fs.mkdirSync(payload, { recursive: true });

  const result = await manager.install({ manifestJson: manifest(root), source: 'test', payloadDir: payload });
  assert.equal(result.ok, false);
  assert.equal(registry.list().length, 0);
});

test('the install prompt lists the permissions and flags the high-risk ones', async () => {
  const root = tmpRoot();
  const registry = new ExtensionRegistry({ filePath: path.join(root, 'registry.json'), appVersion: APP_VERSION });
  const modelStore = new ModelStore({ ledger: new LicenseLedger(path.join(root, 'licenses.json')), rootOverride: root });

  let seen = null;
  const manager = new ExtensionManager({
    registry, modelStore, appVersion: APP_VERSION,
    confirmInstall: async (prompt) => { seen = prompt; return true; },
    rootOverride: root,
  });
  const payload = path.join(root, 'payload');
  fs.mkdirSync(payload, { recursive: true });

  const m = manifest(root);
  m.permissions = ['filesystem.models', 'network.remote', 'filesystem.workspace'];
  m.allowedHosts = ['huggingface.co'];
  delete m.allowedBinaries;

  await manager.install({ manifestJson: m, source: 'test', payloadDir: payload });

  assert.deepEqual(seen.highRiskPermissions.sort(), ['filesystem.workspace', 'network.remote']);
  assert.equal(seen.communityMaintained, true);
  assert.equal(seen.models[0].spdx, 'CC-BY-NC-4.0');
  assert.equal(seen.models[0].requiresAcknowledgement, true);
});

test('three crashes in a session disable the extension', async () => {
  const root = tmpRoot();
  const { manager, registry } = makeManager(root);
  const payload = path.join(root, 'payload');
  fs.mkdirSync(payload, { recursive: true });
  await manager.install({ manifestJson: manifest(root), source: 'test', payloadDir: payload });
  manager.enable('jina-reranker');

  assert.equal(manager.reportCrash('jina-reranker').action, 'restart');
  assert.equal(manager.reportCrash('jina-reranker').action, 'restart');
  const third = manager.reportCrash('jina-reranker');
  assert.equal(third.action, 'disable');

  const record = registry.get('jina-reranker');
  assert.equal(record.enabled, false);
  assert.match(record.disabledReason, /crashed 3 times/);
});

test('the registry narrows a stored grant to what the manifest still declares', () => {
  const root = tmpRoot();
  const file = path.join(root, 'registry.json');
  const m = manifest(root);
  m.permissions = ['filesystem.models'];
  delete m.allowedBinaries;

  // A hand-edited registry claiming more than the manifest asks for.
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    extensions: [{
      id: 'jina-reranker', manifest: m, source: 'test',
      installedAt: new Date().toISOString(), enabled: true,
      grantedPermissions: ['filesystem.models', 'process.spawn', 'network.remote'],
      config: {},
    }],
  }, null, 2));

  const registry = new ExtensionRegistry({ filePath: file, appVersion: APP_VERSION });
  assert.deepEqual(registry.get('jina-reranker').grantedPermissions, ['filesystem.models']);
});

test('a registry entry whose manifest no longer validates is dropped, not resurrected', () => {
  const root = tmpRoot();
  const file = path.join(root, 'registry.json');
  const m = manifest(root);
  m.apiVersion = '99';

  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    extensions: [{
      id: 'jina-reranker', manifest: m, source: 'test',
      installedAt: new Date().toISOString(), enabled: true,
      grantedPermissions: ['filesystem.models'], config: {},
    }],
  }, null, 2));

  const registry = new ExtensionRegistry({ filePath: file, appVersion: APP_VERSION });
  assert.equal(registry.list().length, 0);
  assert.match(registry.warnings().join('; '), /manifest no longer valid/);
});

// ---------------------------------------------------------------------------
// 4. Bundling hazard
// ---------------------------------------------------------------------------

test('singletons are anchored per process, not per esbuild bundle', () => {
  // build-electron.js makes every electron TS file its own entry point with
  // bundle:true, so a module-level `let instance` would exist once per bundle.
  // This pins the globalThis anchoring that makes it one per process.
  const key = 'test-singleton-' + String(Math.random());
  const first = processSingleton(key, () => ({ id: 1 }));
  const second = processSingleton(key, () => ({ id: 2 }));
  assert.equal(first, second);
  assert.equal(second.id, 1);

  resetProcessSingleton(key);
  assert.equal(processSingleton(key, () => ({ id: 3 })).id, 3);

  // And it really is on globalThis, which is what survives bundle duplication.
  assert.ok(globalThis.__nativelyExtensionSingletons__ instanceof Map);
  resetProcessSingleton(key);
});

test('a disabled extension is never loaded, even when load() is called directly', async () => {
  // `enabled` is the user's switch and is also what supervision flips after
  // repeated crashes. A load path that ignored it would resurrect an extension
  // that had just been auto-disabled.
  const root = tmpRoot();
  const { manager, registry } = makeManager(root);
  const payload = path.join(root, 'payload');
  fs.mkdirSync(payload, { recursive: true });
  await manager.install({ manifestJson: manifest(root), source: 'test', payloadDir: payload });

  assert.equal(registry.get('jina-reranker').enabled, false);
  let created = false;
  const withSpy = new ExtensionManager({
    registry,
    modelStore: new ModelStore({ ledger: new LicenseLedger(path.join(root, 'licenses.json')), rootOverride: root }),
    appVersion: APP_VERSION,
    confirmInstall: async () => true,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    rootOverride: root,
    createHost: () => { created = true; return { start: async () => {}, stop: async () => {}, rerank: async () => [] }; },
  });

  assert.equal(await withSpy.load('jina-reranker'), null);
  assert.equal(created, false, 'no process may be forked for a disabled extension');
  assert.deepEqual(withSpy.running(), []);
});

test('rerank through the manager returns null rather than throwing when the extension fails', async () => {
  // A reranker failure must never surface as an error to the retrieval path;
  // the caller falls back to the existing ordering.
  const root = tmpRoot();
  const { manager, registry } = makeManager(root);
  const payload = path.join(root, 'payload');
  fs.mkdirSync(payload, { recursive: true });
  await manager.install({ manifestJson: manifest(root), source: 'test', payloadDir: payload });

  // Not loaded at all.
  assert.equal(await manager.rerank('jina-reranker', 'q', [], 5, new AbortController().signal), null);
  assert.equal(registry.get('jina-reranker').enabled, false);
});


test('sourcePath is remote-side only and never leaks into the local path', () => {
  const root = tmpRoot();
  const { modelStore } = makeManager(root);
  const model = { ...ncModel(), repoPath: 'onnx/model.onnx', file: 'model.onnx' };

  assert.equal(modelStore.sourcePath(model), 'onnx/model.onnx');
  const local = modelStore.resolve('jina-reranker', model);
  assert.equal(path.basename(local), 'model.onnx');
  assert.equal(local.includes('onnx' + path.sep + 'model.onnx'), false,
    'the nested source path must not become a nested local path');

  // With no repoPath, the source path is just the filename.
  assert.equal(modelStore.sourcePath(ncModel()), ncModel().file);
});
