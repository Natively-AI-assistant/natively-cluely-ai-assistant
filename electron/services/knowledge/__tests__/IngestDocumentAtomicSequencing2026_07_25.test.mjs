// electron/services/knowledge/__tests__/IngestDocumentAtomicSequencing2026_07_25.test.mjs
//
// Phase 6 Slice 5 (context-rebuild, 05_MIGRATION_PLAN.md Slice 5 item 3):
// "ingestDocument + generateForProfile + verifyProfileCards become one
// awaited sequence, replacing the setImmediate-deferred race."
//
// Investigation found generateForProfile() is fully synchronous/deterministic
// (no LLM call, DB-transaction-wrapped — see ProfilePackBuilder.ts:210-214's
// own docstring) and _generateProfileOkfPack never throws (its own
// try/catch), so the RESUME branch's setImmediate was pure scheduling
// deferral with no async work behind it — closed with a direct call, zero
// added latency, no flag needed.
//
// The JD branch is different: it defers _generateProfileOkfPack('jd') until
// AFTER aotPipeline.runForJD(...) resolves — a genuinely async, LLM-driven
// chain (Ingestion Audit §A.6.3's real race). Fully awaiting it before
// ingestDocument returns has a real user-facing cost (slower upload-ack), so
// it ships behind the new `atomicJdProfilePackGeneration` flag (dev/test-only
// default), with the pre-existing fire-and-forget behavior preserved
// byte-for-byte in the flag-off branch.
//
// Source-pinned: KnowledgeOrchestrator.ts lives in the premium submodule and
// touches the real (ABI-mismatched in this dev environment) sqlite stack, so
// this follows the same source-pinned pattern as
// LeadershipGroundingFix2026_07_06.test.mjs's premium-file assertions.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(import.meta.url);

const src = readFileSync(
  path.resolve(repoRoot, 'premium/electron/knowledge/KnowledgeOrchestrator.ts'),
  'utf8',
);

const { isIntelligenceFlagEnabled, __resetIntelligenceFlagsCache } = require(
  path.resolve(repoRoot, 'dist-electron/electron/intelligence/intelligenceFlags.js'),
);

describe('resume branch: setImmediate deferral removed, direct synchronous call', () => {
  test('no longer wraps _generateProfileOkfPack("resume") in setImmediate', () => {
    assert.doesNotMatch(src, /setImmediate\(\(\) => this\._generateProfileOkfPack\('resume'\)\)/);
  });

  test('calls _generateProfileOkfPack("resume") directly inside the RESUME branch', () => {
    const marker = "if (type === DocType.RESUME) {\n                this._generateProfileOkfPack('resume');\n            }";
    assert.ok(src.includes(marker), 'expected a direct (non-deferred) call to _generateProfileOkfPack(\'resume\')');
  });
});

describe('JD branch: flag-gated awaited sequence, unchanged default (fire-and-forget) behavior', () => {
  function jdBranchBody() {
    const start = src.indexOf('// 9. Fire AOT Pipeline (JD Only)');
    assert.ok(start >= 0);
    const end = src.indexOf('\n            }\n\n            // 10.', start);
    assert.ok(end > start, 'must find the end of the JD branch before step 10');
    return src.slice(start, end);
  }

  test('branches on isIntelligenceFlagEnabled(\'atomicJdProfilePackGeneration\')', () => {
    const body = jdBranchBody();
    assert.match(body, /isIntelligenceFlagEnabled\('atomicJdProfilePackGeneration'\)/);
  });

  test('flag-ON path awaits aotPipeline.runForJD(...) and calls _generateProfileOkfPack(\'jd\') directly (no setImmediate)', () => {
    const body = jdBranchBody();
    const ifStart = body.indexOf("isIntelligenceFlagEnabled('atomicJdProfilePackGeneration')) {");
    const elseStart = body.indexOf('} else {', ifStart);
    const onBranch = body.slice(ifStart, elseStart);
    assert.match(onBranch, /await this\.aotPipeline\.runForJD\(jdDoc, resumeDoc\)/);
    assert.match(onBranch, /this\._generateProfileOkfPack\('jd'\);/);
    assert.doesNotMatch(onBranch, /setImmediate/, 'the flag-ON path must not defer via setImmediate — that is the entire point of the fix');
  });

  test('flag-OFF path preserves the original fire-and-forget .then()/.catch() + setImmediate shape unchanged', () => {
    const body = jdBranchBody();
    const elseStart = body.indexOf('} else {');
    const elseBranch = body.slice(elseStart);
    assert.match(elseBranch, /\.then\(\(\) => \{/);
    assert.match(elseBranch, /\.catch\(\(err: Error\) => \{/);
    const setImmediateCount = (elseBranch.match(/setImmediate\(\(\) => this\._generateProfileOkfPack\('jd'\)\)/g) || []).length;
    assert.equal(setImmediateCount, 2, 'both the success and failure continuations must still defer via setImmediate, exactly as before');
  });
});

describe('atomicJdProfilePackGeneration flag registration', () => {
  test('resolves to false under this bare node:test harness (dev/test-only default, matching turnIdentityV2/promptComposerV2/canonicalTurnManualChat precedent)', () => {
    __resetIntelligenceFlagsCache();
    delete process.env.NATIVELY_ATOMIC_JD_PROFILE_PACK;
    assert.equal(isIntelligenceFlagEnabled('atomicJdProfilePackGeneration'), false);
  });

  test('NATIVELY_ATOMIC_JD_PROFILE_PACK=1 env override enables it', () => {
    __resetIntelligenceFlagsCache();
    process.env.NATIVELY_ATOMIC_JD_PROFILE_PACK = '1';
    try {
      assert.equal(isIntelligenceFlagEnabled('atomicJdProfilePackGeneration'), true);
    } finally {
      delete process.env.NATIVELY_ATOMIC_JD_PROFILE_PACK;
      __resetIntelligenceFlagsCache();
    }
  });
});
