import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const databaseModule = path.join(repoRoot, 'dist-electron/electron/db/DatabaseManager.js');

let tempDir;
let recordingsDir;
let dbManager;

const meeting = (id, title = id) => ({
  id,
  title,
  date: new Date(0).toISOString(),
  duration: '0:01',
  summary: '',
  transcript: [{ speaker: 'user', text: 'hello', timestamp: 0 }],
  usage: [],
  isProcessed: false,
  summaryStatus: 'queued',
});

const createRecording = (name, content = 'wav') => {
  fs.mkdirSync(recordingsDir, { recursive: true });
  const filePath = path.join(recordingsDir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
};

const metadata = (filePath) => ({
  path: filePath,
  format: 'wav',
  sampleRate: 24_000,
  sizeBytes: fs.statSync(filePath).size,
  durationMs: 1000,
});

describe('meeting recording persistence and deletion', () => {
  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-recording-db-'));
    recordingsDir = path.join(tempDir, 'recordings');
    process.env.NATIVELY_TEST_USERDATA = tempDir;
    delete require.cache[databaseModule];
    const { DatabaseManager } = require(databaseModule);
    dbManager = DatabaseManager.getInstance();
    assert.equal(dbManager.isAvailable(), true, 'test requires the real SQLite database');
  });

  after(() => {
    try { dbManager?.close(); } catch {}
    delete process.env.NATIVELY_TEST_USERDATA;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('migration v26 exists and recording metadata survives placeholder to final re-save without exposing its path', () => {
    const db = dbManager.getDb();
    assert.ok(db.pragma('user_version', { simple: true }) >= 26);
    for (const column of ['audio_recording_path', 'audio_recording_format', 'audio_recording_sample_rate', 'audio_recording_size_bytes', 'audio_recording_duration_ms']) {
      assert.ok(db.pragma('table_info(meetings)').some((entry) => entry.name === column), `missing ${column}`);
    }

    const id = 'recording-preserve';
    dbManager.saveMeeting(meeting(id), 0, 1000);
    const filePath = createRecording(`${id}-one.wav`);
    assert.equal(dbManager.updateMeetingAudioRecording(id, metadata(filePath)), true);
    dbManager.saveMeeting({ ...meeting(id, 'Final title'), isProcessed: true, summaryStatus: 'completed' }, 0, 1000);

    const stored = db.prepare('SELECT audio_recording_path FROM meetings WHERE id = ?').get(id);
    assert.equal(stored.audio_recording_path, filePath);
    const details = dbManager.getMeetingDetails(id);
    assert.equal(details.audioRecording.exists, true);
    assert.equal(details.audioRecording.path, undefined, 'absolute filesystem paths must stay in the main process');
  });

  test('deleting one meeting deletes only its owned WAV', () => {
    const firstId = 'recording-delete-one';
    const secondId = 'recording-keep-two';
    dbManager.saveMeeting(meeting(firstId), 0, 1000);
    dbManager.saveMeeting(meeting(secondId), 0, 1000);
    const firstPath = createRecording(`${firstId}-one.wav`, 'first');
    const secondPath = createRecording(`${secondId}-two.wav`, 'second');
    assert.equal(dbManager.updateMeetingAudioRecording(firstId, metadata(firstPath)), true);
    assert.equal(dbManager.updateMeetingAudioRecording(secondId, metadata(secondPath)), true);

    assert.equal(dbManager.deleteMeeting(firstId), true);
    assert.equal(fs.existsSync(firstPath), false);
    assert.equal(fs.existsSync(secondPath), true);
  });

  test('failed database deletion restores the quarantined WAV', () => {
    const id = 'recording-delete-rollback';
    dbManager.saveMeeting(meeting(id), 0, 1000);
    const filePath = createRecording(`${id}-one.wav`, 'restore-me');
    assert.equal(dbManager.updateMeetingAudioRecording(id, metadata(filePath)), true);
    const db = dbManager.getDb();
    db.exec(`CREATE TRIGGER fail_recording_delete BEFORE DELETE ON meetings WHEN OLD.id = '${id}' BEGIN SELECT RAISE(ABORT, 'forced delete failure'); END;`);

    assert.equal(dbManager.deleteMeeting(id), false);
    assert.equal(fs.existsSync(filePath), true, 'the original WAV must be restored when SQLite rolls back');
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'restore-me');
    db.exec('DROP TRIGGER fail_recording_delete');
  });

  test('recording metadata rejects paths outside the app-owned directory and symlinks', () => {
    const id = 'recording-path-boundary';
    dbManager.saveMeeting(meeting(id), 0, 1000);
    const outside = path.join(tempDir, 'outside.wav');
    fs.writeFileSync(outside, 'outside');
    assert.equal(dbManager.updateMeetingAudioRecording(id, metadata(outside)), false);

    const link = path.join(recordingsDir, 'linked.wav');
    fs.symlinkSync(outside, link);
    assert.equal(dbManager.updateMeetingAudioRecording(id, metadata(link)), false);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'outside');
  });
});
