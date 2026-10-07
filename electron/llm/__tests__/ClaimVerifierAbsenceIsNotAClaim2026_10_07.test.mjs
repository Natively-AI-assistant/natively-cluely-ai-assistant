// A statement of absence is not a claim that needs a record (2026-10-07). See claimVerifier.ts, LIST_THEN_REWRITE.
//
// Measured on 630 development turns of the evidence-rich benchmark: asked "has legal signed off on the privacy
// wording?", the draft said nothing in the status notes says so; the pass listed that sentence as unsupported, removed
// it, and the reply became a status report. The same happened to "there's no cost per building anywhere in the
// material" and to "I don't want to give you a number I haven't verified".

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { claimVerifierSystemPrompt, splitVerifierScratch } from '../../../dist-electron/electron/llm/claimVerifier.js';

const MODES = ['sales', 'call-center', 'looking-for-work', 'technical-interview', 'recruiting', 'team-meet', 'seminar', 'general', 'lecture'];

describe('the never-list names a statement of absence', () => {
  for (const mode of MODES) for (const surface of ['spoken', 'typed']) {
    test(`${mode}, ${surface}`, () => {
      const p = claimVerifierSystemPrompt(mode, surface);
      const never = p.slice(p.indexOf('Never list these'), p.indexOf('Write "UNSUPPORTED: none"'));
      assert.ok(never.length > 0, 'the never-list is in the prompt');
      assert.match(never, /does NOT contain, state or settle something/);
      assert.match(never, /nothing in the notes says legal has signed off/);
      assert.match(never, /declining to give a figure or a detail they cannot verify/);
    });
  }
  test('it sits inside the never-list, before the instruction to write "UNSUPPORTED: none"', () => {
    const p = claimVerifierSystemPrompt('team-meet', 'spoken');
    assert.ok(p.indexOf('does NOT contain, state or settle something') > p.indexOf('Never list these'));
    assert.ok(p.indexOf('does NOT contain, state or settle something') < p.indexOf('Write "UNSUPPORTED: none"'));
  });
  test('what must still be listed is unchanged: a past fact, a fact about the speaker, a consequential promise', () => {
    const p = claimVerifierSystemPrompt('looking-for-work', 'spoken');
    for (const kind of ['[past]', '[self]', '[promise]']) assert.ok(p.includes(kind), kind);
    assert.match(p, /Every phrase you listed is gone/);
  });
  test('the scratch line still splits off the reply', () => {
    const { scratch, reply } = splitVerifierScratch('UNSUPPORTED: none\nCONFLICT: none\n---\nNothing in the notes says legal has signed off.');
    assert.match(scratch, /UNSUPPORTED: none/);
    assert.equal(reply, 'Nothing in the notes says legal has signed off.');
  });
});
