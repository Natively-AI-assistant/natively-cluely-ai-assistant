/**
 * Phase 1: extension.json schema + compatibility gate.
 *
 * The manifest is attacker-influenced input (it arrives from a downloaded
 * repo), so these tests are about what validation REFUSES, not what it accepts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);

const { validateManifest, satisfiesEngineRange } = require(
  path.join(repoRoot, 'dist-electron/electron/services/extensions/ExtensionManifest.js'),
);

const APP_VERSION = '2.8.8';

/** A manifest that must validate, so each test can break exactly one thing. */
function goodManifest(overrides = {}) {
  return {
    id: 'ettin-reranker',
    name: 'Ettin Reranker',
    version: '1.0.0',
    apiVersion: '1',
    type: 'reranker',
    entrypoint: 'dist/index.js',
    author: 'community',
    homepage: 'https://github.com/example/natively-ettin-reranker',
    engines: { natively: '>=2.8.0' },
    permissions: ['filesystem.models'],
    models: [
      {
        key: 'ettin-reranker-150m',
        format: 'onnx',
        source: 'huggingface',
        repo: 'cross-encoder/ettin-reranker-150m-v1',
        file: 'model.onnx',
        approxBytes: 151000000,
        sha256: null,
        license: {
          spdx: 'Apache-2.0',
          url: 'https://huggingface.co/cross-encoder/ettin-reranker-150m-v1',
          redistributable: true,
          commercialUseRestricted: false,
          requiresAcknowledgement: false,
        },
      },
    ],
    ...overrides,
  };
}

test('the baseline manifest validates', () => {
  const result = validateManifest(goodManifest(), { appVersion: APP_VERSION });
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('; '));
  assert.equal(result.manifest.id, 'ettin-reranker');
});

test('an apiVersion this build cannot host is rejected', () => {
  const result = validateManifest(goodManifest({ apiVersion: '2' }), { appVersion: APP_VERSION });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /apiVersion "2" is not supported/);
});

test('an unknown permission string is rejected, not ignored', () => {
  // The critical case: an unknown permission must FAIL the manifest. Silently
  // dropping it would install an extension whose install prompt did not show
  // everything the manifest asked for.
  const result = validateManifest(
    goodManifest({ permissions: ['filesystem.models', 'filesystem.root'] }),
    { appVersion: APP_VERSION },
  );
  assert.equal(result.ok, false);
  const joined = result.errors.join('; ');
  // Pin the POSITION and the closed set, not just the field name: the duplicate
  // permission error also mentions "permissions", so a looser match would pass
  // even if the unknown value had been silently accepted at index 1.
  assert.match(joined, /permissions\.1/);
  assert.match(joined, /expected one of/);
  assert.match(joined, /"process\.spawn"/);
});

test('network.remote without a host allowlist is rejected', () => {
  const result = validateManifest(
    goodManifest({ permissions: ['filesystem.models', 'network.remote'] }),
    { appVersion: APP_VERSION },
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /network\.remote.*allowedHosts/);
});

test('process.spawn without a binary allowlist is rejected', () => {
  const result = validateManifest(
    goodManifest({ permissions: ['filesystem.models', 'process.spawn'] }),
    { appVersion: APP_VERSION },
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /process\.spawn.*allowedBinaries/);
});

test('an extension id that could escape its directory is rejected', () => {
  for (const id of ['../evil', 'a/b', 'C:\\x', '..', 'con', 'UPPER']) {
    const result = validateManifest(goodManifest({ id }), { appVersion: APP_VERSION });
    assert.equal(result.ok, false, `id ${JSON.stringify(id)} should be rejected`);
  }
});

test('declaring models without filesystem.models is rejected', () => {
  const result = validateManifest(
    goodManifest({ permissions: ['network.localhost'] }),
    { appVersion: APP_VERSION },
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /filesystem\.models/);
});

test('an unresolved huggingface repo id warns but does not silently pass as downloadable', () => {
  const m = goodManifest();
  m.models[0].repo = null;
  const result = validateManifest(m, { appVersion: APP_VERSION });
  assert.equal(result.ok, true);
  assert.match(result.warnings.join('; '), /no resolved repo id/);
});

test('engines.natively gates on the running app version', () => {
  const tooNew = validateManifest(
    goodManifest({ engines: { natively: '>=99.0.0' } }),
    { appVersion: APP_VERSION },
  );
  assert.equal(tooNew.ok, false);
  assert.match(tooNew.errors.join('; '), /engines\.natively/);
});

test('an unparseable engine range is refused, not treated as satisfied', () => {
  // A range this build cannot parse is a range it cannot honour. Defaulting to
  // "satisfied" would load an extension against an app version it never claimed
  // to support.
  assert.equal(satisfiesEngineRange('^2.0.0', '2.8.8'), false);
  assert.equal(satisfiesEngineRange('~2.8', '2.8.8'), false);
  assert.equal(satisfiesEngineRange('>=2.8.0', '2.8.8'), true);
  assert.equal(satisfiesEngineRange('*', '2.8.8'), true);
  // 2.10.0 > 2.9.0 numerically, not lexically.
  assert.equal(satisfiesEngineRange('>=2.9.0', '2.10.0'), true);
});

test('a duplicate permission is rejected so the install prompt cannot misreport the grant', () => {
  const result = validateManifest(
    goodManifest({ permissions: ['filesystem.models', 'filesystem.models'] }),
    { appVersion: APP_VERSION },
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /duplicate permission/);
});

test('validation never throws on hostile input', () => {
  for (const input of [null, undefined, 42, 'string', [], { id: {} }]) {
    const result = validateManifest(input, { appVersion: APP_VERSION });
    assert.equal(result.ok, false);
    assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
  }
});


// ── repoPath: source path vs local filename ──────────────────────────────

test('repoPath carries a nested source path while file stays a bare local name', () => {
  // Hugging Face nests weights (onnx/model.onnx). The source path and the local
  // filename are genuinely two different things, and only `file` becomes a path
  // on this machine.
  const m = goodManifest();
  m.models[0].repoPath = 'onnx/model.onnx';
  m.models[0].file = 'model.onnx';
  const result = validateManifest(m, { appVersion: APP_VERSION });
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('; '));
  assert.equal(result.manifest.models[0].repoPath, 'onnx/model.onnx');
});

test('an unsafe repoPath is rejected', () => {
  for (const repoPath of ['/etc/passwd', '../../secrets', 'onnx\\model.onnx', 'https://evil.com/x']) {
    const m = goodManifest();
    m.models[0].repoPath = repoPath;
    const result = validateManifest(m, { appVersion: APP_VERSION });
    assert.equal(result.ok, false, `${repoPath} should be rejected`);
    assert.match(result.errors.join('; '), /unsafe repoPath/);
  }
});
