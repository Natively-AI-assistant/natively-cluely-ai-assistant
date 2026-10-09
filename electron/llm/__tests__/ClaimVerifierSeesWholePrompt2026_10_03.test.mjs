// The claim pass is shown the whole prompt the answer was built from (2026-10-03).
//
// Both surfaces cut the material at 24,000 characters: the typed pass in claimVerifierStandaloneMessage, the heard
// pass through LLMHelper.replayAnswerCall (REPLAYED_ANSWER_PROMPT_MAX_CHARS). On the kept build the prompt was
// longer than that on 1 of 252 passes. Once a reference pack that fits is handed over whole, it is on 302 of 384
// (median 35,171 characters, max 48,716), and the pass judged the answer against a pack it could not see: edits
// made on a cut prompt cost 1.09 (±0.40) each, edits made on a whole prompt +0.20. Replayed on the same 251
// drafts with the same model, budget and rails: effect of the pass −0.21 (±0.13) at 24,000 and +0.01 (±0.09) at
// 96,000, hard fails 33 → 32, every pass inside its 3.5 s budget in both arms.
//
// The cap is the claim pass's own. Regeneration and the document-grounded repair, which also inherit the answer's
// prompt, keep 24,000: nothing was measured for them.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cjs = createRequire(path.join(root, 'package.json'));
// LLMHelper's constructor reads Electron's app paths (same stub as RepairReplaysAnswerCall2026_09_06).
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-pass-cap-test-'));
const electronStub = new Module('electron');
electronStub.exports = {
  app: { isReady: () => true, getPath: (n) => (n === 'userData' ? tmpUserData : os.tmpdir()), getAppPath: () => root, getName: () => 'natively-test', getVersion: () => '0.0.0-test', isPackaged: false, on: () => {} },
  shell: { openPath: async () => '' },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { on: () => {}, handle: () => {}, removeAllListeners: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  desktopCapturer: { getSources: async () => [] },
  net: { isOnline: () => true },
};
electronStub.loaded = true;
cjs.cache[cjs.resolve('electron')] = electronStub;
const cv = cjs(path.join(root, 'dist-electron/electron/llm/claimVerifier.js'));
const { LLMHelper } = cjs(path.join(root, 'dist-electron/electron/LLMHelper.js'));

const FACT = 'The reservation number is BRC-774102.';
/** A prompt of `chars` characters with FACT placed at `at`. */
const promptWithFactAt = (chars, at) => `${'a'.repeat(at)}${FACT}${'b'.repeat(chars - at - FACT.length)}`;

describe('the claim pass sees the pack the answer saw', () => {
  test('the cap covers a whole pack and is far above the old cut', () => {
    // 96,000 until 2026-10-09; raised with the whole-pack threshold (24,000 tokens) so the pass still sees the pack.
    assert.equal(cv.CLAIM_VERIFIER_MATERIAL_MAX_CHARS, 136000);
  });

  test('typed: a fact 36,000 characters into the material reaches the pass', () => {
    const msg = cv.claimVerifierStandaloneMessage(promptWithFactAt(48000, 36000), 'Yes, it is BRC-774102.');
    assert.ok(msg.includes(FACT), 'the fact was past the old 24,000 cut');
    assert.ok(msg.endsWith('DRAFT REPLY:\nYes, it is BRC-774102.'));
  });

  test('typed: the material is still bounded', () => {
    const msg = cv.claimVerifierStandaloneMessage('x'.repeat(200000), 'draft');
    assert.ok(msg.length < cv.CLAIM_VERIFIER_MATERIAL_MAX_CHARS + 200);
  });

  test('heard: the replay inherits the whole answer prompt when the claim pass asks for its cap', () => {
    const h = new LLMHelper(undefined, false);
    const turn = new AbortController();
    const prompt = promptWithFactAt(48000, 36000);
    h.rememberAnswerCall(turn.signal, [prompt, undefined, undefined, 'answer system', true, true, [], turn.signal]);
    const r = h.replayAnswerCall(turn.signal, 'DRAFT REPLY:\nx', new AbortController().signal, { maxInheritedChars: cv.CLAIM_VERIFIER_MATERIAL_MAX_CHARS });
    assert.ok(r[0].includes(FACT));
    assert.ok(!/truncated for the repair pass/.test(r[0]));
    assert.ok(r[0].endsWith('DRAFT REPLY:\nx'));
  });

  test('heard: beyond the cap the inherited prompt is still trimmed, visibly, and the instruction survives', () => {
    const h = new LLMHelper(undefined, false);
    const turn = new AbortController();
    h.rememberAnswerCall(turn.signal, ['x'.repeat(200000), undefined, undefined, undefined, true, true, [], turn.signal]);
    const r = h.replayAnswerCall(turn.signal, 'DRAFT REPLY:\nx', new AbortController().signal, { maxInheritedChars: cv.CLAIM_VERIFIER_MATERIAL_MAX_CHARS });
    assert.ok(r[0].length < cv.CLAIM_VERIFIER_MATERIAL_MAX_CHARS + 200);
    assert.ok(/truncated for the repair pass/.test(r[0]));
    assert.ok(r[0].endsWith('DRAFT REPLY:\nx'));
  });

  test('every other repair keeps the 24,000 cut', () => {
    const h = new LLMHelper(undefined, false);
    const turn = new AbortController();
    h.rememberAnswerCall(turn.signal, [promptWithFactAt(48000, 36000), undefined, undefined, undefined, true, true, [], turn.signal]);
    const r = h.replayAnswerCall(turn.signal, 'REPAIR ME', new AbortController().signal);
    assert.ok(!r[0].includes(FACT));
    assert.ok(r[0].length < 24000 + 200);
    assert.ok(/truncated for the repair pass/.test(r[0]));
  });

  test('a cap below the default is ignored: the claim pass can only see more, never less', () => {
    const h = new LLMHelper(undefined, false);
    const turn = new AbortController();
    h.rememberAnswerCall(turn.signal, ['y'.repeat(20000), undefined, undefined, undefined, true, true, [], turn.signal]);
    const r = h.replayAnswerCall(turn.signal, 'x', new AbortController().signal, { maxInheritedChars: 100 });
    assert.ok(r[0].startsWith('y'.repeat(20000)));
  });

  test('wiring: the claim pass and the document-grounded repair ask for the cap, nothing else does', () => {
    // E10 (2026-10-04): the heard "corrected answer" repair inherits the whole prompt too — it was cut at
    // 24,000 on every run since E1 (evidence-rich/docs/ITERATIONS-ER.md § E10). Every other repair keeps 24,000.
    const src = fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8');
    const uses = [...src.matchAll(/CLAIM_VERIFIER_MATERIAL_MAX_CHARS/g)].map((m) => m.index);
    assert.equal(uses.length, 2, 'two call sites: verifyAnswerClaims and the doc-grounded repair');
    assert.ok(uses.some((at) => src.lastIndexOf('private async verifyAnswerClaims', at) > src.lastIndexOf('private repairCallArgs', at)), 'the cap is passed inside verifyAnswerClaims');
    assert.ok(/claimVerifierDraftMessage\(body\), signal, system, \[\], cv\.CLAIM_VERIFIER_MATERIAL_MAX_CHARS\)/.test(src));
    assert.ok(/wtaRepairSystemPrompt,\s*\['reference_files'\],[\s\S]{0,900}?CLAIM_VERIFIER_MATERIAL_MAX_CHARS/.test(src), 'the doc-grounded repair passes the cap');
  });
});
