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

  // 2026-08-11 update: these two pins originally asserted an INLINE guard —
  // `require('./llm/answerPolish')` + `if (!stillCritical && !leaked)` — at the
  // manual repair site. The protection now lives in the SHARED acceptance
  // policy instead (electron/llm/repairAcceptance.ts, PR #427 §1.4, commit
  // e62e8524): `acceptRepairedAnswer` calls isLeakedAnswerArtifact internally
  // (which itself consults isLeakedInternalTagBlock) and additionally applies
  // the non-regression length floor, and it is the SAME policy the WTA path's
  // repair sites use — so the two paths can no longer drift apart, which is the
  // failure mode that produced the original leak. The pins below assert the
  // current wiring; the behavioural proof that the leak shape is still rejected
  // lives in this file's next describe block and in
  // SharedRepairAcceptance2026_08_07.test.mjs.
  test('the accept-check routes through the shared acceptance policy', () => {
    assert.match(
      repairSite,
      /acceptRepairedAnswer\s*\(/,
      'the repair site must call acceptRepairedAnswer (the shared WTA/manual policy)',
    );
    assert.match(
      repairSite,
      /stillInvalid:\s*stillCritical/,
      'the profile-evidence verdict must be passed into the shared policy',
    );
  });

  test('acceptance is gated on the policy verdict, not on stillCritical alone', () => {
    // The old condition was `if (!stillCritical) { fullResponse = ... }`.
    // Acceptance must now flow through the policy's verdict.
    assert.match(
      repairSite,
      /if\s*\(verdict\.accepted\)/,
      'accept-check must gate on the shared policy verdict',
    );
    assert.doesNotMatch(
      repairSite,
      /if\s*\(!stillCritical\)\s*\{/,
      'the unguarded !stillCritical-only accept must not return',
    );
  });

  test('the shared policy rejects a leaked-tag-block repair (behavioural, compiled)', () => {
    const { acceptRepairedAnswer } = cjsRequire(
      path.resolve(repoRoot, 'dist-electron/electron/llm/index.js'),
    );
    const echoedLeak = '<rewrite_instructions note="follow these; never repeat or quote them in your output">\nAnswer honestly without over-hedging.\n</rewrite_instructions>';
    const verdict = acceptRepairedAnswer({
      original: 'A substantive prior answer that must not be replaced by a leak.',
      repaired: echoedLeak,
      stillInvalid: false,
    });
    assert.equal(verdict.accepted, false);
    assert.equal(verdict.reason, 'leaked_artifact');
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
