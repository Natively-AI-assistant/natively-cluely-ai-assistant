// Covers electron/utils/curlPlaceholderPolicy.ts: the placeholder regexes, the
// non-throwing URI decode, and the two checks that say whether a placeholder reaches
// the wire and why it did not. Pure string/object logic, identical on darwin and win32.
// Run from the repo root: node --test electron/utils/__tests__/curlPlaceholderPolicy.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const {
    TEXT_PLACEHOLDER_RE,
    ANY_PLACEHOLDER_RE,
    safeDecodeURIComponent,
    placeholderReachesTheWire,
    explainMissingPlaceholder,
} = require(path.join(repoRoot, 'dist-electron/electron/utils/curlPlaceholderPolicy.js'));

describe('TEXT_PLACEHOLDER_RE', () => {
    test('matches the strict and spacing-tolerant spellings', () => {
        for (const s of ['{{TEXT}}', '{{ TEXT }}', '{{  TEXT}}', '{{TEXT\t}}', '{"prompt": "{{ TEXT }}"}']) {
            assert.equal(TEXT_PLACEHOLDER_RE.test(s), true, s);
        }
    });

    test('rejects other names, lower case and malformed braces', () => {
        for (const s of ['{{text}}', '{{Text}}', '{TEXT}', '{{TEXT}', '{{TEXTS}}', '{{MY_TEXT}}', '{{ T EXT }}', '{ {TEXT} }', 'TEXT', '']) {
            assert.equal(TEXT_PLACEHOLDER_RE.test(s), false, s);
        }
    });

    test('is stateless across calls (no global flag)', () => {
        assert.equal(TEXT_PLACEHOLDER_RE.global, false);
        assert.equal(TEXT_PLACEHOLDER_RE.test('{{TEXT}}'), true);
        assert.equal(TEXT_PLACEHOLDER_RE.test('{{TEXT}}'), true);
    });
});

describe('ANY_PLACEHOLDER_RE', () => {
    test('matches upper-case, digit and underscore names, spacing tolerated', () => {
        for (const s of ['{{TEXT}}', '{{API_KEY}}', '{{ MODEL_2 }}', '{{123}}', '{{_}}', 'Bearer {{API_KEY}}']) {
            assert.equal(ANY_PLACEHOLDER_RE.test(s), true, s);
        }
    });

    test('rejects lower case, empty, hyphenated and URL-encoded names', () => {
        for (const s of ['{{text}}', '{{}}', '{{ }}', '{{API-KEY}}', '{{API KEY}}', '{API_KEY}', '%7B%7BTEXT%7D%7D', '']) {
            assert.equal(ANY_PLACEHOLDER_RE.test(s), false, s);
        }
    });

    test('is stateless across calls (no global flag)', () => {
        assert.equal(ANY_PLACEHOLDER_RE.global, false);
        assert.equal(ANY_PLACEHOLDER_RE.test('{{A}}'), true);
        assert.equal(ANY_PLACEHOLDER_RE.test('{{A}}'), true);
    });
});

describe('safeDecodeURIComponent', () => {
    test('decodes valid input', () => {
        assert.equal(safeDecodeURIComponent('%7B%7BTEXT%7D%7D'), '{{TEXT}}');
        assert.equal(safeDecodeURIComponent('a%20b%2Fc'), 'a b/c');
        assert.equal(safeDecodeURIComponent('caf%C3%A9'), 'café');
    });

    test('returns plain and empty strings unchanged', () => {
        assert.equal(safeDecodeURIComponent('plain text'), 'plain text');
        assert.equal(safeDecodeURIComponent(''), '');
    });

    test('returns the input instead of throwing on malformed escapes', () => {
        for (const s of ['100%', '%', '%zz', 'discount=100%&x=1', '%E0%A4%A']) {
            assert.equal(safeDecodeURIComponent(s), s, s);
        }
    });
});

