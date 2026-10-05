/**
 * Phase 1: the permission broker denies by default, on BOTH platform branches.
 *
 * The broker takes `platform` as a parameter, so this suite exercises the
 * darwin and win32 containment rules in a single run on either machine. A suite
 * that only ran the current platform's branch would leave the other one
 * unverified, which is exactly what the cross-platform contract forbids.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);

const { createPermissionBroker, isLoopback } = require(
  path.join(repoRoot, 'dist-electron/electron/services/extensions/PermissionBroker.js'),
);

const PLATFORMS = ['darwin', 'win32'];

/** Model dir per platform, so containment is checked against a real-shaped path. */
const MODEL_DIR = {
  darwin: '/Users/someone/.natively/models/jina-reranker',
  win32: 'C:\\Users\\someone\\.natively\\models\\jina-reranker',
};

const OUTSIDE = {
  darwin: '/Users/someone/.ssh/id_rsa',
  win32: 'C:\\Users\\someone\\.ssh\\id_rsa',
};

function grantFor(platform, overrides = {}) {
  return {
    extensionId: 'jina-reranker',
    granted: ['filesystem.models'],
    modelDir: MODEL_DIR[platform],
    ...overrides,
  };
}

for (const platform of PLATFORMS) {
  test(`[${platform}] an undeclared permission is denied with a reason`, () => {
    const broker = createPermissionBroker(platform);
    // Granted NOTHING at all.
    const grant = grantFor(platform, { granted: [] });

    const fsRead = broker.decide(grant, {
      kind: 'filesystem.read',
      path: path.join(MODEL_DIR[platform], 'model.gguf'),
    });
    assert.equal(fsRead.allowed, false);
    assert.match(fsRead.reason, /no filesystem permission granted/);

    const net = broker.decide(grant, { kind: 'network.connect', host: '127.0.0.1', port: 8080 });
    assert.equal(net.allowed, false);
    assert.match(net.reason, /network\.localhost/);

    const spawn = broker.decide(grant, { kind: 'process.spawn', binary: 'llama-server' });
    assert.equal(spawn.allowed, false);
    assert.match(spawn.reason, /process\.spawn/);
  });

  test(`[${platform}] filesystem.models admits its own directory and nothing else`, () => {
    const broker = createPermissionBroker(platform);
    const grant = grantFor(platform);

    const inside = broker.decide(grant, {
      kind: 'filesystem.write',
      path: path.join(MODEL_DIR[platform], 'model.gguf'),
    });
    assert.equal(inside.allowed, true);

    const outside = broker.decide(grant, { kind: 'filesystem.read', path: OUTSIDE[platform] });
    assert.equal(outside.allowed, false);
    assert.match(outside.reason, /outside/);
  });

  test(`[${platform}] a traversal out of the model directory is denied`, () => {
    const broker = createPermissionBroker(platform);
    const grant = grantFor(platform);
    for (const rel of ['../../../.ssh/id_rsa', '..', 'sub/../../escape']) {
      const decision = broker.decide(grant, { kind: 'filesystem.read', path: rel });
      assert.equal(decision.allowed, false, `${rel} should not escape the model dir`);
    }
  });

  test(`[${platform}] a NUL byte in a path is denied rather than checked as a JS string`, () => {
    const broker = createPermissionBroker(platform);
    // Built by concatenation on purpose: path.join() NORMALISES the NUL away,
    // which would make this test pass for the wrong reason. A NUL truncates the
    // path in some syscalls, so the string the broker checks would not describe
    // what the OS actually opens.
    const sep = platform === 'win32' ? '\\' : '/';
    const nulPath = MODEL_DIR[platform] + sep + 'model.gguf\u0000.txt';
    const decision = broker.decide(grantFor(platform), { kind: 'filesystem.read', path: nulPath });
    assert.equal(decision.allowed, false);

    // Sanity: the same path without the NUL is inside the model dir and allowed,
    // so the denial above is attributable to the NUL and nothing else.
    const clean = MODEL_DIR[platform] + sep + 'model.gguf.txt';
    assert.equal(broker.decide(grantFor(platform), { kind: 'filesystem.read', path: clean }).allowed, true);
  });

  test(`[${platform}] filesystem.workspace is read-only and needs a session grant`, () => {
    const broker = createPermissionBroker(platform);
    const workspace = platform === 'win32' ? 'C:\\work\\project' : '/work/project';
    const file = path.join(workspace, 'notes.md');

    // Declared, but no session grant yet.
    const ungranted = broker.decide(
      grantFor(platform, { granted: ['filesystem.workspace'] }),
      { kind: 'filesystem.read', path: file },
    );
    assert.equal(ungranted.allowed, false);
    assert.match(ungranted.reason, /no workspace directory granted/);

    const granted = grantFor(platform, {
      granted: ['filesystem.workspace'],
      workspaceDir: workspace,
    });
    assert.equal(broker.decide(granted, { kind: 'filesystem.read', path: file }).allowed, true);

    const write = broker.decide(granted, { kind: 'filesystem.write', path: file });
    assert.equal(write.allowed, false);
    assert.match(write.reason, /read-only/);
  });

  test(`[${platform}] a grant carrying an unknown permission is refused wholesale`, () => {
    const broker = createPermissionBroker(platform);
    // A corrupted or hand-edited registry entry. The rest of the grant must not
    // be honoured just because only one entry is unrecognised.
    const grant = grantFor(platform, { granted: ['filesystem.models', 'filesystem.everything'] });
    const decision = broker.decide(grant, {
      kind: 'filesystem.read',
      path: path.join(MODEL_DIR[platform], 'model.gguf'),
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /unknown permission/);
  });

  test(`[${platform}] process.spawn matches the allowlist, tolerating the Windows .exe suffix`, () => {
    const broker = createPermissionBroker(platform);
    const grant = grantFor(platform, {
      granted: ['process.spawn'],
      allowedBinaries: ['llama-server'],
    });

    assert.equal(broker.decide(grant, { kind: 'process.spawn', binary: 'llama-server' }).allowed, true);
    // A manifest should not need a platform branch to name its own binary.
    assert.equal(broker.decide(grant, { kind: 'process.spawn', binary: 'llama-server.exe' }).allowed, true);
    assert.equal(broker.decide(grant, { kind: 'process.spawn', binary: 'bash' }).allowed, false);
    assert.equal(broker.decide(grant, { kind: 'process.spawn', binary: '/bin/sh' }).allowed, false);
  });
}

test('loopback is the whole 127.0.0.0/8 block plus ::1, and nothing else', () => {
  for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]']) {
    assert.equal(isLoopback(host), true, `${host} should be loopback`);
  }
  for (const host of ['example.com', '10.0.0.1', '0.0.0.0', '128.0.0.1', '1270.0.0.1']) {
    assert.equal(isLoopback(host), false, `${host} should not be loopback`);
  }
});

