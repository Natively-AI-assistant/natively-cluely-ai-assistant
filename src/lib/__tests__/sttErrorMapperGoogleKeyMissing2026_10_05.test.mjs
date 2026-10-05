// Google STT with no usable service-account key.
//
// GoogleSTT reports it with its own worded message (credentialsUnavailableError
// in electron/audio/GoogleSTT.ts). The overlay shows the mapper's title and
// body, not the message, so without a case of its own this fell through to
// "STT Provider Error: The transcription service encountered an unexpected
// issue." — nothing the user can act on. The library's raw text used to reach
// the auth case only by accident, through the word "authentication" in a URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { categorizeSttError } from '../sttErrorMapper.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('the message GoogleSTT actually sends reads as a missing Google key', () => {
  // Read from the source so a reworded message cannot silently stop matching.
  const source = fs.readFileSync(path.resolve(__dirname, '../../../electron/audio/GoogleSTT.ts'), 'utf8');
  const block = source.slice(source.indexOf('private static credentialsUnavailableError'));
  const message = [...block.slice(0, block.indexOf(');')).matchAll(/'([^']+)'/g)].map((m) => m[1]).join('');
  assert.match(message, /Service Account JSON/, 'precondition: found the message in GoogleSTT.ts');

  const c = categorizeSttError(message);
  assert.equal(c.title, 'Google Key Missing');
  assert.equal(c.category, 'auth');
  assert.match(c.body, /Audio Settings/);
  assert.doesNotMatch(c.body, /API key/i, 'Google STT takes a key file, not an API key');
});

test('an ordinary auth failure is still Authentication Failed', () => {
  assert.equal(categorizeSttError('401 Unauthorized').title, 'Authentication Failed');
});
