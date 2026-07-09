// Unit tests for the round-7 Failure-3 completeness detector
// (electron/llm/documentGroundedPrompt.ts). Proves the detector flags an
// incomplete numeric answer (a multi-value question where the answer dropped a
// value literally present in the retrieved block) and — critically — NEVER
// fabricates: the anti-fabrication guard rejects a re-ask that introduces a
// value not in the block. Mirrors the real C3/C4 seminar-mode failures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import Module from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// Compiled ESM/CJS from the bundled dist, or an isolated tsc tree.
const distDir = (() => {
  const bundled = path.resolve(repoRoot, 'dist-electron/electron/llm/documentGroundedPrompt.js');
  if (fs.existsSync(bundled)) return path.resolve(repoRoot, 'dist-electron');
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'dgcomplete-dist-'));
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(target, 'node_modules'), 'dir');
  try { execSync(`node node_modules/.bin/tsc -p electron/tsconfig.json --outDir ${target}`, { cwd: repoRoot, stdio: 'pipe' }); } catch { /* expected partial */ }
  return target;
})();

const cjsRequire = createRequire(import.meta.url);
const mod = cjsRequire(path.resolve(distDir, 'electron/llm/documentGroundedPrompt.js'));
const { detectIncompleteNumericAnswer, completenessRegenFabricates, extractNumericUnitTokens, questionAsksForSet } = mod;

// A retrieved-block fragment shaped like the real C3 GPU excerpts.
const C3_BLOCK = `
<snippet><text>[Section 3.3.2 | p35-38] The finetuning was conducted using a single GPU card with 96 GB of VRAM, with peak usage around 62 GB.</text></snippet>
<snippet><text>[Section 3.3.2 | p35-38] During inference the model maintained real-time responsiveness while occupying approximately 16 GB of VRAM.</text></snippet>
`;

test('detectIncompleteNumericAnswer: flags C3-style answer that gives 96GB but omits 16GB/62GB', () => {
  const r = detectIncompleteNumericAnswer({
    question: 'What GPU was used for training?',
    answer: 'The training used a single GPU card with 96 GB of VRAM.',
    retrievedBlock: C3_BLOCK,
    answerIsRefusal: false,
  });
  assert.equal(r.incomplete, true, 'should flag incomplete');
  assert.ok(r.missing.includes('16gb'), `missing should include 16gb, got ${JSON.stringify(r.missing)}`);
  assert.ok(r.missing.includes('62gb'), `missing should include 62gb, got ${JSON.stringify(r.missing)}`);
});

test('detectIncompleteNumericAnswer: does NOT flag a complete answer', () => {
  const r = detectIncompleteNumericAnswer({
    question: 'What GPU was used for training?',
    answer: 'A single 96 GB VRAM GPU was used; peak usage ~62 GB, and ~16 GB at inference.',
    retrievedBlock: C3_BLOCK,
    answerIsRefusal: false,
  });
  assert.equal(r.incomplete, false, `complete answer must not be flagged, missing=${JSON.stringify(r.missing)}`);
});

test('detectIncompleteNumericAnswer: does NOT flag a refusal (no downgrade of honest refusals)', () => {
  const r = detectIncompleteNumericAnswer({
    question: 'What GPU was used for training?',
    answer: 'I could not find that in the retrieved sections.',
    retrievedBlock: C3_BLOCK,
    answerIsRefusal: true,
  });
  assert.equal(r.incomplete, false);
});

test('detectIncompleteNumericAnswer: does NOT flag when the answer has no numeric value (prose)', () => {
  // A prose answer with zero number+unit tokens is not a numeric answer — the
  // completeness check must not fire (it targets dropped VALUES, not prose).
  const r = detectIncompleteNumericAnswer({
    question: 'What were the specifications?',
    answer: 'The system uses a humanoid robot with dual arms and cameras.',
    retrievedBlock: C3_BLOCK,
    answerIsRefusal: false,
  });
  assert.equal(r.incomplete, false);
});

test('detectIncompleteNumericAnswer: only fires for SET/multi-value questions', () => {
  // A single-fact question ("what is the height?") is not a set question.
  assert.equal(questionAsksForSet('What is the height of the robot?'), false);
  assert.equal(questionAsksForSet('What were the finetuning hyperparameters?'), true);
  assert.equal(questionAsksForSet('What were the success rates?'), true);
  const r = detectIncompleteNumericAnswer({
    question: 'What is the height of the robot?',
    answer: 'The robot is 1.18 m tall.',
    retrievedBlock: '<text>1.18 m tall, 55 kg weight, 19 DOF.</text>',
    answerIsRefusal: false,
  });
  assert.equal(r.incomplete, false, 'single-fact question must not trigger completeness');
});

test('completenessRegenFabricates: rejects a re-ask that invents a value not in the block', () => {
  // A regen that adds "128 GB" (not in the block) must be rejected — zero fabrication.
  assert.equal(
    completenessRegenFabricates('The GPU had 96 GB, 62 GB peak, 16 GB inference, and 128 GB cache.', C3_BLOCK),
    true,
    '128 GB is not in the block → must be flagged as fabrication',
  );
});

test('completenessRegenFabricates: accepts a re-ask that only surfaces in-block values', () => {
  assert.equal(
    completenessRegenFabricates('A single 96 GB GPU, ~62 GB peak, ~16 GB at inference.', C3_BLOCK),
    false,
    'all values are in the block → not fabrication',
  );
});

test('completenessRegenFabricates: catches a fabricated unitless COUNT not in the block (review LOW #1)', () => {
  // The block mentions "yellow banana and purple grapes" (2 objects) — a regen
  // claiming "5 objects" invents a count not in the block.
  const objBlock = '<text>The robot manipulated a yellow banana and purple grapes.</text>';
  assert.equal(
    completenessRegenFabricates('The robot used 5 objects in the tasks.', objBlock),
    true,
    '"5 objects" is a count not present in the block → fabrication',
  );
});

test('completenessRegenFabricates: does NOT flag a count that IS in the block', () => {
  const objBlock = '<text>The dataset consists of 480 episodes across 3 task categories.</text>';
  assert.equal(
    completenessRegenFabricates('There are 3 task categories and 480 episodes.', objBlock),
    false,
    'both counts appear in the block → not fabrication',
  );
});

test('extractNumericUnitTokens: normalizes units and separators', () => {
  const toks = extractNumericUnitTokens('96 GB, 96gb, 75,000 steps, 2e-4, 50 Hz, 0%');
  assert.ok(toks.has('96gb'));
  assert.ok(toks.has('75000steps'));
  assert.ok(toks.has('50hz'));
  assert.ok(toks.has('0%'));
});