test('network.remote requires the host to be in the manifest allowlist', () => {
  const broker = createPermissionBroker('darwin');
  const grant = grantFor('darwin', {
    granted: ['network.remote'],
    allowedHosts: ['huggingface.co', '*.hf.co'],
  });

  assert.equal(broker.decide(grant, { kind: 'network.connect', host: 'huggingface.co', port: 443 }).allowed, true);
  assert.equal(broker.decide(grant, { kind: 'network.connect', host: 'cdn.hf.co', port: 443 }).allowed, true);
  assert.equal(broker.decide(grant, { kind: 'network.connect', host: 'evil.com', port: 443 }).allowed, false);
  // The wildcard must not match the bare suffix itself.
  assert.equal(broker.decide(grant, { kind: 'network.connect', host: 'hf.co', port: 443 }).allowed, false);
});

test('a bare "*" is not treated as an allowlist entry', () => {
  const broker = createPermissionBroker('darwin');
  const grant = grantFor('darwin', { granted: ['network.remote'], allowedHosts: ['*'] });
  assert.equal(broker.decide(grant, { kind: 'network.connect', host: 'evil.com', port: 443 }).allowed, false);
});

test('network.remote with an empty allowlist is denied even if the grant says otherwise', () => {
  const broker = createPermissionBroker('darwin');
  const grant = grantFor('darwin', { granted: ['network.remote'], allowedHosts: [] });
  const decision = broker.decide(grant, { kind: 'network.connect', host: 'example.com', port: 443 });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /empty host allowlist/);
});

test('an out-of-range port is denied before any host check', () => {
  const broker = createPermissionBroker('darwin');
  const grant = grantFor('darwin', { granted: ['network.localhost'] });
  for (const port of [0, -1, 70000, 1.5, Number.NaN]) {
    assert.equal(broker.decide(grant, { kind: 'network.connect', host: '127.0.0.1', port }).allowed, false);
  }
});

test('an unknown request kind is denied', () => {
  const broker = createPermissionBroker('darwin');
  const decision = broker.decide(grantFor('darwin'), { kind: 'process.fork', binary: 'x' });
  assert.equal(decision.allowed, false);
});
