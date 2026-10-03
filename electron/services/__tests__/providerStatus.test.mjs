// Covers electron/services/providerStatus.ts: cloneProviderStatus (the only runtime
// export; everything else in the module is a type).
// Run from the repo root: node --test electron/services/__tests__/providerStatus.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { cloneProviderStatus } = require(
    path.join(repoRoot, 'dist-electron/electron/services/providerStatus.js'),
);

function makeStatus(overrides = {}) {
    return {
        id: 'ollama',
        kind: 'external_local',
        health: 'degraded',
        requiredForStartup: false,
        requiredForCoreFallback: true,
        message: 'Ollama is not responding',
        recoverable: true,
        details: { port: 11434, model: 'llama3' },
        updatedAt: '2026-01-02T03:04:05.000Z',
        ...overrides,
    };
}

test('the clone is a new object with the same field values', () => {
    const status = makeStatus();
    const clone = cloneProviderStatus(status);
    assert.notEqual(clone, status);
    assert.deepEqual(clone, status);
});

test('details is copied, so editing the clone leaves the original alone', () => {
    const status = makeStatus();
    const clone = cloneProviderStatus(status);
    assert.notEqual(clone.details, status.details);
    clone.details.port = 1;
    clone.details.added = true;
    clone.message = 'changed';
    assert.deepEqual(status, makeStatus());
});

test('editing the original after cloning leaves the clone alone', () => {
    const status = makeStatus();
    const clone = cloneProviderStatus(status);
    status.details.model = 'other';
    status.health = 'ready';
    assert.equal(clone.details.model, 'llama3');
    assert.equal(clone.health, 'degraded');
});

test('a status without details clones with details undefined', () => {
    const { details, ...status } = makeStatus();
    const clone = cloneProviderStatus(status);
    assert.equal(clone.details, undefined);
    for (const key of Object.keys(status)) assert.equal(clone[key], status[key], key);
});

test('explicitly undefined or null details become undefined', () => {
    assert.equal(cloneProviderStatus(makeStatus({ details: undefined })).details, undefined);
    assert.equal(cloneProviderStatus(makeStatus({ details: null })).details, undefined);
});

test('empty details stay an empty object, but a distinct one', () => {
    const status = makeStatus({ details: {} });
    const clone = cloneProviderStatus(status);
    assert.deepEqual(clone.details, {});
    assert.notEqual(clone.details, status.details);
});

test('a status without updatedAt does not gain one', () => {
    const { updatedAt, ...status } = makeStatus();
    const clone = cloneProviderStatus(status);
    assert.equal('updatedAt' in clone, false);
    assert.deepEqual(clone, status);
});

test('every kind and health value passes through unchanged', () => {
    for (const kind of ['cloud', 'external_local', 'packaged_local']) {
        for (const health of ['ready', 'missing_optional_dependency', 'missing_required_asset', 'misconfigured', 'degraded', 'unavailable']) {
            const clone = cloneProviderStatus(makeStatus({ kind, health }));
            assert.equal(clone.kind, kind);
            assert.equal(clone.health, health);
        }
    }
});
