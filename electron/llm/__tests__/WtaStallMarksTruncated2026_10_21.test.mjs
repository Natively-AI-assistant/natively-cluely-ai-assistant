// electron/llm/__tests__/WtaStallMarksTruncated2026_10_21.test.mjs
//
// #644: when raceStreamWithDeadline ends a What to answer turn with
// 'stall_timeout', the user has already seen a partial answer. Before this,
// wtaTruncation was only set by the generator itself, so the outer deadline
// left it false: the partial answer was stored as session history and the
// final event carried no stopReason, so the overlay showed no cut-off notice.
//
// The turn is not drivable without the built engine and a live provider, so
// this pins the ordering in the source, as the other engine guards here do.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');

test('a stall_timeout outcome marks the WTA answer truncated before the write decision', () => {
  const race = src.indexOf('const raceOutcome = await raceStreamWithDeadline(');
  assert.ok(race > 0, 'WTA race call not found');
  const writeDecision = src.indexOf('if (wtaTruncation.truncated) {', race);
  assert.ok(writeDecision > race, 'WTA write decision not found');

  const between = src.slice(race, writeDecision);
  const mark = between.match(/if \(raceOutcome === 'stall_timeout'[^)]*\)\s*\{[^}]*wtaTruncation\.truncated = true;[^}]*wtaTruncation\.reason = 'stall_timeout';/);
  assert.ok(mark, 'stall_timeout must set wtaTruncation (truncated + reason) before it is read');
});
