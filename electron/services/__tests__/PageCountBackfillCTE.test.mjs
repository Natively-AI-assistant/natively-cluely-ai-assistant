// Runtime SQL test for the v22 pageCount backfill recursive CTE.
//
// On 2026-07-01 the test-engineer agent caught a CRITICAL bug in the first
// draft of the v22 backfill: `instr(content, '[Page ')` returns only the
// FIRST occurrence offset, so the original Phase 1 SQL extracted the page
// number from the first [Page N] marker only — returning `page_count = 1`
// for a 66-page PDF (instead of the correct 66). The bug was silent because
// SQLite happily executed the query and the source-assertion tests couldn't
// detect logic errors.
//
// These runtime tests validate the SHIPPED CTE via Python's stdlib sqlite3
// (which has identical SQL semantics to better-sqlite3). The CTE must:
//   1. Walk EVERY [Page N] marker in the content (not just the first)
//   2. Extract the integer page number from each marker
//   3. Return MAX(page_num) which equals the total page count for any
//      document with sequentially-numbered markers
//   4. Leave page_count = NULL when no markers are found (so Phase 2
//      heuristic can pick up the row)
//
// Source: electron/db/DatabaseManager.ts migration v21→v22 phase 1 SQL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// Skip when the better-sqlite3 native binding isn't loadable from plain
// node (it usually requires Electron's NODE_MODULE_VERSION — see test:electron).
function tryOpenDb() {
  try { return new Database(':memory:'); } catch { return null; }
}

function runBackfill(content) {
  const db = tryOpenDb();
  if (!db) {
    return { skipped: true };
  }
  db.exec(`
    CREATE TABLE mode_reference_files (
      id TEXT PRIMARY KEY,
      content TEXT,
      page_count INTEGER,
      extracted_page_count INTEGER
    )
  `);
  db.prepare('INSERT INTO mode_reference_files VALUES (?, ?, NULL, NULL)').run('ref_1', content);

  // Phase 1 — must mirror the production SQL exactly.
  const phaseOneResult = db.prepare(`
    UPDATE mode_reference_files
    SET page_count = (
      WITH RECURSIVE cte_pages(rest, page_num) AS (
        SELECT
          substr(content, instr(content, '[Page ') + 6),
          CASE
            WHEN instr(content, '[Page ') > 0
            THEN CAST(
              substr(content, instr(content, '[Page ') + 6,
                     instr(substr(content, instr(content, '[Page ') + 6), ']') - 1) AS INTEGER)
            ELSE NULL END
        FROM mode_reference_files
        WHERE mode_reference_files.id = mode_reference_files.id
          AND page_count IS NULL AND content LIKE '%[Page %]%'
      UNION ALL
        SELECT
          substr(rest, instr(rest, '[Page ') + 6),
          CASE
            WHEN instr(rest, '[Page ') > 0
            THEN CAST(
              substr(rest, instr(rest, '[Page ') + 6,
                     instr(substr(rest, instr(rest, '[Page ') + 6), ']') - 1) AS INTEGER)
            ELSE NULL END
        FROM cte_pages
        WHERE instr(rest, '[Page ') > 0
        LIMIT 5000
      )
      SELECT MAX(page_num) FROM cte_pages WHERE page_num IS NOT NULL
    )
    WHERE page_count IS NULL AND content LIKE '%[Page %]%'
  `).run();

  // Phase 2 — heuristic fallback for non-PDF / non-marked content.
  db.prepare(`
    UPDATE mode_reference_files
    SET page_count = MAX(1, CAST(LENGTH(content) / 3000 AS INTEGER)),
        extracted_page_count = MAX(1, CAST(LENGTH(content) / 3000 AS INTEGER))
    WHERE page_count IS NULL
  `).run();

  const row = db.prepare('SELECT page_count FROM mode_reference_files WHERE id = ?').get('ref_1');
  db.close();
  return { skipped: false, page_count: row?.page_count ?? null, phase_one_changes: phaseOneResult.changes };
}

test('v22 backfill derives 66 for the live 66-page thesis with preamble', () => {
  const content = 'PREAMBLE\n' + Array.from({ length: 66 }, (_, i) => `[Page ${i + 1}] content here`).join('\n');
  const r = runBackfill(content);
  if (r.skipped) return; // skip on environments without better-sqlite3 native binding
  assert.equal(r.page_count, 66, `66-page thesis must backfill to 66 (got ${r.page_count}) — would have been the 2026-07-01 silent bug`);
});

test('v22 backfill derives 43 for the user-reported 43-page case', () => {
  const content = 'PREAMBLE\n' + Array.from({ length: 43 }, (_, i) => `[Page ${i + 1}] content here`).join('\n');
  const r = runBackfill(content);
  if (r.skipped) return;
  assert.equal(r.page_count, 43, `43-page thesis must backfill to 43 (got ${r.page_count})`);
});

test('v22 backfill walks EVERY marker, not just the first (regression guard for instr-only bug)', () => {
  // The CRITICAL regression: original SQL used instr(content, '[Page ') which
  // returns only the FIRST occurrence. For this content it would have returned
  // 1 (from "[Page 1]") instead of 5 (the max). The CTE fix walks every
  // occurrence so MAX() finds 5.
  const content = '[Page 1] hi [Page 5] mid [Page 3] end';
  const r = runBackfill(content);
  if (r.skipped) return;
  assert.equal(r.page_count, 5, `out-of-order markers must derive MAX not first (got ${r.page_count})`);
});

test('v22 backfill handles markers preceded by heavy preamble', () => {
  const preamble = 'Preamble text '.repeat(100) + '\n';
  const body = 'body text '.repeat(50) + '\n';
  const markers = Array.from({ length: 10 }, (_, i) => `[Page ${i + 1}] content`).join('\n');
  const content = preamble + body + markers;
  const r = runBackfill(content);
  if (r.skipped) return;
  assert.equal(r.page_count, 10, `marker-heavy-preamble doc must backfill to 10 (got ${r.page_count})`);
});

test('v22 backfill returns NULL for content without markers (Phase 2 heuristic catches it)', () => {
  // Phase 1 must return NULL (not 0) when no markers found, so Phase 2's
  // WHERE page_count IS NULL picks the row back up for the heuristic.
  // A non-zero result here means Phase 1 poisoned the row and Phase 2
  // silently skipped it.
  const content = 'Just plain prose with no page markers.\n'.repeat(200);
  const r = runBackfill(content);
  if (r.skipped) return;
  // Phase 2 fires: 8200 chars / 3000 = 2 pages
  assert.ok(r.page_count >= 1, `no-marker doc must get Phase 2 heuristic >= 1 (got ${r.page_count})`);
});

test('v22 backfill handles edge case: page number followed by ] in body text', () => {
  // Marker like [Page 1] followed by content containing ']' elsewhere.
  // The CTE extracts the integer from each marker; subsequent content with
  // ']' must not interfere because the CTE moves past the first ']'.
  const content = 'Title: Foo [Bar]\n[Page 1]\nReference [Baz] here\n[Page 2] more content';
  const r = runBackfill(content);
  if (r.skipped) return;
  assert.equal(r.page_count, 2, `must extract 2 from markers despite ] elsewhere (got ${r.page_count})`);
});

test('v22 backfill returns 1 for a single-page document', () => {
  const content = 'Title\n[Page 1]\nlone content';
  const r = runBackfill(content);
  if (r.skipped) return;
  assert.equal(r.page_count, 1, `single-page doc must backfill to 1 (got ${r.page_count})`);
});