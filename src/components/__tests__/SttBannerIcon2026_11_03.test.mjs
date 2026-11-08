// Only a live reconnect spins (2026-11-03).
//
// The backup-provider banner ("Transcribing on a backup provider") shared the
// spinning RefreshCw of "Transcription Reconnecting". A Windows user whose
// ElevenLabs key was stopped for quota ~16 s into every session, with Deepgram
// standing in, reported it as transcription reconnecting after 10-15 s. Each
// banner now names its kind, and the icon follows the kind, not the tone (both
// banners are warnings). Renderer-only; the same on macOS and Windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(dirname, '../NativelyInterface.tsx'), 'utf8');

test('each STT banner states its kind', () => {
  const start = src.indexOf('const sttStatusBanner:');
  const body = src.slice(start, src.indexOf(': null;', start));
  assert.match(body, /kind: 'stopped',\s*\n\s*title: t\('Transcription Stopped'\)/);
  assert.match(body, /kind: 'reconnecting',\s*\n\s*title: t\('Transcription Reconnecting'\)/);
  assert.match(body, /kind: 'backup',\s*\n\s*title: t\('Transcribing on a backup provider'\)/);
});

test('the icon follows the kind: only reconnecting spins', () => {
  const at = src.indexOf('icon={sttStatusBanner.kind');
  assert.ok(at > 0, 'the banner icon must be chosen by kind, not tone');
  const icon = src.slice(at, src.indexOf('title={sttStatusBanner.title}', at));
  assert.match(icon, /kind === 'stopped'\s*\n\s*\? <MicOff/);
  assert.match(icon, /kind === 'backup'\s*\n\s*\? <Repeat2 strokeWidth=\{2\.2\} \/>/);
  assert.equal((icon.match(/ov-banner-spin/g) || []).length, 1, 'one spinning icon, the reconnect one');
  assert.match(icon, /: <RefreshCw strokeWidth=\{2\.2\} className="ov-banner-spin" \/>\}/);
});
