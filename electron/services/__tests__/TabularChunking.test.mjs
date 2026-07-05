// electron/services/__tests__/TabularChunking.test.mjs
// CSV/TSV is chunked by ROWS with the header repeated — so a query for one entity
// retrieves that entity's labelled row instead of a giant blob (which made the
// model fabricate dataset figures).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dm = path.resolve(__dirname, '../../../dist-electron/electron/services/modes/DocumentMap.js');
const { tabularChunks } = await import(pathToFileURL(dm).href);

describe('tabularChunks', () => {
  const csv = ['country,pop,lifeExp,gdpPercap',
    ...Array.from({ length: 100 }, (_, i) => `Country${i},${i * 1000},${60 + (i % 20)},${5000 + i}`),
    'United States,301139947,78.242,42951.65'].join('\n');

  test('detects a CSV and chunks by rows', () => {
    const chunks = tabularChunks(csv, 40);
    assert.ok(chunks, 'CSV detected as tabular');
    assert.ok(chunks.length >= 2, 'split into multiple row-chunks');
  });

  test('every chunk repeats the header', () => {
    const chunks = tabularChunks(csv, 40);
    for (const c of chunks) assert.match(c, /country,pop,lifeExp,gdpPercap/);
  });

  test('a specific entity row is present and intact', () => {
    const chunks = tabularChunks(csv, 40);
    const us = chunks.find((c) => c.includes('United States'));
    assert.ok(us, 'US row retrieved');
    assert.match(us, /United States,301139947,78\.242,42951\.65/);
  });

  test('prose is NOT treated as a table', () => {
    const prose = 'This is a sentence, with commas, but it is prose. Another sentence, still prose, no columns.';
    assert.equal(tabularChunks(prose), null);
  });

  test('too-short input returns null', () => {
    assert.equal(tabularChunks('a,b\n1,2'), null);
  });

  test('tab-separated is detected', () => {
    const tsv = ['name\tage\tcity', ...Array.from({ length: 10 }, (_, i) => `n${i}\t${i}\tc${i}`)].join('\n');
    const chunks = tabularChunks(tsv, 5);
    assert.ok(chunks && chunks.length >= 2);
    for (const c of chunks) assert.match(c, /name\tage\tcity/);
  });
});
