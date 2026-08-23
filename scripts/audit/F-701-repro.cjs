// F-701 repro: migration v21→v22 writes a GLOBAL MAX page_count to every
// reference file, permanently corrupting per-document page counts on upgrade.
//
// The recursive CTE seeds from `FROM mode_reference_files WHERE
// mode_reference_files.id = mode_reference_files.id` — that predicate binds to
// the INNER FROM instance, so it is a tautology and the subquery is
// UNCORRELATED: MAX(page_num) is the maximum across the WHOLE table, written
// into every matching row. `page_count IS NULL` is then false, so a re-run is
// a no-op and the wrong value is permanent. Fresh profiles are unaffected
// (empty table) — this is upgrade-only.
//
// This runs the migration SQL EXACTLY as extracted from DatabaseManager.ts.
//
// Expected (correct): each document reports its own page count → exit 0.
// Bug (F-701): every row gets the table-wide max → exit 1.
//
// Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/audit/F-701-repro.cjs
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '../..');
const src = fs.readFileSync(path.join(root, 'electron/db/DatabaseManager.ts'), 'utf8');
const START = 'const phaseOne = this.db.prepare(`';
const i = src.indexOf(START);
const j = src.indexOf('`).run();', i);
if (i < 0 || j < 0) { console.error('[F-701] Inconclusive: could not extract phase-1 SQL'); process.exit(2); }
const phaseOneSql = src.slice(i + START.length, j);

const db = new Database(':memory:');
db.exec(`CREATE TABLE mode_reference_files (
  id TEXT PRIMARY KEY, content TEXT, page_count INTEGER, extracted_page_count INTEGER
);`);
const ins = db.prepare('INSERT INTO mode_reference_files (id, content) VALUES (?, ?)');
ins.run('small-3page', '[Page 1] a [Page 2] b [Page 3] c');
ins.run('big-6page',   '[Page 1] a [Page 2] b [Page 3] c [Page 4] d [Page 5] e [Page 6] f');

db.prepare(phaseOneSql).run();

const rows = db.prepare('SELECT id, page_count, extracted_page_count FROM mode_reference_files ORDER BY id').all();
console.log('[F-701] after migration:', JSON.stringify(rows));

const small = rows.find(r => r.id === 'small-3page');
const big = rows.find(r => r.id === 'big-6page');
let bad = false;
if (small.page_count !== 3) { console.error(`[F-701] small-3page reports ${small.page_count} pages, expected 3`); bad = true; }
if (big.page_count !== 6)   { console.error(`[F-701] big-6page reports ${big.page_count} pages, expected 6`); bad = true; }
if (bad) {
  console.error('[F-701] FAIL: the uncorrelated subquery wrote a table-wide MAX into every row — permanent, non-self-healing corruption (F-701 reproduced).');
  process.exit(1);
}
console.log('[F-701] PASS: each document derived its own page count.');
process.exit(0);
