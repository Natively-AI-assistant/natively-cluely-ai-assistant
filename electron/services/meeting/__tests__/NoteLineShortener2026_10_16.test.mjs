// Granola parity round 5 (2026-10-16): the notes window's "Shorten". The
// model's reply replaces the user's line only when it is the same note,
// shorter, keeps the list/heading marker, and adds no new fact. Pure logic.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const s = require(path.join(REPO, 'dist-electron/electron/services/meeting/noteLineShortener.js'));

describe('shortenInput', () => {
    test('a real line is sent one-spaced and bounded; a stub is not', () => {
        assert.equal(s.shortenInput('  so  basically   Dana said the contract  '), 'so basically Dana said the contract');
        assert.equal(s.shortenInput('- ok'), null);
        assert.equal(s.shortenInput(''), null);
        assert.ok(s.shortenInput('x'.repeat(2000)).length <= 600);
    });
});

describe('acceptShortened', () => {
    const orig = 'so basically Dana said that they are probably going to need the contract sometime before the end of Q3 I think';
    test('a tighter line with the same facts is accepted', () => {
        assert.equal(s.acceptShortened('Dana: needs the contract before end of Q3', orig), 'Dana: needs the contract before end of Q3');
    });
    test('quotes and code fences around the reply are stripped', () => {
        assert.equal(s.acceptShortened('"Dana: needs the contract before end of Q3"', orig), 'Dana: needs the contract before end of Q3');
    });
    test('an unchanged line is returned as is; a longer one is refused', () => {
        assert.equal(s.acceptShortened(orig, orig), orig);
        assert.equal(s.acceptShortened(`${orig} and more words here`, orig), null);
    });
    test('a new name, number or capitalised word is a new fact: refused', () => {
        assert.equal(s.acceptShortened('Priya: needs the contract before end of Q3', orig), null);
        assert.equal(s.acceptShortened('Dana: needs the contract by Q4', orig), null);
        assert.equal(s.acceptShortened('Dana: contract before end of Q3, 2 copies', orig), null);
    });
    test('the list or heading marker must survive', () => {
        assert.equal(s.acceptShortened('Move weekly sync', '- we talked about maybe moving the weekly sync to Thursday'), null);
        assert.equal(s.acceptShortened('- Move weekly sync to Thursday', '- we talked about maybe moving the weekly sync to Thursday'), '- Move weekly sync to Thursday');
        assert.equal(s.acceptShortened('# Pricing', '# Pricing and packaging discussion'), '# Pricing');
    });
    test('several lines or an empty reply are refused', () => {
        assert.equal(s.acceptShortened('Dana\nneeds it', orig), null);
        assert.equal(s.acceptShortened('', orig), null);
    });
});
