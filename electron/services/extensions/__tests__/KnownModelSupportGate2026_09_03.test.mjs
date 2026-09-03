/**
 * An extension must not silently ship a model Core has already judged unrunnable.
 *
 * Core's reranker catalogue marks `jinaai/jina-reranker-v3.5-GGUF` as
 * `supported: false` — the bundled llama.cpp reports `n_swa = 0` and runs 17 of
 * 28 layers with the wrong attention, so every score would be wrong. That gate
 * only covered Core's own catalogue. The `jina-reranker-v35` EXTENSION ships
 * the same repo and spawns its own `llama-server`, so nothing consulted the
 * catalogue: it could take over the rerank seam with no warning anywhere.
 *
 * Reranking has no visible failure mode — wrong scores read as worse answers,
 * not as an error — which is exactly why this has to be said out loud.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);

const { lookupKnownModelSupport, knownUnsupportedRepos } = require(
  path.join(repoRoot, 'dist-electron/electron/services/reranking/knownModelSupport.js'),
);
const { buildInstallPromptText, warnAboutKnownUnsupportedModels } = require(
  path.join(repoRoot, 'dist-electron/electron/services/extensions/appWiring.js'),
);

const JINA_V35 = 'jinaai/jina-reranker-v3.5-GGUF';

test('Core reports the v3.5 GGUF as unrunnable, with a reason', () => {
  const known = lookupKnownModelSupport(JINA_V35);
  assert.ok(known, 'the catalogue must recognise this repo');
  assert.equal(known.supported, false);
  assert.match(known.reason, /n_swa|attention/i);
  assert.equal(typeof known.catalogId, 'string');
});

test('repo matching ignores case and stray slashes', () => {
  // Hugging Face treats Owner/Name and owner/name as one repo, so a manifest
  // differing only in case must not slip past the check.
  for (const variant of [JINA_V35.toLowerCase(), JINA_V35.toUpperCase(), ` ${JINA_V35} `]) {
    const known = lookupKnownModelSupport(variant);
    assert.ok(known && known.supported === false, `${variant} should still match`);
  }
});

test('a model Core does not ship gets no opinion', () => {
  for (const repo of ['some-org/not-in-the-catalogue', '', null, undefined, 42]) {
    assert.equal(lookupKnownModelSupport(repo), null, `${String(repo)} should be unknown`);
  }
});

test('a model Core ships AND can run is not flagged', () => {
  // Guard against over-correcting into "every catalogue model is suspect".
  const known = lookupKnownModelSupport('QuantFactory/Qwen3-Reranker-0.6B-GGUF');
  assert.ok(known);
  assert.equal(known.supported, true);
  assert.equal(known.reason, undefined);
  assert.ok(!knownUnsupportedRepos().includes('quantfactory/qwen3-reranker-0.6b-gguf'));
});

// ── the install prompt ────────────────────────────────────────────────────

function promptWith(models) {
  return {
    extensionId: 'x', name: 'X', version: '1.0.0', author: 'community',
    homepage: 'https://example.com/x',
    permissions: ['filesystem.models'], highRiskPermissions: [],
    communityMaintained: true, models,
  };
}

test('the trust prompt states the problem before the user consents', () => {
  const { detail } = buildInstallPromptText(promptWith([{
    key: 'jina-v3.5-Q4_K_M', approxBytes: 396709504, spdx: 'CC-BY-NC-4.0',
    licenseUrl: 'https://huggingface.co/x', commercialUseRestricted: true,
    requiresAcknowledgement: true, repo: JINA_V35,
    knownUnsupportedReason: 'llama.cpp reports n_swa = 0, so 17 of 28 layers run with the wrong attention.',
  }]));

  assert.match(detail, /cannot run them/i);
  assert.match(detail, /n_swa/);
  assert.match(detail, new RegExp(JINA_V35.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // The honest caveat: the extension supplies its own runtime.
  assert.match(detail, /own runtime/i);
});

test('a clean model adds no scare text', () => {
  const { detail } = buildInstallPromptText(promptWith([{
    key: 'qwen3', approxBytes: 483835680, spdx: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/x', commercialUseRestricted: false,
    requiresAcknowledgement: false, repo: 'QuantFactory/Qwen3-Reranker-0.6B-GGUF',
  }]));
  assert.doesNotMatch(detail, /cannot run them/i);
});

// ── the already-enabled case ──────────────────────────────────────────────

function managerWith(records) {
  return { list: () => records };
}

function record(id, enabled, repo) {
  return {
    id, enabled,
    manifest: { name: id, type: 'reranker', models: [{ key: `${id}-m`, repo }] },
  };
}

test('an already-enabled extension with a known-broken model is reported', () => {
  // The install prompt cannot help someone who enabled it before this existed.
  const warnings = warnAboutKnownUnsupportedModels(
    managerWith([record('jina-reranker-v35', true, JINA_V35)]),
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /jina-reranker-v35/);
  assert.match(warnings[0], /n_swa|attention/i);
});

test('a disabled extension, or a runnable model, is not reported', () => {
  assert.deepEqual(
    warnAboutKnownUnsupportedModels(managerWith([record('jina-reranker-v35', false, JINA_V35)])),
    [],
    'a disabled extension cannot own the seam, so it is not a problem',
  );
  assert.deepEqual(
    warnAboutKnownUnsupportedModels(managerWith([
      record('qwen', true, 'QuantFactory/Qwen3-Reranker-0.6B-GGUF'),
      record('unknown', true, 'some-org/whatever'),
    ])),
    [],
  );
});

test('the check never throws, whatever the manager does', () => {
  assert.deepEqual(warnAboutKnownUnsupportedModels({ list() { throw new Error('boom'); } }), []);
  assert.deepEqual(warnAboutKnownUnsupportedModels(managerWith([
    { id: 'no-models', enabled: true, manifest: { type: 'reranker' } },
  ])), []);
});
