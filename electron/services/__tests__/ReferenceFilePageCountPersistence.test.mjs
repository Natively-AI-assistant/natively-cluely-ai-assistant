// Source-contract tests for the 2026-06-27 pageCount persistence fix.
//
// CRITICAL: the previous commit (d3b7f0c) added `pageCount` /
// `extractedPageCount` to ModeReferenceFile but did NOT persist them in
// DatabaseManager.addReferenceFile and did NOT round-trip them through
// rowToFile. As a result the values were written to the in-memory return
// object only and silently dropped at the next getReferenceFiles SELECT
// — the 47-vs-67 page mismatch returned on every app restart.
//
// These tests are SOURCE-ASSERTION tests (the project's existing pattern
// for non-runtime surfaces). They verify the four code paths that close
// the regression:
//   1. DatabaseManager migration block adds the columns (v18 → v19).
//   2. DatabaseManager.addReferenceFile INSERT includes page_count +
//      extracted_page_count.
//   3. rowToFile in ModesManager maps row.page_count + row.extracted_page_count
//      back to ModeReferenceFile.pageCount + extractedPageCount.
//   4. reportReferenceFilePageCounts prefers the real pageCount when
//      set, falls back to the heuristic when not.
//
// Runtime regression tests for the DB itself would require
// ELECTRON_RUN_AS_NODE + better-sqlite3 native binding (Node 25 ABI
// mismatch) — see test:electron. These source assertions catch the
// regressions that DID slip through to commit d3b7f0c.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('DatabaseManager migration v18 → v19 adds page_count + extracted_page_count columns', () => {
  const src = read('electron/db/DatabaseManager.ts');
  assert.match(
    src,
    /Applying migration v18 → v19: Add page_count \+ extracted_page_count to mode_reference_files/,
    'v18→v19 migration block must exist and label the new columns',
  );
  assert.match(
    src,
    /ALTER TABLE mode_reference_files ADD COLUMN page_count INTEGER/,
    'page_count column must be added',
  );
  assert.match(
    src,
    /ALTER TABLE mode_reference_files ADD COLUMN extracted_page_count INTEGER/,
    'extracted_page_count column must be added',
  );
  assert.match(
    src,
    /this\.db\.pragma\('user_version = 19'\)/,
    'user_version must be bumped to 19 after the migration runs',
  );
});

test('DatabaseManager.addReferenceFile INSERT includes page_count + extracted_page_count', () => {
  const src = read('electron/db/DatabaseManager.ts');
  assert.match(
    src,
    /INSERT INTO mode_reference_files\s*\(\s*id,\s*mode_id,\s*file_name,\s*content,\s*page_count,\s*extracted_page_count\s*\)/,
    'INSERT statement must list the two new columns',
  );
  assert.match(
    src,
    /file\.pageCount \?\? null/,
    'pageCount is passed through as null when undefined (old uploads)',
  );
  assert.match(
    src,
    /file\.extractedPageCount \?\? null/,
    'extractedPageCount is passed through as null when undefined',
  );
});

test('ModesManager rowToFile round-trips pageCount + extractedPageCount from the DB row', () => {
  const src = read('electron/services/ModesManager.ts');
  assert.match(
    src,
    /pageCount: typeof row\.page_count === 'number' \? row\.page_count : undefined/,
    'rowToFile must map row.page_count (snake_case from SQLite) to ModeReferenceFile.pageCount',
  );
  assert.match(
    src,
    /extractedPageCount: typeof row\.extracted_page_count === 'number' \? row\.extracted_page_count : undefined/,
    'rowToFile must map row.extracted_page_count to extractedPageCount',
  );
});

test('reportReferenceFilePageCounts prefers real pageCount when set', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  // The helper accepts ModeReferenceFile[] and returns real numbers when
  // ANY file has pageCount set. This is the entire point of F1+F2 — the
  // retriever MUST use the real count, not the heuristic, when available.
  assert.match(
    src,
    /function reportReferenceFilePageCounts\(files: ModeReferenceFile\[\]\)/,
    'helper must exist and accept ModeReferenceFile[]',
  );
  assert.match(
    src,
    /typeof file\.pageCount === 'number' && file\.pageCount > 0/,
    'helper must check file.pageCount is a positive number',
  );
  assert.match(
    src,
    /hasRealPdf\s*=\s*true/,
    'helper must set hasRealPdf when a real pageCount is available',
  );
  assert.match(
    src,
    /referenceFileIngestedByPageHeuristic/,
    'helper must distinguish heuristic-fallback from real page count in telemetry',
  );
});

test('reportReferenceFilePageCounts falls back to heuristic when no pageCount is set', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  // Old text/md/docx uploads and pre-migration PDF uploads have no
  // pageCount. The heuristic (content length / 3000 chars/page) keeps
  // working — but the telemetry must mark it as heuristic so the
  // dashboard can distinguish "real" from "estimated" page counts.
  assert.match(
    src,
    /Math\.max\(\s*1,\s*Math\.ceil\(files\.reduce[\s\S]*?\/ 3000\)/,
    '3000-char heuristic must remain as the fallback',
  );
});