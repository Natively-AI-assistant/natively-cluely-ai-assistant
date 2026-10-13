// Cross-meeting isolation: in-flight answers must not bleed into the next session.
// (Session-epoch staleness inside the WTA pipeline is covered by upstream's own
// supersession/contextEpoch guards; these pin the two meeting-end cancellations.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const mainSource = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const intMgrSource = fs.readFileSync(path.join(root, 'electron/IntelligenceManager.ts'), 'utf8');

function methodBody(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `${signature} exists`);
  const next = src.indexOf('\n  }\n', start);
  return src.slice(start, next);
}

test('ending a meeting aborts in-flight intelligence streams before the background stop', () => {
  const body = methodBody(mainSource, 'private async endMeetingTransition(');
  const resetIdx = body.indexOf('this.intelligenceManager.resetEngine()');
  assert.ok(resetIdx >= 0, 'endMeetingTransition should call resetEngine()');
  const backgroundStopIdx = mainSource.indexOf('const stopResult = await this.intelligenceManager.stopMeeting();');
  assert.ok(backgroundStopIdx >= 0, 'background stopMeeting call exists');
  assert.ok(
    mainSource.indexOf(body) + resetIdx < backgroundStopIdx,
    'resetEngine() runs before the background stopMeeting (250 ms STT grace + persistence)',
  );
});

test('stopMeeting cancels engine before persistence clears session', () => {
  const body = methodBody(intMgrSource.replace(/\n    }\n/g, '\n  }\n'), 'async stopMeeting()');
  assert.match(body, /this\.resetEngine\(\)/);
  assert.ok(
    body.indexOf('resetEngine') < body.indexOf('persistence.stopMeeting'),
    'resetEngine must run before persistence.stopMeeting',
  );
});
