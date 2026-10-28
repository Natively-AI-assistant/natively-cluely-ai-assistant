// Parakeet on the Apple Neural Engine (parakeet/aneBackend.ts).
//
// Guards:
//  1. Platform routing: only darwin + arm64 + macOS 14+ + a built helper gets
//     the Neural Engine. Windows, Intel Macs, older macOS and a dev checkout
//     without the helper keep the ONNX CPU engine — every branch is exercised
//     here with an injected platform, so this file runs the same on both OSes.
//  2. The CoreML file sets match what FluidAudio 0.17.7 loads, for both
//     catalog Parakeet models, pinned to a repo revision.
//  3. The helper wire protocol and lifecycle, against a fake child process:
//     framing, out-of-order-safe id matching, per-request errors, fatal load
//     errors, unexpected death after ready, and dispose.
//
// Run: npm run build:electron && node --test <this file>

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../../../../dist-electron/electron/audio/whisper');
const ane = await import(pathToFileURL(path.join(dist, 'parakeet/aneBackend.js')).href);
const { MODEL_CATALOG } = await import(pathToFileURL(path.join(dist, 'modelManager.js')).href);

const V2 = 'istupakov/parakeet-tdt-0.6b-v2-onnx';
const V3 = 'istupakov/parakeet-tdt-0.6b-v3-onnx';
const HELPER = '/Apps/Natively.app/Contents/Resources/parakeet-ane/Natively-parakeet';
const MAC_14 = () => '23.0.0';
const yes = () => true;

describe('resolveParakeetBackend: exhaustive platform routing', () => {
  test('Apple Silicon, macOS 14+, helper built -> Neural Engine with that helper', () => {
    assert.deepEqual(
      ane.resolveParakeetBackend({ platform: 'darwin', arch: 'arm64', osRelease: MAC_14, helperPath: HELPER, isExecutable: yes }),
      { backend: 'coreml-ane', helperPath: HELPER },
    );
  });

  test('Apple Silicon without the helper (unbuilt dev checkout) -> ONNX', () => {
    assert.deepEqual(
      ane.resolveParakeetBackend({ platform: 'darwin', arch: 'arm64', osRelease: MAC_14, helperPath: HELPER, isExecutable: () => false }),
      { backend: 'onnx' },
    );
    assert.deepEqual(
      ane.resolveParakeetBackend({ platform: 'darwin', arch: 'arm64', osRelease: MAC_14, helperPath: null }),
      { backend: 'onnx' },
    );
  });

  test('Apple Silicon on macOS 13 (Darwin 22) -> ONNX: the helper needs macOS 14', () => {
    assert.equal(
      ane.resolveParakeetBackend({ platform: 'darwin', arch: 'arm64', osRelease: () => '22.6.0', helperPath: HELPER, isExecutable: yes }).backend,
      'onnx',
    );
  });

  test('Intel Mac -> ONNX even with a helper path', () => {
    assert.equal(
      ane.resolveParakeetBackend({ platform: 'darwin', arch: 'x64', osRelease: MAC_14, helperPath: HELPER, isExecutable: yes }).backend,
      'onnx',
    );
  });

  test('Windows (x64 and arm64) -> ONNX, never the macOS helper', () => {
    for (const arch of ['x64', 'arm64']) {
      assert.deepEqual(
        ane.resolveParakeetBackend({ platform: 'win32', arch, osRelease: MAC_14, helperPath: HELPER, isExecutable: yes }),
        { backend: 'onnx' },
      );
    }
  });

  test('Linux -> ONNX', () => {
    assert.equal(ane.resolveParakeetBackend({ platform: 'linux', arch: 'arm64', helperPath: HELPER, isExecutable: yes }).backend, 'onnx');
  });

  test('outside the Electron main process there is no helper path', () => {
    assert.equal(ane.parakeetAneExecutablePath(), null);
  });
});

