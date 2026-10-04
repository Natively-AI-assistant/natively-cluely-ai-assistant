// The v30 migration rebuilt every vec0 table from the BLOB columns in one
// synchronous pass before the first window: 141 MB of vectors for a
// 12,000-chunk profile (2026-10-05). The work a launch does is now capped; a
// table that has to be rebuilt and does not fit is recorded in app_state,
// searched from the stored vectors (the JS cosine path) meanwhile, and rebuilt
// after launch a slice at a time.
//
// The same pass repairs two states shipped builds left behind, which the
// block-size cap added earlier the same day would otherwise have frozen in
// place for any large table:
//   - v30's own rebuild re-inserted NOTHING (it wrote inside an open
//     iterator), so an install that upgraded through it has only the vectors
//     embedded since, and a native query cannot find an older meeting;
//   - re-saving a meeting deleted its chunk rows by cascade and left their
//     vectors behind, where they take up places in every top-k.
//
// Measured 2026-10-05 on an M-series laptop under load, a version-29 profile
// with 12,000 vectors at 3,072 dimensions (141 MB), two runs:
//   one pass during the launch (the old block)   1,123 / 1,309 ms before the first window
//   now: the launch                                   8 /    12 ms
//        the background pass, start to finish       821 /   836 ms, longest hold of the main process 46 / 44 ms
//        a search while the table is recorded       143 /   173 ms (reads every stored vector)
//        a search afterwards                         52 /    42 ms
//        the next launch                              2 /     1 ms
//
// Run under Electron ABI (better-sqlite3):
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test <file>
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = path.join(root, 'dist-electron/electron/db/DatabaseManager.js');
const { VectorStore } = require(path.join(root, 'dist-electron/electron/rag/VectorStore.js'));

const DIM = 16;                 // 64 bytes a vector
const BUDGET = 200;             // bytes one launch may copy in these tests
const SPACE = 'test:space:16';
const PENDING_KEY = 'vec_rebuild_pending_v1';
const SETTLED_KEY = 'vec_block_shrink_settled_v1';
const CHUNKS = `vec_chunks_${DIM}`;
const SUMMARIES = `vec_summaries_${DIM}`;

let tmp, dbMgr;
const vec = (seed) => Buffer.from(new Float32Array(Array.from({ length: DIM }, (_, i) => Math.sin(seed * 1.7 + i * 0.9) + (i === seed % DIM ? 2 : 0))).buffer);
const asArray = (buf) => Array.from(new Float32Array(buf.buffer, buf.byteOffset, DIM));
const quiet = (fn) => {
  const log = console.log, warn = console.warn, error = console.error;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  const restore = () => { console.log = log; console.warn = warn; console.error = error; };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(restore);
    restore();
    return out;
  } catch (e) { restore(); throw e; }
};
function open(budget) {
  process.env.NATIVELY_TEST_USERDATA = tmp;
  delete require.cache[DB_PATH];
  const cls = require(DB_PATH).DatabaseManager;
  if (budget !== undefined) cls.vecRebuildBudgetBytes = budget;
  dbMgr = quiet(() => cls.getInstance());
  return dbMgr;
}
function close() {
  try { dbMgr?.close?.(); } catch {}
  delete require.cache[DB_PATH];
}
const db = () => dbMgr.getDb();
const usable = () => {
  if (!dbMgr.isAvailable()) return false;
  try { db().prepare('SELECT vec_version()').get(); return true; } catch { return false; }
};
const ddl = (name) => db().prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name)?.sql || '';
const pending = () => JSON.parse(db().prepare('SELECT value FROM app_state WHERE key = ?').get(PENDING_KEY)?.value || '{}');
const vecCount = (name = CHUNKS) => db().prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n;
const store = () => quiet(() => new VectorStore(db(), '', ''));
// Ids of the nearest chunks, and whether the native path was the one that answered.
async function search(seed, limit = 3) {
  const vs = store();
  let native = false;
  const real = vs.searchSimilarNative.bind(vs);
  vs.searchSimilarNative = (...args) => { native = true; return real(...args); };
  const hits = await vs.searchSimilar(asArray(vec(seed)), { limit, minSimilarity: -1, spaceKey: SPACE });
  return { ids: hits.map(h => h.id), native };
}
const exact = (seed, limit = 3) => store().searchSimilarJS(asArray(vec(seed)), undefined, limit, -1, SPACE).map(h => h.id);

