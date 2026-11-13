// Auto Answer access rule and the on-device transcript scrubber (autoAnswerAccess.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const A = require(path.join(here, '../../../../dist-electron/electron/intelligence/autoAnswer/autoAnswerAccess.js'));

const current = () => A.newTrainingConsent(new Date('2026-11-13T00:00:00Z'));

test('Pro or trial is allowed without consent and uploads nothing', () => {
  assert.deepEqual(A.autoAnswerAccess({ proOrTrial: true, consent: null }), { allowed: true, basis: 'pro', uploads: false });
});

test('Pro who opted in uploads', () => {
  assert.equal(A.autoAnswerAccess({ proOrTrial: true, consent: current() }).uploads, true);
});

test('free with current consent is allowed and uploads', () => {
  assert.deepEqual(A.autoAnswerAccess({ proOrTrial: false, consent: current() }), { allowed: true, basis: 'sharing', uploads: true });
});

test('free without consent is refused with the access code', () => {
  const r = A.autoAnswerAccess({ proOrTrial: false, consent: undefined });
  assert.equal(r.allowed, false);
  assert.equal(r.error, A.AUTO_ANSWER_ACCESS_REQUIRED);
});

test('an older consent version, or a malformed one, does not count', () => {
  for (const c of [{ version: A.TRAINING_CONSENT_VERSION - 1, grantedAt: '2026-11-13T00:00:00Z' },
    { version: A.TRAINING_CONSENT_VERSION, grantedAt: 'not a date' }, { version: A.TRAINING_CONSENT_VERSION }, 'yes', true]) {
    assert.equal(A.autoAnswerAccess({ proOrTrial: false, consent: c }).allowed, false, JSON.stringify(c));
  }
});

test('scrubber removes emails, links, phone numbers and long digit runs, keeps words and short numbers', () => {
  const s = A.scrubTranscriptText('Mail priya.k@acme.io or call +1 (415) 555-0134, see https://x.io/a?b=1 code 4815162342; we have 3 rounds and 120 users');
  assert.equal(s, 'Mail [email] or call [number], see [link] code [number]; we have 3 rounds and 120 users');
});

test('scrubber leaves times and years alone', () => {
  assert.equal(A.scrubTranscriptText('at 10:30 in 2026, about 40-50 people'), 'at 10:30 in 2026, about 40-50 people');
});

// Drift: every place that acts on Auto Answer asks isAutoAnswerActive(), and
// the IPC refuses to switch it on without access. Source checks, platform-free.
import fs from 'node:fs';
const root = path.join(here, '../../../..');
const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

test('main reads the raw Auto Answer flag only in its own getters/setters', () => {
  const uses = main.split('\n').filter((l) => /this\._autoAnswerEnabled\b/.test(l) && !/^\s*(\/\/|\*)/.test(l));
  for (const l of uses) {
    assert.match(l, /private _autoAnswerEnabled|this\._autoAnswerEnabled = |return this\._autoAnswerEnabled;|if \(!this\._autoAnswerEnabled\) return false;|autoAnswerEnabled=\$\{this\._autoAnswerEnabled\}|keeping \$\{this\._autoAnswerEnabled\}|if \(this\._autoAnswerEnabled && !this\.getAutoAnswerAccess\(\)\.allowed\)/, l.trim());
  }
  assert.match(main, /isEnabled: \(\) => this\.isAutoAnswerActive\(\)/);
});

test('set-auto-answer-enabled refuses to switch on without access; off is always allowed', () => {
  const at = ipc.indexOf("safeHandle('set-auto-answer-enabled'");
  const handler = ipc.slice(at, at + 900);
  assert.match(handler, /if \(enabled\) \{\s*const access = appState\.getAutoAnswerAccess\(\);\s*if \(!access\.allowed\)/);
});

test('known names become [name]: full name and its parts, any case, whole words, any script', () => {
  const s = A.scrubTranscriptText('Thanks priya, and Priya Kumar said KUMAR would join. Ask Al, also Óscar; Priyanka stays.', ['Priya Kumar', 'Al', 'Óscar']);
  assert.equal(s, 'Thanks [name], and [name] said [name] would join. Ask Al, also [name]; Priyanka stays.');
});

test('names with regex characters and no names are safe', () => {
  assert.equal(A.scrubKnownNames('Hi J. (Jo) Smith+ and Jo', ['J. (Jo) Smith+']), 'Hi [name] and Jo');
  assert.equal(A.scrubKnownNames('Hello there', []), 'Hello there');
});
