// electron/llm/__tests__/SplitTurnCodingExtractor.test.mjs
// Issue #539 regression tests:
// 1. extractLatestQuestion joins contiguous interviewer turns to retain full constraints.
// 2. deduplicateEchoedSegments drops duplex acoustic echo between mic and speaker.
// 3. isCodingContinuation handles language specifications and action continuations.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.resolve(repoRoot, rel), 'utf8');

describe('Issue #539: Split-turn interviewer joining, echo deduplication, and coding continuations', () => {
  test('codingFollowup.ts BARE_CODE_TOKENS includes programming languages', () => {
    const src = read('electron/llm/codingFollowup.ts');
    const match = src.match(/const BARE_CODE_TOKENS = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(match, 'BARE_CODE_TOKENS must exist in codingFollowup.ts');
    const tokens = match[1];

    assert.ok(tokens.includes('python'), 'Must include python');
    assert.ok(tokens.includes('cpp'), 'Must include cpp');
    assert.ok(tokens.includes('java'), 'Must include java');
    assert.ok(tokens.includes('typescript'), 'Must include typescript');
    assert.ok(tokens.includes('javascript'), 'Must include javascript');
  });

  test('codingFollowup.ts CONTINUATION_LOOSE_RE includes implement, encrypt, and coding actions', () => {
    const src = read('electron/llm/codingFollowup.ts');
    const match = src.match(/const CONTINUATION_LOOSE_RE =\s*(\/[^/]+\/[a-z]*);/);
    assert.ok(match, 'CONTINUATION_LOOSE_RE must exist in codingFollowup.ts');
    const regexStr = match[1];

    assert.ok(regexStr.includes('implement'), 'Must include implement');
    assert.ok(regexStr.includes('encrypt'), 'Must include encrypt');
  });

  test('transcriptCleaner.ts defines and exports deduplicateEchoedSegments', () => {
    const src = read('electron/llm/transcriptCleaner.ts');
    assert.match(src, /export function deduplicateEchoedSegments\s*\(/, 'Must export deduplicateEchoedSegments');
    assert.match(src, /deduplicateEchoedSegments\s*\(\s*cleaned\s*\)/, 'prepareTranscriptForWhatToAnswer must call deduplicateEchoedSegments');
  });

  test('transcriptQuestionExtractor.ts joins contiguous interviewer turns', () => {
    const src = read('electron/llm/transcriptQuestionExtractor.ts');
    assert.match(src, /while\s*\(\s*startIdx\s*>\s*0\s*&&\s*cleaned\[startIdx\s*-\s*1\]\.role\s*===\s*['"]interviewer['"]\)/,
      'Must walk backward across contiguous interviewer turns');
  });
});
