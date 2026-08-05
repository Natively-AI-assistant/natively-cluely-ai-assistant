// scripts/__tests__/sd-interview-sim-repl-ui.test.mjs
// Presentation helpers for the REPL: wrapping, spend/duration labels, no-color.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createReplUi,
  wrapText,
  formatDuration,
  formatSpend,
  colorEnabled,
} = require('../lib/sd-interview-sim/replUi.js');

describe('wrapText', () => {
  test('wraps prose at the given width', () => {
    const lines = wrapText('alpha bravo charlie delta echo foxtrot', 20);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(line.length <= 20, `too wide: ${line}`);
  });

  test('leaves fenced blocks untouched', () => {
    const ascii = ['```text', 'client ------------------> api ------------> db', '```'].join('\n');
    assert.deepEqual(wrapText(ascii, 20), ascii.split('\n'));
  });

  test('keeps bullet indentation on continuation lines', () => {
    const lines = wrapText('- functional requirements are shortening and redirect', 24);
    assert.match(lines[0], /^- /);
    assert.match(lines[1], /^ {2}\S/);
  });
});

describe('labels', () => {
  test('formatDuration switches units', () => {
    assert.equal(formatDuration(420), '420ms');
    assert.equal(formatDuration(4200), '4.2s');
    assert.equal(formatDuration(65_000), '1m 5s');
  });

  test('formatSpend hides empty spend and shows tokens + usd', () => {
    assert.equal(formatSpend(null), '');
    assert.equal(formatSpend({ input_tokens: 0, output_tokens: 0, estimated_usd: 0 }), '');
    assert.equal(
      formatSpend({ input_tokens: 100, output_tokens: 40, estimated_usd: 0.0021 }),
      '140 tok · $0.0021',
    );
  });
});

describe('createReplUi', () => {
  test('emits plain text when color is disabled', () => {
    const out = [];
    const ui = createReplUi({
      say: (t) => out.push(t),
      write: () => {},
      isTTY: false,
      width: 40,
      env: { NO_COLOR: '1' },
    });

    ui.message('candidate', 'we shard by hash of the short code', { subject: 'Natively' });
    const text = out.join('\n');

    assert.ok(!text.includes('\u001b['), 'no ANSI codes without color');
    assert.match(text, /Natively/);
    assert.match(text, /shard by hash/);
  });

  test('spinner is a no-op timer off-TTY and still reports elapsed', () => {
    const ui = createReplUi({ say: () => {}, write: () => {}, isTTY: false });
    const spin = ui.spinner('thinking');
    assert.equal(typeof spin.stop(), 'number');
  });

  test('colorEnabled honors NO_COLOR over a TTY', () => {
    assert.equal(colorEnabled({ isTTY: true, env: {} }), true);
    assert.equal(colorEnabled({ isTTY: true, env: { NO_COLOR: '1' } }), false);
    assert.equal(colorEnabled({ isTTY: false, env: {} }), false);
  });
});
