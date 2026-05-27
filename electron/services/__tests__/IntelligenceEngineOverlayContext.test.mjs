// Overlay clarify / follow-up context assembly — verifies interim interviewer
// partials are included so overlay actions see the same rolling STT the UI shows.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadSessionTracker() {
  const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
  return import(pathToFileURL(sessionPath).href);
}

describe('SessionTracker — formatted context with interim transcript', () => {
  let SessionTracker;

  beforeEach(async () => {
    ({ SessionTracker } = await loadSessionTracker());
  });

  test('getFormattedContextWithInterim includes pending interviewer partial', () => {
    const session = new SessionTracker();
    const now = Date.now();

    session.handleTranscript({
      speaker: 'interviewer',
      text: 'Can you walk me through your experience with distributed systems?',
      timestamp: now - 5000,
      final: true,
    });

    session.handleTranscript({
      speaker: 'interviewer',
      text: 'And specifically how you handled consistency',
      timestamp: now,
      final: false,
    });

    const plain = session.getFormattedContext(180);
    const withInterim = session.getFormattedContextWithInterim(180);

    assert.doesNotMatch(plain, /consistency/);
    assert.match(withInterim, /distributed systems/);
    assert.match(withInterim, /consistency/);
    assert.match(withInterim, /\[INTERVIEWER\]/);
  });

  test('getFormattedContextWithInterim dedupes interim that matches last final', () => {
    const session = new SessionTracker();
    const now = Date.now();
    const text = 'What is your approach to testing?';

    session.handleTranscript({
      speaker: 'interviewer',
      text,
      timestamp: now,
      final: true,
    });

    session.handleTranscript({
      speaker: 'interviewer',
      text,
      timestamp: now + 100,
      final: false,
    });

    const withInterim = session.getFormattedContextWithInterim(180);
    const occurrences = withInterim.split(text).length - 1;
    assert.equal(occurrences, 1, 'duplicate interim should not be appended');
  });
});
