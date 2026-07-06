/**
 * Regression: the WTA live path must apply minimal answer cleanup (meta-preamble
 * strip + scaffold-label compression + schema-stub guard) UNCONDITIONALLY — NOT
 * gated behind the answerDiversityGuard flag (which defaults OFF). The E2E MiniMax
 * campaign found scaffold labels ("Direct Answer:") and meta-preambles reaching
 * the UI raw on the live path because the full normalizer was flag-gated off.
 * Source-level assertion (the live generation is exercised by the E2E harness).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const src = fs.readFileSync(path.join(repoRoot, 'electron/IntelligenceEngine.ts'), 'utf8');

describe('WTA always-on minimal cleanup', () => {
  test('cleanup runs OUTSIDE the answerDiversityGuard flag gate', () => {
    // The always-on block must appear BEFORE the flag-gated normalizer and must
    // itself not be wrapped in isIntelligenceFlagEnabled('answerDiversityGuard').
    const alwaysOn = src.indexOf('ALWAYS-ON minimal cleanup');
    const flagGate = src.indexOf("isIntelligenceFlagEnabled('answerDiversityGuard')");
    assert.ok(alwaysOn > 0, 'always-on cleanup block present');
    assert.ok(flagGate > alwaysOn, 'always-on cleanup precedes the flag-gated normalizer');
    // Between the always-on marker and its close, there must be no flag check.
    const block = src.slice(alwaysOn, flagGate);
    assert.doesNotMatch(block, /isIntelligenceFlagEnabled/, 'the always-on block must not be flag-gated');
  });
  test('schema-stub guard runs unconditionally (before the flag gate too)', () => {
    const stub = src.indexOf('isLeakedSchemaStub(fullAnswer)');
    const flagGate = src.indexOf("isIntelligenceFlagEnabled('answerDiversityGuard')");
    assert.ok(stub > 0 && stub < flagGate, 'schema-stub guard precedes the flag gate');
  });
  test('cleanup skips coding answers (fences/labels are real there)', () => {
    assert.match(src, /if \(!isCoding && finalWtaAnswer\)/, 'coding answers are skipped');
  });
});
