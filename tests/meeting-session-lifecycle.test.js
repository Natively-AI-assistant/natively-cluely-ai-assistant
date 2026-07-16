const assert = require('node:assert/strict');
const test = require('node:test');

const { SessionTracker } = require('../dist-electron/electron/SessionTracker.js');

test('meeting start resets stale context and anchors timing to the Start action', () => {
  const session = new SessionTracker();
  session.sessionStartTime = 1;
  session.addTranscript({
    speaker: 'interviewer',
    text: 'stale pre-meeting context',
    timestamp: Date.now(),
    final: true,
  });
  session.pushUsage({ type: 'stale' });
  session.setMeetingMetadata({ title: 'stale metadata' });

  const beforeStart = Date.now();
  session.startMeeting({ title: 'current meeting' });
  const afterStart = Date.now();

  assert.ok(session.getSessionStartTime() >= beforeStart);
  assert.ok(session.getSessionStartTime() <= afterStart);
  assert.deepEqual(session.getFullTranscript(), []);
  assert.deepEqual(session.getFullUsage(), []);
  assert.deepEqual(session.getMeetingMetadata(), { title: 'current meeting' });
});

test('an old compaction cannot mutate the next meeting after reset', async () => {
  const session = new SessionTracker();
  let resolveSummary;
  session.setRecapLLM({
    generate: () => new Promise(resolve => { resolveSummary = resolve; }),
  });
  session.fullTranscript = Array.from({ length: 1801 }, (_, index) => ({
    speaker: 'interviewer',
    text: `old-${index}`,
    timestamp: index,
    final: true,
  }));

  const oldCompaction = session.compactTranscriptIfNeeded();
  session.reset();
  session.fullTranscript = Array.from({ length: 600 }, (_, index) => ({
    speaker: 'user',
    text: `new-${index}`,
    timestamp: index,
    final: true,
  }));

  resolveSummary('old meeting summary');
  await oldCompaction;

  assert.equal(session.fullTranscript.length, 600);
  assert.deepEqual(session.transcriptEpochSummaries, []);
});
