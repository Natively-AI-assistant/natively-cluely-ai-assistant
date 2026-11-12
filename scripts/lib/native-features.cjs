// Cargo features for a dev build of native-module.
//
// NATIVELY_NATIVE_FEATURES=fault-injection compiles in the dev-only faults
// from native-module/src/fault_injection.rs, used to run the system-audio
// failure paths in the real app. A packaging build (app:build sets
// NATIVELY_BUILD_ALL_MAC_ARCHES) or CI must never carry them, so both refuse.

const DEV_ONLY_FEATURES = new Set(['fault-injection']);

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]} the features to pass to `napi build --features`
 */
function resolveNativeFeatures(env) {
  const raw = (env.NATIVELY_NATIVE_FEATURES || '').trim();
  if (!raw) return [];

  const features = raw.split(',').map((f) => f.trim()).filter(Boolean);
  const unknown = features.filter((f) => !DEV_ONLY_FEATURES.has(f));
  if (unknown.length > 0) {
    throw new Error(
      `NATIVELY_NATIVE_FEATURES: unknown feature(s) ${unknown.join(', ')}; allowed: ${[...DEV_ONLY_FEATURES].join(', ')}`,
    );
  }
  if (env.NATIVELY_BUILD_ALL_MAC_ARCHES === '1' || env.CI) {
    throw new Error(
      'NATIVELY_NATIVE_FEATURES is set for a packaging or CI build. Those features are dev-only; unset it and rebuild.',
    );
  }
  return features;
}

/** `napi build` arguments for `features` (empty string when none). */
function napiFeatureArgs(features) {
  return features.length > 0 ? ` --features ${features.join(',')}` : '';
}

module.exports = { resolveNativeFeatures, napiFeatureArgs };
