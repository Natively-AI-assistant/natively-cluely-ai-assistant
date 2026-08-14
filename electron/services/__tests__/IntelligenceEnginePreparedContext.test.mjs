// buildPreparedTranscriptContext — interim + final transcript assembly for WTA.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadPreparedContext() {
  const modPath = path.resolve(
    __dirname,
    '../../../dist-electron/electron/utils/preparedTranscriptContext.js',
  );
  return import(pathToFileURL(modPath).href);
}

async function loadSessionTracker() {
  const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
  return import(pathToFileURL(sessionPath).href);
}

describe('buildPreparedTranscriptContext', () => {
  let buildPreparedTranscriptContext;
  let SessionTracker;

  beforeEach(async () => {
    ({ buildPreparedTranscriptContext } = await loadPreparedContext());
    ({ SessionTracker } = await loadSessionTracker());
  });

  test('includes interim interviewer text alongside final turns', () => {
    const session = new SessionTracker();
    const now = Date.now();

    session.handleTranscript({
      speaker: 'interviewer',
      text: 'Tell me about your leadership experience.',
      timestamp: now - 5000,
      final: true,
    });

    session.handleTranscript({
      speaker: 'interviewer',
      text: 'Especially cross-functional teams.',
      timestamp: now,
      final: false,
    });

    const context = buildPreparedTranscriptContext(session, 180);
    assert.match(context, /leadership experience/);
    assert.match(context, /cross-functional teams/);
  });

  test('returns empty string for empty session (negative)', () => {
    const session = new SessionTracker();
    assert.equal(buildPreparedTranscriptContext(session, 180), '');
  });
});
