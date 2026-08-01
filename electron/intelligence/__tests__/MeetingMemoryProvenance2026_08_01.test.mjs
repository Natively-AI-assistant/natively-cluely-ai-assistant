// electron/intelligence/__tests__/MeetingMemoryProvenance2026_08_01.test.mjs
//
// DEFECT B (P0, 2026-08-01) — phantom meeting memory. A zero-audio session whose
// "transcript" was only typed manual-chat questions + assistant answers persisted
// {topics:7, decisions:1, actionItems:7, entities:7} because the extractor mined
// every segment in the unprovenanced store. This pins the provenance model:
//
//   1. isMemoryEligibleSegment: origin === 'stt' only; documented legacy fallback
//      (no origin): speaker not assistant-like AND numeric confidence < 1.
//   2. MeetingInsightExtractor / buildMeetingRecord extract ONLY from eligible
//      segments (decisions, actionItems, topics, entities, risks, questions,
//      participants, cleanTranscript).
//   3. buildPersistedMeetingMemory HARD INVARIANT: zero eligible segments ⇒ EMPTY
//      persisted memory regardless of extractor output (defense-in-depth), plus
//      content-free telemetry counts.
//   4. Evidence pointers: decisionsMeta/actionItemsMeta carry sourceSegmentIds
//      that index the ORIGINAL transcript array.
//
// Runs against the compiled artifact the app ships (dist-electron), like the other
// MeetingMemory tests.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MeetingMemoryService,
  MeetingInsightExtractor,
  isMemoryEligibleSegment,
  buildPersistedMeetingMemory,
} from '../../../dist-electron/electron/intelligence/MeetingMemoryService.js';

const ex = new MeetingInsightExtractor();
const svc = new MeetingMemoryService();

// The Defect B repro shape: a zero-audio "team meet" session — typed questions +
// assistant answers, including reference-style pasted content ("Suggested
// Transcript for Testing") full of decision/action trigger phrases.
const ZERO_AUDIO_SESSION = [
  { speaker: 'user', text: 'Suggested Transcript for Testing: We decided to block release until résumé and JD routing are fixed.', timestamp: 1000, final: true, origin: 'manual_chat' },
  { speaker: 'assistant', text: 'Got it. Maya will patch the source contract by Friday, and Mark owns the Redis migration.', timestamp: 2000, final: true, confidence: 1.0, origin: 'assistant' },
  { speaker: 'user', text: 'What will we need to do to follow up on the action items from Acme Technologies?', timestamp: 3000, final: true, origin: 'manual_chat' },
  { speaker: 'assistant', text: 'Decision: beta launches next Tuesday. Action: ship the API docs by EOD.', timestamp: 4000, final: true, confidence: 1.0, origin: 'assistant' },
];

// Same content, LEGACY shape (stored before provenance existed — no origin field).
// Typed chat omits confidence; assistant hardcodes 1.0.
const ZERO_AUDIO_SESSION_LEGACY = ZERO_AUDIO_SESSION.map(({ origin, ...rest }) => rest);

describe('isMemoryEligibleSegment — eligibility rule', () => {
  test("origin 'stt' is eligible (with or without confidence)", () => {
    assert.equal(isMemoryEligibleSegment({ speaker: 'user', text: 'x', origin: 'stt', confidence: 0.9 }), true);
    assert.equal(isMemoryEligibleSegment({ speaker: 'interviewer', text: 'x', origin: 'stt' }), true);
  });

  test('every non-stt origin is ineligible even with STT-looking confidence', () => {
    for (const origin of ['manual_chat', 'assistant', 'system_instruction', 'test']) {
      assert.equal(isMemoryEligibleSegment({ speaker: 'user', text: 'x', origin, confidence: 0.9 }), false, `origin=${origin}`);
    }
  });

  test('legacy fallback: {speaker:user, confidence:0.92, no origin} IS eligible', () => {
    assert.equal(isMemoryEligibleSegment({ speaker: 'user', text: 'x', confidence: 0.92 }), true);
  });

  test('legacy fallback: {speaker:assistant, confidence:1.0} is NOT eligible', () => {
    assert.equal(isMemoryEligibleSegment({ speaker: 'assistant', text: 'x', confidence: 1.0 }), false);
  });

  test('legacy fallback: {speaker:user, no confidence} (typed chat) is NOT eligible', () => {
    assert.equal(isMemoryEligibleSegment({ speaker: 'user', text: 'x' }), false);
  });

  test('legacy fallback: confidence 1.0 (assistant hardcode) is NOT eligible on any speaker', () => {
    assert.equal(isMemoryEligibleSegment({ speaker: 'interviewer', text: 'x', confidence: 1 }), false);
  });

  test('legacy fallback: assistant-like speakers (ai/model) are NOT eligible even with confidence < 1', () => {
    assert.equal(isMemoryEligibleSegment({ speaker: 'ai', text: 'x', confidence: 0.5 }), false);
    assert.equal(isMemoryEligibleSegment({ speaker: 'model', text: 'x', confidence: 0.5 }), false);
  });

  test('garbage input never throws and is ineligible', () => {
    assert.equal(isMemoryEligibleSegment(null), false);
    assert.equal(isMemoryEligibleSegment(undefined), false);
    assert.equal(isMemoryEligibleSegment({}), false);
  });
});

