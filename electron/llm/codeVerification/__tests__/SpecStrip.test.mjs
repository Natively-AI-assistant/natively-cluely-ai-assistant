// electron/llm/codeVerification/__tests__/SpecStrip.test.mjs
//
// The hidden <verification_spec> must NEVER reach the UI — neither in the final
// answer (stripVerificationSpec) nor mid-stream (StreamingSpecStripper, even
// when the opening tag is split across chunk boundaries).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  stripVerificationSpec,
  StreamingSpecStripper,
  CODING_VERIFICATION_INSTRUCTION,
} from '../../../../dist-electron/electron/llm/codingContract.js';

const ANSWER = `## Approach\n\nx\n\n## Code\n\n\`\`\`python\ndef f(x): return x\n\`\`\`\n\n## Complexity\n\nTime: O(1).`;
const SPEC = `\n\n<verification_spec>\n{"entry":"f","language":"python","cases":[{"input":[1],"expected":1}]}\n</verification_spec>`;

describe('stripVerificationSpec (whole answer)', () => {
  test('removes the block, keeps the visible answer', () => {
    const out = stripVerificationSpec(ANSWER + SPEC);
    assert.doesNotMatch(out, /verification_spec/);
    assert.match(out, /## Approach/);
    assert.match(out, /def f\(x\)/);
  });
  test('idempotent + safe with no spec', () => {
    assert.equal(stripVerificationSpec(ANSWER), ANSWER);
  });
  test('strips an UNCLOSED spec to EOF (truncated stream must not leak)', () => {
    const unclosed = ANSWER + '\n\n<verification_spec>\n{"entry":"f","cases":[{"input":[1],"expected":1}]}';
    const out = stripVerificationSpec(unclosed);
    assert.doesNotMatch(out, /verification_spec/, 'unclosed spec must still be stripped');
    assert.match(out, /## Complexity/);
  });
  test('strips MULTIPLE spec blocks (a hallucinated second spec must not leak)', () => {
    const two = ANSWER + '\n<verification_spec>{"a":1}</verification_spec>\nmid\n<verification_spec>{"b":2}</verification_spec>';
    const out = stripVerificationSpec(two);
    assert.doesNotMatch(out, /verification_spec/, 'both spec blocks must be stripped');
    assert.match(out, /## Complexity/);
  });
});

describe('StreamingSpecStripper', () => {
  test('emits visible text and suppresses the spec when fed whole', () => {
    const s = new StreamingSpecStripper();
    const out = s.push(ANSWER + SPEC) + s.finish();
    assert.doesNotMatch(out, /verification_spec/);
    assert.match(out, /## Complexity/);
  });

  test('suppresses the spec even when the opening tag is SPLIT across chunks', () => {
    const s = new StreamingSpecStripper();
    // Feed in awkward chunks that split "<verification_spec" down the middle.
    const chunks = [
      '## Code\n```python\ndef f(x): return x\n```\n\n## Complexity\nO(1).\n\n<verif',
      'ication_spec>\n{"entry":"f",',
      '"language":"python","cases":[]}\n</verification_spec>',
    ];
    let out = '';
    for (const c of chunks) out += s.push(c);
    out += s.finish();
    assert.doesNotMatch(out, /verif/i, 'no partial or full spec tag leaks');
    assert.match(out, /## Complexity/);
    assert.match(out, /O\(1\)/);
  });

  test('suppresses the spec when fed ONE CHARACTER per chunk (token-stream stress)', () => {
    const s = new StreamingSpecStripper();
    const full = ANSWER + SPEC;
    let out = '';
    for (const ch of full) out += s.push(ch);
    out += s.finish();
    assert.doesNotMatch(out, /verif/i, 'no partial tag leaks char-by-char');
    assert.match(out, /## Complexity/);
  });

  test('text + spec + trailing in one chunk → only the leading text survives', () => {
    const s = new StreamingSpecStripper();
    const out = s.push('VISIBLE<verification_spec>{x}</verification_spec>TRAILING') + s.finish();
    assert.equal(out, 'VISIBLE');
  });

  test('once suppressing, all further chunks are dropped', () => {
    const s = new StreamingSpecStripper();
    s.push('text <verification_spec>{');
    assert.equal(s.push('more spec content'), '');
    assert.equal(s.push('}</verification_spec> trailing'), '');
    assert.equal(s.finish(), '');
  });

  test('a normal coding answer with NO spec streams through unchanged', () => {
    const s = new StreamingSpecStripper();
    let out = '';
    for (const c of ['## Approach\n', 'use a map\n', '## Code\n```py\nx=1\n```']) out += s.push(c);
    out += s.finish();
    assert.match(out, /## Approach/);
    assert.match(out, /x=1/);
  });
});

describe('CODING_VERIFICATION_INSTRUCTION', () => {
  test('asks for entry/language/cases and is removed-before-display', () => {
    assert.match(CODING_VERIFICATION_INSTRUCTION, /<verification_spec>/);
    assert.match(CODING_VERIFICATION_INSTRUCTION, /"entry"/);
    assert.match(CODING_VERIFICATION_INSTRUCTION, /argument list/i);
    assert.match(CODING_VERIFICATION_INSTRUCTION, /removed before display/i);
  });
});
