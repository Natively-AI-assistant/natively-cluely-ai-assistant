// electron/services/__tests__/SentenceAwareChunking.test.mjs
//
// Proves the sentence-aware windowing keeps a normative clause intact across a
// chunk boundary — the RFC 8259 "Implementations MUST NOT add a byte order mark"
// bug where the word-window chunker split "MUST NOT" away from "byte order mark".

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dmPath = path.resolve(__dirname, '../../../dist-electron/electron/services/modes/DocumentMap.js');
const { sentenceAwareWindows } = await import(pathToFileURL(dmPath).href);

describe('sentenceAwareWindows', () => {
  test('never splits a sentence mid-clause (RFC BOM case)', () => {
    // Build long filler so the target sentence lands mid-window under 140 words.
    const filler = Array.from({ length: 130 }, (_, i) => `word${i}`).join(' ') + '.';
    const target = 'Implementations MUST NOT add a byte order mark (U+FEFF) to the beginning of a networked-transmitted JSON text.';
    const after = Array.from({ length: 60 }, (_, i) => `tail${i}`).join(' ') + '.';
    const text = `${filler} ${target} ${after}`;
    const windows = sentenceAwareWindows(text, 140, 30);
    // The target sentence must appear WHOLE in at least one window — never with
    // "MUST NOT" and "byte order mark" separated into different chunks.
    const whole = windows.some((w) => w.includes(target));
    assert.ok(whole, 'target normative sentence must be intact in one window');
    // No window may contain "byte order mark" without also containing "MUST NOT".
    for (const w of windows) {
      if (/byte order mark/.test(w)) {
        assert.ok(/MUST NOT/.test(w), 'a window with "byte order mark" must also carry "MUST NOT"');
      }
    }
  });

  test('short text returns a single window unchanged', () => {
    const w = sentenceAwareWindows('One short sentence here.', 140, 30);
    assert.equal(w.length, 1);
    assert.equal(w[0], 'One short sentence here.');
  });

  test('a single over-long sentence is emitted whole, not truncated', () => {
    const long = 'This ' + Array.from({ length: 200 }, () => 'x').join(' ') + ' end.';
    const w = sentenceAwareWindows(long, 140, 30);
    assert.equal(w.length, 1);
    assert.ok(w[0].includes('end.'), 'over-long sentence kept whole');
  });

  test('multiple sentences pack into >1 window with sentence-boundary overlap', () => {
    const sentences = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} has exactly eight words here total.`);
    const text = sentences.join(' ');
    const windows = sentenceAwareWindows(text, 40, 10);
    assert.ok(windows.length > 1, 'splits into multiple windows');
    // every window boundary is a full sentence (ends with a period)
    for (const w of windows) assert.match(w.trim(), /\.$/);
  });

  test('empty / whitespace returns no windows', () => {
    assert.deepEqual(sentenceAwareWindows('   ', 140, 30), []);
  });
});
