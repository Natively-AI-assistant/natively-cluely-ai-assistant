// Training transcript sharing: what goes out, when, and withdrawal (TrainingTranscriptUploader.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const U = require(path.join(here, '../../../../dist-electron/electron/services/training/TrainingTranscriptUploader.js'));

const consent = { version: 1, grantedAt: '2026-11-13T00:00:00.000Z' };
const meeting = (over = {}) => ({
  meetingId: 'm-1', startTime: Date.parse('2026-11-13T09:30:00Z'), durationMs: 60_000, mode: 'technical-interview',
  transcript: [
    { speaker: 'interviewer', text: 'Can you mail me at a.b@c.io?', timestamp: Date.parse('2026-11-13T09:30:05Z'), final: true },
    { speaker: 'interviewer', text: 'partial', timestamp: Date.parse('2026-11-13T09:30:06Z'), final: false },
    { speaker: 'user', text: 'Sure, call 415 555 0134.', timestamp: Date.parse('2026-11-13T09:30:09Z'), final: true },
  ], ...over,
});

function rig({ access = { allowed: true, basis: 'sharing', uploads: true }, status = 200 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'train-up-'));
  const calls = [];
  const up = new U.TrainingTranscriptUploader({
    dir, apiBase: () => 'https://api.test', installId: () => 'inst-1', callerHeaders: async () => ({ 'x-install-token': 'tok' }),
    appVersion: '3.0.0', platform: 'darwin', access: () => access, consent: () => consent, log: () => {},
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { status, ok: status < 300 }; },
  });
  return { dir, calls, up, files: () => fs.readdirSync(dir).filter((f) => f.endsWith('.json')) };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test('body: finals only, scrubbed, sides, offsets, day only, hashed meeting ref', () => {
  const b = U.buildTrainingBody(meeting(), { installId: 'inst-1', consent, basis: 'sharing', appVersion: '3.0.0', platform: 'win32' });
  assert.deepEqual(b.turns, [
    { s: 'others', t: 5000, x: 'Can you mail me at [email]?' },
    { s: 'user', t: 9000, x: 'Sure, call [number].' },
  ]);
  assert.equal(b.started_day, '2026-11-13');
  assert.notEqual(b.meeting_ref, 'm-1');
  assert.equal(b.meeting_ref.length, 32);
  assert.equal(b.platform, 'win32');
});

test('a meeting where Auto Answer never ran is not sent', async () => {
  const r = rig();
  r.up.meetingStarted();
  r.up.offerMeeting(meeting());
  await settle();
  assert.equal(r.calls.length, 0);
  assert.equal(r.files().length, 0);
});

test('Auto Answer ran + consent: sent once, file removed on 200', async () => {
  const r = rig();
  r.up.meetingStarted(); r.up.noteAutoAnswerRan();
  r.up.offerMeeting(meeting());
  await settle();
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, 'https://api.test/v1/training/meeting-transcripts');
  assert.equal(r.calls[0].init.headers['x-install-id'], 'inst-1');
  assert.equal(r.calls[0].init.headers['x-install-token'], 'tok');
  assert.equal(r.files().length, 0);
});

test('Pro without the opt-in uploads nothing', async () => {
  const r = rig({ access: { allowed: true, basis: 'pro', uploads: false } });
  r.up.meetingStarted(); r.up.noteAutoAnswerRan();
  r.up.offerMeeting(meeting());
  await settle();
  assert.equal(r.calls.length, 0);
  assert.equal(r.files().length, 0);
});

test('server down: kept on disk for a retry; withdraw deletes it', async () => {
  const r = rig({ status: 503 });
  r.up.meetingStarted(); r.up.noteAutoAnswerRan();
  r.up.offerMeeting(meeting());
  await settle();
  assert.equal(r.files().length, 1);
  r.up.withdraw();
  assert.equal(r.files().length, 0);
});

test('a malformed-body rejection is dropped, not retried forever', async () => {
  const r = rig({ status: 422 });
  r.up.meetingStarted(); r.up.noteAutoAnswerRan();
  r.up.offerMeeting(meeting());
  await settle();
  assert.equal(r.files().length, 0);
});
