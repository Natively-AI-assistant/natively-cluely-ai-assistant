// Covers electron/services/modes/retrievalTextMatch.ts: levenshtein1 (exactly one
// edit apart) and includesPlannerTerm (substring first, bounded one-edit fallback).
// Run from the repo root: node --test electron/services/__tests__/retrievalTextMatch.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const { levenshtein1, includesPlannerTerm } = require(
    path.join(repoRoot, 'dist-electron/electron/services/modes/retrievalTextMatch.js'),
);

// Textbook edit distance, used as an independent oracle.
function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            d[i][j] = Math.min(
                d[i - 1][j] + 1,
                d[i][j - 1] + 1,
                d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
    }
    return d[a.length][b.length];
}

describe('levenshtein1', () => {
    test('one substitution, at the start, middle and end', () => {
        assert.equal(levenshtein1('abc', 'xbc'), true);
        assert.equal(levenshtein1('abc', 'axc'), true);
        assert.equal(levenshtein1('abc', 'abx'), true);
    });

    test('one insertion or deletion, at the start, middle and end', () => {
        assert.equal(levenshtein1('abcd', 'bcd'), true);
        assert.equal(levenshtein1('acd', 'abcd'), true);
        assert.equal(levenshtein1('abc', 'ab'), true);
        assert.equal(levenshtein1('ab', 'abc'), true);
    });

    test('identical strings are zero edits, not one', () => {
        assert.equal(levenshtein1('abc', 'abc'), false);
        assert.equal(levenshtein1('', ''), false);
    });

    test('comparison is case-insensitive', () => {
        assert.equal(levenshtein1('ABC', 'abc'), false);
        assert.equal(levenshtein1('ABC', 'abd'), true);
    });

    test('two or more edits are rejected', () => {
        assert.equal(levenshtein1('ab', 'ba'), false); // a transposition is two edits
        assert.equal(levenshtein1('abcd', 'abxy'), false);
        assert.equal(levenshtein1('abcd', 'ac'), false); // length differs by 2
        assert.equal(levenshtein1('abc', 'ybcx'), false); // one substitution + one insertion
        assert.equal(levenshtein1('abc', 'xab'), false);
    });

    test('empty and nullish input is treated as the empty string', () => {
        assert.equal(levenshtein1('', 'a'), true);
        assert.equal(levenshtein1('a', ''), true);
        assert.equal(levenshtein1(null, 'a'), true);
        assert.equal(levenshtein1('a', undefined), true);
        assert.equal(levenshtein1(null, undefined), false);
        assert.equal(levenshtein1('', 'ab'), false);
    });

    test('is symmetric and agrees with textbook edit distance on every string up to length 4 over {a,b}', () => {
        const words = [''];
        for (let len = 1; len <= 4; len++) {
            for (let n = 0; n < 2 ** len; n++) {
                words.push(n.toString(2).padStart(len, '0').replace(/0/g, 'a').replace(/1/g, 'b'));
            }
        }
        assert.equal(words.length, 31);
        for (const a of words) {
            for (const b of words) {
                assert.equal(levenshtein1(a, b), editDistance(a, b) === 1, `levenshtein1(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
            }
        }
    });
});

describe('includesPlannerTerm', () => {
    test('exact substring match, case-insensitive', () => {
        assert.equal(includesPlannerTerm('The Weight is 5 kg', 'weight'), true);
        assert.equal(includesPlannerTerm('the weight is 5 kg', 'WEIGHT'), true);
        assert.equal(includesPlannerTerm('weights', 'weight'), true);
    });

    test('substring match also applies to short and numeric terms', () => {
        assert.equal(includesPlannerTerm('ask the API team', 'api'), true);
        assert.equal(includesPlannerTerm('order 1234 shipped', '1234'), true);
    });

    test('empty or nullish term or text never matches', () => {
        assert.equal(includesPlannerTerm('anything', ''), false);
        assert.equal(includesPlannerTerm('anything', null), false);
        assert.equal(includesPlannerTerm('anything', undefined), false);
        assert.equal(includesPlannerTerm('', 'weight'), false);
        assert.equal(includesPlannerTerm(null, 'weight'), false);
        assert.equal(includesPlannerTerm(undefined, 'weight'), false);
    });

    test('one-edit fuzzy match on a word token', () => {
        assert.equal(includesPlannerTerm('it weighs a lot', 'weight'), true);
        assert.equal(includesPlannerTerm('the wieght', 'weight'), false); // transposition = two edits
        assert.equal(includesPlannerTerm('a heavy freight', 'weight'), false); // two edits
    });

    test('terms shorter than four characters are never fuzzed', () => {
        assert.equal(includesPlannerTerm('the cat sat', 'cot'), false);
        assert.equal(includesPlannerTerm('use apis here', 'apo'), false);
    });

    test('terms containing a digit are never fuzzed', () => {
        assert.equal(includesPlannerTerm('order 1235 shipped', '1234'), false);
        assert.equal(includesPlannerTerm('see section abcde', 'abcd1'), false);
        assert.equal(includesPlannerTerm('model gptx', 'gpt4'), false);
    });

    test('words shorter than four characters are never fuzzed against', () => {
        assert.equal(includesPlannerTerm('a big map', 'maps'), false);
    });

    test('plural and -ies inflections of the term match', () => {
        assert.equal(includesPlannerTerm('it weighs', 'weigh'), true);
        assert.equal(includesPlannerTerm('studies show otherwise', 'study'), true);
        assert.equal(includesPlannerTerm('three companies', 'company'), true);
    });

    test('hyphenated tokens are matched as one word', () => {
        assert.equal(includesPlannerTerm('a well-known fact', 'wellknown'), true); // one deletion
        assert.equal(includesPlannerTerm('a well-known fact', 'known'), true); // substring
    });

    test('unrelated text does not match', () => {
        assert.equal(includesPlannerTerm('the quick brown fox', 'weight'), false);
        assert.equal(includesPlannerTerm('12345 67890 !!!', 'weight'), false);
    });
});