/**
 * An older install: `count` embedded chunks and one embedded summary, with the
 * vec0 tables in the given shape. Returns the chunk ids in insertion order.
 */
function seed(count, { metric = true, vecRowsFor = (ids) => ids, userVersion } = {}) {
  const d = db();
  d.exec(`DROP TABLE IF EXISTS ${CHUNKS}; DROP TABLE IF EXISTS ${SUMMARIES};`);
  const tail = metric ? ' distance_metric=cosine' : '';
  d.exec(`CREATE VIRTUAL TABLE ${CHUNKS} USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${DIM}]${tail})`);
  d.exec(`CREATE VIRTUAL TABLE ${SUMMARIES} USING vec0(summary_id INTEGER PRIMARY KEY, embedding float[${DIM}]${tail})`);
  d.prepare(`INSERT INTO meetings (id, title, start_time, duration_ms, embedding_space) VALUES ('m1', 't', 1, 1, ?)`).run(SPACE);
  const insChunk = d.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding) VALUES ('m1', ?, 'Me', 1, 2, 'text', 1, ?)`);
  const ids = [];
  d.transaction(() => { for (let i = 0; i < count; i++) ids.push(Number(insChunk.run(i, vec(i)).lastInsertRowid)); })();
  const insVec = d.prepare(`INSERT INTO ${CHUNKS}(chunk_id, embedding) VALUES (?, ?)`);
  d.transaction(() => { for (const id of vecRowsFor(ids)) insVec.run(BigInt(id), vec(ids.indexOf(id) >= 0 ? ids.indexOf(id) : id)); })();
  const sumId = d.prepare(`INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('m1', 's', ?)`).run(vec(900)).lastInsertRowid;
  d.prepare(`INSERT INTO ${SUMMARIES}(summary_id, embedding) VALUES (?, ?)`).run(BigInt(sumId), vec(900));
  d.prepare('DELETE FROM app_state WHERE key IN (?, ?)').run(SETTLED_KEY, PENDING_KEY);
  if (userVersion !== undefined) d.pragma(`user_version = ${userVersion}`);
  return ids;
}
const relaunch = (budget = BUDGET) => { close(); open(budget); };

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vec-deferred-')); open(16 * 1024 * 1024); });
afterEach(() => {
  close();
  require(DB_PATH).DatabaseManager.vecRebuildBudgetBytes = 16 * 1024 * 1024;
  delete require.cache[DB_PATH];
  delete process.env.NATIVELY_TEST_USERDATA;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe('upgrading from before the cosine migration with a large index', () => {
  test('the launch does not copy the large table, and search is right at once', async () => {
    if (!usable()) return;
    const ids = seed(40, { metric: false, userVersion: 29 });      // 2,560 bytes of vectors, budget 200
    relaunch();

    assert.ok(db().pragma('user_version', { simple: true }) >= 30, 'the schema version advances');
    assert.doesNotMatch(ddl(CHUNKS), /distance_metric/, 'the large table was not rebuilt during the launch');
    assert.deepEqual(pending()[CHUNKS], { recreated: false, cursor: 0 }, 'it is recorded for after launch');
    assert.match(ddl(SUMMARIES), /distance_metric=cosine/, 'the small table beside it was rebuilt at once');
    assert.equal(pending()[SUMMARIES], undefined);

    const found = await search(7);
    assert.equal(found.native, false, 'the L2 table is not the one a query reads');
    assert.deepEqual(found.ids, exact(7));
    assert.equal(found.ids[0], ids[7]);
  });

  test('after the background pass the table is cosine, complete, and searched natively with the same answer', async () => {
    if (!usable()) return;
    const ids = seed(40, { metric: false, userVersion: 29 });
    relaunch();
    const before = (await search(7)).ids;

    assert.equal(await quiet(() => dbMgr.runPendingVecRebuilds()), 40);
    assert.deepEqual(pending(), {}, 'nothing is left recorded');
    assert.match(ddl(CHUNKS), /distance_metric=cosine/);
    assert.match(ddl(CHUNKS), /chunk_size\s*=\s*64/);
    assert.equal(vecCount(), 40);

    const after = await search(7);
    assert.equal(after.native, true);
    assert.deepEqual(after.ids, before, 'same nearest chunks as the exact search gave');
    assert.equal(after.ids[0], ids[7]);

    relaunch();                                                     // and the launch after that changes nothing
    assert.deepEqual(pending(), {});
    assert.equal(vecCount(), 40);
    assert.equal(db().prepare('SELECT value FROM app_state WHERE key = ?').get(SETTLED_KEY)?.value, '1');
  });

  test('a small index is still rebuilt during the launch, with nothing recorded', async () => {
    if (!usable()) return;
    const ids = seed(2, { metric: false, userVersion: 29 });        // 128 bytes, inside the budget
    relaunch();
    assert.match(ddl(CHUNKS), /distance_metric=cosine/);
    assert.equal(vecCount(), 2);
    assert.deepEqual(pending(), {});
    const found = await search(1, 1);
    assert.equal(found.native, true);
    assert.deepEqual(found.ids, [ids[1]]);
  });
});

describe('a table left incomplete by the migration that re-inserted nothing', () => {
  // Cosine DDL, default blocks, and only the vectors embedded after the upgrade.
  const brokenV30 = () => seed(40, { vecRowsFor: (ids) => ids.slice(-3) });

  test('the defect: a native query cannot find an older chunk', () => {
    if (!usable()) return;
    const ids = brokenV30();
    const native = store().searchSimilarNative(asArray(vec(7)), undefined, 3, -1, SPACE).map(h => h.id);
    assert.equal(native.includes(ids[7]), false, 'precondition: this is the state being repaired');
  });

  test('a large one is recorded, searched exactly meanwhile, and refilled after launch', async () => {
    if (!usable()) return;
    const ids = brokenV30();
    relaunch();
    assert.deepEqual(pending()[CHUNKS], { recreated: false, cursor: 0 }, 'not written off as densely packed');
    assert.equal((await search(7)).ids[0], ids[7], 'the older chunk is found before the refill');

    await quiet(() => dbMgr.runPendingVecRebuilds());
    assert.equal(vecCount(), 40);
    const after = await search(7);
    assert.equal(after.native, true);
    assert.equal(after.ids[0], ids[7]);
  });

  test('a small one is refilled during the launch', async () => {
    if (!usable()) return;
    seed(3, { vecRowsFor: (ids) => ids.slice(-1) });
    relaunch();
    assert.equal(vecCount(), 3);
    assert.deepEqual(pending(), {});
  });
});

describe('vectors whose chunk rows are gone', () => {
  test('a large table carrying them is rebuilt without them', async () => {
    if (!usable()) return;
    seed(40, { vecRowsFor: (ids) => [...ids, 9001, 9002, 9003] });
    relaunch();
    assert.ok(pending()[CHUNKS], 'recorded for the background pass');
    await quiet(() => dbMgr.runPendingVecRebuilds());
    assert.equal(vecCount(), 40);
    assert.equal(db().prepare(`SELECT COUNT(*) AS n FROM ${CHUNKS}_rowids WHERE rowid >= 9001`).get().n, 0);
  });

  test('a large table that is complete and exact is left alone and searched natively', async () => {
    if (!usable()) return;
    const ids = seed(40);
    relaunch();
    assert.deepEqual(pending(), {});
    assert.doesNotMatch(ddl(CHUNKS), /chunk_size/, 'nothing about it is wrong, so it is not copied');
    const found = await search(7);
    assert.equal(found.native, true);
    assert.equal(found.ids[0], ids[7]);
  });
});

describe('the background pass can be interrupted', () => {
  test('a quit between slices keeps the cursor; the next launch resumes and finishes', async () => {
    if (!usable()) return;
    const ids = seed(2500, { metric: false, userVersion: 29 });     // 1,000 rows a slice at this width
    relaunch();
    const run = quiet(() => dbMgr.runPendingVecRebuilds());
    await new Promise(resolve => setImmediate(resolve));             // one slice in
    close();                                                         // the app quits
    const copiedBeforeQuit = await run;
    assert.ok(copiedBeforeQuit >= 1000 && copiedBeforeQuit < 2500, `stopped part way (${copiedBeforeQuit})`);

    open(BUDGET);
    const state = pending()[CHUNKS];
    assert.equal(state.recreated, true);
    assert.ok(state.cursor >= ids[999] && state.cursor < ids[2499], 'the cursor was saved with the slice');
    assert.equal(vecCount(), copiedBeforeQuit, 'the part-filled table is kept');
    const mid = await search(2400);
    assert.equal(mid.native, false, 'a part-filled table is not searched natively');
    assert.equal(mid.ids[0], ids[2400], 'a chunk not copied yet is still found');

    assert.equal(await quiet(() => dbMgr.runPendingVecRebuilds()), 2500 - copiedBeforeQuit, 'only the rest is copied');
    assert.equal(vecCount(), 2500);
    assert.deepEqual(pending(), {});
  });

  test('a vector embedded while the table is recorded is not lost', async () => {
    if (!usable()) return;
    seed(40, { metric: false, userVersion: 29 });
    relaunch();
    const d = db();
    const id = Number(d.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding) VALUES ('m1', 99, 'Me', 1, 2, 'new', 1, ?)`).run(vec(99)).lastInsertRowid);
    await quiet(() => dbMgr.runPendingVecRebuilds());
    assert.equal(vecCount(), 41);
    assert.equal((await search(99)).ids[0], id);
  });
});

