// electron/llm/__tests__/RequestedPropertyUnifyParity2026_07_25.test.mjs
//
// Phase 6 Slice 0, item 6 (I3, docs/context-rebuild/05_MIGRATION_PLAN.md):
// the plan proposed deleting the legacy 8-value `classifyRequestedProperty`
// (customModeExecutionContract.ts:701) and redirecting
// `validatePropertyAnswerability` (:733) to the canonical, 22-value
// `PROPERTY_RULES` table (requestedProperty.ts) via
// `detectRequestedProperty` (requestedPropertyDetector.ts) — but ONLY if a
// required parity test proves both classifiers agree on a shared corpus of
// property-bearing questions. If it fails, the plan requires pulling this
// item from Slice 0 rather than shipping unconditionally.
//
// RESULT: parity FAILS, and not incidentally — requestedPropertyDetector.ts's
// own header already documents this as a KNOWN, DELIBERATE divergence:
// "Supersedes (but does not remove) the 8-value `classifyRequestedProperty`
// in customModeExecutionContract.ts — the legacy validator keeps its own
// copy until the Phase 15 cleanup." Three independent, structural reasons
// the two classifiers cannot be swapped in-place today:
//
//   1. NAME MISMATCH: the legacy union's TYPE declares a metrics/results
//      member 'metric_or_result' (customModeExecutionContract.ts:684) —
//      but the function body (:701-711) never returns it; there is no
//      branch for it at all, so it is dead in the type but unreachable in
//      practice. The canonical union's equivalent member is 'result_metric'
//      (types.ts:77, requestedProperty.ts's PROPERTY_RULES) and IS reachable
//      via detectRequestedProperty. So on a metric/result question, the
//      legacy classifier returns 'unknown' while the canonical one correctly
//      returns 'result_metric' — a real BEHAVIOR change (not just a renamed
//      label), since validatePropertyAnswerability treats 'unknown' as "no
//      property check applies" (customModeExecutionContract.ts:734) and
//      would start enforcing evidence requirements it does not enforce
//      today.
//   2. COVERAGE MISMATCH: the canonical table recognizes 22 properties
//      (candidate_project, document_metadata, physical_weight, ...) the
//      legacy classifier has never heard of, so even same-named properties
//      can diverge on questions the legacy classifier would call 'unknown'.
//   3. Consequently redirecting `validatePropertyAnswerability` to the
//      canonical table is not a pure refactor — it changes which questions
//      get property-evidence enforcement applied, an intentional-seeming
//      but unreviewed behavior change out of scope for a "cheap,
//      independent, one-file" Slice 0 item.
//
// Per the migration plan's own gate: item 6 is PULLED from Slice 0.
// `classifyRequestedProperty` is NOT deleted. A real unification is future
// work, gated behind a to-be-added dev/test-scoped flag
// (NATIVELY_REQUESTED_PROPERTY_UNIFY) once the name mismatch is resolved —
// not attempted here.
//
// This file is a permanent regression/documentation artifact: if a future
// change resolves the name mismatch and someone flips this parity check to
// green, that is exactly the signal item 6 is finally safe to land.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);

const { classifyRequestedProperty } = cjsRequire(
  path.resolve(repoRoot, 'dist-electron/electron/llm/customModeExecutionContract.js'),
);
const { detectRequestedProperty } = cjsRequire(
  path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/requestedPropertyDetector.js'),
);

// A corpus covering realistic property-bearing questions for each of the
// legacy classifier's 8 declared property values. `legacy` values below are
// live-derived (calling classifyRequestedProperty), not hardcoded
// expectations — the point of this test is to compare the two REAL
// classifiers, not to encode an assumption about what the legacy one
// "should" return.
const CORPUS_QUESTIONS = [
  'What phase of the project was this built in?',
  'What processor controls the robot?',
  'How much did this cost to build?',
  'Who funded this research?',
  'Which cloud provider was used for training?',
  'How many human participants were in the study?',
  'What was the size of the dataset?',
  'What accuracy did the model achieve?',
];

describe('item 6 gate: classifyRequestedProperty vs detectRequestedProperty parity', () => {
  test('the two classifiers do NOT agree on a metric/result question (legacy never reaches metric_or_result at all)', () => {
    const legacy = classifyRequestedProperty('What accuracy did the model achieve?');
    const canonical = detectRequestedProperty('What accuracy did the model achieve?');
    assert.equal(legacy, 'unknown', 'the legacy classifier has no reachable branch for metric_or_result');
    assert.equal(canonical, 'result_metric');
    assert.notEqual(
      legacy,
      canonical,
      'documents the known divergence between the legacy and canonical RequestedProperty classifiers',
    );
  });

  test('parity corpus: full agreement fails (documents item 6 is correctly pulled from Slice 0)', () => {
    const results = CORPUS_QUESTIONS.map((q) => ({
      q,
      legacy: classifyRequestedProperty(q),
      canonical: detectRequestedProperty(q),
    }));
    const mismatches = results.filter(({ legacy, canonical }) => legacy !== canonical);

    // At minimum the metric/result question must mismatch (legacy: 'unknown',
    // canonical: 'result_metric') — this is the required parity gate failing,
    // which is why item 6 does not ship in this slice.
    assert.ok(
      mismatches.length >= 1,
      'expected at least the documented metric/result question to mismatch',
    );
    assert.ok(
      mismatches.some((m) => m.q === 'What accuracy did the model achieve?'),
    );
  });

  test('classifyRequestedProperty is still present and in use (NOT deleted — item 6 pulled per the parity gate)', () => {
    assert.equal(typeof classifyRequestedProperty, 'function');
  });
});
