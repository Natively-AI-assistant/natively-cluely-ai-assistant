// F-501 regression test (audit/autopilot-2026-08-18).
//
// Seminar Mode's strictness contract (evidence 'required' + onNoEvidence
// 'say_not_found_then_answer_general', which drives the "Not in your reference
// files" preamble) was unreachable. TurnPlanner selects it on
// `sourceContract.templateType === 'seminar'`, but ModeSourceContract has NO
// templateType field — only seededForTemplateType — and IntelligenceEngine
// built its frozen snapshot from `rawSnapshotSourceContract.templateType`,
// which therefore always resolved to undefined. The real value sits one object
// away on the mode info the contract was snapshotted from. Seminar routed
// correctly (MODE_CONTEXT_PROFILES still mapped it to lecture_answer) but was
// never strict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const { planTurn } = await import(path.join(root, 'dist-electron/electron/llm/TurnPlanner.js'));

const availability = {
  hasReferenceFiles: true, hasProfileFacts: false, hasJobDescription: false,
  hasLiveTranscript: true, hasMeetingRag: false,
};

test('a seminar contract resolves the STRICT grounding profile', () => {
  const plan = planTurn({
    question: 'What did the paper conclude?',
    availability,
    sourceContract: { sourceAuthority: 'reference_files_primary', templateType: 'seminar' },
  });
  assert.equal(plan.groundingProfile?.evidencePreference, 'required');
  assert.equal(plan.groundingProfile?.onNoEvidence, 'say_not_found_then_answer_general');
});

test('strictness does NOT leak to other modes', () => {
  const plan = planTurn({
    question: 'What did the paper conclude?',
    availability,
    sourceContract: { sourceAuthority: 'reference_files_primary' },
  });
  assert.equal(plan.groundingProfile?.evidencePreference, 'preferred',
    'the 7 built-in modes must keep the permissive default');
});

test('IntelligenceEngine sources templateType from the MODE, not the contract', () => {
  const engine = fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8');
  const i = engine.indexOf('const snapshotSourceContract');
  assert.notEqual(i, -1, 'snapshot contract construction not found');
  const block = engine.slice(i, i + 1800);
  assert.ok(
    /templateType:\s*\(snapshotModeInfo as any\)\?\.templateType/.test(block),
    'the snapshot must take templateType from snapshotModeInfo — ModeSourceContract has no such field, so reading it off the contract makes the seminar branch permanently unreachable (F-501)'
  );
});
