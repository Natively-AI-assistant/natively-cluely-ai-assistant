import test from 'node:test';
import assert from 'node:assert/strict';
import { createChunker, cleanForSpeech, CODE_NOTICE, SOFT_CAP } from '../readAloudChunker.mjs';

const run = (tokens) => {
    const c = createChunker();
    const out = [];
    for (const t of tokens) out.push(...c.push(t));
    out.push(...c.flush());
    return out;
};

test('emits a sentence as soon as it is complete, across token boundaries', () => {
    const c = createChunker();
    assert.deepEqual(c.push('I led the migr'), []);
    assert.deepEqual(c.push('ation to Postgres. Then'), ['I led the migration to Postgres.']);
    assert.deepEqual(c.push(' we cut latency'), []);
    assert.deepEqual(c.flush(), ['Then we cut latency']);
});

test('splits on newlines and question/exclamation marks', () => {
    assert.deepEqual(run(['Why? Because it scales!\nNext line']), ['Why?', 'Because it scales!', 'Next line']);
});

test('decimals and versions do not split a sentence', () => {
    assert.deepEqual(run(['It ran 3.5x faster on v2.1 builds.']), ['It ran 3.5x faster on v2.1 builds.']);
});

test('strips markdown', () => {
    assert.equal(cleanForSpeech('## **Bold** point with `code` and [a link](https://x.y)'), 'Bold point with code and a link');
    assert.equal(cleanForSpeech('- first item'), 'first item');
    assert.equal(cleanForSpeech('1. numbered'), 'numbered');
    assert.equal(cleanForSpeech('keeps snake_case_names'), 'keeps snake_case_names');
});

test('skips fenced code and announces it once', () => {
    const out = run(['Here is the fix:\n``', '`python\nprint("hi")\n``', '`\nThat is it.\n```js\nx()\n```\nDone.']);
    assert.deepEqual(out, ['Here is the fix:', CODE_NOTICE, 'That is it.', 'Done.']);
});

test('unclosed fence at end of stream is dropped', () => {
    assert.deepEqual(run(['Look:\n```\nconst a = 1;']), ['Look:', CODE_NOTICE]);
});

test('drops the trailing [[GIST]] line even when the marker is split', () => {
    assert.deepEqual(run(['Use a hash map.\n[[GI', 'ST]] Hash map, O(n). More']), ['Use a hash map.']);
});

test('cuts long runs without punctuation at the soft cap on a space', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const out = run([words]);
    assert.ok(out.length >= 2);
    for (const s of out) assert.ok(s.length <= SOFT_CAP);
    assert.equal(out.join(' '), words);
});

test('nothing after flush', () => {
    const c = createChunker();
    c.push('Hello.');
    c.flush();
    assert.deepEqual(c.push(' More.'), []);
});
