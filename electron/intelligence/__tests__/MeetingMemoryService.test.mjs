// PHASE 10 — Meeting Memory: deterministic insight extraction + structured record.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MeetingMemoryService,
  MeetingInsightExtractor,
} from '../../../dist-electron/electron/intelligence/MeetingMemoryService.js';

const SALES_CALL = [
  { speaker: 'them', text: 'What is your pricing for the enterprise tier?', timestamp: 1000 },
  { speaker: 'me', text: 'We will send over a detailed quote by end of day.', timestamp: 2000 },
  { speaker: 'them', text: 'Can you integrate with Redis and Kafka?', timestamp: 3000 },
  { speaker: 'me', text: "We agreed to start a pilot next week with the Acme Technologies team.", timestamp: 4000 },
  { speaker: 'them', text: 'We decided to move forward with the proposal.', timestamp: 5000 },
];

describe('MeetingInsightExtractor', () => {
  const ex = new MeetingInsightExtractor();

  test('extracts questions asked', () => {
    const r = ex.extract(SALES_CALL);
    assert.ok(r.questionsAsked.some(q => /pricing/i.test(q)));
    assert.ok(r.questionsAsked.some(q => /redis|kafka/i.test(q)));
  });

  test('extracts decisions', () => {
    const r = ex.extract(SALES_CALL);
    assert.ok(r.decisions.some(d => /agreed|decided|move forward/i.test(d)));
  });

  test('extracts action items', () => {
    const r = ex.extract(SALES_CALL);
    assert.ok(r.actionItems.some(a => /will send|by end of day/i.test(a)));
  });

  test('extracts skills/technologies discussed', () => {
    const r = ex.extract(SALES_CALL);
    assert.ok(r.skillsDiscussed.includes('redis'));
    assert.ok(r.skillsDiscussed.includes('kafka'));
  });

  test('extracts entities and company-like names', () => {
    const r = ex.extract(SALES_CALL);
    assert.ok(r.entities.some(e => /Acme/.test(e)));
    assert.ok(r.companiesDiscussed.some(c => /Acme Technologies|Technologies/.test(c)) || r.entities.some(e => /Acme/.test(e)));
  });

  test('topics are populated and bounded', () => {
    const r = ex.extract(SALES_CALL);
    assert.ok(r.topics.length > 0);
    assert.ok(r.topics.length <= 20);
  });

  test('empty/malformed transcript → empty insights, never throws', () => {
    assert.doesNotThrow(() => ex.extract([]));
    const r = ex.extract([]);
    assert.deepEqual(r.questionsAsked, []);
    assert.deepEqual(r.decisions, []);
  });
});

describe('MeetingMemoryService.buildMeetingRecord', () => {
  const svc = new MeetingMemoryService();

  test('produces the structured meeting record', () => {
    const rec = svc.buildMeetingRecord({ meetingId: 'm1', segments: SALES_CALL, mode: 'sales', startedAt: 1000, endedAt: 5000 });
    assert.equal(rec.meetingId, 'm1');
    assert.equal(rec.mode, 'sales');
    assert.ok(rec.participants.includes('them'));
    assert.ok(rec.participants.includes('me'));
    assert.match(rec.cleanTranscript, /pricing/);
    assert.ok(rec.questionsAsked.length > 0);
    assert.ok(rec.sourceQuality > 0 && rec.sourceQuality <= 1);
  });

  test('sourceQuality reflects structure (a rich call scores higher than a thin one)', () => {
    const rich = svc.buildMeetingRecord({ meetingId: 'm1', segments: SALES_CALL });
    const thin = svc.buildMeetingRecord({ meetingId: 'm2', segments: [{ speaker: 'a', text: 'hello there' }] });
    assert.ok(rich.sourceQuality > thin.sourceQuality);
  });

  test('clean transcript strips fillers/stutters', () => {
    const rec = svc.buildMeetingRecord({ meetingId: 'm3', segments: [{ speaker: 'a', text: 'um um the the price is high' }] });
    assert.doesNotMatch(rec.cleanTranscript, /\bum um\b|\bthe the\b/);
  });

  test('never throws on empty input', () => {
    assert.doesNotThrow(() => svc.buildMeetingRecord({ meetingId: 'x', segments: [] }));
  });
});
