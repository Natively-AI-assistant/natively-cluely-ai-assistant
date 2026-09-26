// electron/services/__tests__/ModeRetrievalIsolation.test.mjs
//
// Verifies the retriever's contract: it operates exclusively on the file
// list it is handed. Even if other modes exist in the database, the active
// mode's retrieval is computed from the active mode's customContext + the
// active mode's reference files only.
//
// We also confirm the chunk-trust signal: the retrieved context block always
// carries the `reference_grounding_guard` so downstream prompts see the
// "untrusted evidence" marker.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runScenario, makeMode, asReferenceFiles } from '../../../tests/utils/scenarioRunner.mjs';
import { loadReferenceFiles, SENTINELS, foreignSentinels } from '../../../tests/utils/referenceFileFactory.mjs';

describe('Retrieval isolation — only active mode files contribute', () => {
  test('only-active-mode-files-passed: foreign sentinels are absent', () => {
    const mode = makeMode('mode_sales', 'sales', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('sales'));
    const result = runScenario({
      mode,
      files,
      query: 'how do we compare to Cluely on reference files',
    });
    for (const phrase of foreignSentinels('sales')) {
      assert.ok(
        !result.formattedContext.includes(phrase),
        `Sales retrieval must not include foreign sentinel: "${phrase}"`
      );
    }
  });

  test('grounding guard is present in every retrieval that produces snippets', () => {
    const mode = makeMode('mode_general', 'general', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('general'));
    const result = runScenario({
      mode,
      files,
      query: 'what is our Q1 ARR run rate for the Natively pilot',
      transcript: 'Founder: what is our Q1 ARR run rate for the pilot accounts? It should be in the metrics sheet.',
    });
    assert.ok(result.snippets.length > 0, 'Test data should produce at least one snippet');
    assert.ok(
      result.formattedContext.includes('<evidence_use_rule>'),
      'Grounding guard envelope must wrap retrieved snippets'
    );
  });

  test('fallback path emits empty formattedContext and usedFallback=true when query overlaps with nothing', () => {
    const mode = makeMode('mode_general', 'general', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('general'));
    const result = runScenario({
      mode,
      files,
      query: 'zzzqxqz unrelated nonsense terms that no fixture mentions',
    });
    assert.equal(result.usedFallback, true);
    assert.equal(result.formattedContext, '');
  });

  test('customContext is treated as a retrievable source alongside files', () => {
    const customContext = 'Founder note: pricing changes effective May 30 — internal-only.';
    const mode = makeMode('mode_general', 'general', customContext);
    const files = asReferenceFiles(mode.id, loadReferenceFiles('general'));
    const result = runScenario({
      mode,
      files,
      query: 'are there any pricing changes coming up',
    });
    assert.ok(
      result.snippets.some(s => s.sourceType === 'custom_context'),
      'customContext should be retrievable when the query overlaps with it'
    );
  });

  test('snippet source identity is preserved per chunk', () => {
    const mode = makeMode('mode_team', 'team-meet', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('team-meet'));
    const result = runScenario({
      mode,
      files,
      query: 'INC-119 root cause and mitigation',
    });
    assert.ok(result.snippets.length > 0);
    for (const s of result.snippets) {
      assert.ok(s.sourceId, 'Each snippet must carry a sourceId for downstream citation');
      assert.ok(['reference_file', 'custom_context'].includes(s.sourceType));
    }
  });

  test('token budget honored — selecting fewer chunks rather than exceeding budget', () => {
    const mode = makeMode('mode_lecture', 'lecture', '');
    const files = asReferenceFiles(mode.id, loadReferenceFiles('lecture'));
    const tight = runScenario({
      mode,
      files,
      query: 'Greens function harmonic functions exam Laplacian',
      tokenBudget: 60,
    });
    const wide = runScenario({
      mode,
      files,
      query: 'Greens function harmonic functions exam Laplacian',
      tokenBudget: 4000,
    });
    assert.ok(
      tight.snippets.length <= wide.snippets.length,
      `Tight budget (${tight.snippets.length} snippets) should yield ≤ wide budget (${wide.snippets.length} snippets)`
    );
  });
});