describe('MeetingInsightExtractor — provenance filter (Defect B core)', () => {
  test('reference-style manual_chat/assistant text cannot create decisions', () => {
    const r = ex.extract(ZERO_AUDIO_SESSION);
    assert.deepEqual(r.decisions, [], `expected no decisions, got ${JSON.stringify(r.decisions)}`);
    assert.deepEqual(r.decisionsMeta, []);
  });

  test('assistant messages cannot create decisions (origin AND legacy speaker/confidence shapes)', () => {
    const tagged = ex.extract([
      { speaker: 'assistant', text: 'We decided to move forward with the proposal.', confidence: 1.0, origin: 'assistant' },
    ]);
    assert.deepEqual(tagged.decisions, []);
    const legacy = ex.extract([
      { speaker: 'assistant', text: 'We decided to move forward with the proposal.', confidence: 1.0 },
    ]);
    assert.deepEqual(legacy.decisions, []);
  });

  test('manual-chat questions cannot create action items ("will"/"need to" triggers)', () => {
    const r = ex.extract([
      { speaker: 'user', text: 'What will we need to do to fix the JD routing by Friday?', origin: 'manual_chat' },
    ]);
    assert.deepEqual(r.actionItems, []);
    assert.deepEqual(r.actionItemsMeta, []);
  });

  test('zero eligible segments ⇒ zero decisions AND zero actionItems AND zero topics/entities', () => {
    for (const transcript of [ZERO_AUDIO_SESSION, ZERO_AUDIO_SESSION_LEGACY]) {
      const r = ex.extract(transcript);
      assert.deepEqual(r.decisions, []);
      assert.deepEqual(r.actionItems, []);
      assert.deepEqual(r.topics, []);
      assert.deepEqual(r.entities, []);
      assert.deepEqual(r.questionsAsked, []);
      assert.deepEqual(r.risks, []);
    }
  });

  test("origin 'stt' segments CAN create supported decisions/action items with sourceSegmentIds", () => {
    // Ineligible segments interleaved so ids prove they index the ORIGINAL array.
    const transcript = [
      { speaker: 'user', text: 'Summarize this meeting for me please.', origin: 'manual_chat' },                                  // 0
      { speaker: 'user', text: 'We decided to block release until résumé and JD routing are fixed.', confidence: 0.93, origin: 'stt' }, // 1
      { speaker: 'assistant', text: 'Understood — that decision is logged.', confidence: 1.0, origin: 'assistant' },               // 2
      { speaker: 'interviewer', text: 'Maya will patch the source contract by Friday.', confidence: 0.9, origin: 'stt' },          // 3
    ];
    const r = ex.extract(transcript);
    assert.equal(r.decisions.length, 1, `decisions: ${JSON.stringify(r.decisions)}`);
    assert.match(r.decisions[0], /block release/);
    assert.equal(r.actionItems.length, 1, `actionItems: ${JSON.stringify(r.actionItems)}`);
    assert.match(r.actionItems[0], /Maya will patch/);
    // Evidence pointers into the ORIGINAL transcript array.
    assert.deepEqual(r.decisionsMeta[0].sourceSegmentIds, [1]);
    assert.deepEqual(r.actionItemsMeta[0].sourceSegmentIds, [3]);
    assert.equal(r.decisionsMeta[0].text, r.decisions[0]);
    assert.equal(r.actionItemsMeta[0].text, r.actionItems[0]);
  });
});

