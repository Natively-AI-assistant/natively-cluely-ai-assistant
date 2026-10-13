// gemini-chat-stream grounds manual chat in the unified interview context
// (InterviewContextBuilder) captured before the user's turn is recorded.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcSource = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

test('gemini-chat-stream always snapshots interview context before user turn', () => {
  const handlerStart = ipcSource.indexOf('const _geminiChatStreamHandler = async (');
  assert.ok(handlerStart >= 0);
  const snapshotIdx = ipcSource.indexOf('let autoContextSnapshot: string | undefined;', handlerStart);
  assert.ok(snapshotIdx > handlerStart, 'snapshot is taken inside the handler');
  const snapshot = ipcSource.slice(snapshotIdx, ipcSource.indexOf('}', ipcSource.indexOf('catch (ctxErr)', snapshotIdx)));
  assert.match(snapshot, /intelligenceManager\.getInterviewContextForChat\(\)/, 'should snapshot interview context');
  assert.doesNotMatch(snapshot, /if\s*\(\s*!context\s*\)/, 'snapshot must not be gated on !context');
  const recordIdx = ipcSource.indexOf('intelligenceManager.addTranscript(', snapshotIdx);
  assert.ok(recordIdx > snapshotIdx, 'snapshot precedes recording the user turn');
});
