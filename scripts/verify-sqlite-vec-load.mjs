// Real-execution proof that this platform's sqlite-vec binary loads and
// answers a vector query (2026-08-15, closing the "Requires physical Windows
// verification" item from the semantic-retrieval repair).
//
// Mirrors DatabaseManager's EXACT load sequence — getLoadablePath(), the
// asar-unpacked rewrite (a no-op in dev/CI), the extension-suffix strip that
// better-sqlite3's loadExtension() requires — then creates a vec0 table,
// inserts a vector, and runs a MATCH query. If any platform package
// (vec0.dll / vec0.dylib / vec0.so) is missing or fails to dlopen, this
// exits 1; the graceful JS-cosine fallback in VectorStore deliberately does
// NOT exist here, because silently passing on the fallback is exactly how a
// missing Windows binary shipped unnoticed before.
//
// Run under Electron's ABI (better-sqlite3 is built for it by postinstall):
//   ELECTRON_RUN_AS_NODE=1 npx --no-install electron scripts/verify-sqlite-vec-load.mjs

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const fail = (msg, err) => {
  console.error(`[verify-sqlite-vec-load] FAIL: ${msg}`, err?.message || err || '');
  process.exit(1);
};

let db;
try {
  db = new Database(':memory:');
} catch (e) {
  fail(`better-sqlite3 failed to open (ABI mismatch? run under ELECTRON_RUN_AS_NODE)`, e);
}

let extPath;
try {
  extPath = sqliteVec.getLoadablePath();
} catch (e) {
  fail(`sqlite-vec.getLoadablePath() threw — the ${process.platform}-${process.arch} platform package is missing`, e);
}
try {
  // Same two rewrites DatabaseManager applies (electron/db/DatabaseManager.ts).
  const stripped = extPath.replace('app.asar', 'app.asar.unpacked').replace(/\.(dylib|so|dll)$/, '');
  db.loadExtension(stripped);
} catch (e) {
  fail(`loadExtension failed for ${extPath} — the native binary exists but did not dlopen`, e);
}

try {
  const { v } = db.prepare('select vec_version() as v').get();
  db.exec('create virtual table t using vec0(embedding float[4])');
  const vec = (a) => Buffer.from(new Float32Array(a).buffer);
  db.prepare('insert into t(rowid, embedding) values (1, ?)').run(vec([1, 0, 0, 0]));
  db.prepare('insert into t(rowid, embedding) values (2, ?)').run(vec([0, 1, 0, 0]));
  const row = db.prepare('select rowid, distance from t where embedding match ? order by distance limit 1').get(vec([0.9, 0.1, 0, 0]));
  if (row?.rowid !== 1) fail(`vector MATCH returned the wrong neighbour: ${JSON.stringify(row)}`);
  console.log(`[verify-sqlite-vec-load] OK — sqlite-vec ${v} on ${process.platform}-${process.arch}: vec0 table + MATCH query verified (nearest=${row.rowid}, distance=${row.distance.toFixed(4)})`);
  process.exit(0);
} catch (e) {
  fail('vec0 table / MATCH query failed after a successful load', e);
}