describe('wiring', () => {
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

  test('the migration no longer copies vectors itself', () => {
    const src = read('electron/db/DatabaseManager.ts');
    const block = src.slice(src.indexOf('if (version < 30) {'), src.indexOf('if (version < 31) {'));
    assert.match(block, /this\.repairVecTables\(\{ fromMigration: true \}\);\s*\n\s*this\.db\.pragma\('user_version = 30'\);/);
    assert.doesNotMatch(block, /reinsertVectorsFromBlobs|DROP TABLE/);
  });

  test('both native searches check the record first, and it lives in the database', () => {
    const vs = read('electron/rag/VectorStore.ts');
    assert.match(vs, /this\.useNativeVec && !isVecTableRebuildPending\(this\.db, `vec_chunks_\$\{queryEmbedding\.length\}`\)/);
    assert.match(vs, /this\.useNativeVec && !isVecTableRebuildPending\(this\.db, `vec_summaries_\$\{queryEmbedding\.length\}`\)/);
    assert.equal((vs.match(/embedding MATCH \?/g) || []).length, 2, 'a third native reader would need the same check');
    assert.match(read('electron/db/vecRebuildPending.ts'), /SELECT value FROM app_state WHERE key = \?/);
  });

  test('the background pass is started after open and stopped on both close paths', () => {
    const src = read('electron/db/DatabaseManager.ts');
    assert.match(src, /this\.runMigrations\(\);\s*\n\s*this\.repairVecTables\(\);\s*\n\s*this\.scheduleVecRebuilds\(\);/);
    assert.equal((src.match(/this\.cancelScheduledVecRebuilds\(\);/g) || []).length, 2);
    const slices = src.slice(src.indexOf('private async rebuildVecTableInSlices(')).slice(0, 4500)
      .split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    assert.ok(slices.includes('page.all('), 'rows are read in pages');
    assert.ok(!/\.iterate\(/.test(slices), 'no statement may run while an iterator is open');
  });
});
