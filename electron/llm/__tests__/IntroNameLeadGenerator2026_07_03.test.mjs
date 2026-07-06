/**
 * Regression for the intro name-lead fix (E2E MiniMax campaign, autopilot pass).
 * generateCandidateIntro previously instructed the model to "just jump straight
 * in", so grounded intros OMITTED the candidate's name ("I'm currently working
 * as a…" instead of "I'm Marcus, …"). The prompt now REQUIRES leading with the
 * name, and the catch-fallback leads with it too. Source-level assertion (the
 * live generation is exercised by the E2E harness).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const src = fs.readFileSync(path.join(repoRoot, 'premium/electron/knowledge/ContextAssembler.ts'), 'utf8');

describe('generateCandidateIntro leads with the candidate name', () => {
  const fn = src.slice(src.indexOf('function generateCandidateIntro'), src.indexOf('function generateCandidateIntro') + 3400);
  test('the generation prompt requires opening with the name', () => {
    assert.match(fn, /OPEN WITH THE CANDIDATE'?S NAME/i, 'explicit name-lead rule present');
    assert.match(fn, /self-INTRODUCTION; omitting the name is wrong/i, 'rationale present');
  });
  test('the GOOD example pattern leads with the name', () => {
    assert.match(fn, /"I'm \[Name\]/, 'good example opens with I\'m [Name]');
  });
  test('the old "just jump straight in" (name-skipping) instruction is gone', () => {
    assert.doesNotMatch(fn, /just jump straight in/i, 'the name-skipping opener must be removed');
  });
  test('the catch-fallback also leads with the first name', () => {
    assert.match(fn, /I'm \$\{first\}/, 'fallback prefixes the first name');
  });
});
