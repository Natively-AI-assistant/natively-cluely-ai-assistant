import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Phase 6 Slice 0, item 3 — Hindsight post-meeting retain gate.
//
// docs/context-rebuild/02_INGESTION_AND_STORAGE_AUDIT.md §C.1 found the
// retain condition never checked meetingData.summaryStatus, so a summary
// whose generation failed could still be queued into long-term memory as if
// it were a validated fact (non-negotiable rule 13). Fix: add
// `meetingData.summaryStatus !== 'failed'` to the retain condition.
//
// MeetingPersistence is a singleton with heavy DatabaseManager/
// HindsightManager/LongTermMemoryService dependencies with no existing mock
// harness in this codebase; per this file's sibling
// (MeetingPersistenceRace.test.mjs), the established convention for this
// exact class is a source-pinned structural assertion rather than a full
// behavioral mock — followed here for the same reason: this is a one-line,
// non-refactored condition addition, not part of a structural rewrite this
// pin would obstruct.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../../MeetingPersistence.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

test('the Hindsight post-meeting retain condition checks summaryStatus !== failed', () => {
  const summaryStatusComputeIndex = source.indexOf(
    "summaryStatus: generationSucceeded || data.transcript.length <= 2 ? 'completed' : 'failed'",
  );
  const retainConditionIndex = source.indexOf(
    "if (isIntelligenceFlagEnabled('hindsightPostMeetingRetain') && hsCfg && _hm.isAvailable()",
  );

  assert.ok(summaryStatusComputeIndex >= 0, 'summaryStatus computation should exist');
  assert.ok(retainConditionIndex >= 0, 'retain condition should exist');
  assert.ok(summaryStatusComputeIndex < retainConditionIndex, 'summaryStatus must be computed before the retain condition reads it');

  const conditionBlockEnd = source.indexOf(') {', retainConditionIndex) + 3;
  const conditionBlock = source.slice(retainConditionIndex, conditionBlockEnd);

  assert.match(
    conditionBlock,
    /meetingData\.summaryStatus\s*!==\s*'failed'/,
    'retain condition must check meetingData.summaryStatus !== \'failed\' before queuing a Hindsight retain',
  );
});
