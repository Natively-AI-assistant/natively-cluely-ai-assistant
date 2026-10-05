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
const { prepareVecRowWriter: writer } = require(path.join(root, 'dist-electron/electron/db/vecRowWrite.js'));

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
    // Recorded to be FILLED, not dropped: the table has the right shape, it is only short of rows.
    assert.deepEqual(pending()[CHUNKS], { recreated: true, cursor: 0 }, 'not written off as densely packed');
    assert.equal(vecCount(), 3, 'the rows it has are kept');
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
  test('they are deleted at launch, whatever the size of the table, without rebuilding it', async () => {
    if (!usable()) return;
    const ids = seed(40, { vecRowsFor: (ids) => [...ids, 9001, 9002, 9003] });
    relaunch();
    assert.deepEqual(pending(), {}, 'three stray rows are not a reason to recopy 40');
    assert.doesNotMatch(ddl(CHUNKS), /chunk_size/, 'the table was not dropped');
    assert.equal(vecCount(), 40);
    const found = await search(7);
    assert.equal(found.native, true);
    assert.equal(found.ids[0], ids[7]);
    assert.equal(db().prepare(`SELECT COUNT(*) AS n FROM ${CHUNKS} WHERE chunk_id >= 9001`).get().n, 0);
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

  // What the normal embed path does for a new chunk: the BLOB and the vec0 row.
  const embedLive = (index) => {
    const d = db();
    const id = Number(d.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding) VALUES ('m1', ?, 'Me', 1, 2, 'new', 1, ?)`).run(index, vec(index)).lastInsertRowid);
    writer(d, CHUNKS, 'chunk_id')(id, vec(index));
    return id;
  };

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

  // The copy and the normal embed path write the same table. vec0 rejects a
  // second INSERT for a key, so a resumed pass counted the rows embedded in
  // between as failures — and when a slice held only those, it threw the whole
  // table away and started again on the next launch (code review, 2026-10-05).
  test('rows the normal embed path wrote in between are updated, not counted as failures', async () => {
    if (!usable()) return;
    const ids = seed(2500, { metric: false, userVersion: 29 });
    relaunch();
    const run = quiet(() => dbMgr.runPendingVecRebuilds());
    await new Promise(resolve => setImmediate(resolve));
    close();
    await run;

    open(BUDGET);
    const live = [3001, 3002, 3003, 3004, 3005].map(embedLive);     // embedded this session, vec0 row included
    // The pass had reached the end of the old rows when the app quit.
    const record = pending();
    record[CHUNKS].cursor = ids[ids.length - 1];
    db().prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(PENDING_KEY, JSON.stringify(record));
    const before = vecCount();

    assert.equal(await quiet(() => dbMgr.runPendingVecRebuilds()), 5, 'the slice holds only rows that are already there');
    assert.deepEqual(pending(), {}, 'finished, not thrown away to start again');
    assert.equal(vecCount(), before, 'no row was duplicated or dropped');
    assert.equal((await search(3003)).ids[0], live[2]);
  });

  test('one table that cannot be rebuilt does not hold up the next', async () => {
    if (!usable()) return;
    seed(40, { metric: false, userVersion: 29 });
    relaunch();
    // A recorded table whose dimension can never be created, listed first.
    const record = { vec_chunks_99999999: { recreated: false, cursor: 0 }, ...pending() };
    db().prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(PENDING_KEY, JSON.stringify(record));

    assert.equal(await quiet(() => dbMgr.runPendingVecRebuilds()), 40);
    assert.equal(vecCount(), 40);
    assert.deepEqual(Object.keys(pending()), ['vec_chunks_99999999'], 'the good table is done; the bad one stays recorded');
  });

  test('a record that says "recreated" for a table that is gone starts over', async () => {
    if (!usable()) return;
    seed(40, { metric: false, userVersion: 29 });
    relaunch();
    db().exec(`DROP TABLE ${CHUNKS}`);
    db().prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)').run(PENDING_KEY, JSON.stringify({ [CHUNKS]: { recreated: true, cursor: 17 } }));

    assert.equal(await quiet(() => dbMgr.runPendingVecRebuilds()), 40);
    assert.equal(vecCount(), 40);
    assert.deepEqual(pending(), {});
  });
});

describe('writing a vector for a key that already has one', () => {
  test('the defect: vec0 rejects INSERT OR REPLACE on an existing key', () => {
    if (!usable()) return;
    const ids = seed(2);
    assert.throws(
      () => db().prepare(`INSERT OR REPLACE INTO ${CHUNKS}(chunk_id, embedding) VALUES (?, ?)`).run(BigInt(ids[0]), vec(50)),
      /UNIQUE constraint failed/,
      'if this stops throwing, sqlite-vec gained REPLACE and vecRowWrite.ts can be simplified',
    );
  });

  test('the writer replaces the vector in place, and inserts when there is none', () => {
    if (!usable()) return;
    const ids = seed(2);
    const write = writer(db(), CHUNKS, 'chunk_id');
    const stored = (id) => Buffer.from(db().prepare(`SELECT embedding AS e FROM ${CHUNKS} WHERE chunk_id = ?`).get(BigInt(id)).e);
    write(ids[0], vec(50));
    assert.deepEqual(stored(ids[0]), vec(50), 'the old vector is gone');
    assert.equal(vecCount(), 2);
    write(777, vec(51));
    assert.deepEqual(stored(777), vec(51));
    assert.equal(vecCount(), 3);
    assert.throws(() => writer(db(), 'chunks', 'id'), /not a vec0 table/);
  });

  test("vec0 lists its keys through its own interface, which is what the contents check reads", () => {
    if (!usable()) return;
    const ids = seed(2);
    // vecTableDrift asks `SELECT chunk_id FROM <table>` — the public
    // interface, not the `_rowids` shadow table. If this stops working the
    // check degrades to "cannot tell" and leaves tables alone.
    assert.deepEqual(db().prepare(`SELECT chunk_id FROM ${CHUNKS} ORDER BY chunk_id`).all().map(r => Number(r.chunk_id)), ids);
    const src = fs.readFileSync(path.join(root, 'electron/db/DatabaseManager.ts'), 'utf8');
    const check = src.slice(src.indexOf('private vecTableDrift('), src.indexOf('/** One-time: see the note on stale summary vectors'));
    assert.ok(check.length > 200);
    assert.doesNotMatch(check, /_rowids/, 'no dependency on the shadow table');
    assert.match(check, /return null;/, 'an unreadable table is "cannot tell", never "wrong"');
  });

  test('a stored vector with no direction is never a perfect match', async () => {
    if (!usable()) return;
    const ids = seed(3);
    const d = db();
    const insChunk = d.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding) VALUES ('m1', ?, 'Me', 1, 2, 'bad vector', 1, ?)`);
    const zero = Buffer.alloc(DIM * 4);
    const nan = Buffer.from(new Float32Array(Array.from({ length: DIM }, (_, i) => (i === 0 ? NaN : 0.1))).buffer);
    const bad = [zero, nan].map((buf, i) => {
      const id = Number(insChunk.run(50 + i, buf).lastInsertRowid);
      writer(d, CHUNKS, 'chunk_id')(id, buf);
      return id;
    });
    d.prepare(`INSERT INTO meetings (id, title, start_time, duration_ms, embedding_space) VALUES ('m1b', 't', 1, 1, ?)`).run(SPACE);
    const sumId = Number(d.prepare(`INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('m1b', 'bad', ?)`).run(zero).lastInsertRowid);
    // The defect, at the source: vec0 has no distance for these rows.
    const raw = d.prepare(`SELECT chunk_id, distance FROM ${CHUNKS} WHERE embedding MATCH ? ORDER BY distance LIMIT 10`).all(vec(1));
    assert.ok(raw.some(r => bad.includes(Number(r.chunk_id)) && r.distance === null), `precondition: vec0 returns a NULL distance (${JSON.stringify(raw.map(r => r.distance))})`);
    writer(d, SUMMARIES, 'summary_id')(sumId, zero);

    const vs = store();
    const hits = vs.searchSimilarNative(asArray(vec(1)), undefined, 10, 0.25, SPACE);
    assert.equal(hits.some(h => bad.includes(h.id)), false, 'no chunk with a zero or NaN vector is returned');
    assert.equal(hits[0].id, ids[1]);
    assert.ok(hits.every(h => Number.isFinite(h.similarity)));
    const sums = vs.searchSummariesNative(asArray(vec(900)), 10, SPACE);
    assert.equal(sums.some(s => s.meetingId === 'm1b'), false);
    assert.equal(sums[0]?.meetingId, 'm1');
  });

  // vec0 sorts rows with no distance FIRST, so dropping them after the LIMIT
  // left nothing: 200 such rows among 300 good ones gave 0 hits where the
  // exact search finds 8 (code review, 2026-10-05).
  test('enough bad vectors to fill the top-k do not empty the result', async () => {
    if (!usable()) return;
    seed(2);
    relaunch(16 * 1024 * 1024);
    // The reviewer's case as reproduced: 768 dimensions, 300 good vectors, 200 of zeros.
    const W = 768;
    const wide = (seed) => Buffer.from(new Float32Array(Array.from({ length: W }, (_, i) => Math.sin(seed * 1.7 + i * 0.9) + (i === seed % W ? 2 : 0))).buffer);
    const d = db();
    const insChunk = d.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding) VALUES ('m1', ?, 'Me', 1, 2, 'wide', 1, ?)`);
    const write = writer(d, `vec_chunks_${W}`, 'chunk_id');
    const good = [];
    d.transaction(() => {
      for (let i = 0; i < 300; i++) { const id = Number(insChunk.run(1000 + i, wide(i)).lastInsertRowid); write(id, wide(i)); good.push(id); }
      const zero = Buffer.alloc(W * 4);
      for (let i = 0; i < 200; i++) write(Number(insChunk.run(2000 + i, zero).lastInsertRowid), zero);
    })();
    const raw = d.prepare(`SELECT distance FROM vec_chunks_${W} WHERE embedding MATCH ? ORDER BY distance LIMIT 32`).all(wide(7));
    const withoutDistance = raw.filter(r => r.distance === null).length;
    // Measured on this build: all 32 of the 32 fetched rows.
    assert.ok(withoutDistance > 0, `precondition: rows with no distance are in the fetched top-k (${withoutDistance} of ${raw.length})`);

    const vs = store();
    const query = Array.from(new Float32Array(wide(7).buffer, wide(7).byteOffset, W));
    const hits = await vs.searchSimilar(query, { limit: 8, minSimilarity: 0.25, spaceKey: SPACE });
    const exactHits = vs.searchSimilarJS(query, undefined, 8, 0.25, SPACE);
    assert.ok(hits.length > 0, 'not emptied by the rows with no distance');
    assert.equal(hits[0].id, good[7]);
    assert.deepEqual(hits.map(h => h.id), exactHits.map(h => h.id), 'the same answer as the exact search');
  });

  test('no writer in the app uses INSERT OR REPLACE on a vec0 table', () => {
    for (const file of ['electron/rag/VectorStore.ts', 'electron/db/DatabaseManager.ts']) {
      const code = fs.readFileSync(path.join(root, file), 'utf8').split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      assert.doesNotMatch(code, /INSERT OR REPLACE INTO (\$\{|vec_)/, file);
    }
    const vs = fs.readFileSync(path.join(root, 'electron/rag/VectorStore.ts'), 'utf8');
    assert.match(vs, /prepareVecRowWriter\(this\.db, `vec_chunks_\$\{dim\}`, 'chunk_id'\)\(chunkId, blob\)/);
    assert.match(vs, /prepareVecRowWriter\(this\.db, `vec_summaries_\$\{dim\}`, 'summary_id'\)\(row\.id, blob\)/);
  });
});

// What a released build leaves: cosine tables at the default block size, a
// complete chunk table, a summary vector, and none of this build's flags.
describe('a profile from a released build', () => {
  const released = (count) => {
    const ids = seed(count);
    db().prepare(`DELETE FROM app_state WHERE key LIKE 'vec_%'`).run();
    return ids;
  };

  test('both tables end up at the current block size, with every vector, in one launch', async () => {
    if (!usable()) return;
    const ids = released(5);
    relaunch(16 * 1024 * 1024);
    assert.match(ddl(CHUNKS), /chunk_size\s*=\s*64/);
    assert.match(ddl(SUMMARIES), /chunk_size\s*=\s*64/, 'the one-time summary rewrite must not leave this table at the old block size');
    assert.equal(vecCount(CHUNKS), 5);
    assert.equal(vecCount(SUMMARIES), 1);
    assert.deepEqual(pending(), {});
    const flags = Object.fromEntries(db().prepare(`SELECT key, value FROM app_state WHERE key LIKE 'vec_%'`).all().map(r => [r.key, r.value]));
    assert.deepEqual(flags, { [SETTLED_KEY]: '1', vec_summary_vectors_rewritten_v1: '1' });
    assert.equal((await search(3, 1)).ids[0], ids[3]);
  });

  test('the file gives the old blocks back', () => {
    if (!usable()) return;
    // Real widths, so the old blocks are megabytes: one 1,024-vector block of
    // 3,072 dimensions is 12.6 MB, and there are two tables.
    const W = 3072;
    const d = db();
    d.exec(`DROP TABLE IF EXISTS vec_chunks_${W}; DROP TABLE IF EXISTS vec_summaries_${W};`);
    d.exec(`CREATE VIRTUAL TABLE vec_chunks_${W} USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[${W}] distance_metric=cosine)`);
    d.exec(`CREATE VIRTUAL TABLE vec_summaries_${W} USING vec0(summary_id INTEGER PRIMARY KEY, embedding float[${W}] distance_metric=cosine)`);
    const wide = (seed) => Buffer.from(new Float32Array(Array.from({ length: W }, (_, i) => Math.sin(seed + i))).buffer);
    d.prepare(`INSERT INTO meetings (id, title, start_time, duration_ms, embedding_space) VALUES ('big', 't', 1, 1, ?)`).run(SPACE);
    const chunkId = d.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding) VALUES ('big', 0, 'Me', 1, 2, 'text', 1, ?)`).run(wide(1)).lastInsertRowid;
    d.prepare(`INSERT INTO vec_chunks_${W}(chunk_id, embedding) VALUES (?, ?)`).run(BigInt(chunkId), wide(1));
    const sumId = d.prepare(`INSERT INTO chunk_summaries (meeting_id, summary_text, embedding) VALUES ('big', 's', ?)`).run(wide(2)).lastInsertRowid;
    d.prepare(`INSERT INTO vec_summaries_${W}(summary_id, embedding) VALUES (?, ?)`).run(BigInt(sumId), wide(2));
    d.prepare(`DELETE FROM app_state WHERE key LIKE 'vec_%'`).run();
    close();
    const file = path.join(tmp, 'natively.db');
    const before = fs.statSync(file).size;
    assert.ok(before > 24 * 1024 * 1024, `precondition: two default blocks (${(before / 1048576).toFixed(1)} MB)`);

    open(16 * 1024 * 1024);
    assert.match(ddl(`vec_summaries_${W}`), /chunk_size\s*=\s*64/);
    assert.match(ddl(`vec_chunks_${W}`), /chunk_size\s*=\s*64/);
    close();
    const after = fs.statSync(file).size;
    assert.ok(after < 5 * 1024 * 1024, `${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
    open(16 * 1024 * 1024);
  });
});

describe('the store writing to vec0 (through the manager opened here, not the hidden second one)', () => {
  // Each compiled file carries its own DatabaseManager singleton; VectorStore's
  // would open this same database and repair it behind the test's back.
  const nativeStore = () => { const vs = store(); vs.ensureVecTable = (dim) => dbMgr.ensureVecTableForDim(dim); return vs; };
  const sumVec = (id) => db().prepare(`SELECT embedding AS e FROM ${SUMMARIES} WHERE summary_id = ?`).get(BigInt(id))?.e;

  test('a re-embedded summary replaces its vector; changing its text removes the old one at once', async () => {
    if (!usable()) return;
    seed(2);
    relaunch(16 * 1024 * 1024);
    const vs = nativeStore();
    const id = Number(db().prepare(`SELECT id FROM chunk_summaries WHERE meeting_id = 'm1'`).get().id);
    vs.storeSummaryEmbedding('m1', asArray(vec(41)));
    assert.deepEqual(Buffer.from(sumVec(id)), vec(41), 'a second write to the same key lands');

    assert.equal(vs.saveSummary('m1', 'the notes were regenerated'), true);
    assert.equal(sumVec(id), undefined, 'the old vector must not rank the new text');
    assert.deepEqual(vs.searchSummariesNative(asArray(vec(41)), 5, SPACE), []);
    assert.equal(vs.saveSummary('m1', 'the notes were regenerated'), true, 'still waiting to be embedded');

    vs.storeSummaryEmbedding('m1', asArray(vec(42)));
    assert.deepEqual(Buffer.from(sumVec(id)), vec(42));
    const hit = vs.searchSummariesNative(asArray(vec(42)), 5, SPACE)[0];
    assert.equal(hit.summaryText, 'the notes were regenerated');
    assert.ok(hit.similarity > 0.999);

    vs.saveSummary('m1', 'the notes were regenerated');             // same text: nothing is cleared
    assert.deepEqual(Buffer.from(sumVec(id)), vec(42));
  });

  // Seen in the app the first time the 384-wide local model stored a vector:
  // the BLOB was written before the table was created, so the new table looked
  // like one "created beside stored vectors" and was sent for a refill.
  test('the first vector of a new width does not send its own table for a background refill', () => {
    if (!usable()) return;
    seed(2);
    relaunch(16 * 1024 * 1024);
    const W = 12;
    const wide = Array.from({ length: W }, (_, i) => Math.cos(i + 1));
    const d = db();
    assert.equal(!!d.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'vec_summaries_${W}'`).get(), false, 'precondition: a width nothing has used');
    const chunkId = Number(d.prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count) VALUES ('m1', 70, 'Me', 1, 2, 'new width', 1)`).run().lastInsertRowid);
    const vs = nativeStore();
    quiet(() => { vs.storeSummaryEmbedding('m1', wide); vs.storeEmbedding(chunkId, wide); });
    assert.deepEqual(pending(), {}, 'nothing recorded: the table was created before the vector was stored');
    assert.equal(d.prepare(`SELECT COUNT(*) AS n FROM vec_summaries_${W}`).get().n, 1);
    assert.equal(d.prepare(`SELECT COUNT(*) AS n FROM vec_chunks_${W}`).get().n, 1);
  });

  test('a chunk vector written twice ends up as the second one; a vector for a deleted chunk is not written', () => {
    if (!usable()) return;
    const ids = seed(2);
    relaunch(16 * 1024 * 1024);
    const vs = nativeStore();
    vs.storeEmbedding(ids[0], asArray(vec(77)));
    assert.deepEqual(Buffer.from(db().prepare(`SELECT embedding AS e FROM ${CHUNKS} WHERE chunk_id = ?`).get(BigInt(ids[0])).e), vec(77));
    vs.storeEmbedding(424242, asArray(vec(78)));
    assert.equal(db().prepare(`SELECT COUNT(*) AS n FROM ${CHUNKS} WHERE chunk_id = 424242`).get().n, 0);
  });
});

describe('the checks that run on every launch', () => {
  const settled = () => db().prepare('SELECT value FROM app_state WHERE key = ?').get(SETTLED_KEY)?.value === '1';

  test('contents that drift after the block-size question is settled are still repaired', async () => {
    if (!usable()) return;
    const ids = seed(3);
    relaunch(16 * 1024 * 1024);
    assert.equal(settled(), true);
    assert.equal(vecCount(), 3);
    // A launch where the extension did not load: the vector went to the BLOB column only.
    const lost = Number(db().prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding) VALUES ('m1', 9, 'Me', 1, 2, 'blob only', 1, ?)`).run(vec(9)).lastInsertRowid);
    assert.equal(store().searchSimilarNative(asArray(vec(9)), undefined, 1, -1, SPACE)[0]?.id === lost, false, 'precondition: a native query cannot see it');

    relaunch(16 * 1024 * 1024);
    assert.equal(vecCount(), 4);
    const found = await search(9, 1);
    assert.equal(found.native, true);
    assert.deepEqual(found.ids, [lost]);
    assert.equal(ids.length, 3);
  });

  const blobOnly = (index) => Number(db().prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding) VALUES ('m1', ?, 'Me', 1, 2, 'blob only', 1, ?)`).run(index, vec(index)).lastInsertRowid);

  test('one missing row in a large table is written at launch; the table is not recopied', async () => {
    if (!usable()) return;
    seed(40);
    relaunch();
    assert.equal(settled(), true);
    const lost = blobOnly(99);
    relaunch();                                                     // budget 200 bytes; one vector is 64
    assert.deepEqual(pending(), {});
    assert.equal(vecCount(), 41);
    assert.doesNotMatch(ddl(CHUNKS), /chunk_size/, 'not dropped and rebuilt for one row');
    const found = await search(99, 1);
    assert.equal(found.native, true);
    assert.deepEqual(found.ids, [lost]);
  });

  test('more missing rows than the launch may write are recorded, and the table is kept', async () => {
    if (!usable()) return;
    seed(40);
    relaunch();
    const lost = [90, 91, 92, 93, 94].map(blobOnly);                // 320 bytes, budget 200
    relaunch();
    assert.deepEqual(pending()[CHUNKS], { recreated: true, cursor: 0 });
    assert.equal((await search(92, 1)).ids[0], lost[2], 'found from the stored vectors meanwhile');
    await quiet(() => dbMgr.runPendingVecRebuilds());
    assert.equal(vecCount(), 45);
    assert.deepEqual(pending(), {});
  });

  // A launch without the extension stores BLOBs only, and a width that is not
  // pre-created (the bundled model's 384) then has vectors and no table. The
  // first vector stored later created an EMPTY table, and native search
  // answered from that one row (code review, 2026-10-05).
  describe('a stored width that has no table', () => {
    const W = 8;
    const wide = (seed) => Buffer.from(new Float32Array(Array.from({ length: W }, (_, i) => Math.cos(seed * 2.1 + i))).buffer);
    const addWide = (index) => Number(db().prepare(`INSERT INTO chunks (meeting_id, chunk_index, speaker, start_timestamp_ms, end_timestamp_ms, cleaned_text, token_count, embedding) VALUES ('m1', ?, 'Me', 1, 2, 'wide', 1, ?)`).run(index, wide(index)).lastInsertRowid);
    const wideCount = () => db().prepare(`SELECT COUNT(*) AS n FROM vec_chunks_${W}`).get().n;
    const tableExists = () => !!db().prepare(`SELECT 1 FROM sqlite_master WHERE name = 'vec_chunks_${W}'`).get();

    test('gets one at launch, with its vectors in it', () => {
      if (!usable()) return;
      seed(2);
      for (let i = 0; i < 5; i++) addWide(i);                       // 160 bytes, inside the budget of 200... with the 2 x 64 above it is not
      assert.equal(tableExists(), false);
      relaunch(16 * 1024 * 1024);
      assert.equal(tableExists(), true);
      assert.equal(wideCount(), 5);
      assert.deepEqual(pending(), {});
    });

    test('too many to write at launch: created, recorded, and filled after launch', async () => {
      if (!usable()) return;
      seed(2);
      for (let i = 0; i < 20; i++) addWide(i);                      // 640 bytes, budget 200
      relaunch();
      assert.equal(tableExists(), true);
      assert.deepEqual(pending()[`vec_chunks_${W}`], { recreated: true, cursor: 0 });
      await quiet(() => dbMgr.runPendingVecRebuilds());
      assert.equal(wideCount(), 20);
    });

    test('created mid-session beside stored vectors, it is recorded instead of answering from one row', async () => {
      if (!usable()) return;
      seed(2);
      relaunch(16 * 1024 * 1024);                                   // settled, nothing of this width yet
      for (let i = 0; i < 5; i++) addWide(i);                       // written while the extension was away
      quiet(() => dbMgr.ensureVecTableForDim(W));                   // the first store of the session
      assert.equal(tableExists(), true);
      assert.deepEqual(pending()[`vec_chunks_${W}`], { recreated: true, cursor: 0 });
      assert.equal(pending()[`vec_summaries_${W}`], undefined, 'no summary of that width is stored');
      await quiet(() => dbMgr.runPendingVecRebuilds());
      assert.equal(wideCount(), 5);
      assert.deepEqual(pending(), {});
    });
  });

  // Between 2026-10-04 and 2026-10-05 a re-embedded summary kept its old
  // vector in vec0. The key is present on both sides, so comparing keys cannot
  // find it; every summary vector is written again, once.
  test('a summary whose vec0 row holds an older vector than its BLOB is corrected, once', async () => {
    if (!usable()) return;
    seed(2);
    relaunch(16 * 1024 * 1024);
    const d = db();
    const sumId = Number(d.prepare(`SELECT id FROM chunk_summaries WHERE meeting_id = 'm1'`).get().id);
    d.prepare('UPDATE chunk_summaries SET embedding = ? WHERE id = ?').run(vec(555), sumId);   // the BLOB moved on; vec0 did not
    d.prepare('DELETE FROM app_state WHERE key = ?').run('vec_summary_vectors_rewritten_v1');   // a profile from before this build
    const inVec = () => Buffer.from(db().prepare(`SELECT embedding AS e FROM ${SUMMARIES} WHERE summary_id = ?`).get(BigInt(sumId)).e);
    assert.notDeepEqual(inVec(), vec(555), 'precondition');

    relaunch(16 * 1024 * 1024);
    assert.deepEqual(inVec(), vec(555));
    assert.equal(db().prepare('SELECT value FROM app_state WHERE key = ?').get('vec_summary_vectors_rewritten_v1')?.value, '1');
  });

  test('the upgrade launch spends its budget once, not once in the migration and once after', () => {
    if (!usable()) return;
    // Two tables that are only the wrong block size: 192 and 64 bytes, budget 200.
    seed(3, { userVersion: 29 });
    relaunch();
    assert.match(ddl(SUMMARIES), /chunk_size\s*=\s*64/, 'the smaller one is done');
    assert.doesNotMatch(ddl(CHUNKS), /chunk_size/, 'the other waits for the next launch');
    relaunch();
    assert.match(ddl(CHUNKS), /chunk_size\s*=\s*64/);
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
