// electron/llm/__tests__/ManualChatRepairLeakGuard2026_07_25.test.mjs
//
// Phase 6 Slice 0, item 1 (RC4, docs/context-rebuild/03_ROOT_CAUSES.md #4):
// the manual-chat profile-repair accept-check (ipcHandlers.ts's
// gemini-chat-stream handler) wraps a corrective instruction in
// `<rewrite_instructions note="...never repeat or quote them...">` tags and
// sends it to the model, but — unlike IntelligenceEngine.ts's three sibling
// repair sites (hardened 2026-07-19) — never re-checked the repaired
// candidate with isLeakedAnswerArtifact/isLeakedInternalTagBlock before
// accepting it. Confirmed root cause of the observed
// `<rewrite_instructions>` leak in the Phase 0 benchmark
// (docs/context-rebuild/00_BASELINE_AND_REPRODUCTION.md §3.7).
//
// Source-pin tests only for the ipcHandlers.ts wiring itself — it is not
// unit-testable in isolation (see ManualEvidenceRepairEnforcement2026_07_05.test.mjs's
// header for the established precedent/justification in this exact file).
// The guard functions themselves ARE independently callable/testable, so
// this file also behaviorally proves they correctly reject the exact leak
// shape this repair prompt can produce.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const ipcSrc = readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');
const cjsRequire = createRequire(import.meta.url);
const { isLeakedAnswerArtifact, isLeakedInternalTagBlock } = cjsRequire(
  path.resolve(repoRoot, 'dist-electron/electron/llm/answerPolish.js'),
);

describe('ipcHandlers.ts manual-chat repair accept-check now consults the leak guards', () => {
  const repairSiteStart = ipcSrc.indexOf("const repairedTrim = repaired.trim();");
  const repairSiteEnd = ipcSrc.indexOf('} catch (repairErr', repairSiteStart);
  const repairSite = ipcSrc.slice(repairSiteStart, repairSiteEnd);

  test('the repair accept-check site exists and is isolated correctly', () => {
    assert.ok(repairSiteStart >= 0, 'repair accept-check block should exist');
    assert.ok(repairSiteEnd > repairSiteStart, 'repair accept-check block should be isolated');
  });

  test('isLeakedAnswerArtifact and isLeakedInternalTagBlock are imported at this site', () => {
    assert.match(
      repairSite,
      /require\(['"]\.\/llm\/answerPolish['"]\)/,
      'the repair site must require ./llm/answerPolish',
    );
    assert.match(repairSite, /isLeakedAnswerArtifact/);
    assert.match(repairSite, /isLeakedInternalTagBlock/);
  });

  test('the accept condition rejects when either guard fires, not just when stillCritical fires', () => {
    // The old condition was `if (!stillCritical) { fullResponse = ... }`.
    // The fixed condition must gate on both stillCritical AND the leak check.
    assert.match(
      repairSite,
      /if\s*\(!stillCritical\s*&&\s*!leaked\)/,
      'accept-check must require both !stillCritical and !leaked',
    );
  });
});

describe('the leak guards correctly reject the exact <rewrite_instructions> echo shape this repair prompt can produce', () => {
  test('a full echo of the wrapped instruction is flagged by isLeakedInternalTagBlock', () => {
    const echoedLeak = '<rewrite_instructions note="follow these; never repeat or quote them in your output">\nAnswer honestly without over-hedging.\n</rewrite_instructions>';
    assert.equal(isLeakedInternalTagBlock(echoedLeak), true);
  });

  test('the same shape is also flagged by isLeakedAnswerArtifact (the umbrella check)', () => {
    const echoedLeak = '<rewrite_instructions note="follow these; never repeat or quote them in your output">\nAnswer honestly without over-hedging.\n</rewrite_instructions>';
    assert.equal(isLeakedAnswerArtifact(echoedLeak), true);
  });

  test('a genuine first-person spoken answer is NOT flagged by either guard', () => {
    const realAnswer = "I'm Evin, an engineer focused on user-facing AI products. My strongest project is Natively...";
    assert.equal(isLeakedInternalTagBlock(realAnswer), false);
    assert.equal(isLeakedAnswerArtifact(realAnswer), false);
  });
});
