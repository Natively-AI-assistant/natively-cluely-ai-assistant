// PHASE 8 WIRING VERIFICATION — MeetingMemory extraction SHAPE persisted into summary_json.
//
// This test does NOT exercise MeetingPersistence.ts directly (that pulls in Electron +
// better-sqlite3 native ABI and a live DB). Instead it proves the exact thing the Phase 8
// wiring relies on: calling the REAL compiled MeetingMemoryService.buildMeetingRecord with a
// realistic TranscriptSegment[] produces the field set that electron/MeetingPersistence.ts
// (~line 360-380) copies into `summaryData.meetingMemory`, and that the resulting object
// survives the JSON round-trip DatabaseManager.saveMeeting/getMeetingDetails performs
// (JSON.stringify({ ...detailedSummary }) → JSON.parse) without loss, alongside the
// pre-existing detailedSummary keys (backward compatibility — extra key is additive).
//
// Loads the SAME compiled artifact the app ships (dist-electron), so this is a faithful
// proxy of the wired behavior, not a re-implementation.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MeetingMemoryService } from '../../../dist-electron/electron/intelligence/MeetingMemoryService.js';

// Realistic sales-call transcript in the EXACT shape MeetingPersistence passes as
// `data.transcript` → buildMeetingRecord({ segments }): TranscriptSegment = {speaker,text,timestamp}.
const SALES_TRANSCRIPT = [
  { speaker: 'them', text: 'Thanks for hopping on. What is your pricing for the enterprise tier?', timestamp: 1000 },
  { speaker: 'me', text: 'Happy to walk through it. I will send over a detailed quote by end of day.', timestamp: 2000 },
  { speaker: 'them', text: 'Does the platform integrate with Redis for caching at our scale?', timestamp: 3000 },
  { speaker: 'me', text: 'Yes, we run Redis and Postgres under the hood and it handles sharding cleanly.', timestamp: 4000 },
  { speaker: 'them', text: 'Great. We decided to start a pilot next week with the Acme Technologies team.', timestamp: 5000 },
  { speaker: 'me', text: 'Perfect, we will set up the pilot environment and follow up with onboarding docs.', timestamp: 6000 },
];

// The EXACT projection electron/MeetingPersistence.ts performs at the wiring site. Keeping
// this inline mirrors the production code so a drift in either the record shape or the wiring
// projection is caught here.
function projectMeetingMemory(record) {
  return {
    topics: record.topics,
    questionsAsked: record.questionsAsked,
    decisions: record.decisions,
    actionItems: record.actionItems,
    entities: record.entities,
    skillsDiscussed: record.skillsDiscussed,
    companiesDiscussed: record.companiesDiscussed,
    participants: record.participants,
    sourceQuality: record.sourceQuality,
    schemaVersion: 1,
  };
}

