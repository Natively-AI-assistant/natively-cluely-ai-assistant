// Regression guard for "Russian question about bubble sort → all-English
// answer" (2026-07-26). Coding/DSA answers carry a contract mandating exact
// English headings; models read that as "the whole answer is English" and
// ignored the soft auto-language instruction. The auto-language suffix must
// explicitly decouple mandated scaffolding (headings, code) from prose
// language.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');

test('auto-language instruction carves out structured-answer scaffolding from prose language', () => {
    assert.ok(src.includes('[LANGUAGE INSTRUCTION — HIGHEST PRIORITY]'));
    // Prose under mandated headings must follow the user's language…
    assert.ok(src.includes('including every sentence under required markdown headings'));
    // …and a formatting contract must not flip the whole answer to English.
    assert.ok(src.includes('does NOT make the answer English'));
});
