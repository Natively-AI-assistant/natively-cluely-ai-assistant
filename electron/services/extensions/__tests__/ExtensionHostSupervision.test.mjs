/**
 * Phase 2: utilityProcess supervision.
 *
 * `utilityProcess` emits no generic error event — a throw during module load in
 * the child surfaces ONLY as an `exit` with a non-zero code, and a child wedged
 * in a synchronous native call emits nothing at all. Every deadline therefore
 * has to be owned by the host. These tests drive a fake child through each of
 * those failure modes; a real process is never spawned.
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
const { createExtensionHost, CrashSupervisor, bootstrapPath } = require(path.join(base, 'ExtensionHost.js'));
const { createPermissionBroker } = require(path.join(base, 'PermissionBroker.js'));

const tick = () => new Promise((r) => setImmediate(r));

function makeFakeChild() {
  const listeners = {};
  const child = {
    pid: 4242,
    sent: [],
    killed: false,
    postMessage(m) { child.sent.push(m); },
    kill() { child.killed = true; return true; },
    on(event, fn) { (listeners[event] ||= []).push(fn); },
    emit(event, ...args) { (listeners[event] || []).forEach((f) => f(...args)); },
    ready() { child.emit('message', { direction: 'extension-to-host', id: 0, body: { kind: 'ready' } }); },
    reply(id, body) { child.emit('message', { direction: 'extension-to-host', id, body }); },
    lastOfKind(kind) { return child.sent.filter((m) => m.body?.kind === kind).pop(); },
  };
  return child;
}

/** A real directory with a real entrypoint file, because the host stats it. */
function makeExtensionDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-host-'));
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'index.js'), 'module.exports = {};');
  return dir;
}

function manifest(overrides = {}) {
  return {
    id: 'jina-reranker',
    name: 'Jina Reranker',
    version: '1.0.0',
    apiVersion: '1',
    type: 'reranker',
    entrypoint: 'dist/index.js',
    author: 'community',
    homepage: 'https://github.com/example/x',
    engines: { natively: '>=2.8.0' },
    permissions: ['filesystem.models', 'process.spawn', 'network.localhost'],
    allowedBinaries: ['llama-server'],
    models: [],
    ...overrides,
  };
}

function makeHost(overrides = {}) {
  const child = makeFakeChild();
  const dir = overrides.extensionDir ?? makeExtensionDir();
  const warnings = [];
  const host = createExtensionHost({
    manifest: overrides.manifest ?? manifest(),
    extensionDir: dir,
    modelDir: path.join(dir, 'models'),
    broker: createPermissionBroker('darwin'),
    config: {},
    logger: {
      debug() {}, info() {},
      warn: (m) => warnings.push(String(m)),
      error: (m) => warnings.push(String(m)),
    },
    timeouts: { initMs: 60, rerankMs: 60, disposeMs: 20 },
    forkOverride: () => child,
    ...overrides,
  });
  return { host, child, dir, warnings };
}

/** Drive start() to completion against a cooperative fake child. */
async function started(overrides = {}) {
  const ctx = makeHost(overrides);
  const promise = ctx.host.start();
  await tick();
  ctx.child.ready();
  await tick();
  const init = ctx.child.lastOfKind('init');
  ctx.child.reply(init.id, { kind: 'init', ok: true });
  await promise;
  return { ...ctx, init };
}

// ── startup ───────────────────────────────────────────────────────────────

test('a child that never announces readiness fails startup instead of hanging', async () => {
  const { host } = makeHost();
  await assert.rejects(() => host.start(), /did not answer startup within 60ms/);
});

test('a child that dies during module load fails startup with its exit code', async () => {
  const { host, child } = makeHost();
  const promise = host.start();
  await tick();
  // This is the only signal utilityProcess gives for a module-load throw.
  child.emit('exit', 1);
  await assert.rejects(() => promise, /exited during startup \(code 1\)/);
});

test('startup sends the sandbox parameters the child needs before it loads anything', async () => {
  const { init, dir } = await started();
  assert.deepEqual(init.body.granted, ['filesystem.models', 'process.spawn', 'network.localhost']);
  // Only binaries the broker actually authorised are pre-approved.
  assert.deepEqual(init.body.preauthorizedBinaries, ['llama-server']);
  assert.equal(init.body.entrypoint, path.join(dir, 'dist', 'index.js'));
});

test('a binary the broker refuses is not pre-authorised', async () => {
  // process.spawn is NOT granted, so nothing may be spawned.
  const m = manifest({ permissions: ['filesystem.models'], allowedBinaries: ['llama-server'] });
  const { init } = await started({ manifest: m });
  assert.deepEqual(init.body.preauthorizedBinaries, []);
});

