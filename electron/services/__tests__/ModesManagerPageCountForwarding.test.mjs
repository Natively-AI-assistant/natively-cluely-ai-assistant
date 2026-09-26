// Producer-side forwarding regression test for the 2026-07-01 pageCount fix.
//
// The 2026-06-27 round-2b (commit d3b7f0c) added page_count + extracted_page_count
// columns to mode_reference_files (v18→v19 migration), wired the values into
// DatabaseManager.addReferenceFile's INSERT, and the rowToFile mapper back into
// ModeReferenceFile.pageCount. But the INTEGRATOR — ModesManager.addReferenceFile
// — silently dropped the values when calling DatabaseManager.addReferenceFile,
// so every PDF uploaded since v19 had NULL page_count. This meant the live
// ModeContextRetriever telemetry (`referenceFileIngestedByPageHeuristic: true`,
// `referenceFilePageCount: <heuristic estimate>`) was firing on EVERY modern
// PDF — even after restart, even after re-upload.
//
// Fix (2026-07-01):
//   1. ModesManager.addReferenceFile forwards params.pageCount and
//      params.extractedPageCount to DatabaseManager.addReferenceFile.
//   2. DatabaseManager v21→v22 migration backfills NULL rows from existing
//      `[Page N]` markers (exact) or content-length/3000 (heuristic fallback).
//
// These are SOURCE-ASSERTION tests following the project's existing pattern
// (cf. ReferenceFilePageCountPersistence.test.mjs) — runtime DB tests would
// require ELECTRON_RUN_AS_NODE + better-sqlite3 native binding.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('ModesManager.addReferenceFile forwards pageCount to DatabaseManager.addReferenceFile', () => {
  const src = read('electron/services/ModesManager.ts');
  // The inner DatabaseManager.addReferenceFile(...) call MUST include
  // `pageCount: params.pageCount` on the object literal — otherwise the
  // schema-side fix and the retriever-side fix both fail silently.
  const addReferenceFileBlock = src.match(
    /public addReferenceFile\(params: \{[\s\S]*?DatabaseManager\.getInstance\(\)\.addReferenceFile\(\{[\s\S]*?\}\);/,
  );
  assert.ok(addReferenceFileBlock, 'ModesManager.addReferenceFile + DatabaseManager.addReferenceFile call must exist');

  assert.match(
    addReferenceFileBlock[0],
    /pageCount:\s*params\.pageCount/,
    'ModesManager.addReferenceFile must forward params.pageCount to DatabaseManager.addReferenceFile (round-trip integrity — fixes the 2026-07-01 missing-forwarding bug)',
  );
});

test('ModesManager.addReferenceFile forwards extractedPageCount to DatabaseManager.addReferenceFile', () => {
  const src = read('electron/services/ModesManager.ts');
  const addReferenceFileBlock = src.match(
    /public addReferenceFile\(params: \{[\s\S]*?DatabaseManager\.getInstance\(\)\.addReferenceFile\(\{[\s\S]*?\}\);/,
  );
  assert.ok(addReferenceFileBlock, 'ModesManager.addReferenceFile block must exist');

  assert.match(
    addReferenceFileBlock[0],
    /extractedPageCount:\s*params\.extractedPageCount/,
    'ModesManager.addReferenceFile must forward params.extractedPageCount to DatabaseManager.addReferenceFile (matches the symmetry of pageCount forwarding)',
  );
});

test('DatabaseManager.addReferenceFile INSERT persists page_count from forwarded value', () => {
  // Regression guard: the DB-side INSERT must accept `file.pageCount` and
  // bind it to the page_count column. This was the v18→v19 fix in d3b7f0c;
  // verify it wasn't accidentally undone by the OKF v19→v21 migrations.
  const src = read('electron/db/DatabaseManager.ts');

  assert.match(
    src,
    /public addReferenceFile\(file: \{[\s\S]*?pageCount\?: number;[\s\S]*?extractedPageCount\?: number;/,
    'DatabaseManager.addReferenceFile input shape must declare pageCount? + extractedPageCount? optional fields',
  );

  assert.match(
    src,
    /INSERT INTO mode_reference_files \(id, mode_id, file_name, content, page_count, extracted_page_count\)/,
    'INSERT column list must include page_count, extracted_page_count',
  );

  assert.match(
    src,
    /file\.pageCount \?\? null/,
    'INSERT must bind file.pageCount (with ?? null fallback for legacy callers) to page_count column',
  );

  assert.match(
    src,
    /file\.extractedPageCount \?\? null/,
    'INSERT must bind file.extractedPageCount (with ?? null fallback) to extracted_page_count column',
  );
});

test('DatabaseManager migration v21 → v22 backfills NULL page_count + extracted_page_count', () => {
  // The v22 backfill migration runs once on app start, after the existing
  // v18→v21 migrations. It must:
  //   1. Be guarded by `version < 22` so re-runs are no-ops.
  //   2. Use a WHERE page_count IS NULL clause so it's idempotent.
  //   3. Log how many rows it backfilled (observability).
  const src = read('electron/db/DatabaseManager.ts');

  assert.match(
    src,
    /Applying migration v21 → v22: Backfill NULL page_count \+ extracted_page_count on mode_reference_files/,
    'v21→v22 backfill migration block must exist with descriptive label',
  );

  assert.match(
    src,
    /if \(version < 22\)/,
    'v22 migration must be guarded by `version < 22` so re-runs are no-ops',
  );

  assert.match(
    src,
    /WHERE page_count IS NULL/,
    'backfill UPDATE must be guarded by WHERE page_count IS NULL so it is idempotent across re-runs',
  );

  assert.match(
    src,
    /this\.db\.pragma\('user_version = 22'\)/,
    'v22 migration must advance the schema version to 22 on success',
  );

  // The log message uses template-literal interpolation (`${phaseOne.changes}`
  // etc.) so we match on the template structure rather than literal numbers.
  assert.match(
    src,
    /\[DatabaseManager\] v22 backfill: derived \$\{phaseOne\.changes\} rows from \[Page N\] markers, heuristically estimated \$\{phaseTwo\.changes\} remaining rows/,
    'v22 backfill must log how many rows it touched per phase (observability for production debug)',
  );
});

test('DatabaseManager migration v21 → v22 backfill handles [Page N] marker derivation', () => {
  // Phase 1 of the backfill derives a real count from [Page N] markers
  // already present in content (injected by round-2 pdf-parse). The SQL
  // must extract the max page number from those markers. This is what
  // makes the backfill safe for existing post-v19 rows.
  const src = read('electron/db/DatabaseManager.ts');

  // The phase-1 UPDATE must reference [Page N] markers somehow — either
  // via content LIKE '%[Page %]%' guard or via substr extraction. Either
  // is acceptable; what matters is that the LIKE clause matches.
  assert.match(
    src,
    /content LIKE '%\[Page %\]%'/,
    'phase 1 of the v22 backfill must be guarded by `content LIKE \'%[Page %]%\'` so it only touches documents with [Page N] markers',
  );
});