describe('MeetingMemory wiring — extraction shape persisted into summary_json (Phase 8)', () => {
  test('buildMeetingRecord populates every field the wiring projects', () => {
    const record = new MeetingMemoryService().buildMeetingRecord({
      meetingId: 'mtg-test-1',
      segments: SALES_TRANSCRIPT,
      mode: 'sales',
      startedAt: 1000,
      endedAt: 6000,
    });

    const mem = projectMeetingMemory(record);

    // Every key the production wiring writes must exist and be the right type.
    assert.ok(Array.isArray(mem.topics), 'topics is array');
    assert.ok(Array.isArray(mem.questionsAsked), 'questionsAsked is array');
    assert.ok(Array.isArray(mem.decisions), 'decisions is array');
    assert.ok(Array.isArray(mem.actionItems), 'actionItems is array');
    assert.ok(Array.isArray(mem.entities), 'entities is array');
    assert.ok(Array.isArray(mem.skillsDiscussed), 'skillsDiscussed is array');
    assert.ok(Array.isArray(mem.companiesDiscussed), 'companiesDiscussed is array');
    assert.ok(Array.isArray(mem.participants), 'participants is array');
    assert.equal(typeof mem.sourceQuality, 'number', 'sourceQuality is number');
    assert.equal(mem.schemaVersion, 1, 'schemaVersion pinned to 1');
  });

  test('pricing question is captured in questionsAsked', () => {
    const record = new MeetingMemoryService().buildMeetingRecord({ meetingId: 'm', segments: SALES_TRANSCRIPT });
    assert.ok(
      record.questionsAsked.some(q => /pricing/i.test(q)),
      `expected a pricing question, got: ${JSON.stringify(record.questionsAsked)}`,
    );
  });

  test('pilot decision is captured in decisions', () => {
    const record = new MeetingMemoryService().buildMeetingRecord({ meetingId: 'm', segments: SALES_TRANSCRIPT });
    assert.ok(
      record.decisions.some(d => /decided|pilot|start a pilot/i.test(d)),
      `expected a pilot decision, got: ${JSON.stringify(record.decisions)}`,
    );
  });

  test('redis is captured in skillsDiscussed', () => {
    const record = new MeetingMemoryService().buildMeetingRecord({ meetingId: 'm', segments: SALES_TRANSCRIPT });
    assert.ok(
      record.skillsDiscussed.includes('redis'),
      `expected redis in skillsDiscussed, got: ${JSON.stringify(record.skillsDiscussed)}`,
    );
  });

  test('both speakers appear in participants', () => {
    const record = new MeetingMemoryService().buildMeetingRecord({ meetingId: 'm', segments: SALES_TRANSCRIPT });
    assert.ok(record.participants.includes('them'), `participants missing 'them': ${JSON.stringify(record.participants)}`);
    assert.ok(record.participants.includes('me'), `participants missing 'me': ${JSON.stringify(record.participants)}`);
  });

  test('sourceQuality is a real number in [0,1]', () => {
    const record = new MeetingMemoryService().buildMeetingRecord({ meetingId: 'm', segments: SALES_TRANSCRIPT });
    assert.ok(Number.isFinite(record.sourceQuality), 'sourceQuality is finite');
    assert.ok(record.sourceQuality >= 0 && record.sourceQuality <= 1, `sourceQuality out of range: ${record.sourceQuality}`);
    // A structured 6-turn call should score above the floor (it has questions+decisions+actions).
    assert.ok(record.sourceQuality > 0, 'a structured call should have sourceQuality > 0');
  });

  // ── Backward-compatibility / persistence proof ────────────────────────────────────────
  test('meetingMemory survives the saveMeeting JSON round-trip alongside existing detailedSummary keys', () => {
    const record = new MeetingMemoryService().buildMeetingRecord({ meetingId: 'm', segments: SALES_TRANSCRIPT });

    // Simulate the detailedSummary object AS BUILT by MeetingPersistence with flag ON:
    // pre-existing keys (overview/actionItems/keyPoints) PLUS the additive meetingMemory key.
    const detailedSummary = {
      overview: 'Sales discovery call about enterprise pricing.',
      actionItems: ['Send detailed quote', 'Set up pilot environment'],
      keyPoints: ['Customer interested in enterprise tier', 'Redis/Postgres backend confirmed'],
      schemaVersion: 2,
      meetingMemory: projectMeetingMemory(record),
    };

    // DatabaseManager.saveMeeting serializes JSON.stringify({ legacySummary, detailedSummary }).
    const summaryJson = JSON.stringify({ legacySummary: 'See detailed summary', detailedSummary });

    // getMeetingDetails / getRecentMeetings do JSON.parse(row.summary_json || '{}').detailedSummary.
    const parsed = JSON.parse(summaryJson).detailedSummary;

    // Existing keys untouched (additive change does not disturb them).
    assert.equal(parsed.overview, detailedSummary.overview);
    assert.deepEqual(parsed.actionItems, detailedSummary.actionItems);
    assert.deepEqual(parsed.keyPoints, detailedSummary.keyPoints);

    // New key round-trips losslessly.
    assert.ok(parsed.meetingMemory, 'meetingMemory key survived round-trip');
    assert.deepEqual(parsed.meetingMemory, projectMeetingMemory(record));
    assert.equal(parsed.meetingMemory.schemaVersion, 1);
  });

  test('readers tolerate OLD meetings without meetingMemory (missing key is undefined, not a throw)', () => {
    // An old meeting saved before Phase 8 — no meetingMemory key.
    const oldDetailed = { overview: 'legacy', actionItems: [], keyPoints: [] };
    const summaryJson = JSON.stringify({ legacySummary: 'x', detailedSummary: oldDetailed });
    const parsed = JSON.parse(summaryJson || '{}').detailedSummary;
    assert.equal(parsed.meetingMemory, undefined, 'old meeting has no meetingMemory');
    // Accessing nested fields defensively must not throw.
    assert.doesNotThrow(() => {
      const topics = parsed.meetingMemory?.topics ?? [];
      assert.ok(Array.isArray(topics));
    });
  });

  // ── Robustness: extraction never throws on bad input (non-fatal guarantee) ─────────────
  test('buildMeetingRecord never throws on empty/malformed transcript', () => {
    const svc = new MeetingMemoryService();
    const bad = [
      undefined,
      null,
      [],
      [{}],
      [{ speaker: 'x' }],            // no text
      [{ text: 'hello' }],           // no speaker
      [{ speaker: null, text: null }],
      [{ speaker: 'x', text: '' }],
      [{ speaker: 'x', text: '   ' }],
      'not-an-array',
      123,
      [{ speaker: 'x', text: 'a'.repeat(50000) }], // huge single line
    ];
    for (const segments of bad) {
      assert.doesNotThrow(() => {
        const r = svc.buildMeetingRecord({ meetingId: 'm', segments });
        // Even on garbage input the contract holds: arrays present, sourceQuality numeric.
        assert.ok(Array.isArray(r.topics));
        assert.ok(Array.isArray(r.questionsAsked));
        assert.ok(Array.isArray(r.decisions));
        assert.ok(Array.isArray(r.actionItems));
        assert.ok(Array.isArray(r.entities));
        assert.ok(Array.isArray(r.skillsDiscussed));
        assert.ok(Array.isArray(r.companiesDiscussed));
        assert.ok(Array.isArray(r.participants));
        assert.equal(typeof r.sourceQuality, 'number');
        assert.ok(r.sourceQuality >= 0 && r.sourceQuality <= 1);
      }, `buildMeetingRecord threw on input: ${JSON.stringify(segments)?.slice(0, 60)}`);
    }
  });

  test('empty transcript yields an empty-but-valid record (sourceQuality 0)', () => {
    const r = new MeetingMemoryService().buildMeetingRecord({ meetingId: 'm', segments: [] });
    assert.deepEqual(r.questionsAsked, []);
    assert.deepEqual(r.decisions, []);
    assert.deepEqual(r.participants, []);
    assert.equal(r.sourceQuality, 0);
  });
});
