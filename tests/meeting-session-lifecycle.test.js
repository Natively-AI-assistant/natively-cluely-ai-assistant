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
