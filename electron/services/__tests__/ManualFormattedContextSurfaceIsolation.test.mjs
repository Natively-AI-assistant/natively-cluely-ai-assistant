import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist-electron/electron');
const { SessionTracker } = await import(pathToFileURL(path.join(distDir, 'SessionTracker.js')).href);

describe('manual formatted-context surface isolation', () => {
  test('manual prompt keeps human transcript and its own replies but excludes every other assistant surface', () => {
    const session = new SessionTracker();
    const now = Date.now();

    session.addTranscript({
      speaker: 'interviewer',
      text: 'Could you introduce yourself?',
      timestamp: now,
      final: true,
    });
    session.addTranscript({
      speaker: 'user',
      text: 'I am a software engineer.',
      timestamp: now + 1,
      final: true,
    });
    session.addAssistantMessage(
      'WTA presentation that must not anchor a later manual translation.',
      undefined,
      'what_to_answer',
    );
    session.addAssistantMessage(
      'Manual chat answer that belongs to this same surface.',
      undefined,
      'manual_chat',
    );
    session.addAssistantMessage(
      'Screenshot answer from a different surface.',
      undefined,
      'screenshot',
    );

    const manual = session.getFormattedContext(900, 'manual_chat');
    assert.match(manual, /Could you introduce yourself\?/);
    assert.match(manual, /I am a software engineer\./);
    assert.match(manual, /Manual chat answer that belongs/);
    assert.doesNotMatch(manual, /WTA presentation/);
    assert.doesNotMatch(manual, /Screenshot answer/);

    const legacyShared = session.getFormattedContext(900);
    assert.match(legacyShared, /WTA presentation/);
    assert.match(legacyShared, /Manual chat answer/);
    assert.match(legacyShared, /Screenshot answer/);
  });

  test('a new manual surface does not inherit legacy untagged or WTA assistant output', () => {
    const session = new SessionTracker();
    session.addAssistantMessage('Legacy answer with unknown provenance and enough characters.');
    session.addAssistantMessage('Recent WTA candidate presentation with enough characters.', undefined, 'what_to_answer');

    assert.equal(session.getFormattedContext(900, 'manual_chat'), '');
    assert.match(session.getFormattedContext(900), /Legacy answer/);
    assert.match(session.getFormattedContext(900), /Recent WTA candidate presentation/);
  });
});
