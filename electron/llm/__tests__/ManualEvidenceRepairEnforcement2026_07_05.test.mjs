// electron/llm/__tests__/ManualEvidenceRepairEnforcement2026_07_05.test.mjs
//
// Profile Intelligence production-fix autopilot (2026-07-05,
// docs/investigations/pi-production-fix-progress.md, Confirmed Bug #3): the
// manual-chat path (ipcHandlers.ts gemini-chat-stream) called
// validateProfileEvidence and correctly DETECTED unsupported_metric
// violations, but only logged them — CRITICAL_CODES (the set that triggers a
// bounded repair regeneration) only covered assistant_identity_leak /
// false_no_access_refusal / false_no_experience_refusal. A fabricated metric
// ("25% retention" not in the resume) was detected and then delivered to the
// user unchanged. This mirrors EvidenceRepairLive.test.mjs, which already
// covered the LIVE (WhatToAnswer/transcript) path's equivalent wiring in
// IntelligenceEngine.ts — the manual path had no matching source pin.
//
// Source-pin tests only (ipcHandlers.ts's manual chat handler is not unit-
// testable in isolation — it's wired deep inside a `safeHandle` IPC
// registration with live streaming/session state). Behavior is additionally
// verified end-to-end via the live-backend replay harness
// (scripts/pi-replay.cjs / pi-replay-stateful.cjs).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcSrc = readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

describe('manual-chat CRITICAL_CODES enforcement includes unsupported_metric', () => {
  test('unsupported_metric is in the manual-path CRITICAL_CODES set', () => {
    assert.match(
      ipcSrc,
      /CRITICAL_CODES = new Set\(\['assistant_identity_leak', 'false_no_access_refusal', 'false_no_experience_refusal', 'unsupported_metric'\]\)/,
    );
  });

  test('the critical check reads from profileValidation.violations (validateProfileEvidence), not just validateProfileOutput', () => {
    // Custom-Mode Source Isolation (2026-07-06): widened the proximity window
    // from 120 → 600 chars because the new doc-grounded exclusion
    // (`&& !_docGroundedBlocksRepair`) lives between the `critical` keyword
    // and the `profileValidation.violations.find(...)` call. The behavioral
    // invariant — that critical reads from violations — is unchanged.
    assert.match(
      ipcSrc,
      /const critical = profileAvailable[\s\S]{0,600}profileValidation\.violations\.find\(v => v\.severity === 'error' && CRITICAL_CODES\.has\(v\.code\)\)/,
    );
  });

  test('the repair re-check uses validateProfileEvidence (evidence-aware), not the narrower output-only check', () => {
    assert.match(
      ipcSrc,
      /const reCheck = validateProfileEvidence\(\{ answer: repairedTrim, plan: answerPlan, evidence, profileAvailable, candidateDirected: true \}\)/,
    );
  });
});
