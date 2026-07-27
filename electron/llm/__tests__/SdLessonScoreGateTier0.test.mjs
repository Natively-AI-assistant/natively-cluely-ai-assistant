// electron/llm/__tests__/SdLessonScoreGateTier0.test.mjs
//
// Post-gate LESSON score gate + Deep Dive/NFR section preference (SPEC 02).
// Pure helpers only — WTA inject omit/inject is covered by wiring + existing seams.
//
// Run: npm run build:electron && node --test electron/llm/__tests__/SdLessonScoreGateTier0.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distLlm = path.resolve(__dirname, '../../../dist-electron/electron/llm');

const scoreGate = await import(pathToFileURL(path.join(distLlm, 'sdLessonScoreGate.js')).href);

describe('applyScoreGate (post-gate ~0.5)', () => {
  test('excludes chunks below 0.5 when sdPhase=post_requirements', () => {
    const chunks = [
      { text: '## Deep Dives\nweak', similarity: 0.35 },
      { text: '## Deep Dives\nstrong', similarity: 0.72 },
      { text: '## Understanding the Problem\nmid', similarity: 0.49 },
    ];
    const out = scoreGate.applyScoreGate(chunks, 'post_requirements');
    assert.equal(out.length, 1);
    assert.equal(out[0].text, '## Deep Dives\nstrong');
    assert.equal(out[0].similarity, 0.72);
  });

  test('keeps chunks at exactly 0.5', () => {
    const chunks = [{ text: 'boundary', similarity: 0.5 }];
    const out = scoreGate.applyScoreGate(chunks, 'post_requirements');
    assert.equal(out.length, 1);
  });

  test('all below threshold → empty (omit seam)', () => {
    const chunks = [
      { text: 'a', similarity: 0.25 },
      { text: 'b', similarity: 0.49 },
    ];
    assert.deepEqual(scoreGate.applyScoreGate(chunks, 'post_requirements'), []);
  });

  test('requirements phase is identity (sibling gate owns filtering)', () => {
    const chunks = [
      { text: '## Understanding the Problem\nclarify', similarity: 0.3 },
      { text: '## Deep Dives\nskip-me-in-req', similarity: 0.9 },
    ];
    const out = scoreGate.applyScoreGate(chunks, 'requirements');
    assert.equal(out, chunks);
    assert.equal(out.length, 2);
  });
});

describe('preferDeepDiveSections (post-gate sort, not hard filter)', () => {
  test('orders Deep Dive / NFR ahead of Understanding / FR', () => {
    const chunks = [
      { text: '## Understanding the Problem\nClarify scope.\n', similarity: 0.8 },
      { text: '## Functional Requirements\nCreate short links.\n', similarity: 0.81 },
      { text: '## Potential Deep Dives\nBase62 encoding tradeoffs.\n', similarity: 0.7 },
      { text: '### Non-Functional Requirements\nLow latency redirects.\n', similarity: 0.75 },
    ];
    const out = scoreGate.preferDeepDiveSections(chunks, 'post_requirements');
    assert.equal(out.length, 4, 'preference must not hard-exclude');
    const joined = out.map((c) => c.text).join('\n---\n');
    const deepIdx = joined.indexOf('Base62 encoding tradeoffs');
    const nfrIdx = joined.indexOf('Low latency redirects');
    const undIdx = joined.indexOf('Clarify scope');
    const frIdx = joined.indexOf('Create short links');
    assert.ok(deepIdx >= 0 && nfrIdx >= 0 && undIdx >= 0 && frIdx >= 0);
    assert.ok(Math.min(deepIdx, nfrIdx) < Math.min(undIdx, frIdx));
  });

  test('deprioritized-only set still returns all chunks (no omit)', () => {
    const chunks = [
      { text: '## Understanding the Problem\nOnly early section.\n', similarity: 0.9 },
      { text: '## Functional Requirements\nStill injectable.\n', similarity: 0.85 },
    ];
    const out = scoreGate.preferDeepDiveSections(chunks, 'post_requirements');
    assert.equal(out.length, 2);
    assert.match(out.map((c) => c.text).join('\n'), /Only early section/);
    assert.match(out.map((c) => c.text).join('\n'), /Still injectable/);
  });

  test('requirements phase is identity', () => {
    const chunks = [
      { text: '## Understanding the Problem\na', similarity: 0.9 },
      { text: '## Deep Dives\nb', similarity: 0.9 },
    ];
    assert.equal(scoreGate.preferDeepDiveSections(chunks, 'requirements'), chunks);
  });
});