test('an entrypoint pointing outside the extension directory is refused', async () => {
  const { host } = makeHost({ manifest: manifest({ entrypoint: '../../../etc/passwd' }) });
  await assert.rejects(() => host.start(), /entrypoint outside its own directory/);
});

test('a missing entrypoint is refused before a process is spawned', async () => {
  const { host } = makeHost({ manifest: manifest({ entrypoint: 'dist/nope.js' }) });
  await assert.rejects(() => host.start(), /entrypoint not found/);
});

// ── per-call deadlines ────────────────────────────────────────────────────

test('a rerank the child never answers is failed by the host deadline', async () => {
  const { host } = await started();
  await assert.rejects(
    () => host.rerank('q', [{ id: 'a', text: 'a' }], 5, new AbortController().signal),
    /did not answer rerank within 60ms/,
  );
});

test('an aborted rerank rejects without waiting for the deadline', async () => {
  const { host } = await started();
  const controller = new AbortController();
  const promise = host.rerank('q', [{ id: 'a', text: 'a' }], 5, controller.signal);
  controller.abort();
  await assert.rejects(() => promise, /rerank aborted/);
});

test('a reply whose id matches nothing in flight is discarded, not applied to another call', async () => {
  const { host, child } = await started();
  const promise = host.rerank('q', [{ id: 'a', text: 'a' }], 5, new AbortController().signal);
  await tick();

  const call = child.lastOfKind('rerank');
  // A stale reply from a previous call must not settle this one.
  child.reply(call.id + 999, { kind: 'rerank', ok: true, ranked: [{ id: 'WRONG', score: 1, rank: 1 }] });
  await tick();

  child.reply(call.id, { kind: 'rerank', ok: true, ranked: [{ id: 'a', score: 0.9, rank: 1 }] });
  assert.deepEqual(await promise, [{ id: 'a', score: 0.9, rank: 1 }]);
});

test('an error reply rejects the specific call it belongs to', async () => {
  const { host, child } = await started();
  const promise = host.rerank('q', [{ id: 'a', text: 'a' }], 5, new AbortController().signal);
  await tick();
  const call = child.lastOfKind('rerank');
  child.reply(call.id, { kind: 'error', ok: false, message: 'model not loaded' });
  await assert.rejects(() => promise, /model not loaded/);
});

test('a child exit rejects everything in flight rather than leaving it hanging', async () => {
  const { host, child } = await started();
  const promise = host.rerank('q', [{ id: 'a', text: 'a' }], 5, new AbortController().signal);
  await tick();
  child.emit('exit', 139);
  await assert.rejects(() => promise, /exited \(code 139\)/);
});

// ── crash accounting ──────────────────────────────────────────────────────

test('an unexpected exit is reported as a crash; a requested stop is not', async () => {
  const crashes = [];
  const a = await started({ onCrash: (code) => crashes.push(code) });
  a.child.emit('exit', 3);
  assert.deepEqual(crashes, [3]);

  const b = await started({ onCrash: (code) => crashes.push(code) });
  const stopping = b.host.stop();
  await tick();
  b.child.emit('exit', 0);
  await stopping;
  assert.deepEqual(crashes, [3], 'a deliberate stop must not count as a crash');
});

test('stop() hard-kills a child that will not answer dispose', async () => {
  const { host, child } = await started();
  await host.stop();
  assert.equal(child.killed, true);
});

test('three crashes in a session disable, two do not', () => {
  const supervisor = new CrashSupervisor();
  assert.equal(supervisor.recordCrash('x').action, 'restart');
  assert.equal(supervisor.recordCrash('x').action, 'restart');
  assert.equal(supervisor.recordCrash('x').action, 'disable');
  // Counts are per extension.
  assert.equal(supervisor.recordCrash('y').action, 'restart');
  supervisor.clear('x');
  assert.equal(supervisor.recordCrash('x').action, 'restart');
});

// ── broker mediation over RPC ─────────────────────────────────────────────

test('a denied capability request is answered with a reason and logged', async () => {
  const { child, warnings } = await started();

  // network.localhost is granted; network.remote is not.
  child.emit('message', {
    direction: 'extension-to-host',
    id: 77,
    body: { kind: 'broker', request: { kind: 'network.connect', host: 'evil.com', port: 443 } },
  });
  await tick();

  const reply = child.sent.find((m) => m.id === 77);
  assert.equal(reply.body.ok, false);
  assert.equal(reply.body.denied, true);
  assert.match(reply.body.reason, /requires "network\.remote"/);
  assert.ok(warnings.some((w) => /denied network\.connect/.test(w)), 'the denial must be logged');
});

test('the bootstrap script sits next to the host bundle so packaging keeps them together', () => {
  const resolved = bootstrapPath();
  assert.match(resolved, /extensions[\\/]host[\\/]bootstrap\.js$/);
  assert.equal(fs.existsSync(resolved), true, `${resolved} must exist in dist-electron`);
});
