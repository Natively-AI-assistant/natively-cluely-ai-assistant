// electron/llm/__tests__/ManualChatVisionDeadline2026_09_06.test.mjs
//
// A screenshot turn in manual chat is served by the vision chain, whose
// measured first-token p50 is 5.6s and max 11.6s. Until 2026-09-06 this site
// kept the 7000ms text deadline that WTA had already replaced in e079cd4a, so
// roughly half of healthy vision turns were aborted and replaced with "The
// model did not produce an answer in time".

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const ipc = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');

describe('manual chat screenshot deadline', () => {
  test('a vision turn uses the vision-aware ceiling, gated on attached images', () => {
    const i = ipc.indexOf('isUsefulYet: () => manualFirstUseful');
    assert.ok(i > 0, 'manual-chat race site not found');
    const site = ipc.slice(Math.max(0, i - 900), i);
    assert.ok(/\(imagePaths\?\.length \?\? 0\) > 0\s*\?\s*totalHardTimeoutMs\(\{ isLocal: usingLocalLlm, isVisionTurn: true, viaServerCascade \}\)/.test(site),
      'vision turns must take totalHardTimeoutMs({ isVisionTurn: true })');
    // Prefix match, not the whole argument list. The property this test is named
    // for is "a non-vision turn takes the ANSWER-TYPE deadline, not the vision
    // ceiling" — the arity is incidental, and firstUsefulDeadlineMs has since
    // gained route arguments (isUserEndpoint, then the observed latency) so the
    // manual surface reads the same route table WTA does. Pinning the exact
    // 3-arg call made a deliberate signature extension look like a regression.
    assert.ok(/: firstUsefulDeadlineMs\(answerPlan\.answerType, usingLocalLlm, viaServerCascade[,)]/.test(site),
      'non-vision turns keep the answer-type deadline');
    assert.equal(/: totalHardTimeoutMs\(\{ isLocal: usingLocalLlm, isVisionTurn: true[\s\S]{0,80}?\n\s*isUsefulYet/.test(site), false,
      'the non-vision branch must not fall through to the vision ceiling');
  });
  test('totalHardTimeoutMs is imported where it is used', () => {
    assert.match(ipc, /raceStreamWithDeadline, firstUsefulDeadlineMs, totalHardTimeoutMs,/);
  });
});
