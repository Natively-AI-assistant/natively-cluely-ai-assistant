// The user's name reaches the transcriber as a hint (2026-09-27).
//
// Interviewers and teammates say the user's name ("Evin, can you…"), and STT
// spelled an uncommon one a new way each time ("Evan", "Kevin", "Alec"). main
// sets the terms at meeting start; each streaming provider reads them when it
// builds its connect frame. Platform-neutral: plain JSON / query parameters,
// identical on macOS and Windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '../../..');
const DIST = path.join(REPO, 'dist-electron/electron/audio');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const terms = require(path.join(DIST, 'sttContextTerms.js'));

test('the name becomes the full name and the first name; junk never does', () => {
  assert.deepEqual(terms.nameTerms('Evin John'), ['Evin John', 'Evin']);
  assert.deepEqual(terms.nameTerms('  Priya  '), ['Priya']);
  assert.deepEqual(terms.nameTerms(null), []);
  assert.deepEqual(terms.sanitizeSttTerms(['<b>x</b>', 'x'.repeat(41), 'José', 'josé', 7]), ['José']);
});

test('Soniox (your own key) sends the terms as context.terms, and nothing when there are none', () => {
  const { SonioxStreamingSTT } = require(path.join(DIST, 'SonioxStreamingSTT.js'));
  const stt = new SonioxStreamingSTT('k');
  terms.setSttContextTerms([]);
  assert.equal(stt.buildConfigFrame().context, undefined, 'the frame is unchanged without a name');
  terms.setSttContextTerms(['Evin John', 'Evin']);
  assert.deepEqual(stt.buildConfigFrame().context, { terms: ['Evin John', 'Evin'] });
  terms.setSttContextTerms([]);
});

test('Deepgram: keyterm on Nova-3, keywords on Nova-2', () => {
  const { DeepgramStreamingSTT } = require(path.join(DIST, 'DeepgramStreamingSTT.js'));
  terms.setSttContextTerms(['Evin']);
  assert.deepEqual(new DeepgramStreamingSTT('k', 'nova-3').hintTerms(), { keyterm: ['Evin'] });
  assert.deepEqual(new DeepgramStreamingSTT('k', 'nova-2-meeting').hintTerms(), { keywords: ['Evin'] });
  terms.setSttContextTerms([]);
  assert.deepEqual(new DeepgramStreamingSTT('k', 'nova-3').hintTerms(), {});
});

test('Natively: context_terms in the legacy frame only; the relay frame is the relay\'s contract', () => {
  const src = read('electron/audio/NativelyProSTT.ts');
  const body = (name) => { const s = src.indexOf(`private ${name}(`); return src.slice(s, src.indexOf('\n    }\n', s)); };
  assert.match(body('buildLegacyAuthFrame'), /\.\.\.this\.contextTermsField\(\)/);
  assert.doesNotMatch(body('buildAuthFrame'), /contextTerms|context_terms/);
});

test('main sets the terms at meeting start from the same name the judge uses', () => {
  const main = read('electron/main.ts');
  assert.match(main, /this\.autoAnswerUsage\.meetingStarted\(\);[\s\S]{0,200}setSttContextTerms\(nameTerms\(this\.currentUserName\(\)\)\)/);
  assert.match(main, /userName: \(\) => this\.currentUserName\(\)/);
});
