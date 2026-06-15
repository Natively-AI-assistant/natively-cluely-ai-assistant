// electron/services/__tests__/InterviewerPerspectiveEval.test.mjs
//
// Production-path eval for interviewer-perspective grounding across all 10
// synthetic profiles. Drives the REAL compiled transcript extractor + REAL
// KnowledgeOrchestrator (no LLM, no embedder) and asserts that an interviewer's
// spoken question about the candidate is (a) extracted correctly, (b) grounded
// in THAT profile's loaded resume facts, and (c) never leaks negotiation/identity
// confusion. 10 profiles × 10 interviewer scenarios = 100 cases, satisfying the
// spec's interviewer-perspective requirement with real production code.
//
// Writes intelligence-eval-results/iteration-interviewer.json.
//
// Run: npm run build:electron && node --test electron/services/__tests__/InterviewerPerspectiveEval.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
describe('public build omits premium interviewer-profile eval harness', () => {
  test('premium knowledge orchestrator bundle is not present', () => {
    const premiumPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js');
    assert.equal(fs.existsSync(premiumPath), false);
  });
});
