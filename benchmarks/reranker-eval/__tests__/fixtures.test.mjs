// benchmarks/reranker-eval/__tests__/fixtures.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const documents = JSON.parse(readFileSync(path.resolve(__dirname, '../fixtures/documents.json'), 'utf8'));
const queries = JSON.parse(readFileSync(path.resolve(__dirname, '../fixtures/queries.json'), 'utf8'));

describe('reranker-eval fixtures', () => {
  test('documents.json has at least 4 documents with non-empty id/type/text', () => {
    assert.ok(documents.length >= 4, `expected >= 4 documents, got ${documents.length}`);
    for (const doc of documents) {
      assert.ok(doc.id && doc.id.length > 0, 'doc.id must be non-empty');
      assert.ok(doc.type === 'resume' || doc.type === 'jd', `doc.type must be resume|jd, got ${doc.type}`);
      assert.ok(doc.text && doc.text.length > 200, `doc.text too short for ${doc.id}`);
    }
  });

  test('queries.json has at least 25 queries, each referencing a real document', () => {
    assert.ok(queries.length >= 25, `expected >= 25 queries, got ${queries.length}`);
    const docIds = new Set(documents.map((d) => d.id));
    for (const q of queries) {
      assert.ok(q.id && q.query && q.goldDocumentId, `query ${JSON.stringify(q)} missing required field`);
      assert.ok(docIds.has(q.goldDocumentId), `query ${q.id} references unknown document ${q.goldDocumentId}`);
      assert.ok(Array.isArray(q.goldChunkKeywords) && q.goldChunkKeywords.length >= 2, `query ${q.id} needs >= 2 goldChunkKeywords`);
    }
  });

  test('every goldChunkKeywords phrase actually appears verbatim in its goldDocumentId text', () => {
    const byId = new Map(documents.map((d) => [d.id, d.text]));
    for (const q of queries) {
      const text = byId.get(q.goldDocumentId);
      for (const kw of q.goldChunkKeywords) {
        assert.ok(text.includes(kw), `query ${q.id}: keyword "${kw}" not found verbatim in ${q.goldDocumentId}`);
      }
    }
  });

  test('every document has at least 6 queries referencing it', () => {
    const counts = new Map();
    for (const q of queries) counts.set(q.goldDocumentId, (counts.get(q.goldDocumentId) || 0) + 1);
    for (const doc of documents) {
      assert.ok((counts.get(doc.id) || 0) >= 6, `document ${doc.id} has fewer than 6 queries`);
    }
  });
});
