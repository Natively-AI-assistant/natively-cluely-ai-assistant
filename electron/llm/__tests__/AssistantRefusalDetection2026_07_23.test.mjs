// Regression tests for isAssistantRefusal (electron/llm/documentGroundedPrompt.ts).
//
// Root-cause fix (2026-07-23, Context OS investigation): the false-refusal
// detector used to scan the ENTIRE answer text for refusal-shaped phrases with
// no notion of WHO the phrase is about. An answer that legitimately describes
// a third party (a robot, a tool, the document itself) using refusal-shaped
// language — "the robot cannot confirm the object is present", "the tool must
// not guess when unavailable" — tripped the same detector as an actual
// assistant decline ("I could not find that..."), risking a false regen that
// discarded a correct, grounded answer. This file proves the fix: the
// canonical isAssistantRefusal only counts a refusal as the ASSISTANT'S OWN
// decline when it leads the answer with a first-person/implicit subject, not
// when a third-party subject is named in the same clause.

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
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'refusal-dist-'));
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(target, 'node_modules'), 'dir');
  try { execSync(`node node_modules/.bin/tsc -p electron/tsconfig.json --outDir ${target}`, { cwd: repoRoot, stdio: 'pipe' }); } catch { /* expected partial */ }
  return target;
})();

const cjsRequire = createRequire(import.meta.url);
const mod = cjsRequire(path.resolve(distDir, 'electron/llm/documentGroundedPrompt.js'));
const { isAssistantRefusal } = mod;

// ── Genuine assistant refusals — must be detected ──────────────────────────

test('isAssistantRefusal: detects the system canonical refusal string', () => {
  assert.equal(
    isAssistantRefusal('I could not find that in the retrieved sections of the document.'),
    true,
  );
});

test('isAssistantRefusal: detects a first-person "I could not find" decline', () => {
  assert.equal(
    isAssistantRefusal('I could not find that specific detail in the retrieved sections.'),
    true,
  );
});

test('isAssistantRefusal: detects a leading "not mentioned" with no explicit subject', () => {
  assert.equal(
    isAssistantRefusal('Not mentioned in the uploaded material.'),
    true,
  );
});

test('isAssistantRefusal: detects "This is not directly mentioned in the uploaded material" (property-validator canonical string)', () => {
  assert.equal(
    isAssistantRefusal('This is not directly mentioned in the uploaded material.'),
    true,
  );
});

// ── Legitimate answers describing a third party — must NOT be flagged ─────

test('isAssistantRefusal: does NOT flag a robot/tool refusal described in the answer (Reasoning Tool symptom)', () => {
  assert.equal(
    isAssistantRefusal('The Reasoning Tool should not guess when an object cannot be confirmed in the scene; instead it queries the perception system or another agent.'),
    false,
  );
});

test('isAssistantRefusal: does NOT flag "the robot cannot confirm" as an assistant decline', () => {
  assert.equal(
    isAssistantRefusal('If the object cannot be confirmed, the robot should not execute the action and must query perception again.'),
    false,
  );
});

test('isAssistantRefusal: does NOT flag a third-party subject named before "not mentioned"', () => {
  assert.equal(
    isAssistantRefusal('The safety protocol states that the exact position is not mentioned without a prior inspection step.'),
    false,
  );
});

test('isAssistantRefusal: does NOT flag a factual research sentence using "could not find"', () => {
  assert.equal(
    isAssistantRefusal('Researchers could not find a viable solution, leading to the proposed AgenticVLA framework.'),
    false,
  );
});

test('isAssistantRefusal: does NOT flag a mid-answer clause after the answer already stated content', () => {
  assert.equal(
    isAssistantRefusal('The Self-Awareness Tool uses Gemma 3 12B to verify scene presence. The exact confidence threshold is not specified in this excerpt, but the tool keeps the robot at rest until the object is detected.'),
    false,
  );
});

// ── Edge cases ──────────────────────────────────────────────────────────────

test('isAssistantRefusal: empty answer is not a refusal', () => {
  assert.equal(isAssistantRefusal(''), false);
});

test('isAssistantRefusal: a normal factual answer with no refusal phrase is not flagged', () => {
  assert.equal(
    isAssistantRefusal('The Self-Awareness Tool is powered by Gemma 3 12B and verifies scene presence before allowing the robot to act.'),
    false,
  );
});
