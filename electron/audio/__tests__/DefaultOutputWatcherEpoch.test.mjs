import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

function extractMethod(signaturePattern, label) {
  const m = signaturePattern.exec(mainSource);
  assert.ok(m, `could not locate ${label}`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < mainSource.length && depth > 0) {
    const ch = mainSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces while extracting ${label}`);
  return mainSource.slice(start, i - 1);
}

test('default-output route-change rebuild aborts when the meeting generation has changed mid-await', () => {
  const body = extractMethod(/private\s+async\s+handleDefaultOutputChanged\s*\([^)]*\)[^{]*\{/, 'handleDefaultOutputChanged');
  assert.ok(
    /const\s+meetingGeneration\s*=\s*this\._meetingGeneration/.test(body),
    'BUG: handleDefaultOutputChanged must capture _meetingGeneration at entry.',
  );
  assert.ok(
    /const\s+isCurrentMeeting\s*=\s*\(\)\s*=>\s*this\.isMeetingActive\s*&&\s*this\._meetingGeneration\s*===\s*meetingGeneration/.test(body),
    'BUG: handleDefaultOutputChanged must verify both isMeetingActive and captured generation.',
  );
  assert.ok(
    /await\s+resolveMacScreenCaptureCapability[\s\S]*if\s*\(\s*!isCurrentMeeting\s*\(\s*\)\s*\)\s*\{[\s\S]*return;/.test(body),
    'BUG: handleDefaultOutputChanged must re-check the generation after awaiting resolveMacScreenCaptureCapability before mutating systemAudioCapture.',
  );
});

test('microphone recovery handler aborts when the meeting generation has changed mid-await', () => {
  const setupBody = extractMethod(/private\s+setupMicRecoveryHandler\s*\([^)]*\)[^{]*\{/, 'setupMicRecoveryHandler');
  assert.ok(
    /const\s+micRecoveryMeetingGeneration\s*=\s*this\._meetingGeneration/.test(setupBody),
    'BUG: setupMicRecoveryHandler must capture _meetingGeneration before kicking off mic recovery.',
  );
  assert.ok(
    /const\s+isMicRecoveryCurrentMeeting\s*=\s*\(\)\s*=>\s*this\.isMeetingActive\s*&&\s*this\._meetingGeneration\s*===\s*micRecoveryMeetingGeneration/.test(setupBody),
    'BUG: setupMicRecoveryHandler must check both isMeetingActive and the captured mic-recovery generation.',
  );
  assert.ok(
    /this\._micRecoveryTimer\s*=\s*null;[\s\S]*if\s*\(\s*!isMicRecoveryCurrentMeeting\s*\(\s*\)\s*\)\s*\{[\s\S]*return;/.test(setupBody),
    'BUG: setupMicRecoveryHandler must re-check the generation after the 1.5s delay before destroying/recreating the mic.',
  );
});

test('startMeeting resets system + mic recovery counters so a stale meeting cannot consume the new budget', () => {
  const startMeetingBody = extractMethod(/public\s+async\s+startMeeting\s*\([^)]*\)[^{]*\{/, 'startMeeting');
  for (const counter of ['_systemAudioRecoveryAttempts', '_systemAudioConsecutiveFailures', '_micRecoveryAttempts']) {
    assert.ok(
      new RegExp(`this\\.${counter}\\s*=\\s*0`).test(startMeetingBody),
      `BUG: startMeeting must reset this.${counter} so stale meeting counters do not bleed into the new meeting.`,
    );
  }
});

test('system audio recovery handler aborts when the meeting generation has changed mid-await', () => {
  const setupBody = extractMethod(/private\s+setupAudioRecoveryHandler\s*\([^)]*\)[^{]*\{/, 'setupAudioRecoveryHandler');
  assert.ok(
    /const\s+recoveryMeetingGeneration\s*=\s*this\._meetingGeneration/.test(setupBody),
    'BUG: setupAudioRecoveryHandler must capture _meetingGeneration before kicking off an async recovery.',
  );
  assert.ok(
    /const\s+isRecoveryCurrentMeeting\s*=\s*\(\)\s*=>\s*this\.isMeetingActive\s*&&\s*this\._meetingGeneration\s*===\s*recoveryMeetingGeneration/.test(setupBody),
    'BUG: setupAudioRecoveryHandler must check both isMeetingActive and the captured recovery generation.',
  );
  assert.ok(
    /await\s+resolveMacScreenCaptureCapability\s*\(\s*['"]system audio recovery['"]\s*\)[\s\S]*if\s*\(\s*!isRecoveryCurrentMeeting\s*\(\s*\)\s*\)\s*\{[\s\S]*return;/.test(setupBody),
    'BUG: setupAudioRecoveryHandler must re-check the generation after awaiting resolveMacScreenCaptureCapability before installing a fresh SystemAudioCapture.',
  );
  assert.ok(
    /if\s*\(\s*this\._systemAudioRecoveryAttempts\s*>=\s*3\s*&&\s*isRecoveryCurrentMeeting\s*\(\s*\)\s*\)/.test(setupBody),
    'BUG: terminal audio-capture-failed IPC must be gated on the current meeting to avoid surfacing stale failures in a new meeting.',
  );
});
