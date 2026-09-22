import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The server's FINAL transcript frames carry `full_text` — every final of the
// session so far — unless the auth frame says `full_text: false`. Measured on a
// real production session (2026-09-21) it was 79% of all final-frame bytes and
// grows with the meeting. This client reads only text / is_final / confidence.
//
// Platform-neutral: the frame is plain JSON over a WebSocket, identical on macOS
// and Windows; there is no platform branch in this code path.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '../NativelyProSTT.ts'), 'utf8');
const body = (name) => {
  const start = src.indexOf(`private ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  return src.slice(start, src.indexOf('\n    }\n', start));
};

test('the legacy (Railway) auth frame opts out with a BOOLEAN false', () => {
  assert.match(body('buildLegacyAuthFrame'), /^\s*full_text:\s+false,$/m);
});

test('the relay frame is untouched — the relay owns its own frame contract', () => {
  const relay = body('buildAuthFrame');
  assert.doesNotMatch(relay.replace(/\/\/.*$/gm, ''), /full_text/);
});

test('and the client really never reads the field it is declining', () => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /msg\.full_text|\.full_text\b(?!:)/);
});
