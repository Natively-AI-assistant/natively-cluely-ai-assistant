// Flag-parity verification (2026-07-14 real-app source-switch repair) —
// Phase 8. Root cause: five flags (ragConfidenceGate/ragLocalRerank/
// okfKnowledgePacks/okfHybridRetrieval/jitFinalAnswerEnforced) were hardcoded
// `default: false` during a 2026-07-09 stability rollback, while their doc
// comments (and sibling flags like okfProfilePacks) still promised
// dev/test-default-ON — so a real dev-mode Electron run and the benchmark
// harness silently exercised DIFFERENT effective Context OS behavior on the
// same build. This suite pins: (1) the 5 flags are restored to their intended
// defaults, (2) assertVerificationFlagsOrThrow is a true no-op unless
// explicitly opted in, and (3) it throws when a required flag is missing.
//
// All tests mutate shared process.env state, so — following the exact pattern
// IntelligenceFlags.test.mjs already uses — they live under ONE flat
// `describe` with beforeEach/afterEach clearing env, never nested describes
// (Node's test runner may run sibling describe blocks concurrently, which
// would corrupt env-mutation assertions across blocks).
//
// Requires: npm run build:electron.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron/intelligence');
const mod = await import(pathToFileURL(path.join(distDir, 'intelligenceFlags.js')).href);

const {
  isIntelligenceFlagEnabled,
  intelligenceFlagSnapshot,
  isVerificationModeEnabled,
  assertVerificationFlagsOrThrow,
  REQUIRED_CONTEXT_OS_FLAGS_FOR_VERIFICATION,
  __resetIntelligenceFlagsCache,
} = mod;

const RESTORED_ENV_KEYS = [
  'NATIVELY_RAG_CONFIDENCE_GATE',
  'NATIVELY_RAG_LOCAL_RERANK',
  'NATIVELY_OKF_KNOWLEDGE_PACKS',
  'NATIVELY_OKF_HYBRID_RETRIEVAL',
  'NATIVELY_JIT_FINAL_ANSWER_ENFORCED',
  'NATIVELY_VERIFICATION_MODE',
  'NODE_ENV',
  'BENCHMARK_MODEL',
  'NATIVELY_INTERNAL',
  'NATIVELY_DEV',
];

function clearEnv() {
  for (const k of RESTORED_ENV_KEYS) delete process.env[k];
  if (typeof __resetIntelligenceFlagsCache === 'function') __resetIntelligenceFlagsCache();
}

