// The live claim pass rides on the answer's own prompt (2026-11-10): same system
// prompt, same user message, then the verifier's instructions and the draft. A
// provider prompt cache only reuses an IDENTICAL start, so this is what lets the
// pass reuse the material the answer sent a second earlier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const cv = await import(pathToFileURL(path.join(root, 'dist-electron/electron/llm/claimVerifier.js')).href);
const { LLMHelper } = await import(pathToFileURL(path.join(root, 'dist-electron/electron/LLMHelper.js')).href);

test('the inline message carries the verifier role, then the draft after the LAST "---" line', () => {
  const sys = cv.claimVerifierSystemPrompt('technical-interview', 'spoken');
  const m = cv.claimVerifierInlineMessage(sys, 'I cut latency by 40%.');
  assert.ok(m.startsWith('# Verification pass — not a question to answer\nYour role for this message only: '));
  assert.ok(m.includes(sys), 'the whole verifier prompt, unchanged');
  const lastRule = m.lastIndexOf('\n---\n');
  assert.equal(m.slice(lastRule + 5), 'DRAFT REPLY:\nI cut latency by 40%.', 'the draft is what follows the last --- line, as the instructions say');
});

test('switch: on by default, NATIVELY_CLAIM_VERIFIER_SHARED_PREFIX=0 restores the own-system-prompt shape', () => {
  assert.equal(cv.claimVerifierSharesAnswerPrefix({}), true);
  assert.equal(cv.claimVerifierSharesAnswerPrefix({ NATIVELY_CLAIM_VERIFIER_SHARED_PREFIX: '0' }), false);
});

test('replayed with no system override, the call starts with exactly the answer call', () => {
  const h = Object.create(LLMHelper.prototype);
  h.answerCallByTurn = new WeakMap();
  const turn = new AbortController();
  const answerMsg = '# About the user\nPriya.\n\n# Conversation so far\n[INTERVIEWER]: Why?\n\n# Question\nWhy?';
  h.rememberAnswerCall(turn.signal, [answerMsg, undefined, undefined, 'ANSWER SYSTEM', true, true, [], turn.signal]);
  const inline = cv.claimVerifierInlineMessage('VERIFY', 'draft');
  const r = h.replayAnswerCall(turn.signal, inline, new AbortController().signal, { maxInheritedChars: cv.CLAIM_VERIFIER_MATERIAL_MAX_CHARS });
  assert.equal(r[3], 'ANSWER SYSTEM', 'system prompt inherited unchanged (repairCallArgs passes no override)');
  assert.ok(r[0].startsWith(answerMsg), 'user message starts with the answer\'s, byte for byte');
  assert.ok(r[0].endsWith(inline));
});
