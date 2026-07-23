// Regression tests for the named-entity claim-to-evidence check added to
// detectUnsupportedDocumentAnswer (electron/llm/documentGroundedPrompt.ts,
// root-cause fix, 2026-07-23).
//
// Root cause: the real benchmark accepted "Model: AgenticVLA powers the
// Self-Awareness Tool" when the source evidence names "Gemma 3 12B" as the
// Self-Awareness Tool's visual backbone — meanwhile grounded, CORRECT
// questions about the Reasoning Tool and the complete AgenticVLA pipeline
// were rejected as false refusals. The prior validator only checked NUMERIC
// claims against evidence (detectUnsupportedDocumentAnswer's original scope);
// there was no factual-entailment check for named entities/model names at
// all — only shape/refusal checks. This closes that gap.

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
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'entityclaim-dist-'));
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(target, 'node_modules'), 'dir');
  try { execSync(`node node_modules/.bin/tsc -p electron/tsconfig.json --outDir ${target}`, { cwd: repoRoot, stdio: 'pipe' }); } catch { /* expected partial */ }
  return target;
})();

const cjsRequire = createRequire(import.meta.url);
const mod = cjsRequire(path.resolve(distDir, 'electron/llm/documentGroundedPrompt.js'));
const { extractNamedEntityClaims, detectUnsupportedDocumentAnswer, validateDocumentGroundedAnswer } = mod;

const SELF_AWARENESS_BLOCK = 'The Self-Awareness Tool uses Gemma 3 12B as its visual backbone. It identifies visible objects and compares frames over time to detect execution failures. It keeps the robot in the rest position until the target object is detected.';

// ── extractNamedEntityClaims ─────────────────────────────────────────────

test('extractNamedEntityClaims: extracts digit-bearing model names', () => {
  const claims = extractNamedEntityClaims('The Self-Awareness Tool uses Gemma 3 12B as its visual backbone.');
  assert.ok(claims.has('gemma 3 12b'), `expected gemma 3 12b in ${JSON.stringify([...claims])}`);
});

test('extractNamedEntityClaims: extracts CamelCase model names', () => {
  const claims = extractNamedEntityClaims('AgenticVLA powers the Self-Awareness Tool.');
  assert.ok(claims.has('agenticvla'), `expected agenticvla in ${JSON.stringify([...claims])}`);
});

test('extractNamedEntityClaims: does NOT flag ordinary Title-Case prose', () => {
  const claims = extractNamedEntityClaims('The Reasoning Tool is responsible for decomposing complex commands.');
  assert.equal(claims.has('reasoning tool'), false, 'plain Title-Case phrases without digits/CamelCase must not be flagged as entity claims');
});

// ── detectUnsupportedDocumentAnswer: the real symptom ──────────────────────

test('detectUnsupportedDocumentAnswer: flags the wrong model name (AgenticVLA vs Gemma 3 12B — the real symptom)', () => {
  const r = detectUnsupportedDocumentAnswer({
    answer: 'Model: AgenticVLA powers the Self-Awareness Tool.',
    retrievedBlock: SELF_AWARENESS_BLOCK,
  });
  assert.equal(r.unsupported, true);
  assert.equal(r.reason, 'unsupported_named_entity');
  assert.ok(r.unsupportedTokens.includes('agenticvla'), `expected agenticvla flagged, got ${JSON.stringify(r.unsupportedTokens)}`);
});

test('detectUnsupportedDocumentAnswer: does NOT flag the correct model name', () => {
  const r = detectUnsupportedDocumentAnswer({
    answer: 'The Self-Awareness Tool is powered by Gemma 3 12B.',
    retrievedBlock: SELF_AWARENESS_BLOCK,
  });
  assert.equal(r.unsupported, false, `correct entity must not be flagged, got ${JSON.stringify(r)}`);
});

test('detectUnsupportedDocumentAnswer: does not flag an answer with no named-entity claims', () => {
  const r = detectUnsupportedDocumentAnswer({
    answer: 'It identifies visible objects and keeps the robot at rest until the object is detected.',
    retrievedBlock: SELF_AWARENESS_BLOCK,
  });
  assert.equal(r.unsupported, false);
});

test('detectUnsupportedDocumentAnswer: numeric check still takes priority and reports its own reason', () => {
  const r = detectUnsupportedDocumentAnswer({
    answer: 'The success rate was 91%.',
    retrievedBlock: 'The success rate was 44%.',
  });
  assert.equal(r.unsupported, true);
  assert.equal(r.reason, 'unsupported_numeric_value');
});

// ── validateDocumentGroundedAnswer: end-to-end wiring ──────────────────────

test('validateDocumentGroundedAnswer: rejects the wrong-model-name answer end-to-end', () => {
  const result = validateDocumentGroundedAnswer({
    question: 'Which model powers the Self-Awareness Tool?',
    answer: 'Model: AgenticVLA powers the Self-Awareness Tool.',
    retrievedBlock: SELF_AWARENESS_BLOCK,
    answerType: 'list_answer',
  });
  assert.equal(result.ok, false, 'the wrong-model-name answer must fail validation end-to-end');
  assert.equal(result.reason, 'unsupported_named_entity');
});

test('validateDocumentGroundedAnswer: accepts the correct model name end-to-end', () => {
  const result = validateDocumentGroundedAnswer({
    question: 'Which model powers the Self-Awareness Tool?',
    answer: 'The Self-Awareness Tool is powered by Gemma 3 12B, which identifies visible objects and detects execution failures.',
    retrievedBlock: SELF_AWARENESS_BLOCK,
    answerType: 'list_answer',
  });
  assert.equal(result.ok, true, `correct answer must pass, got reason=${result.reason}`);
});
