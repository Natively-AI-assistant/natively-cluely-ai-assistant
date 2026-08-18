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
// Measured in scripts/audit/F-705-repro.cjs against real sqlite-vec: 3 vectors
// survive the cascade without an explicit reap, 0 with it.
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

test('deleteMeeting reaps vec0 rows BEFORE the parent delete', () => {
  const b = body('public deleteMeeting(id: string): boolean {');
  const reap = b.indexOf('this.deleteVectorsForMeeting(id)');
  const del = b.indexOf("DELETE FROM meetings WHERE id = ?");
  assert.notEqual(reap, -1, 'deleteMeeting must explicitly reap vec0 rows (F-705)');
  assert.ok(reap < del,
    'the reap must run BEFORE the cascade, while the chunk ids are still resolvable');
});

test('the reaper resolves ids through the ordinary tables for every existing dimension', () => {
  const b = body('public deleteVectorsForMeeting(meetingId: string): void {', 2200);
  assert.ok(/getExistingVecDims\(\)/.test(b), 'must cover every provisioned dimension');
  assert.ok(/FROM chunks WHERE meeting_id = \?/.test(b), 'must resolve chunk ids for the meeting');
  assert.ok(/DELETE FROM vec_chunks_\$\{dim\}/.test(b), 'must delete chunk vectors');
  assert.ok(/DELETE FROM vec_summaries_\$\{dim\}/.test(b), 'must delete summary vectors');
});

test('clearAllData also clears the vec0 tables', () => {
  const b = body('public clearAllData(): boolean {');
  assert.ok(/DELETE FROM vec_chunks_\$\{dim\}/.test(b),
    'a full wipe must clear vec0 chunk vectors too (F-705)');
  assert.ok(/DELETE FROM vec_summaries_\$\{dim\}/.test(b),
    'a full wipe must clear vec0 summary vectors too (F-705)');
});
