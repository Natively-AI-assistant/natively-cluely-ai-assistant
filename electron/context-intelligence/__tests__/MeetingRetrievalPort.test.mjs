// The meeting retrieval port, and the combined-port fan-out.
//
// Closes the gap recorded as the named prerequisite in 13 §13.7: the mode port
// covers reference files only, so a meeting question composed a no-evidence
// disclosure even when the answer had just been spoken.
//
// The isolation invariant is deliberately NOT re-implemented in the port — it
// declares each chunk's scope as its own meeting and lets the adapter's scope
// containment reject foreigners. These tests prove that indirection actually
// holds, because "the other filter handles it" is exactly the assumption that
// leaves a rule enforced nowhere.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { createMeetingRetrievalPort, combineRetrievalPorts, MEETING_MIN_SIMILARITY } =
  await import(pathToFileURL(path.join(base, 'retrieval/meeting-retrieval-port.js')).href);
const { createModeRetrievalPort } = await import(pathToFileURL(path.join(base, 'retrieval/mode-retrieval-port.js')).href);
const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);

const CURRENT = 'm-sept';
const chunk = (over = {}) => ({
  meetingId: CURRENT, chunkIndex: 0, text: 'Meera owns the events table migration.',
  similarity: 0.8, ...over,
});

const decisionInMeeting = decide({
  requestId: 'r1', requestSequence: 1, surface: 'manual-chat', modeId: 'team-meet',
  scope: { userId: 'u1', meetingId: CURRENT }, sessionId: 's',
  manualQuestion: 'Who owns the events table migration?',
});

const port = (chunks, over = {}) => createMeetingRetrievalPort({
  retriever: { retrieve: async () => ({ chunks }) },
  currentMeetingId: CURRENT, userId: 'u1', tokenBudget: 1500, ...over,
});

describe('meeting retrieval port', () => {
  test('an in-meeting chunk becomes evidence with meeting provenance', async () => {
    const r = await port([chunk()]).retrieve({ decision: decisionInMeeting });
    assert.equal(r.evidence.length, 1);
    assert.equal(r.evidence[0].sourceType, 'MEETING_TRANSCRIPT');
    assert.equal(r.evidence[0].scopeId, 'u:u1|m:m-sept');
  });

  test('a chunk from ANOTHER meeting is rejected OUT_OF_SCOPE by the shared filter', async () => {
    // The port itself contains no isolation logic — this proves the delegation
    // works rather than silently admitting the foreign record.
    const r = await port([chunk({ meetingId: 'm-june', text: 'We are moving the ledger to Cassandra.' })])
      .retrieve({ decision: decisionInMeeting });
    assert.equal(r.evidence.length, 0);
    assert.equal(r.attempts[0].rejections[0].reason, 'OUT_OF_SCOPE');
  });

  test('a low-similarity chunk never becomes a candidate', async () => {
    const r = await port([chunk({ similarity: MEETING_MIN_SIMILARITY - 0.01 })])
      .retrieve({ decision: decisionInMeeting });
    assert.equal(r.evidence.length, 0, 'a similarity store always returns its top-k; the floor is what makes that safe');
  });

  test('empty text and missing meeting ids are dropped, not passed through', async () => {
    const r = await port([chunk({ text: '   ' }), chunk({ meetingId: '' })])
      .retrieve({ decision: decisionInMeeting });
    assert.equal(r.evidence.length, 0);
  });
});

describe('combined ports', () => {
  const modePort = (chunks) => createModeRetrievalPort({
    modesManager: { retrieveHybridRaw: async () => ({ chunks }) },
    modeInfo: { id: 'm1' }, files: [{ id: 'f1' }], tokenBudget: 1500, userId: 'u1',
  });

  test('evidence from BOTH sources reaches one turn', async () => {
    const combined = combineRetrievalPorts([
      modePort([{ sourceId: 'f1', fileName: 'risk.json', text: 'Risk R-4 is owned by Meera.', chunkIndex: 0, score: 0.7 }]),
      port([chunk({ similarity: 0.9 })]),
    ]);
    const r = await combined.retrieve({ decision: decisionInMeeting });
    const types = r.evidence.map((e) => e.sourceType).sort();
    assert.deepEqual(types, ['MEETING_TRANSCRIPT', 'REFERENCE_FILE'],
      'a live meeting question can legitimately need a document AND something said');
  });

  test('results are re-ranked across sources and capped once', async () => {
    const many = Array.from({ length: 20 }, (_, i) => chunk({ chunkIndex: i, similarity: 0.5 + i / 100 }));
    const combined = combineRetrievalPorts([port(many), port(many)]);
    const r = await combined.retrieve({ decision: decisionInMeeting });
    const cap = decisionInMeeting.retrievalPlan.maximumAcceptedEvidence;
    assert.ok(r.evidence.length <= cap,
      `two ports each returning their maximum must not double the cap (${r.evidence.length} > ${cap})`);
    const scores = r.evidence.map((e) => e.finalScore);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'merged evidence must be re-ranked');
  });

  test('one failing source does not blank the turn (§22.1)', async () => {
    const broken = { retrieve: async () => { throw new Error('rag down'); } };
    const combined = combineRetrievalPorts([broken, port([chunk()])]);
    const r = await combined.retrieve({ decision: decisionInMeeting });
    assert.equal(r.evidence.length, 1, 'the healthy source still contributes');
    assert.ok(r.attempts.some((a) => a.failed), 'and the failure is RECORDED, never silent');
  });
});
