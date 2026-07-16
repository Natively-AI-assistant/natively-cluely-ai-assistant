import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const { SessionTracker } = await import(pathToFileURL(modulePath).href);

test('startMeeting clears stale session context and anchors timing/metadata to Start', () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 1_000;
    const tracker = new SessionTracker();
    tracker.setMeetingMetadata({ title: 'stale meeting' });
    tracker.addTranscript({ speaker: 'user', text: 'stale transcript', timestamp: 1_000, final: true });
    tracker.logUsage('chat', 'stale question', 'stale answer');
    tracker.setCodingQuestion('stale coding question', 'transcript');

    Date.now = () => 5_000;
    const metadata = { title: 'Fresh interview', calendarEventId: 'calendar-1', source: 'calendar' };
    tracker.startMeeting(metadata);

    assert.equal(tracker.getSessionStartTime(), 5_000);
    assert.deepEqual(tracker.getMeetingMetadata(), metadata);
    assert.deepEqual(tracker.getFullTranscript(), []);
    assert.deepEqual(tracker.getFullUsage(), []);
    assert.deepEqual(tracker.getDetectedCodingQuestion(), { question: null, source: null });
  } finally {
    Date.now = originalNow;
  }
});
