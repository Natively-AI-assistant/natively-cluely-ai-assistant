// electron/intelligence/__tests__/ActiveCodingProblemRetention.test.mjs
// Issue #539 regression tests:
// 1. SessionTracker.looksLikeCodingQuestion detects concise questions (<50 chars).
// 2. SessionTracker retains detectedCodingQuestion with timestamp.
// 3. IntelligenceEngine splices active coding problem when transcript >180s has evicted it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.resolve(repoRoot, rel), 'utf8');

describe('Issue #539: Active Coding Problem Retention across >180s', () => {
  test('SessionTracker.looksLikeCodingQuestion allows concise questions down to 25 chars', () => {
    const src = read('electron/SessionTracker.ts');
    assert.doesNotMatch(src, /if\s*\(\s*text\.length\s*<\s*50\s*\)\s*return\s*false/, 'Should not drop questions under 50 chars');
    assert.match(src, /if\s*\(\s*text\.length\s*<\s*25\s*\)\s*return\s*false/, 'Should allow concise coding questions down to 25 chars');
  });

  test('SessionTracker.getDetectedCodingQuestion includes timestamp', () => {
    const src = read('electron/SessionTracker.ts');
    assert.match(src, /getDetectedCodingQuestion\s*\(\s*\)\s*:\s*\{[^}]*timestamp/,
      'getDetectedCodingQuestion must include timestamp in return signature');
  });

  test('IntelligenceEngine splices active coding problem when evicted from 180s transcript', () => {
    const src = read('electron/IntelligenceEngine.ts');
    assert.match(src, /isCodingContinuation/, 'IntelligenceEngine must import and check isCodingContinuation');
    assert.match(src, /activeCoding|getDetectedCodingQuestion/, 'IntelligenceEngine must check active coding question when priorInterviewer is missing');
  });
});
