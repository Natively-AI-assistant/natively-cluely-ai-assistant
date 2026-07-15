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

  test('keeps prepared transcript human-only and never appends assistant history', () => {
    const now = Date.now();
    const session = {
      getContextWithInterim: () => [
        { role: 'interviewer', text: 'What problem did the gate prevent?', timestamp: now - 3000 },
        { role: 'user', text: 'Please answer from the attached document.', timestamp: now - 2000 },
        { role: 'assistant', text: 'STALE ASSISTANT CLAIM FROM AN EARLIER TURN', timestamp: now - 1000 },
      ],
      getAssistantResponseHistory: () => ['OLDER GATED ASSISTANT RESPONSE'],
    };

    const context = buildPreparedTranscriptContext(session, 180);
    assert.match(context, /what problem did the gate prevent/i);
    assert.match(context, /please answer from the attached document/i);
    assert.doesNotMatch(context, /STALE ASSISTANT CLAIM/);
    assert.doesNotMatch(context, /OLDER GATED ASSISTANT RESPONSE/);
    assert.doesNotMatch(context, /RECENT ASSISTANT RESPONSES/);
  });
});