describe('buildMeetingRecord — memory view is eligible-only', () => {
  test("participants never include 'assistant'; cleanTranscript excludes chat/assistant text", () => {
    const rec = svc.buildMeetingRecord({
      meetingId: 'm-prov-1',
      segments: [
        ...ZERO_AUDIO_SESSION,
        { speaker: 'interviewer', text: 'We agreed to start the pilot next week.', confidence: 0.91, origin: 'stt' },
      ],
    });
    assert.deepEqual(rec.participants, ['interviewer']);
    assert.doesNotMatch(rec.cleanTranscript, /Maya will patch|Suggested Transcript|beta launches/);
    assert.match(rec.cleanTranscript, /pilot next week/);
    assert.equal(rec.decisions.length, 1);
  });

  test('zero-audio session (tagged AND legacy shapes) yields an all-empty record', () => {
    for (const segments of [ZERO_AUDIO_SESSION, ZERO_AUDIO_SESSION_LEGACY]) {
      const rec = svc.buildMeetingRecord({ meetingId: 'm-prov-2', segments });
      assert.deepEqual(rec.decisions, []);
      assert.deepEqual(rec.actionItems, []);
      assert.deepEqual(rec.topics, []);
      assert.deepEqual(rec.entities, []);
      assert.deepEqual(rec.participants, []);
      assert.equal(rec.cleanTranscript, '');
      assert.equal(rec.sourceQuality, 0);
    }
  });
});

describe('buildPersistedMeetingMemory — persistence HARD INVARIANT + telemetry', () => {
  test('zero eligible ⇒ EMPTY persisted memory EVEN IF the extractor (regression) returned items', () => {
    // Simulate an extractor-filter regression: a record full of phantom items.
    const phantomRecord = svc.buildMeetingRecord({
      meetingId: 'm-prov-3',
      segments: [{ speaker: 'S', text: 'We decided to ship Redis by Friday.', confidence: 0.9, origin: 'stt' }],
    });
    assert.ok(phantomRecord.decisions.length > 0, 'precondition: record has items');
    // But the ACTUAL transcript has zero eligible segments.
    const { meetingMemory, telemetry } = buildPersistedMeetingMemory(ZERO_AUDIO_SESSION, phantomRecord);
    assert.deepEqual(meetingMemory.decisions, []);
    assert.deepEqual(meetingMemory.actionItems, []);
    assert.deepEqual(meetingMemory.topics, []);
    assert.deepEqual(meetingMemory.entities, []);
    assert.deepEqual(meetingMemory.participants, []);
    assert.equal(meetingMemory.sourceQuality, 0);
    assert.equal(meetingMemory.schemaVersion, 2, 'schemaVersion unchanged by the guard');
    assert.equal(telemetry.zeroEligibleGuardApplied, true);
    assert.equal(telemetry.persistedDecisions, 0);
    assert.equal(telemetry.persistedActionItems, 0);
  });

  test('telemetry counts by provenance (counts only — no transcript text in the object)', () => {
    const transcript = [
      { speaker: 'user', text: 'spoken one', confidence: 0.9, origin: 'stt' },
      { speaker: 'interviewer', text: 'We decided to go live Tuesday.', confidence: 0.88, origin: 'stt' },
      ...ZERO_AUDIO_SESSION, // 2 manual_chat + 2 assistant
      { speaker: 'assistant', text: 'legacy assistant row', confidence: 1.0 }, // legacy assistant (no origin)
    ];
    const record = svc.buildMeetingRecord({ meetingId: 'm-prov-4', segments: transcript });
    const { meetingMemory, telemetry } = buildPersistedMeetingMemory(transcript, record);
    assert.equal(telemetry.memoryEligibleSegments, 2);
    assert.equal(telemetry.actualTranscriptSegments, 2);
    assert.equal(telemetry.manualChatMessages, 2);
    assert.equal(telemetry.assistantMessages, 3, 'origin-tagged assistant (2) + legacy speaker fallback (1)');
    assert.equal(telemetry.zeroEligibleGuardApplied, false);
    assert.equal(telemetry.persistedDecisions, meetingMemory.decisions.length);
    assert.equal(telemetry.persistedActionItems, meetingMemory.actionItems.length);
    assert.ok(meetingMemory.decisions.some((d) => /go live Tuesday/.test(d)));
    // No raw transcript text leaks through the telemetry object.
    assert.ok(Object.values(telemetry).every((v) => typeof v === 'number' || typeof v === 'boolean'));
  });

  test('meetingMemory blob survives the summary_json JSON round-trip (additive fields included)', () => {
    const transcript = [{ speaker: 'me', text: 'Mark owns Redis migration by Friday.', confidence: 0.9, origin: 'stt' }];
    const record = svc.buildMeetingRecord({ meetingId: 'm-prov-5', segments: transcript });
    const { meetingMemory } = buildPersistedMeetingMemory(transcript, record);
    const roundTripped = JSON.parse(JSON.stringify({ detailedSummary: { meetingMemory } })).detailedSummary.meetingMemory;
    assert.deepEqual(roundTripped, meetingMemory);
    assert.ok(Array.isArray(roundTripped.actionItemsMeta));
    assert.deepEqual(roundTripped.actionItemsMeta[0].sourceSegmentIds, [0]);
  });
});
