// Regression tests for hasMultipleSubQuestions / classifyDocumentQuestionShape
// / detectIncompleteSubQuestionAnswer (electron/llm/documentGroundedPrompt.ts).
//
// Root cause (Context OS investigation, 2026-07-23): classifyDocumentQuestionShape
// picks exactly ONE DocumentQuestionShape via first-match regex ordering. The
// real benchmark's semantic-relationship question —
//   "In the semantic-relationship benchmark, what instruction was given, why
//    was it a long-horizon task, how did each system behave, and what
//    success rate did AgenticVLA achieve?"
// — has FOUR distinct asks but was classified as `exact_numeric_answer`
// because "success rate" matched looksLikeSpec. Downstream, the numeric-only
// completeness check had no way to notice the answer dropped the
// instruction/reason/behavior clauses, so a short answer restating only the
// success rate ("44%") passed validation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const distDir = (() => {
  const bundled = path.resolve(repoRoot, 'dist-electron/electron/llm/documentGroundedPrompt.js');
  if (fs.existsSync(bundled)) return path.resolve(repoRoot, 'dist-electron');
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'multipart-dist-'));
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(target, 'node_modules'), 'dir');
  try { execSync(`node node_modules/.bin/tsc -p electron/tsconfig.json --outDir ${target}`, { cwd: repoRoot, stdio: 'pipe' }); } catch { /* expected partial */ }
  return target;
})();

const cjsRequire = createRequire(import.meta.url);
const mod = cjsRequire(path.resolve(distDir, 'electron/llm/documentGroundedPrompt.js'));
const { hasMultipleSubQuestions, classifyDocumentQuestionShape, detectIncompleteSubQuestionAnswer } = mod;

const SEMANTIC_RELATIONSHIP_QUESTION = 'In the semantic-relationship benchmark, what instruction was given, why was it a long-horizon task, how did each system behave, and what success rate did AgenticVLA achieve?';

// ── hasMultipleSubQuestions ─────────────────────────────────────────────────

test('hasMultipleSubQuestions: detects the real 4-clause semantic-relationship question', () => {
  assert.equal(hasMultipleSubQuestions(SEMANTIC_RELATIONSHIP_QUESTION), true);
});

test('hasMultipleSubQuestions: does NOT flag a single-clause spec question', () => {
  assert.equal(hasMultipleSubQuestions('What GPU was used for training?'), false);
});

test('hasMultipleSubQuestions: does NOT flag a single-clause list question', () => {
  assert.equal(hasMultipleSubQuestions('What are the two research questions?'), false);
});

test('hasMultipleSubQuestions: detects multiple question marks', () => {
  assert.equal(hasMultipleSubQuestions('What model powers the tool? What are its responsibilities?'), true);
});

test('hasMultipleSubQuestions: does NOT flag a normal definitional question', () => {
  assert.equal(hasMultipleSubQuestions('What is a Vision-Language-Action model?'), false);
});

// ── classifyDocumentQuestionShape ───────────────────────────────────────────

test('classifyDocumentQuestionShape: the semantic-relationship question is NOT exact_numeric_answer', () => {
  const shape = classifyDocumentQuestionShape(SEMANTIC_RELATIONSHIP_QUESTION);
  assert.notEqual(shape, 'exact_numeric_answer', 'a 4-clause compound question must not collapse to a single-number answer shape');
  assert.equal(shape, 'list_answer', 'a compound question should route to list_answer, whose completeness semantics fit multi-clause coverage');
});

test('classifyDocumentQuestionShape: a genuine single-clause spec question is still exact_numeric_answer', () => {
  assert.equal(classifyDocumentQuestionShape('What GPU memory was used during inference?'), 'exact_numeric_answer');
});

// ── detectIncompleteSubQuestionAnswer ───────────────────────────────────────

test('detectIncompleteSubQuestionAnswer: flags an answer that only restates the numeric clause (the observed 959->182 char failure)', () => {
  const shortAnswer = 'The success rate of AgenticVLA on the "pick up the fruits" task was 44%, while the other models tested were not able to accomplish this level of complexity.';
  const r = detectIncompleteSubQuestionAnswer({
    question: SEMANTIC_RELATIONSHIP_QUESTION,
    answer: shortAnswer,
    answerIsRefusal: false,
  });
  assert.equal(r.incomplete, true, 'an answer that never mentions the instruction itself must be flagged incomplete');
});

test('detectIncompleteSubQuestionAnswer: does NOT flag a genuinely complete multi-part answer', () => {
  const fullAnswer = 'The instruction given was "put the fruits on the plate". It is long-horizon because the banana and grapes must be moved sequentially. Each system behaved differently: OpenVLA and finetuned OpenVLA-OFT failed to complete both-object sequentiality, while AgenticVLA decomposed the instruction into separate fruit actions. AgenticVLA achieved a 44% success rate.';
  const r = detectIncompleteSubQuestionAnswer({
    question: SEMANTIC_RELATIONSHIP_QUESTION,
    answer: fullAnswer,
    answerIsRefusal: false,
  });
  assert.equal(r.incomplete, false, `complete answer must not be flagged, missing=${JSON.stringify(r.missing)}`);
});

test('detectIncompleteSubQuestionAnswer: is a no-op for a single-clause question', () => {
  const r = detectIncompleteSubQuestionAnswer({
    question: 'What GPU was used for training?',
    answer: 'A single 96 GB VRAM GPU was used.',
    answerIsRefusal: false,
  });
  assert.equal(r.incomplete, false);
  assert.deepEqual(r.missing, []);
});

test('detectIncompleteSubQuestionAnswer: does not flag a refusal', () => {
  const r = detectIncompleteSubQuestionAnswer({
    question: SEMANTIC_RELATIONSHIP_QUESTION,
    answer: 'I could not find that in the retrieved sections of the document.',
    answerIsRefusal: true,
  });
  assert.equal(r.incomplete, false);
});
