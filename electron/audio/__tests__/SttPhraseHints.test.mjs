// Tests for the tech-term glossary and ElevenLabs keyterm biasing.
//
// Why: when a phrase is recognized under a non-English primary language
// (ru-RU), embedded English tech terms — "Stateless Widget", "hot reload" —
// get phonetically mangled by that language's model. ElevenLabs' keyterms
// bias recognition toward the exact tokens so they come out verbatim inside
// Cyrillic text. (Google's speechContexts slot is owned by sttContextTerms —
// the user's name and dictionary — so the glossary is NOT injected there; it
// also feeds the provider-agnostic transcriptTermFix post-processor.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron');

const { DEFAULT_TECH_PHRASE_HINTS } = await import(path.join(distRoot, 'config/sttPhraseHints.js'));

test('default glossary stays curated and bounded (≤500 phrases, ≤100 chars)', () => {
    assert.ok(DEFAULT_TECH_PHRASE_HINTS.length > 0);
    assert.ok(DEFAULT_TECH_PHRASE_HINTS.length <= 500);
    for (const p of DEFAULT_TECH_PHRASE_HINTS) {
        assert.ok(p.length <= 100, `phrase too long: ${p}`);
    }
    assert.ok(DEFAULT_TECH_PHRASE_HINTS.includes('Stateless Widget'));
    assert.ok(DEFAULT_TECH_PHRASE_HINTS.includes('Stateful Widget'));
});

test('ElevenLabs appends keyterms to the WS URL within Scribe v2 limits', () => {
    // Structural: the connect URL builder loops over this.keyterms, and the
    // field derivation enforces the realtime caps (≤50 terms of ≤20 chars).
    const src = readFileSync(path.resolve(__dirname, '../ElevenLabsStreamingSTT.ts'), 'utf8');
    assert.ok(src.includes('keyterms=${encodeURIComponent(term)}'));
    assert.ok(src.includes('.filter(t => t.length <= 20)'));
    assert.ok(src.includes('.slice(0, 50)'));

    // And the derived subset itself is valid.
    const subset = DEFAULT_TECH_PHRASE_HINTS.filter(t => t.length <= 20).slice(0, 50);
    assert.ok(subset.length > 0 && subset.length <= 50);
    assert.ok(subset.includes('Stateless Widget'));
});
