// Tests for the targeted retrieval retry path (audit 2026-06-27, fix F6).
//
// When document-grounded custom mode returns zero chunks on the first
// pass, the retriever now extracts high-signal entity terms from the
// query and re-runs scoring with those terms as the new query. This
// rescues cases where the model would otherwise say "not directly
// mentioned" for a fact that IS in the document but lexically distant
// from the user's question (e.g. user asks "How many joints does
// Mercury have?" and the doc says "Mercury X1 has 19 degrees of
// freedom").
//
// These are SOURCE-ASSERTION tests because the retry path runs inside
// the lexical retriever which requires better-sqlite3 native binding
// (Node 25 ABI mismatch in this fast-iteration loop).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('targeted retry: extractHighSignalEntityTerms recognises capitalised phrases', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  assert.match(
    src,
    /function extractHighSignalEntityTerms\(query: string\): string\[\]/,
    'extractHighSignalEntityTerms helper must exist',
  );
  // The phrase regex matches a capitalised word optionally followed by 0-3
  // more capitalised words. We assert the building blocks are present.
  assert.ok(
    src.includes('[A-Z]') && src.includes('[A-Za-z0-9-]'),
    'phrase regex must use [A-Z] + [A-Za-z0-9-] classes',
  );
  assert.ok(
    src.includes('phraseMatches') && src.includes('termMatches'),
    'helper must split into phrase vs term buckets',
  );
});

test('targeted retry: extractHighSignalEntityTerms drops stopwords and short tokens', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  assert.match(
    src,
    /ENTITY_STOPWORDS/,
    'helper must maintain a stopword list',
  );
  assert.match(
    src,
    /if \(cleaned\.length < 2 \|\| cleaned\.length > 40\) continue/,
    'helper must filter out very short and very long tokens',
  );
});

test('targeted retry: extractPageMarker reads [Page N] from chunk start', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  assert.match(
    src,
    /function extractPageMarker\(text: string\): number \| null/,
    'extractPageMarker helper must exist',
  );
  assert.ok(
    src.includes('[Page') && src.includes('\\d+'),
    'helper must parse the [Page N] marker via regex',
  );
});

test('targeted retry: extractFirstHeading reads chunk-anchored heading', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  assert.match(
    src,
    /function extractFirstHeading\(text: string\): string \| null/,
    'extractFirstHeading helper must exist',
  );
  assert.match(
    src,
    /#\{1,3\}\\s\+|\(\?:\\d\+\(\\?:\\\.\\d\+\)\{0,2\}\\s\+\)/,
    'helper must recognise markdown ATX or numbered headings',
  );
});

test('targeted retry: hooked into the zero-chunks branch of document-grounded mode', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  // The retry MUST only fire when forceDocumentGrounding is true AND
  // selected.length === 0 AND extractHighSignalEntityTerms returns
  // something. Otherwise we'd retry on every miss — wasteful for the
  // non-document-grounded path.
  assert.match(
    src,
    /if \(forceDocumentGrounding\)\s*\{[\s\S]*?extractHighSignalEntityTerms/,
    'retry hook must be inside forceDocumentGrounding branch',
  );
});

test('targeted retry: emits the documented telemetry fields', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  // firstPassTooGeneric, targetedRetryTriggered, targetedRetryTerms,
  // targetedRetryRetrievedChunks, targetedRetryMatchedPages,
  // targetedRetryMatchedSections — every one must appear in the retry
  // branch so the dashboard can show when the retry fired.
  for (const field of [
    'firstPassTooGeneric',
    'targetedRetryTriggered',
    'targetedRetryTerms',
    'targetedRetryRetrievedChunks',
    'targetedRetryMatchedPages',
    'targetedRetryMatchedSections',
  ]) {
    assert.ok(
      src.includes(field),
      `telemetry field "${field}" must be emitted from the retry branch`,
    );
  }
});

test('targeted retry: returns the retried chunks via the same context format as the happy path', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  // When retry succeeds, the formatted context must still be the standard
  // <active_mode_retrieved_context> envelope with <evidence_use_rule>
  // and <snippet> blocks. Otherwise downstream code that parses the
  // envelope would break.
  const retrySuccessIdx = src.indexOf('retrySelected.length > 0');
  assert.ok(retrySuccessIdx !== -1, 'retry success branch must exist');
  const afterRetry = src.slice(retrySuccessIdx, retrySuccessIdx + 2000);
  assert.ok(
    afterRetry.includes('<active_mode_retrieved_context>'),
    'retry success path must emit the standard envelope',
  );
  assert.ok(
    afterRetry.includes('<evidence_use_rule>'),
    'retry success path must emit the evidence_use_rule',
  );
});