import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveNativeFeatures, napiFeatureArgs } = require('../lib/native-features.cjs');

test('no variable means a normal build', () => {
  assert.deepEqual(resolveNativeFeatures({}), []);
  assert.deepEqual(resolveNativeFeatures({ NATIVELY_NATIVE_FEATURES: '  ' }), []);
  assert.equal(napiFeatureArgs([]), '');
});

test('a dev build can turn on fault injection', () => {
  const features = resolveNativeFeatures({ NATIVELY_NATIVE_FEATURES: 'fault-injection' });
  assert.deepEqual(features, ['fault-injection']);
  assert.equal(napiFeatureArgs(features), ' --features fault-injection');
});

test('unknown features are rejected, so nothing reaches the cargo command line unchecked', () => {
  assert.throws(
    () => resolveNativeFeatures({ NATIVELY_NATIVE_FEATURES: 'fault-injection,--target x; rm' }),
    /unknown feature/,
  );
});

test('packaging and CI builds refuse dev-only features', () => {
  assert.throws(
    () => resolveNativeFeatures({ NATIVELY_NATIVE_FEATURES: 'fault-injection', NATIVELY_BUILD_ALL_MAC_ARCHES: '1' }),
    /packaging or CI/,
  );
  assert.throws(
    () => resolveNativeFeatures({ NATIVELY_NATIVE_FEATURES: 'fault-injection', CI: 'true' }),
    /packaging or CI/,
  );
});
