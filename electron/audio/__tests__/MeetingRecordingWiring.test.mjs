import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const main = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');
const ipc = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
const preload = fs.readFileSync(path.join(repoRoot, 'electron/preload.ts'), 'utf8');
const settings = fs.readFileSync(path.join(repoRoot, 'electron/services/SettingsManager.ts'), 'utf8');
const renderer = fs.readFileSync(path.join(repoRoot, 'src/components/SettingsOverlay.tsx'), 'utf8');
const meetingDetails = fs.readFileSync(path.join(repoRoot, 'src/components/MeetingDetails.tsx'), 'utf8');

test('durable raw-audio recording is explicit opt-in and disabled by never-retain mode', () => {
  assert.match(settings, /saveMeetingRecordings\?: boolean/);
  assert.match(main, /get\('saveMeetingRecordings'\) === true/);
  assert.match(main, /get\('meetingRetention'\) !== 'never'/);
  assert.match(main, /metadata\?\.doNotPersist !== true/);
  assert.match(renderer, /Save local meeting recordings/);
  assert.match(renderer, /setSaveMeetingRecordings/);
  assert.match(renderer, /disabled=\{meetingRetention === 'never'\}/);
  assert.match(ipc, /if \(!enabled\) appState\.discardActiveMeetingRecording\(\)/);
  assert.match(ipc, /enabled && SettingsManager\.getInstance\(\)\.get\('meetingRetention'\) === 'never'/);
  assert.match(ipc, /error: 'meeting_history_disabled'/);
  assert.match(ipc, /if \(retention === 'never'\) \{[\s\S]{0,120}appState\.discardActiveMeetingRecording\(\)/);
});

test('renderer recording actions accept only meeting IDs and never arbitrary paths', () => {
  assert.match(preload, /openMeetingRecording: \(id: string\) => ipcRenderer\.invoke\('open-meeting-recording', id\)/);
  assert.match(preload, /revealMeetingRecording: \(id: string\) => ipcRenderer\.invoke\('reveal-meeting-recording', id\)/);
  assert.match(ipc, /DatabaseManager\.getInstance\(\)\.getMeetingAudioRecording\(meetingId\)/);
  assert.doesNotMatch(ipc, /open-meeting-recording[\s\S]{0,160}filePath/);
  assert.doesNotMatch(ipc, /reveal-meeting-recording[\s\S]{0,160}filePath/);
  assert.match(meetingDetails, /catch \{[\s\S]{0,320}setRecordingError\('Recording unavailable'\)/);
});

test('quit defers database shutdown until critical meeting persistence completes', () => {
  const prepareStart = main.indexOf('public async prepareForShutdown');
  const prepareEnd = main.indexOf('private broadcastMeetingState', prepareStart);
  const prepare = main.slice(prepareStart, prepareEnd);
  assert.ok(prepareStart >= 0 && prepareEnd > prepareStart);
  assert.match(prepare, /if \(this\.isMeetingActive\) await this\.endMeeting\(\)/);
  assert.match(prepare, /if \(this\._endMeetingInFlight && this\._audioInitPromise\)/);
  assert.match(prepare, /await this\._audioInitPromise\.catch/);
  assert.match(prepare, /await this\._pendingCriticalMeetingTeardown/);

  const quitStart = main.indexOf('app.on("before-quit"');
  const quit = main.slice(quitStart, quitStart + 1400);
  assert.match(quit, /event\.preventDefault\(\)/);
  assert.match(quit, /appState\.prepareForShutdown\(\)/);
  assert.match(quit, /meetingShutdownReady = true;[\s\S]{0,80}app\.quit\(\)/);
});

test('failed recording metadata persistence removes the untracked WAV', () => {
  const recordingSaveStart = main.indexOf('const saved = DatabaseManager.getInstance().updateMeetingAudioRecording');
  const recordingSaveEnd = main.indexOf('return meetingId;', recordingSaveStart);
  const recordingSave = main.slice(recordingSaveStart, recordingSaveEnd);
  assert.ok(recordingSaveStart >= 0 && recordingSaveEnd > recordingSaveStart);
  assert.match(recordingSave, /if \(saved\) \{[\s\S]*?\} else \{[\s\S]*?fs\.promises\.unlink\(recording\.path\)/);
  assert.match(recordingSave, /Removed recording because its metadata could not be saved/);
});
