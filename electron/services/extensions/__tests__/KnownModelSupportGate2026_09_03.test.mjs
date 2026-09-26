/**
 * An extension must not silently ship a model Core has already judged unrunnable.
 *
 * Core's reranker catalogue records, per model, whether Core can execute it.
 * That gate only ever covered Core's OWN catalogue: an extension shipping the
 * same repo spawns its own runtime, so nothing consulted the catalogue and a
 * known-broken model could take over the rerank seam with nothing said. This
 * suite covers the mechanism that closes it.
 *
 * WHY A SYNTHETIC CATALOGUE. The first version of this file asserted that
 * `jinaai/jina-reranker-v3.5-GGUF` was unsupported. On 2026-09-01 it was; by
 * 2026-09-03 it had been fixed and every catalogue entry was supported, and
 * three tests failed — not because the mechanism broke, but because they were
 * asserting volatile product data. Mechanism tests now build their own
 * catalogue. Only genuine invariants are asserted against the real one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);

const { createModelSupportLookup, lookupKnownModelSupport } = require(
  path.join(repoRoot, 'dist-electron/electron/services/reranking/knownModelSupport.js'),
);
const { buildInstallPromptText, warnAboutKnownUnsupportedModels } = require(
  path.join(repoRoot, 'dist-electron/electron/services/extensions/appWiring.js'),
);
const { RERANKER_MODEL_CATALOG } = require(
  path.join(repoRoot, 'dist-electron/electron/rag/rerankerModelCatalog.js'),
);

const BROKEN_REPO = 'example-org/Broken-Reranker-GGUF';
const WORKING_REPO = 'example-org/working-reranker';
const REASON = 'llama.cpp reports n_swa = 0, so 17 of 28 layers run with the wrong attention.';

const lookup = createModelSupportLookup([
  { id: 'broken-model', repo: BROKEN_REPO, supported: false, unsupportedReason: REASON },
  { id: 'working-model', repo: WORKING_REPO, supported: true },
]);

// ── the lookup ────────────────────────────────────────────────────────────

test('an unrunnable model is reported with its reason and catalogue id', () => {
  const known = lookup(BROKEN_REPO);
  assert.equal(known.supported, false);
  assert.equal(known.reason, REASON);
  assert.equal(known.catalogId, 'broken-model');
});

test('a runnable model carries no reason', () => {
  const known = lookup(WORKING_REPO);
  assert.equal(known.supported, true);
  assert.equal(known.reason, undefined);
});

test('repo matching ignores case and stray whitespace or slashes', () => {
  // Hugging Face treats Owner/Name and owner/name as one repo, so a manifest
  // differing only in case must not slip past the check.
  for (const variant of [
    BROKEN_REPO.toLowerCase(), BROKEN_REPO.toUpperCase(), ` ${BROKEN_REPO} `, `${BROKEN_REPO}/`,
  ]) {
    const known = lookup(variant);
    assert.ok(known && known.supported === false, `${JSON.stringify(variant)} should still match`);
  }
});

test('a model Core does not ship gets no opinion', () => {
  for (const repo of ['some-org/not-in-the-catalogue', '', '   ', null, undefined, 42, {}]) {
    assert.equal(lookup(repo), null, `${String(repo)} should be unknown`);
  }
});

test('a duplicate repo keeps the first entry rather than the last', () => {
  const dup = createModelSupportLookup([
    { id: 'first', repo: 'a/b', supported: false, unsupportedReason: 'first wins' },
    { id: 'second', repo: 'A/B', supported: true },
  ]);
  assert.equal(dup('a/b').catalogId, 'first');
  assert.deepEqual(dup.unsupportedRepos(), ['a/b']);
});

// ── the real catalogue: invariants only, never a specific model's status ──

test('every real catalogue entry is resolvable by its own repo', () => {
  assert.ok(RERANKER_MODEL_CATALOG.length > 0);
  for (const entry of RERANKER_MODEL_CATALOG) {
    const known = lookupKnownModelSupport(entry.repo);
    assert.ok(known, `${entry.repo} must resolve`);
    assert.equal(known.supported, entry.supported);
  }
});

test('every real unsupported entry states a reason', () => {
  // If nothing is unsupported today this is vacuously true, which is fine —
  // the point is that an unsupported entry can never be reason-less.
  for (const entry of RERANKER_MODEL_CATALOG) {
    if (entry.supported) continue;
    const known = lookupKnownModelSupport(entry.repo);
    assert.ok(known.reason && known.reason.length > 0,
      `${entry.repo} is unsupported and must say why`);
  }
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
    key: 'broken-Q4_K_M', approxBytes: 396709504, spdx: 'CC-BY-NC-4.0',
    licenseUrl: 'https://huggingface.co/x', commercialUseRestricted: true,
    requiresAcknowledgement: true, repo: BROKEN_REPO, knownUnsupportedReason: REASON,
  }]));

  assert.match(detail, /cannot run them/i);
  assert.match(detail, /n_swa/);
  assert.match(detail, /Broken-Reranker-GGUF/);
  // The honest caveat: the extension supplies its own runtime.
  assert.match(detail, /own runtime/i);
});

test('a clean model adds no scare text', () => {
  const { detail } = buildInstallPromptText(promptWith([{
    key: 'fine', approxBytes: 1000, spdx: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/x', commercialUseRestricted: false,
    requiresAcknowledgement: false, repo: WORKING_REPO,
  }]));
  assert.doesNotMatch(detail, /cannot run them/i);
});

// ── the already-enabled case ──────────────────────────────────────────────

const managerWith = (records) => ({ list: () => records });
const record = (id, enabled, repo) => ({
  id, enabled,
  manifest: { name: id, type: 'reranker', models: [{ key: `${id}-m`, repo }] },
});

test('an already-enabled extension with a known-broken model is reported', () => {
  // The install prompt cannot help someone who enabled it before this existed.
  const warnings = warnAboutKnownUnsupportedModels(
    managerWith([record('broken-ext', true, BROKEN_REPO)]), lookup,
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /broken-ext/);
  assert.match(warnings[0], /n_swa/);
  assert.match(warnings[0], /own runtime/i);
});

test('a disabled extension, or a runnable model, is not reported', () => {
  assert.deepEqual(
    warnAboutKnownUnsupportedModels(managerWith([record('broken-ext', false, BROKEN_REPO)]), lookup),
    [],
    'a disabled extension cannot own the seam, so it is not a problem',
  );
  assert.deepEqual(
    warnAboutKnownUnsupportedModels(managerWith([
      record('fine', true, WORKING_REPO),
      record('unknown', true, 'some-org/whatever'),
    ]), lookup),
    [],
  );
});

test('the check never throws, whatever the manager does', () => {
  assert.deepEqual(warnAboutKnownUnsupportedModels({ list() { throw new Error('boom'); } }, lookup), []);
  assert.deepEqual(warnAboutKnownUnsupportedModels(managerWith([
    { id: 'no-models', enabled: true, manifest: { type: 'reranker' } },
  ]), lookup), []);
});
