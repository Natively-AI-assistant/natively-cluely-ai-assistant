// Real-custom-mode-repair (2026-07-11) — REGRESSION for a bug the real
// end-to-end benchmark caught: integration.ts's normalizeSourceAuthority()
// switch was missing 'reference_files_primary', silently downgrading it to
// the default 'ask_if_ambiguous' case. This meant the legacy arbiter
// correctly computed sourceAuthority='reference_files_primary' for a
// migrated seminar mode, but by the time it reached the Context OS kernel it
// had been normalized away — so any question matching
// AMBIGUOUS_SOURCE_TERM_RE ("method", "project", "phase", ...) incorrectly
// resolved to sourceOwner='clarify' instead of 'reference_files', while
// questions NOT matching that regex happened to still work via the
// permissive 'unknown' fallthrough (masking the bug for roughly half the
// benchmark's questions — exactly why it needed a REAL end-to-end run to
// surface, not just unit tests of each layer in isolation).
//
// Run under `ELECTRON_RUN_AS_NODE=1 electron --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);

// Force Context OS on for this test process (env read fresh, no cache).
process.env.NATIVELY_CONTEXT_OS = '1';
process.env.NATIVELY_CONTEXT_OS_MANUAL_CHAT = '1';

const co = cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/intelligence/context-os/index.js'));

function buildFor(question, sourceAuthority, overrides = {}) {
  return co.buildTurnContractForSurface({
    surface: 'manual_chat',
    question,
    activeModeId: 'mode-test',
    activeModeName: 'Seminar mode',
    sourceAuthority,
    answerType: 'list_answer',
    hasReferenceFiles: true,
    hasProfileFacts: false,
    hasLiveTranscript: false,
    ...overrides,
  });
}

describe('INCIDENT REGRESSION: reference_files_primary must NOT be normalized away to ask_if_ambiguous', () => {
  test('an ambiguous-term-matching question ("method") still resolves to reference_files, not clarify', () => {
    const contract = buildFor('What fine-tuning method was used?', 'reference_files_primary');
    assert.equal(contract.sourceOwner, 'reference_files',
      'BUG SIGNATURE: if this is "clarify", normalizeSourceAuthority is downgrading reference_files_primary again');
  });

  test('an ambiguous-term-matching question ("project") still resolves to reference_files, not clarify', () => {
    const contract = buildFor('What was the total project budget?', 'reference_files_primary');
    assert.equal(contract.sourceOwner, 'reference_files');
  });

  test('a non-ambiguous-term question also resolves to reference_files (control — this direction always worked)', () => {
    const contract = buildFor('What robot platform is used in this thesis?', 'reference_files_primary');
    assert.equal(contract.sourceOwner, 'reference_files');
  });

  test('an explicit profile switch is still granted under reference_files_primary (not clarify)', () => {
    const contract = buildFor(
      'Based only on my résumé, what is my strongest project?',
      'reference_files_primary',
      { hasProfileFacts: true, userExplicitSource: 'profile' },
    );
    assert.equal(contract.sourceOwner, 'profile');
  });

  test('reference_files_only (the strict, non-primary authority) is unaffected by this fix', () => {
    const contract = buildFor('What fine-tuning method was used?', 'reference_files_only');
    assert.equal(contract.sourceOwner, 'reference_files');
  });

  test('an unrecognized authority string still safely normalizes to ask_if_ambiguous (no crash, conservative default)', () => {
    const contract = buildFor('What is this?', 'totally_unknown_value');
    assert.ok(['unknown', 'clarify'].includes(contract.sourceOwner));
  });
});
