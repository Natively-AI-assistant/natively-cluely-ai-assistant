// Regression for campaign2 iteration 83 (B14 harness failure, run-082):
// the model produced a raw answer opening with a bold pseudo-header it
// invented itself — "**Generalization beyond translation:** Based only
// on what's literally in the paper..." — which is NOT a member of the
// CLOSED `SCAFFOLD_LABEL_RE` list (that list only covers specific known
// robotic scaffold labels like "Direct Answer:" / "Tech Stack:"). Because
// `IntelligenceEngine.ts`'s ALWAYS-ON minimal-cleanup block only invokes
// `compressToSpeakable` when `SCAFFOLD_LABEL_RE.test(cleaned)` is true,
// this generic bold-header shape slipped straight through to the judge,
// which flagged it as "written documentation rather than conversational
// speech" (a G3 rejection) despite the underlying facts being correctly
// grounded.
//
// `compressToSpeakable` ALREADY strips generic bold pseudo-headers via
// its own line-level regex (this is not new stripping logic) — the bug
// was purely that the caller's gate never let execution reach that
// function for this answer shape. The fix exports that exact pattern as
// `BOLD_PSEUDO_HEADER_RE` so the caller's gate can also fire on it,
// without duplicating or altering the strip itself.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/answerPolish.js');
const { compressToSpeakable, SCAFFOLD_LABEL_RE, BOLD_PSEUDO_HEADER_RE } = await import(pathToFileURL(modPath).href);

const B14_RAW_ANSWER = '**Generalization beyond translation:** Based only on what\'s literally in the paper, the evidence for cross-task generalization is fairly narrow but positive. The authors explicitly claim the Transformer "generalizes well to other tasks" and back it up with exactly one additional task: English constituency parsing, tested in both a limited-data WSJ-only setting and a semi-supervised setting with ~17M sentences from the BerkleyParser corpora. That\'s it. The paper doesn\'t report experiments on classification, summarization, QA, or anything else. So the document\'s own answer to "does it generalize?" is "we tried parsing and it worked."';

describe('BOLD_PSEUDO_HEADER_RE / compressToSpeakable — bold pseudo-header stripping (campaign2 iteration 83, B14)', () => {
  test('the B14 bold pseudo-header is NOT in the closed SCAFFOLD_LABEL_RE list (confirms the gap this fix closes)', () => {
    SCAFFOLD_LABEL_RE.lastIndex = 0;
    assert.equal(SCAFFOLD_LABEL_RE.test(B14_RAW_ANSWER), false);
  });

  test('BOLD_PSEUDO_HEADER_RE DOES match the B14 bold pseudo-header (the gate that must widen to catch it)', () => {
    BOLD_PSEUDO_HEADER_RE.lastIndex = 0;
    assert.equal(BOLD_PSEUDO_HEADER_RE.test(B14_RAW_ANSWER), true);
  });

  test('compressToSpeakable strips the bold pseudo-header and keeps the substantive prose', () => {
    const out = compressToSpeakable(B14_RAW_ANSWER);
    assert.equal(/\*\*Generalization beyond translation:\*\*/.test(out), false);
    assert.ok(out.includes('constituency parsing'), 'must preserve the real content after stripping the header');
    assert.ok(out.trim().length >= 40);
  });

  test('a short non-colon-terminated bold span (real emphasis, not a pseudo-header) is left untouched', () => {
    const realEmphasis = 'The idea is to **bold** the core term being explained, not to add a header.';
    BOLD_PSEUDO_HEADER_RE.lastIndex = 0;
    assert.equal(BOLD_PSEUDO_HEADER_RE.test(realEmphasis), false);
  });

  test('a legitimate closed-list scaffold label is still matched by BOLD_PSEUDO_HEADER_RE is not required — SCAFFOLD_LABEL_RE alone already covers it', () => {
    const knownLabel = '**Direct Answer:** I have eight years of production Go experience.';
    SCAFFOLD_LABEL_RE.lastIndex = 0;
    assert.equal(SCAFFOLD_LABEL_RE.test(knownLabel), true);
  });
});
