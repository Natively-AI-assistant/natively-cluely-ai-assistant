import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../../MeetingPersistence.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const stopStart = source.indexOf('    public async stopMeeting');
const stopEnd = source.indexOf('    /**\n     * Heavy lifting', stopStart);
const stopSource = source.slice(stopStart, stopEnd);

test('stopMeeting saves placeholder before starting background processing', () => {
  assert.ok(stopStart >= 0, 'stopMeeting should exist');
  assert.ok(stopEnd > stopStart, 'stopMeeting source should be isolated');

  const placeholderSaveIndex = stopSource.indexOf('DatabaseManager.getInstance().saveMeeting(placeholder, snapshot.startTime, durationMs);');
  const backgroundStartIndex = stopSource.indexOf('this.processAndSaveMeeting(snapshot, meetingId, metadataSnapshot, modeSnapshot)');

  assert.ok(placeholderSaveIndex >= 0, 'placeholder should be saved');
  assert.ok(backgroundStartIndex >= 0, 'background processing should be queued');
  assert.ok(placeholderSaveIndex < backgroundStartIndex, 'background processing must not start before placeholder save');
});
