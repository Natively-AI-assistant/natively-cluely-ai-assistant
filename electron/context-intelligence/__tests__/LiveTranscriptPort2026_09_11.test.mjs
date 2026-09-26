// The live transcript is evidence (2026-09-11). See live-transcript-port.ts.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { createLiveTranscriptRetrievalPort, chunkLiveTranscript, LIVE_TRANSCRIPT_SOURCE_ID } =
  await import(pathToFileURL(path.join(base, 'retrieval/live-transcript-port.js')).href);
const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);

const t0 = 1_700_000_000_000;
const seg = (speaker, text, i) => ({ speaker, text, timestamp: t0 + i * 8000, final: true });
const STANDUP = [
  ['system', 'okay lets start, um, quick round. Deepak you first'],
  ['system', 'so fleet tracker, the gps backlog thing, we rate limited the pings, one per five seconds, its stable now'],
  ['user', 'ok so that one is done, do we close it'],
  ['system', 'yeah close it. Meera, checkout'],
  ['system', 'right so, two things, the redis pool one is closed, pool is at two hundred now. the flag rollout one is the sev one'],
  ['system', 'okay Arjun, notifications'],
  ['system', 'so the kafka lag one, we changed partitions twenty four to forty eight, I need to know the max consumers, do we cap at twelve or sixteen'],
  ['system', 'sixteen, the brokers can take it'],
  ['user', 'whats the retention on the orders topic again, seven days?'],
  ['system', 'seven days on orders events, seventy two hours on vehicle positions'],
  ['system', 'good. Jonas, the etl thing'],
  ['system', 'snowflake cap raised to nine hundred credits, alert at eighty percent, also we moved the elasticsearch relocation window to two to four utc'],
  ['user', 'nice. random question, whats our monthly cloud budget'],
  ['system', 'one forty two k, alert at eighty five percent'],
  ['system', 'ok and yara wanted to remind everyone secrets rotate every ninety days and the next rotation is the twentieth'],
  ['user', 'wait is that the twentieth of this month'],
  ['system', 'yes september twentieth'],
  ['assistant', 'The retention on orders is seven days.'],
  ['system', 'ok thanks everyone, decisions: close the fleet tracker incident, cap consumers at sixteen'],
].map(([s, t], i) => seg(s, t, i));

const decision = (q) => decide({
  requestId: 'r1', requestSequence: 1, surface: 'what-to-answer', modeId: 'team-meet',
  scope: { userId: 'local', sessionId: 'sess-1' }, sessionId: 'sess-1', transcriptQuestion: q,
});
const port = () => createLiveTranscriptRetrievalPort({ segments: STANDUP, userId: 'local', sessionId: 'sess-1' });

describe('chunkLiveTranscript', () => {
  test('groups final speech into labelled windows and leaves assistant turns out', () => {
    const chunks = chunkLiveTranscript(STANDUP);
    assert.ok(chunks.length >= 2, 'a 19-turn stand-up is more than one window');
    assert.ok(chunks.every((c) => !/seven days\.$/m.test(c) || !/^ASSISTANT/m.test(c)));
    assert.ok(chunks.some((c) => /^THEM: /m.test(c)) && chunks.some((c) => /^ME: /m.test(c)));
    assert.ok(!chunks.join('\n').includes('The retention on orders is seven days.'), 'assistant speech is history, not evidence');
  });
  test('interim (non-final) segments are not evidence', () => {
    const chunks = chunkLiveTranscript([{ speaker: 'system', text: 'half a sent', final: false }, seg('system', 'a full sentence here', 0)]);
    assert.equal(chunks.length, 1);
    assert.ok(!chunks[0].includes('half a sent'));
  });
  test('consecutive windows share their boundary utterance', () => {
    const chunks = chunkLiveTranscript(STANDUP, undefined, 200);
    for (let i = 1; i < chunks.length; i++) {
      const prevLast = chunks[i - 1].split('\n').pop();
      assert.equal(chunks[i].split('\n')[0], prevLast, `window ${i} starts with the last line of window ${i - 1}`);
    }
  });
  test('nothing spoken → no port at all', () => {
    assert.equal(createLiveTranscriptRetrievalPort({ segments: [], userId: 'local', sessionId: 's' }), null);
  });
});

