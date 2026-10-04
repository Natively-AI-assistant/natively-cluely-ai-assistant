// The rerank's confidence gate reads the PRE-E11 answerability (2026-10-04).
// E11 made a name shared by the question and a chunk worth more in the ranking.
// Read by the gate too, the higher top score satisfied it on most heard turns
// and the bundled rerank stopped being awaited: on the dev run the time from
// the hotkey to the provider request fell from a median of ~500 ms to 24 ms.
// The owner decided on 2026-10-03 that the awaited rerank stays as it is, so
// the gate keeps the old score and only the ranking uses the new one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const D = await import(pathToFileURL(path.join(root, 'dist-electron/electron/llm/documentGroundedPrompt.js')).href);
const hybridSrc = fs.readFileSync(path.join(root, 'electron/services/modes/ModeHybridRetriever.ts'), 'utf8');
const Q = 'What code opens the gate at the Ashbrook depot?';
const RIGHT = "Operations reference Ashbrook Rollout risk template draft checklist team migration summary staffing. The Ashbrook depot's gate release code is ASHBROOK-N6-3000.";
const OTHER = "Operations reference Belbrook The Belbrook depot's gate release code is BELBROOK-N6-3017.";

describe('gateScore is the pre-E11 formula', () => {
  test('flat 0.08 per entity hit, capped at 0.25, minus 0.18 for an overview word in the first 220 chars', () => {
    const right = D.computeDocumentAnswerabilityScore({ question: Q, candidateText: RIGHT });
    const other = D.computeDocumentAnswerabilityScore({ question: Q, candidateText: OTHER });
    assert.ok(Math.abs(right.gateScore - 0.07) < 1e-9, `right chunk gate ${right.gateScore}`);   // 0.25 − 0.18 ("summary")
    assert.ok(Math.abs(other.gateScore - 0.24) < 1e-9, `other chunk gate ${other.gateScore}`);   // 3 × 0.08
  });
  test('the RANKING score is the new one: the named chunk leads', () => {
    const right = D.computeDocumentAnswerabilityScore({ question: Q, candidateText: RIGHT });
    const other = D.computeDocumentAnswerabilityScore({ question: Q, candidateText: OTHER });
    assert.ok(right.score > other.score + 0.1, `${right.score} vs ${other.score}`);
  });
  test('common-word hits: 0.08 each for the gate (as before), 0.05 each for the ranking', () => {
    const a = D.computeDocumentAnswerabilityScore({ question: 'how long are audit logs kept', candidateText: 'Audit logs are kept for 400 days in cold storage.' });
    assert.ok(Math.abs(a.gateScore - 0.24) < 1e-9, `gate ${a.gateScore}`);
    assert.ok(Math.abs(a.score - 0.15) < 1e-9, `ranking ${a.score}`);
  });
});

describe('wiring', () => {
  test('the confidence gate reads answerabilityGateScore, over the whole candidate list', () => {
    assert.match(hybridSrc, /Math\.max\(0, c\.answerabilityGateScore \?\? c\.answerabilityScore \?\? 0\)/);
    assert.match(hybridSrc, /const gateScores = sorted\.map\(scoreOf\)\.sort\(\(x, y\) => y - x\);/);
    assert.match(hybridSrc, /answerabilityGateScore: a\.gateScore \+ targetBoost/);
  });
  test('structural boosts are added to both scores', () => {
    assert.match(hybridSrc, /answerabilityGateScore: \(c\.answerabilityGateScore \?\? c\.answerabilityScore \?\? 0\) \+ 0\.6/);
    assert.match(hybridSrc, /answerabilityGateScore: \(candidate\.answerabilityGateScore \?\? candidate\.answerabilityScore \?\? 0\) \+ 1\.2/);
  });
});
