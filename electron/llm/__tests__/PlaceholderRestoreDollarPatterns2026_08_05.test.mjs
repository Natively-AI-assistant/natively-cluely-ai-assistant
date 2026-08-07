// electron/llm/__tests__/PlaceholderRestoreDollarPatterns2026_08_05.test.mjs
//
// Regression for the placeholder-restoration corruption (PR #429 tech-debt
// finding, 2026-08-05): post-processing protects code/math segments by
// swapping them for tokens (FENCE0, CODE0, INL0, MATH0, __CODE_BLOCK_0__)
// and restoring them with String.prototype.replace(token, segment). With a
// STRING second argument, JavaScript expands dollar patterns found inside the
// segment — `$&` (the matched token itself), $` (everything before the match)
// and $' (everything after) — so LLM answers containing those sequences
// (sed/regex `$&`, bash ANSI-C `$'\t'`, jQuery snippets) came back corrupted:
// internal tokens leaked into the rendered code, or surrounding prose was
// injected into the middle of a code block. The fix is callback-based
// restoration (`() => segment`), which performs no pattern expansion.
//
// Note: `$1`/`$2` are NOT affected — with a literal-string search pattern
// there are no capture groups, so ECMAScript leaves them verbatim. The tests
// below cover the three live patterns: $&, $` and $'.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  reduceDashes,
  reduceDashesInChunk,
  StreamingDashReducer,
  clampResponse,
  cleanAnswerArtifacts,
} from '../../../dist-electron/electron/llm/index.js';

describe('reduceDashes restores code containing dollar patterns verbatim', () => {
  test('fenced block with `$&` survives (no CODE0 token leak)', () => {
    const code = '```js\nlet r = str.replace(/foo/, "matched: $& done");\n```';
    const out = reduceDashes(`Approach text.\n\n${code}`);
    assert.ok(out.includes('matched: $& done'), `code $& must survive, got: ${out}`);
    assert.ok(!out.includes('CODE0'), `internal CODE0 token must not leak, got: ${out}`);
  });

  test('fenced block with bash ANSI-C $\' quoting survives (no post-match injection)', () => {
    const code = "```bash\nIFS=$'\\n' read -r line\n```";
    const out = reduceDashes(`Read lines safely.\n\n${code}`);
    assert.ok(out.includes("IFS=$'\\n' read -r line"), `bash $' must survive, got: ${out}`);
  });

  test('fenced block with $` survives (no pre-match prose injection)', () => {
    const code = '```js\nconst pre = "before: $`";\n```';
    const out = reduceDashes(`Prose before the block.\n\n${code}`);
    assert.ok(out.includes('const pre = "before: $`";'), `code $\` must survive, got: ${out}`);
  });

  test('inline code with `$&` survives (no INL0 token leak)', () => {
    const out = reduceDashes('In sed the token `$&` means the whole match.');
    assert.ok(out.includes('`$&`'), `inline $& must survive, got: ${out}`);
    assert.ok(!out.includes('INL0'), `internal INL0 token must not leak, got: ${out}`);
  });
});

describe('streaming dash reducers restore inline segments verbatim', () => {
  test('StreamingDashReducer preserves inline code `$&` in a prose chunk', () => {
    const reducer = new StreamingDashReducer();
    const out = reducer.reduce('The pattern `$&` re-inserts the match — like sed.');
    assert.ok(out.includes('`$&`'), `inline $& must survive, got: ${out}`);
    assert.ok(!/\bINL0\b/.test(out), `internal INL0 token must not leak, got: ${out}`);
  });

  test('reduceDashesInChunk preserves inline code `$&`', () => {
    const out = reduceDashesInChunk('Use `$&` in the replacement — it echoes the match.');
    assert.ok(out.includes('`$&`'), `inline $& must survive, got: ${out}`);
    assert.ok(!/\bINL0\b/.test(out), `internal INL0 token must not leak, got: ${out}`);
  });
});

describe('clampResponse restores code blocks containing dollar patterns verbatim', () => {
  test('code block with `$&` survives markdown strip + restore (no __CODE_BLOCK_0__ leak)', () => {
    const code = '```js\nout = s.replace(/x/, "$&!");\n```';
    const out = clampResponse(`Here is the code.\n\n${code}`, 3, 45);
    assert.ok(out.includes('"$&!"'), `code $& must survive, got: ${out}`);
    assert.ok(!out.includes('__CODE_BLOCK_0__'), `internal __CODE_BLOCK_0__ must not leak, got: ${out}`);
    assert.ok(!out.includes('CODE0'), `internal CODE0 token must not leak, got: ${out}`);
  });
});

describe('cleanAnswerArtifacts restores fenced code containing dollar patterns verbatim', () => {
  test('fenced block with `$&` survives (no FENCE0 token leak)', () => {
    const code = '```js\nconst m = line.replace(/err/, "[$&]");\n```';
    const out = cleanAnswerArtifacts(`The failing line is patched like this:\n\n${code}`);
    assert.ok(out.includes('"[$&]"'), `code $& must survive, got: ${out}`);
    assert.ok(!out.includes('FENCE0'), `internal FENCE0 token must not leak, got: ${out}`);
  });
});