describe('flag-parity verification (2026-07-14)', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  test('under a dev/test/benchmark context, all 5 resolve to true (matching their doc-promised dev/test default)', () => {
    process.env.NODE_ENV = 'test';
    assert.equal(isIntelligenceFlagEnabled('ragConfidenceGate'), true);
    assert.equal(isIntelligenceFlagEnabled('ragLocalRerank'), true);
    assert.equal(isIntelligenceFlagEnabled('okfKnowledgePacks'), true);
    assert.equal(isIntelligenceFlagEnabled('okfHybridRetrieval'), true);
    // jitFinalAnswerEnforced is unconditionally true (production policy, not
    // dev/test-gated) — restored to its pre-rollback intended default.
    assert.equal(isIntelligenceFlagEnabled('jitFinalAnswerEnforced'), true);
  });

  test('outside a dev/test/benchmark context (production-like), the 4 context-gated flags resolve to false; jitFinalAnswerEnforced stays true', () => {
    // No NODE_ENV, no BENCHMARK_MODEL, no NATIVELY_INTERNAL/DEV → production-like.
    assert.equal(isIntelligenceFlagEnabled('ragConfidenceGate'), false);
    assert.equal(isIntelligenceFlagEnabled('ragLocalRerank'), false);
    assert.equal(isIntelligenceFlagEnabled('okfKnowledgePacks'), false);
    assert.equal(isIntelligenceFlagEnabled('okfHybridRetrieval'), false);
    assert.equal(isIntelligenceFlagEnabled('jitFinalAnswerEnforced'), true,
      'jitFinalAnswerEnforced is the intended production policy, not a dev/test experiment');
  });

  test('an explicit env override still wins over the restored default (both directions)', () => {
    process.env.NODE_ENV = 'test';
    process.env.NATIVELY_OKF_KNOWLEDGE_PACKS = '0';
    process.env.NATIVELY_JIT_FINAL_ANSWER_ENFORCED = '0';
    assert.equal(isIntelligenceFlagEnabled('okfKnowledgePacks'), false, 'explicit off must still override a true default');
    assert.equal(isIntelligenceFlagEnabled('jitFinalAnswerEnforced'), false, 'explicit off must still override the unconditional true default');
  });

  test('isVerificationModeEnabled is false by default (no env set)', () => {
    assert.equal(isVerificationModeEnabled(), false);
  });

  test('assertVerificationFlagsOrThrow is a NO-OP when verification mode is not enabled, even with every required flag off', () => {
    // production-like: all 5 required flags resolve false/true per their design,
    // but verification mode itself is OFF, so this must never throw.
    assert.doesNotThrow(() => assertVerificationFlagsOrThrow());
  });

  test('assertVerificationFlagsOrThrow THROWS when verification mode is on and a required flag is disabled', () => {
    process.env.NATIVELY_VERIFICATION_MODE = '1';
    process.env.NATIVELY_OKF_KNOWLEDGE_PACKS = '0'; // force one required flag off
    process.env.NODE_ENV = 'test'; // the others would otherwise resolve true
    assert.throws(() => assertVerificationFlagsOrThrow(), /okfKnowledgePacks/);
  });

  test('assertVerificationFlagsOrThrow does NOT throw when verification mode is on and every required flag is enabled', () => {
    process.env.NATIVELY_VERIFICATION_MODE = '1';
    process.env.NODE_ENV = 'test'; // all 5 required flags resolve true under this context
    assert.doesNotThrow(() => assertVerificationFlagsOrThrow());
  });

  test('the required-flags list is exactly the 5 flags named in the divergence report — a real, legible list, not "every flag"', () => {
    assert.deepEqual(
      new Set(REQUIRED_CONTEXT_OS_FLAGS_FOR_VERIFICATION),
      new Set(['ragConfidenceGate', 'ragLocalRerank', 'okfKnowledgePacks', 'okfHybridRetrieval', 'jitFinalAnswerEnforced']),
    );
  });

  test('intelligenceFlagSnapshot: snapshot reflects the exact same resolution as isIntelligenceFlagEnabled for every flag', () => {
    process.env.NODE_ENV = 'test';
    const snap = intelligenceFlagSnapshot();
    for (const key of REQUIRED_CONTEXT_OS_FLAGS_FOR_VERIFICATION) {
      assert.equal(snap[key], isIntelligenceFlagEnabled(key), `snapshot must agree with the live resolver for ${key}`);
    }
  });

  // ── main.ts wiring: the assertion must actually terminate the process ─────
  //
  // code-review (round 2): a throw here that only reaches a generic top-level
  // .catch() (which logs but never exits) leaves a half-initialized,
  // windowless Electron process alive indefinitely — defeating the "fails
  // immediately and loudly" guarantee this feature exists to provide for a
  // CI/soak harness. main.ts is a 7800+ line module with heavy import-time
  // side effects (real Electron app/BrowserWindow/native-module wiring), so a
  // full subprocess-boot integration test is disproportionate for this one
  // assertion; a source-guard test (the same pattern already used by e.g.
  // OkfPhase0FalseRefusalGuard.test.mjs) pins the actual code shape instead.
  test('main.ts: the verification assertion catch block hard-exits (app.exit/process.exit), it does not just log', () => {
    const mainSrc = fs.readFileSync(path.resolve(__dirname, '../../main.ts'), 'utf8');
    const startIdx = mainSrc.indexOf('assertVerificationFlagsOrThrow();');
    assert.ok(startIdx >= 0, 'expected the assertVerificationFlagsOrThrow() call site in main.ts');
    // The catch block immediately follows; bound the search window so this
    // doesn't accidentally match an unrelated exit() call much later in the file.
    const window = mainSrc.slice(startIdx, startIdx + 600);
    assert.match(window, /catch\s*\(verifyErr/, 'expected a catch block for the assertion');
    assert.match(window, /app\?\.exit\(1\)|app\.exit\(1\)/, 'catch block must hard-exit via app.exit(1)');
    assert.match(window, /process\.exit\(1\)/, 'catch block must fall back to process.exit(1) when Electron app is unavailable');
  });
});