describe('CoreML model sets', () => {
  test('every catalog Parakeet TDT model has a Neural Engine build, and nothing else does', () => {
    const parakeetIds = MODEL_CATALOG.filter((m) => m.sessionLayout === 'parakeet-tdt').map((m) => m.id).sort();
    assert.deepEqual(parakeetIds, [V2, V3]);
    assert.deepEqual(Object.keys(ane.PARAKEET_CORE_ML_MODELS).sort(), parakeetIds);
    for (const m of MODEL_CATALOG) assert.equal(ane.hasParakeetCoreMlModel(m.id), parakeetIds.includes(m.id), m.id);
  });

  test('v2 is FluidAudio version v2 with the v2 joint; v3 uses JointDecisionv3', () => {
    const v2 = ane.PARAKEET_CORE_ML_MODELS[V2];
    const v3 = ane.PARAKEET_CORE_ML_MODELS[V3];
    assert.equal(v2.version, 'v2');
    assert.equal(v3.version, 'v3');
    assert.equal(v2.download.repo, 'FluidInference/parakeet-tdt-0.6b-v2-coreml');
    assert.equal(v3.download.repo, 'FluidInference/parakeet-tdt-0.6b-v3-coreml');
    const bundles = (m) => [...new Set(m.download.files.map((f) => f.path.split('/')[0]))].sort();
    assert.deepEqual(bundles(v2), ['Decoder.mlmodelc', 'Encoder.mlmodelc', 'JointDecision.mlmodelc', 'Preprocessor.mlmodelc', 'parakeet_vocab.json']);
    assert.deepEqual(bundles(v3), ['Decoder.mlmodelc', 'Encoder.mlmodelc', 'JointDecisionv3.mlmodelc', 'Preprocessor.mlmodelc', 'parakeet_vocab.json']);
  });

  test('downloads are pinned to a commit, not a moving branch', () => {
    for (const m of Object.values(ane.PARAKEET_CORE_ML_MODELS)) {
      assert.match(m.download.revision, /^[0-9a-f]{40}$/);
    }
  });

  test('cache check needs every CoreML file, non-empty, in the repo folder', (t) => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parakeet-ane-cache-'));
    t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));
    const files = ane.PARAKEET_CORE_ML_MODELS[V2].download.files;
    for (const { path: rel } of files.slice(0, -1)) {
      const full = path.join(repoDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, 'x');
    }
    assert.equal(ane.isParakeetCoreMlCached(repoDir, V2), false, 'one file missing');
    fs.writeFileSync(path.join(repoDir, files.at(-1).path), '');
    assert.equal(ane.isParakeetCoreMlCached(repoDir, V2), false, 'an empty file is not installed');
    fs.writeFileSync(path.join(repoDir, files.at(-1).path), '{}');
    assert.equal(ane.isParakeetCoreMlCached(repoDir, V2), true);
    assert.equal(ane.isParakeetCoreMlCached(repoDir, 'onnx-community/moonshine-base-ONNX'), false);
  });

  test('a CoreML repo maps back to its catalog model, nothing else does', () => {
    assert.equal(ane.parakeetCoreMlModelForRepo('FluidInference/parakeet-tdt-0.6b-v2-coreml').modelId, V2);
    assert.equal(ane.parakeetCoreMlModelForRepo('FluidInference/parakeet-tdt-0.6b-v3-coreml').modelId, V3);
    assert.equal(ane.parakeetCoreMlModelForRepo(V2), undefined);
  });
});

/** A child process double: stdin is captured, stdout/stderr are writable by the test. */
function fakeHelper() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => { child.killed = true; child.exitCode = 0; setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
  const written = [];
  child.stdin.on('data', (b) => written.push(b));
  child.frames = () => {
    const all = Buffer.concat(written);
    const frames = [];
    for (let at = 0; at + 8 <= all.length;) {
      const id = all.readUInt32LE(at);
      const count = all.readUInt32LE(at + 4);
      const samples = new Float32Array(all.buffer.slice(all.byteOffset + at + 8, all.byteOffset + at + 8 + count * 4));
      frames.push({ id, count, samples });
      at += 8 + count * 4;
    }
    return frames;
  };
  child.say = (obj) => child.stdout.write(JSON.stringify(obj) + '\n');
  return child;
}

const tick = () => new Promise((r) => setImmediate(r));

