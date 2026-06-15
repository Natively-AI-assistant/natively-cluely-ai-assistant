import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const benchmarkPath = path.resolve(__dirname, '../../../benchmarks/profile-intelligence/answer_quality_judge.ts');
const manualPath = path.resolve(__dirname, '../manualProfileIntelligence.ts');
const promptPath = path.resolve(__dirname, '../prompts.ts');

test('public build no longer depends on the removed answer-quality benchmark harness', () => {
  assert.equal(fs.existsSync(benchmarkPath), false);
});

test('manual profile path still guards assistant-meta identity asks', () => {
  const source = fs.readFileSync(manualPath, 'utf8');
  assert.match(source, /isAssistantIdentityQuestion/);
  assert.match(source, /if \(isAssistantIdentityQuestion\(question\)\) return null;/);
});

test('system prompt identity uses OpenOffer wording', () => {
  const source = fs.readFileSync(promptPath, 'utf8');
  assert.match(source, /OpenOffer/);
});
