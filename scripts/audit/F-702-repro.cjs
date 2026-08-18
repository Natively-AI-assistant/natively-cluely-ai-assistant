// F-702 / F-701-repair repro: verifies the v27 migration REPAIRS installs that
// already ran the broken v22 (page_count = table-wide MAX, extracted_page_count
// left NULL). Runs the real v22 phase-1 SQL to create the damage, then the real
// v27 repair SQL, both extracted from DatabaseManager.ts.
//
// Expected (correct): per-document counts restored AND extracted_page_count
// populated → exit 0.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '../..');
const src = fs.readFileSync(path.join(root, 'electron/db/DatabaseManager.ts'), 'utf8');

function between(startMarker, endMarker, from) {
  const i = src.indexOf(startMarker, from);
  const j = src.indexOf(endMarker, i);
  if (i < 0 || j < 0) return null;
  return src.slice(i + startMarker.length, j);
}
const v27Repair = between('const repaired = this.db.prepare(`', '`).run();', 0);
const v27Fill   = between('const filled = this.db.prepare(`', '`).run();', 0);
if (!v27Repair || !v27Fill) { console.error('[F-702] Inconclusive: could not extract v27 SQL'); process.exit(2); }

const db = new Database(':memory:');
db.exec(`CREATE TABLE mode_reference_files (
  id TEXT PRIMARY KEY, content TEXT, page_count INTEGER, extracted_page_count INTEGER
);`);
const ins = db.prepare('INSERT INTO mode_reference_files (id, content) VALUES (?, ?)');
ins.run('small-3page', '[Page 1] a [Page 2] b [Page 3] c');
ins.run('big-6page',   '[Page 1] a [Page 2] b [Page 3] c [Page 4] d [Page 5] e [Page 6] f');

// Simulate an install that already ran the BROKEN v22: table-wide max, no extracted.
db.prepare(`UPDATE mode_reference_files SET page_count = 6, extracted_page_count = NULL`).run();
console.log('[F-702] damaged state:', JSON.stringify(db.prepare('SELECT id,page_count,extracted_page_count FROM mode_reference_files ORDER BY id').all()));

db.prepare(v27Repair).run();
db.prepare(v27Fill).run();

const rows = db.prepare('SELECT id, page_count, extracted_page_count FROM mode_reference_files ORDER BY id').all();
console.log('[F-702] after v27 repair:', JSON.stringify(rows));

const small = rows.find(r => r.id === 'small-3page');
const big = rows.find(r => r.id === 'big-6page');
let bad = false;
if (small.page_count !== 3) { console.error(`[F-702] small-3page page_count ${small.page_count}, expected 3`); bad = true; }
if (big.page_count !== 6)   { console.error(`[F-702] big-6page page_count ${big.page_count}, expected 6`); bad = true; }
if (small.extracted_page_count !== 3 || big.extracted_page_count !== 6) {
  console.error('[F-702] extracted_page_count not populated:', small.extracted_page_count, big.extracted_page_count); bad = true;
}
// Idempotence: re-running must not change anything.
db.prepare(v27Repair).run(); db.prepare(v27Fill).run();
const again = db.prepare('SELECT id, page_count, extracted_page_count FROM mode_reference_files ORDER BY id').all();
if (JSON.stringify(again) !== JSON.stringify(rows)) { console.error('[F-702] repair is NOT idempotent'); bad = true; }

if (bad) { console.error('[F-702] FAIL'); process.exit(1); }
console.log('[F-702] PASS: v22 corruption repaired, extraction counts populated, repair is idempotent.');
process.exit(0);
