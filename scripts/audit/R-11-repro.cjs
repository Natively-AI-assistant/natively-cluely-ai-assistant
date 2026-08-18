#!/usr/bin/env node
/**
 * R-11 repro — v27's repair was unscoped and damaged rows v22 never touched.
 *
 * What v22 actually did (DatabaseManager.ts, v21→v22):
 *   Phase 1: `WHERE page_count IS NULL AND content LIKE '%[Page %]%'`, setting
 *            ONLY page_count (from a marker walk that was buggy — that is the
 *            corruption v27 exists to repair).
 *   Phase 2: `WHERE page_count IS NULL`, setting BOTH columns heuristically.
 *
 * The ingestion path writes the two columns TOGETHER (pageCount from
 * data.total, extractedPageCount from data.pages). So `extracted_page_count IS
 * NULL` is the signature of a row v22 Phase 1 touched, and its PRESENCE is the
 * signature of a row that came from ingestion and must be left alone.
 *
 * v27 shipped with no such scope:
 *   - the re-derive ran on every marker-bearing row, DOWNGRADING correct values
 *     on the extractor's timeout path (data.pages partial, data.total true), so
 *     a correct 10 with an honest 3/10 coverage signal became 3/3 — destroying
 *     the value and erasing the coverage gap ModeContextRetriever consumes;
 *   - the fill ran on every row, FABRICATING 100% extraction coverage for a
 *     document whose data.pages came back empty (page_count set, zero pages
 *     actually extracted).
 *
 * Fixture rows are the four the DB reviewer used. SQL is pulled verbatim from
 * the source so this cannot pass against a copy.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/audit/R-11-repro.cjs
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const REPO = path.resolve(__dirname, '..', '..');
const SRC = path.join(REPO, 'electron', 'db', 'DatabaseManager.ts');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`[R-11] ${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual} (expected ${expected})`);
};

// --- Pull v27's two UPDATE statements verbatim out of the source ----------
const src = fs.readFileSync(SRC, 'utf8');
// Anchor on the migration's PURPOSE, never its version number: the number
// legitimately changes when this branch is merged (main's usage_outbox also
// claimed v27, so the repair was renumbered to v28). Pinning the number made
// this repro fail against correct code.
const anchor = src.indexOf('REPAIR the page counts corrupted by v22');
if (anchor < 0) { console.error('[R-11] FAIL: page-count repair migration not found in source'); process.exit(1); }
const endMarker = src.indexOf('page-count repair failed', anchor);
if (endMarker < 0) { console.error('[R-11] FAIL: end of the repair block not found'); process.exit(1); }
const v27Block = src.slice(anchor, endMarker);
const stmts = [...v27Block.matchAll(/`(\s*UPDATE mode_reference_files[\s\S]*?)`/g)].map((m) => m[1]);
if (stmts.length !== 2) {
  console.error(`[R-11] FAIL: expected 2 UPDATE statements in the page-count repair, found ${stmts.length}`);
  process.exit(1);
}
const [REDERIVE_SQL, FILL_SQL] = stmts;

// --- Real table, the reviewer's four rows --------------------------------
const db = new Database(':memory:');
db.exec(`CREATE TABLE mode_reference_files (
  id TEXT PRIMARY KEY, content TEXT, page_count INTEGER, extracted_page_count INTEGER
);`);

const marked = (n) => Array.from({ length: n }, (_, i) => `[Page ${i + 1}] body text`).join('\n');
const ins = db.prepare('INSERT INTO mode_reference_files (id, content, page_count, extracted_page_count) VALUES (?,?,?,?)');
// timeout : ingested. data.total=10 (correct), data.pages=3 -> honest 3/10 coverage.
ins.run('timeout', marked(3), 10, 3);
// good    : ingested cleanly, 10/10.
ins.run('good', marked(10), 10, 10);
// nopages : ingested, data.total=7 but data.pages EMPTY -> no markers, ext NULL.
ins.run('nopages', 'plain text with no page markers at all', 7, null);
// scanned : ingested, 5 pages, zero text extracted -> ext = 0 (not NULL).
ins.run('scanned', 'scanned image pdf, no text layer', 5, 0);
// v22bad  : the row v27 EXISTS to repair — v22 wrote a wrong page_count and
//           never wrote extracted_page_count. Real content has 6 markers.
ins.run('v22bad', marked(6), 1, null);

const dump = () => db.prepare('SELECT id, page_count pc, extracted_page_count epc FROM mode_reference_files ORDER BY id').all();
console.log('[R-11] BEFORE:', JSON.stringify(dump()));

db.prepare(REDERIVE_SQL).run();
db.prepare(FILL_SQL).run();

const after = Object.fromEntries(dump().map((r) => [r.id, r]));
console.log('[R-11] AFTER :', JSON.stringify(dump()));

// The row v27 exists to repair MUST be repaired.
check('v22bad page_count repaired 1 -> 6  ', after.v22bad.pc, 6);
check('v22bad extracted filled to 6       ', after.v22bad.epc, 6);

// Rows v22 never touched must be untouched.
check('timeout keeps its correct total 10 ', after.timeout.pc, 10);
check('timeout keeps honest coverage 3    ', after.timeout.epc, 3);
check('good is unchanged (10)             ', after.good.pc, 10);
check('good coverage unchanged (10)       ', after.good.epc, 10);
check('nopages keeps its total 7          ', after.nopages.pc, 7);
check('nopages coverage stays UNKNOWN     ', after.nopages.epc, null);
check('scanned keeps its total 5          ', after.scanned.pc, 5);
check('scanned coverage stays 0           ', after.scanned.epc, 0);

if (failures) {
  console.error('[R-11] FAIL: v27 damaged rows v22 never corrupted, or failed to repair the one it should.');
  process.exit(1);
}
console.log('[R-11] PASS: v27 repairs only what v22 could have corrupted.');
