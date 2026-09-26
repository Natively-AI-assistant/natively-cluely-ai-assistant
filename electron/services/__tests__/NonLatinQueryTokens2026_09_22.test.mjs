// A question written in a non-Latin script must reach retrieval (2026-09-22).
//
// Live-reproduced in the real app with the multilingual default embedder: 120
// Hindi questions over the English benchmark corpus. The pure-Hindi ones
// returned twelve snippets with NO vector score, the first rows of an unrelated
// CSV. The dense path never ran. The tokenizer stripped every character outside
// [a-z0-9] (`.replace(/[^a-z0-9\s-]/g, ' ')`), so "फ्री टियर पर प्रोजेक्ट की सीमा
// क्या है?" became zero tokens, and ModeHybridRetriever.retrieve()'s zero-token
// short-circuit returned the fallback shape before any embedding was computed.
// The same model answers that question offline at R@10 0.433 (English: 0.425).
//
// Fix: keep every letter, combining mark and digit (\p{L}\p{M}\p{N}). Marks
// matter: Devanagari vowel signs are \p{M}, and dropping them would split a
// word mid-syllable. ASCII text tokenizes exactly as before, checked here
// against the old expression over every ASCII paragraph of the repo's docs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const { wordsOf } = await import(pathToFileURL(path.resolve(root, 'dist-electron/electron/services/modes/lexicalTokens.js')).href);
const { tokenize } = await import(pathToFileURL(path.resolve(root, 'dist-electron/electron/context-intelligence/retrieval/bm25.js')).href);

// The pre-fix expressions, verbatim, as the invariance oracle.
const oldBase = (t) => t.toLowerCase().replace(/['’]s\b/g, '').replace(/['’]/g, '').replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/);
const oldTokenize = (t) => oldBase(t).filter((w) => w.length > 2 || (w.length > 0 && /\d/.test(w)));

describe('non-Latin scripts produce tokens', () => {
  test('a pure-Hindi question is no longer empty', () => {
    const q = 'फ्री टियर पर प्रोजेक्ट और डॉक्यूमेंट की सीमा क्या है?';
    const w = wordsOf(q);
    assert.ok(w.length >= 4, `expected Hindi tokens, got ${JSON.stringify(w)}`);
    assert.ok(w.includes('प्रोजेक्ट'), 'combining marks (vowel signs, virama) stay inside the word');
  });

  test('Malayalam too', () => {
    assert.ok(wordsOf('ഗ്രേസ് പിരീഡ് എത്ര ദിവസമാണ്?').length >= 2);
  });

  test('a mixed-script question keeps both the identifier and the Hindi words', () => {
    const w = wordsOf('ENTITLEMENT_CACHE_TTL_SECONDS का मान क्या है');
    assert.ok(w.some((t) => t.includes('entitlement')), JSON.stringify(w));
    assert.ok(w.includes('क्या'), JSON.stringify(w));
  });

  test('BM25 tokenize stays in parity with wordsOf on non-Latin text', () => {
    const t = 'भुगतान विफल होने पर सहायता टीम क्या कर सकती है?';
    assert.deepEqual(tokenize(t), wordsOf(t, { shortNumerics: true }).filter(Boolean));
    assert.ok(tokenize(t).length >= 4);
  });
});

describe('ASCII tokenization is byte-for-byte unchanged', () => {
  // The repository's own docs: a large body of real English technical prose that
  // ships with the repo (the benchmark corpus is gitignored, so CI lacks it).
  const docsDir = path.resolve(root, 'docs');
  const ascii = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'))
    .flatMap((f) => fs.readFileSync(path.join(docsDir, f), 'utf8').split(/\n\s*\n/))
    // eslint-disable-next-line no-control-regex
    .filter((t) => t.trim() && /^[\x00-\x7f]*$/.test(t));

  test('bm25 tokenize matches the old expression on every ASCII docs paragraph', () => {
    assert.ok(ascii.length > 500, `expected the repo docs, got ${ascii.length} ASCII paragraphs`);
    for (const t of ascii) assert.deepEqual(tokenize(t), oldTokenize(t));
  });

  test('wordsOf base tokens match the old expression on every ASCII docs paragraph', () => {
    for (const t of ascii) {
      const oldWords = oldBase(t).filter((w) => w.length > 2);
      const now = wordsOf(t);
      // wordsOf appends hyphen and numeral extras after the base tokens; the
      // base prefix is what the regex controls.
      assert.deepEqual(now.slice(0, oldWords.length), oldWords);
    }
  });
});
