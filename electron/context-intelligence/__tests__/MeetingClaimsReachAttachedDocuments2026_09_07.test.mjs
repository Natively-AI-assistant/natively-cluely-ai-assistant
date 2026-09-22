// A meeting-shaped question must be able to read the documents attached to a
// meeting mode (2026-09-07).
//
// THE DEFECT, measured in Team Meet with an incident postmortem and a launch
// checklist attached (tests/fixtures/modes/team-meet):
//   "Who owns the launch checklist and when is it due?"   → MEETING_FACT
//   "What are the action items from the INC-119 postmortem?" → MEETING_FACT
// both planned [MEETING_TRANSCRIPT] only, retrieved the right chunks
// (candidates 2, admitted 2) and dropped them as PLANNED_TYPE_FILTER —
// evidence 0, answerability NONE — and the user was told "I don't have the
// details in the meeting notes yet" while the answer sat in the attached file.
//
// MEETING_STATEMENT / MEETING_DECISION were authoritative for MEETING_TRANSCRIPT
// alone. The documents a user attaches to a meeting mode are its notes,
// agendas, postmortems and checklists; the same "documents are attached"
// widening the USER_* claims received (T1) now applies to the meeting claims.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);

const { classifyTurn } = await load('question/turn-classifier.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');
const { decide } = await load('orchestration/orchestrator.js');
const { createLegacyRetrievalPort } = await load('retrieval/legacy-retrieval-port.js');

const classify = (q, modeId, over = {}) =>
  classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES[modeId], isFollowUp: false, ...over });

const QUESTIONS = [
  'Who owns the launch checklist and when is it due?',
  'What are the action items from the INC-119 postmortem?',
  'What did we decide about migrations after the incident?',
];

describe('meeting claims reach the attached documents when documents are attached', () => {
  for (const q of QUESTIONS) {
    test(`plan includes REFERENCE_FILE with documents attached: ${q}`, () => {
      const r = classify(q, 'team-meet', { hasAttachedDocuments: true });
      assert.ok(r.claimTypes.some((c) => c === 'MEETING_STATEMENT' || c === 'MEETING_DECISION'), JSON.stringify(r.claimTypes));
      assert.ok(r.requiredSourceTypes.includes('REFERENCE_FILE'), JSON.stringify(r.requiredSourceTypes));
      assert.ok(r.requiredSourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(r.requiredSourceTypes));
    });
  }

  test('without documents the plan stays transcript-only (the honest "not said yet" is preserved)', () => {
    const r = classify(QUESTIONS[0], 'team-meet', { hasAttachedDocuments: false });
    assert.ok(!r.requiredSourceTypes.includes('REFERENCE_FILE'), JSON.stringify(r.requiredSourceTypes));
  });

  test('the attached checklist chunk is admitted as evidence for the meeting claim', async () => {
    const registry = {
      sourceTypes: new Map([['checklist', 'REFERENCE_FILE']]),
      activeVersions: new Map([['checklist', 'legacy']]),
      chunkVersions: new Map([['checklist', 'legacy']]),
      sourceScopes: new Map([['checklist', { userId: 'u' }]]),
    };
    const chunks = [{
      sourceId: 'checklist', fileName: 'team_meet_launch_checklist.md', chunkIndex: 0, score: 0.9,
      text: '# Launch checklist — Halcyon beta\nSarah owns the launch checklist and must deliver it by Friday.',
      provenance: 'MODE_REFERENCE_FILE',
    }];
    const d = decide({
      requestId: 'r', requestSequence: 1, surface: 'what_to_answer', modeId: 'team-meet',
      scope: { userId: 'u', modeId: 'team-meet' }, sessionId: 's',
      manualQuestion: QUESTIONS[0], hasAttachedDocuments: true,
    });
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => chunks, assumeCurrentWhenVersionUnknown: true, assumeInScopeWhenUnknown: true });
    const { evidence, attempts } = await port.retrieve({ decision: d });
    assert.equal(evidence.length, 1, `dropped: ${JSON.stringify(attempts[0]?.rejections)}`);
    assert.ok(evidence[0].acceptedFor.includes('MEETING_STATEMENT') || evidence[0].acceptedFor.includes('MEETING_DECISION'), JSON.stringify(evidence[0].acceptedFor));
  });

  test('cross-meeting isolation is untouched: a transcript chunk from another meeting is still rejected', async () => {
    const registry = {
      sourceTypes: new Map([['m-other', 'MEETING_TRANSCRIPT']]),
      activeVersions: new Map([['m-other', 'v1']]),
      chunkVersions: new Map([['m-other', 'v1']]),
      sourceScopes: new Map([['m-other', { userId: 'u', meetingId: 'meeting-OTHER' }]]),
    };
    const chunks = [{ sourceId: 'm-other', text: 'Sarah owns the launch checklist.', chunkIndex: 0, score: 0.95 }];
    const d = decide({
      requestId: 'r', requestSequence: 1, surface: 'what_to_answer', modeId: 'team-meet',
      scope: { userId: 'u', modeId: 'team-meet', meetingId: 'meeting-THIS' }, sessionId: 's',
      manualQuestion: QUESTIONS[0], hasAttachedDocuments: true,
    });
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => chunks });
    const { evidence } = await port.retrieve({ decision: d });
    assert.equal(evidence.length, 0, 'another meeting\'s transcript must never evidence this one');
  });
});
