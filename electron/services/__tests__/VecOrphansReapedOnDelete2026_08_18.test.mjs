// F-705 regression test (audit/autopilot-2026-08-18).
//
// deleteMeeting()/clearAllData() relied entirely on ON DELETE CASCADE, but
// vec_chunks_* / vec_summaries_* are USING vec0 VIRTUAL tables and SQLite
// virtual tables carry no foreign keys — a cascade can never reach them.
// VectorStore's own delete paths already issue explicit DELETEs for exactly
// this reason; neither DatabaseManager path called into it, so every deleted
// meeting left its vectors behind. Orphans consume slots in the KNN top-K
// (searchSimilarNative silently drops ids it cannot resolve back to `chunks`),
// so recall degrades monotonically with every deletion.
//
// Measured in scripts/audit/R-01-repro.cjs against real sqlite-vec: 3 chunk
// vectors + 1 summary vector survive the cascade without a working reap, 0 with
// one, and a bystander meeting is untouched.
//
// UPDATED 2026-08-18 (audit R-01/R-12). The first version of this file pinned
// exact source literals, and they went stale the moment the implementation was
// corrected: the reaper's IN(...) deletes moved into a batching helper (SQLite
// caps bound parameters) and deleteMeeting's reap+delete moved inside a
// transaction, renaming its parameter. Both were FALSE failures — the behaviour
// was verified end-to-end by the repro above. The assertions below now check the
// structure that carries the guarantee, not the spelling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, '../../db/DatabaseManager.ts'), 'utf8');

function body(sig, span = 1800) {
  const i = src.indexOf(sig);
  assert.notEqual(i, -1, `${sig} not found`);
  return src.slice(i, i + span);
}

// Source-scan assertions must look at CODE, not prose. An explanatory comment
// that happens to quote the old broken expression is not a reintroduction of it,
// and treating it as one produced a false failure here (and twice elsewhere in
// this campaign). Strip line comments and SQL comments before asserting.
function codeOnly(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\s*(\/\/|--).*$/, ''))
    .join('\n');
}

test('deleteMeeting reaps vec0 rows BEFORE the parent delete, in one transaction', () => {
  const b = body('public deleteMeeting(id: string): boolean {');
  const reap = b.indexOf('this.deleteVectorsForMeeting(');
  const del = b.indexOf("DELETE FROM meetings WHERE id = ?");
  assert.ok(/this\.db\.transaction\(/.test(b),
    'the reap and the parent delete must be one unit, or a failed delete leaves the vectors gone (R-12)');
  assert.notEqual(reap, -1, 'deleteMeeting must explicitly reap vec0 rows (F-705)');
  assert.ok(reap < del,
    'the reap must run BEFORE the cascade, while the chunk ids are still resolvable');
});

test('the reaper resolves ids through the ordinary tables for every existing dimension', () => {
  // Span sized to the whole method. A fixed window that merely FITS today is a
  // false failure waiting to happen — it broke once already when the fix added
  // explanatory comments.
  const b = body('public deleteVectorsForMeeting(meetingId: string): void {', 4200);
  assert.ok(/getExistingVecDims\(\)/.test(b), 'must cover every provisioned dimension');
  assert.ok(/FROM chunks WHERE meeting_id = \?/.test(b), 'must resolve chunk ids for the meeting');
  // The deletes are issued through a batching helper (SQLite caps bound
  // parameters at ~32k), so assert the helper is driven with both vec tables
  // rather than pinning an inline statement.
  assert.ok(/vec_chunks_\$\{dim\}/.test(b), 'must delete chunk vectors');
  assert.ok(/vec_summaries_\$\{dim\}/.test(b), 'must delete summary vectors');
  assert.ok(/DELETE FROM \$\{table\} WHERE \$\{column\} IN/.test(src),
    'the reaper must issue batched IN(...) deletes');
  // The summary lookup must be meeting-keyed. chunk_summaries has no chunk_id
  // column, so the original JOIN threw at prepare() time and the whole reaper
  // silently did nothing (R-01).
  assert.ok(/SELECT id FROM chunk_summaries WHERE meeting_id = \?/.test(b),
    'chunk_summaries is keyed per-meeting; a JOIN on cs.chunk_id throws at prepare (R-01)');
  assert.ok(!/cs\.chunk_id/.test(codeOnly(b)),
    'chunk_summaries has no chunk_id column, so the reaper must not JOIN on one');
});

test('clearAllData also clears the vec0 tables', () => {
  const b = body('public clearAllData(): boolean {');
  assert.ok(/DELETE FROM vec_chunks_\$\{dim\}/.test(b),
    'a full wipe must clear vec0 chunk vectors too (F-705)');
  assert.ok(/DELETE FROM vec_summaries_\$\{dim\}/.test(b),
    'a full wipe must clear vec0 summary vectors too (F-705)');
});