describe('AneParakeetEngine: wire protocol and lifecycle', () => {
  test('passes the model folder and version, resolves on ready', async () => {
    const child = fakeHelper();
    let args;
    const created = ane.AneParakeetEngine.create(HELPER, '/m/coreml', 'v2', {
      spawnHelper: (file, a) => { assert.equal(file, HELPER); args = a; return child; },
    });
    child.say({ type: 'ready', loadMs: 157 });
    await created;
    assert.deepEqual(args, ['--model-dir', '/m/coreml', '--version', 'v2']);
  });

  test('frames are id + sample count + little-endian Float32, and results match by id', async () => {
    const child = fakeHelper();
    const created = ane.AneParakeetEngine.create(HELPER, '/m', 'v3', { spawnHelper: () => child });
    child.say({ type: 'ready' });
    const engine = await created;

    const a = engine.transcribe(new Float32Array([0.5, -0.25, 1]));
    // A view into a larger buffer: only the view's samples may be sent.
    const backing = new Float32Array([9, 9, 0.125, 9]);
    const b = engine.transcribe(backing.subarray(2, 3));
    await tick();
    const frames = child.frames();
    assert.equal(frames.length, 2);
    assert.deepEqual([frames[0].id, frames[0].count, [...frames[0].samples]], [1, 3, [0.5, -0.25, 1]]);
    assert.deepEqual([frames[1].id, frames[1].count, [...frames[1].samples]], [2, 1, [0.125]]);

    // Answered out of order: each promise still gets its own text.
    child.say({ type: 'result', id: 2, text: 'second' });
    child.say({ type: 'result', id: 1, text: 'first' });
    assert.deepEqual(await a, { text: 'first' });
    assert.deepEqual(await b, { text: 'second' });
  });

  test('a per-request error rejects that request only', async () => {
    const child = fakeHelper();
    const created = ane.AneParakeetEngine.create(HELPER, '/m', 'v2', { spawnHelper: () => child });
    child.say({ type: 'ready' });
    const engine = await created;
    const bad = engine.transcribe(new Float32Array(4));
    const good = engine.transcribe(new Float32Array(4));
    child.say({ type: 'error', id: 1, message: 'invalid audio' });
    child.say({ type: 'result', id: 2, text: 'ok' });
    await assert.rejects(bad, /invalid audio/);
    assert.deepEqual(await good, { text: 'ok' });
  });

  test('a fatal load error rejects create() with the helper\'s message', async () => {
    const child = fakeHelper();
    const created = ane.AneParakeetEngine.create(HELPER, '/m', 'v2', { spawnHelper: () => child });
    child.say({ type: 'fatal', message: 'Failed to load Parakeet CoreML models: Encoder.mlmodelc missing' });
    child.exitCode = 1;
    child.emit('exit', 1, null);
    await assert.rejects(created, /Encoder\.mlmodelc missing/);
  });

  test('a spawn failure rejects create()', async () => {
    await assert.rejects(
      ane.AneParakeetEngine.create(HELPER, '/m', 'v2', { spawnHelper: () => { throw new Error('ENOENT'); } }),
      /Could not start the Parakeet Neural Engine helper: ENOENT/,
    );
  });

  test('death after ready rejects in-flight work, reports once, and fails later calls', async () => {
    const child = fakeHelper();
    const deaths = [];
    const created = ane.AneParakeetEngine.create(HELPER, '/m', 'v2', {
      spawnHelper: () => child,
      onUnexpectedExit: (e) => deaths.push(e.message),
    });
    child.say({ type: 'ready' });
    const engine = await created;
    const inFlight = engine.transcribe(new Float32Array(4));
    child.stderr.write('E5RT: ANE compile failed\n');
    await tick();
    child.exitCode = 6;
    child.emit('exit', null, 'SIGABRT');
    await assert.rejects(inFlight, /exited \(SIGABRT\): E5RT: ANE compile failed/);
    assert.equal(deaths.length, 1);
    await assert.rejects(engine.transcribe(new Float32Array(4)), /exited/);
  });

  test('dispose closes stdin, stops the helper, and is not reported as a crash', async () => {
    const child = fakeHelper();
    const deaths = [];
    const created = ane.AneParakeetEngine.create(HELPER, '/m', 'v2', {
      spawnHelper: () => child,
      onUnexpectedExit: (e) => deaths.push(e),
    });
    child.say({ type: 'ready' });
    const engine = await created;
    const pending = engine.transcribe(new Float32Array(4));
    engine.dispose();
    await assert.rejects(pending, /stopped/);
    assert.equal(child.stdin.writableEnded, true);
    assert.equal(child.killed, true);
    await tick();
    assert.equal(deaths.length, 0);
  });
});