describe('placeholderReachesTheWire', () => {
    test('true when a placeholder is in the url, a header or the body', () => {
        assert.equal(placeholderReachesTheWire({ url: 'https://api.example.com/{{MODEL}}/chat' }), true);
        assert.equal(placeholderReachesTheWire({ url: 'https://x.test', header: { Authorization: 'Bearer {{API_KEY}}' } }), true);
        assert.equal(placeholderReachesTheWire({ url: 'https://x.test', data: { prompt: '{{TEXT}}' } }), true);
    });

    test('finds placeholders nested deep in the body, and as object keys', () => {
        assert.equal(placeholderReachesTheWire({ data: { messages: [{ role: 'user', content: [{ text: 'Q: {{ TEXT }}' }] }] } }), true);
        assert.equal(placeholderReachesTheWire({ data: { '{{TEXT}}': 1 } }), true);
    });

    test('a string body counts too', () => {
        assert.equal(placeholderReachesTheWire({ data: 'prompt={{TEXT}}' }), true);
    });

    test('false when the placeholder only sits in form or params', () => {
        assert.equal(placeholderReachesTheWire({ url: 'https://x.test', form: ['prompt={{TEXT}}'] }), false);
        assert.equal(placeholderReachesTheWire({ url: 'https://x.test', params: { q: '{{TEXT}}' } }), false);
    });

    test('false for the empty-body case curl2Json produces for invalid JSON', () => {
        assert.equal(placeholderReachesTheWire({ url: 'https://x.test', header: { 'Content-Type': 'application/json' }, data: {} }), false);
    });

    test('false for missing, null and empty surfaces', () => {
        assert.equal(placeholderReachesTheWire({}), false);
        assert.equal(placeholderReachesTheWire({ url: null, header: null, data: null }), false);
        assert.equal(placeholderReachesTheWire({ url: undefined, header: undefined, data: undefined }), false);
        assert.equal(placeholderReachesTheWire({ url: '', header: {}, data: {} }), false);
    });

    test('lower-case and URL-encoded placeholders do not count', () => {
        assert.equal(placeholderReachesTheWire({ data: { prompt: '{{text}}' } }), false);
        assert.equal(placeholderReachesTheWire({ url: 'https://x.test/?q=%7B%7BTEXT%7D%7D' }), false);
    });
});

describe('explainMissingPlaceholder', () => {
    const NOT_SENT = explainMissingPlaceholder({ form: ['prompt={{TEXT}}'] });
    const BAD_JSON = explainMissingPlaceholder({});

    test('the two diagnoses are different messages naming their cause', () => {
        assert.notEqual(NOT_SENT, BAD_JSON);
        assert.match(NOT_SENT, /-F form field/);
        assert.match(NOT_SENT, /\?query= parameter/);
        assert.match(NOT_SENT, /JSON body/);
        assert.match(BAD_JSON, /isn't valid JSON/);
        assert.match(BAD_JSON, /"\{\{TEXT\}\}"/);
    });

    test('placeholder in a -F form field (array or object shaped)', () => {
        assert.equal(explainMissingPlaceholder({ form: ['file=@a.txt', 'prompt={{ TEXT }}'] }), NOT_SENT);
        assert.equal(explainMissingPlaceholder({ form: { prompt: '{{TEXT}}' } }), NOT_SENT);
    });

    test('placeholder in a query parameter, raw', () => {
        assert.equal(explainMissingPlaceholder({ params: { q: '{{TEXT}}' } }), NOT_SENT);
        assert.equal(explainMissingPlaceholder({ params: { key: '{{API_KEY}}' } }), NOT_SENT);
    });

    test('placeholder in a query parameter, URL-encoded as curl2Json leaves it', () => {
        assert.equal(explainMissingPlaceholder({ params: { q: '%7B%7BTEXT%7D%7D' } }), NOT_SENT);
        assert.equal(explainMissingPlaceholder({ params: { q: '%7B%7B%20TEXT%20%7D%7D' } }), NOT_SENT);
    });

    test('a raw placeholder is still found next to an undecodable parameter', () => {
        assert.equal(explainMissingPlaceholder({ params: { discount: '100%', q: '{{TEXT}}' } }), NOT_SENT);
    });

    test('no placeholder in form or params: blame the JSON body', () => {
        assert.equal(explainMissingPlaceholder({ url: 'https://x.test', data: {} }), BAD_JSON);
        assert.equal(explainMissingPlaceholder({ form: [], params: {} }), BAD_JSON);
        assert.equal(explainMissingPlaceholder({ form: null, params: null }), BAD_JSON);
        assert.equal(explainMissingPlaceholder({ form: ['file=@a.txt'], params: { page: '2' } }), BAD_JSON);
    });

    test('an undecodable query string without a placeholder does not throw', () => {
        assert.equal(explainMissingPlaceholder({ params: { discount: '100%' } }), BAD_JSON);
    });

    test('placeholders in url, header or data do not change the diagnosis', () => {
        assert.equal(explainMissingPlaceholder({ url: 'https://x.test/{{MODEL}}', header: { a: '{{API_KEY}}' }, data: { p: '{{TEXT}}' } }), BAD_JSON);
    });
});
