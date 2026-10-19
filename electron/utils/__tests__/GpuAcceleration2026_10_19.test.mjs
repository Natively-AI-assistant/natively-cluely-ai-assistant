// GPU kill-switch decision logic (electron/utils/gpuAcceleration.ts): env var
// precedence over the stored setting, and a malformed or missing settings.json
// must never flip acceleration off. Pure module — plain node drives the
// compiled dist-electron output, exactly as main.ts consumes it pre-ready.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { shouldDisableGpu } = require(path.join(repoRoot, 'dist-electron/electron/utils/gpuAcceleration.js'));

test('NATIVELY_DISABLE_GPU=1 beats a false setting', () => {
    assert.equal(shouldDisableGpu({ NATIVELY_DISABLE_GPU: '1' }, '{"disableGpuAcceleration":false}'), true);
});

test('NATIVELY_DISABLE_GPU=0 beats a true setting (undo without editing JSON)', () => {
    assert.equal(shouldDisableGpu({ NATIVELY_DISABLE_GPU: '0' }, '{"disableGpuAcceleration":true}'), false);
});

test('env unset: the stored setting decides', () => {
    assert.equal(shouldDisableGpu({}, '{"disableGpuAcceleration":true}'), true);
    assert.equal(shouldDisableGpu({}, '{"disableGpuAcceleration":false}'), false);
    assert.equal(shouldDisableGpu({}, '{}'), false);
});

test('malformed JSON or a missing settings file reads as off', () => {
    assert.equal(shouldDisableGpu({}, 'not json'), false);
    assert.equal(shouldDisableGpu({}, ''), false);
    assert.equal(shouldDisableGpu({}, null), false);
});
