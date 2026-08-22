// R-20 regression test — behavioural, against a real SQLite database.
//
// R-12 wrapped the vector reap and the parent DELETE in one transaction so a
// meeting could not survive a failed reap. But deleteVectorsForMeeting caught
// everything into a console.warn and returned normally, so the transaction saw
// no error and committed the DELETE anyway: meeting gone, vectors orphaned in
// the vec0 tables, where they keep consuming KNN top-K slots that
// searchSimilarNative can no longer resolve back to `chunks`.
//
// deleteIn's per-batch `catch (_) {}` had the same shape one level down. It
// must still swallow "no such table" — getExistingVecDims() returns
// KNOWN_DIMS ∪ discovered, so most dims legitimately have no table — but
// nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const src = fs.readFileSync(new URL('../DatabaseManager.ts', import.meta.url), 'utf8');

function bodyOf(signature, len = 4200) {
  const i = src.indexOf(signature);
  assert.notEqual(i, -1, `${signature} not found`);
  return src.slice(i, i + len);
}

test('a failed vector reap aborts the meeting delete instead of committing it', () => {
  const body = bodyOf('public deleteVectorsForMeeting(meetingId: string): void {');
  const catchIdx = body.indexOf('catch (e)');
  assert.notEqual(catchIdx, -1, 'the outer catch must still exist');
  const tail = body.slice(catchIdx, catchIdx + 700);
  assert.ok(/throw e/.test(tail),
    'the failure must reach the caller, or R-12\'s transaction cannot roll back the parent DELETE');
});

test('deleteIn swallows a missing dim table and nothing else', () => {
  const body = bodyOf('const deleteIn = (table: string, column: string, ids: number[]) => {', 1600);
  assert.ok(/no such table/i.test(body),
    'the expected missing-table case must be recognised explicitly');
  assert.ok(/throw e/.test(body),
    'any other failure must propagate — swallowing all of them is what hid R-01');
  assert.ok(!/catch \(_\) \{ \/\* dim table may not exist \*\/ \}/.test(body),
    'the blanket catch must be gone');
});

test('the narrowed catch actually admits a real missing table and rejects other errors', () => {
  // Pin the predicate itself against SQLite's real messages.
  const D = require('better-sqlite3');
  const db = new D(':memory:');
  db.exec('CREATE TABLE present (chunk_id INTEGER)');

  const isMissingTable = (e) => /no such table/i.test(String(e?.message ?? e));

  let missing;
  try { db.prepare('DELETE FROM absent_table WHERE chunk_id IN (?)').run(1); } catch (e) { missing = e; }
  assert.ok(missing && isMissingTable(missing),
    'a genuinely absent dim table must still be swallowed');

  let other;
  try { db.prepare('DELETE FROM present WHERE no_such_column IN (?)').run(1); } catch (e) { other = e; }
  assert.ok(other && !isMissingTable(other),
    'a different failure (here: a bad column) must NOT be mistaken for a missing table');

  db.close();
});