describe('the live transcript answers questions about what was said', () => {
  for (const [q, expect] of [
    ['did anyone mention the elasticsearch window', /elasticsearch relocation window to two to four utc/],
    ['when is the secrets rotation', /september twentieth|the twentieth/],
    ['earlier someone said the pool size, what was it', /pool is at two hundred/],
    ['what was jonas talking about again', /snowflake cap raised to nine hundred credits/],
  ]) {
    test(`${q}`, async () => {
      const r = await port().retrieve({ decision: decision(q) });
      assert.ok(r.evidence.length > 0, `no evidence for "${q}"`);
      assert.equal(r.evidence[0].sourceType, 'MEETING_TRANSCRIPT');
      assert.equal(r.evidence[0].sourceId, LIVE_TRANSCRIPT_SOURCE_ID);
      assert.ok(r.evidence.some((e) => expect.test(e.content)), `expected ${expect} in ${JSON.stringify(r.evidence.map((e) => e.content.slice(0, 80)))}`);
    });
  }
  test('a turn whose plan does not include MEETING_TRANSCRIPT admits nothing from it', async () => {
    // A coding task in technical-interview plans no transcript pool; the
    // legacy port's planned-type filter keeps the live transcript out.
    const d = decide({ requestId: 'r2', requestSequence: 2, surface: 'what-to-answer', modeId: 'technical-interview',
      scope: { userId: 'local', sessionId: 'sess-1' }, sessionId: 'sess-1', transcriptQuestion: 'implement two sum in python and explain the complexity' });
    assert.ok(!d.retrievalPlan.sourceTypes.includes('MEETING_TRANSCRIPT'), JSON.stringify(d.retrievalPlan.sourceTypes));
    const r = await port().retrieve({ decision: d });
    assert.equal(r.evidence.length, 0);
  });
  test('another session cannot see this transcript (scope containment)', async () => {
    const d = decide({ requestId: 'r3', requestSequence: 3, surface: 'what-to-answer', modeId: 'team-meet',
      scope: { userId: 'local', sessionId: 'sess-2' }, sessionId: 'sess-2', transcriptQuestion: 'did anyone mention the elasticsearch window' });
    const r = await port().retrieve({ decision: d });
    assert.equal(r.evidence.length, 0);
    assert.equal(r.attempts[0].rejections[0].reason, 'OUT_OF_SCOPE');
  });
  test('a question sharing no words with the meeting retrieves nothing', async () => {
    const r = await port().retrieve({ decision: decision('xyzzqxq bogusterm nonsenseword') });
    assert.equal(r.evidence.length, 0);
  });
});

describe('the live path wires the port (source pins)', () => {
  // Superseded by issue #552 (Task 3): the engine no longer builds this port
  // itself — it hands the session's transcript to resolveMeetingEvidence(),
  // which builds BOTH the JIT and live-transcript ports from one shared
  // resolver (see meeting-evidence.ts and MeetingEvidence2026_09_11.test.mjs,
  // whose test 8 pins the port's own construction). What's left to pin here
  // is only the handover: the engine still passes its OWN transcript and
  // conversation session id into that resolver.
  test('IntelligenceEngine hands its own transcript and session id to the meeting-evidence resolver', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/IntelligenceEngine.ts'), 'utf8');
    assert.match(src, /resolveMeetingEvidence\(\{/);
    assert.match(src, /segments: \(this\.session as any\)\?\.getFullTranscript\?\.\(\) \?\? \[\]/);
    assert.match(src, /sessionId: this\.conversationSessionId\(\)/);
  });
});
