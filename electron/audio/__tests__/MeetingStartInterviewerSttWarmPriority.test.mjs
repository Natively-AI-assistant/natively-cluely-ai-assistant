// Regression test for Windows Local Whisper meetings where the single warm
// worker was consumed by the hidden user-microphone channel. The visible
// interviewer/system channel then cold-started and could remain unavailable
// for the whole short meeting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const mainSource = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');

function extractMethodBody(methodName) {
  const re = new RegExp(`(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
  const match = re.exec(mainSource);
  assert.ok(match, `could not locate ${methodName} in main.ts`);
  let cursor = match.index + match[0].length;
  const start = cursor;
  let depth = 1;
  while (cursor < mainSource.length && depth > 0) {
    if (mainSource[cursor] === '{') depth++;
    else if (mainSource[cursor] === '}') depth--;
    cursor++;
  }
  assert.equal(depth, 0, `unbalanced braces in ${methodName}`);
  return mainSource.slice(start, cursor - 1);
}

test('startMeeting gives the warm STT worker to interviewer before the hidden user channel', () => {
  const body = extractMethodBody('startMeeting');
  const interviewerStart = body.indexOf('this.googleSTT?.start()');
  const userStart = body.indexOf('this.googleSTT_User?.start()');

  assert.ok(interviewerStart >= 0, 'could not find interviewer STT start');
  assert.ok(userStart >= 0, 'could not find user STT start');
  assert.ok(
    interviewerStart < userStart,
    'interviewer STT must start first so it receives the single preloaded Whisper worker',
  );
});
