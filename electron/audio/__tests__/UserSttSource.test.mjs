// User-STT source policy — last-armed wins (ADR 0015 / ticket 07).
// Pure module; no Electron. Glossary: phone-stt-source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const {
  armPhoneUserSttSource,
  armDesktopUserSttSource,
  disarmUserSttSource,
  releasePhoneUserSttSource,
  shouldAcceptUserSttFrom,
  labelUserSttSource,
  planPhoneSttIngest,
} = require(path.join(repoRoot, 'dist-electron/electron/audio/userSttSource.js'));

test('last-armed wins: phone then desktop', () => {
  let src = armDesktopUserSttSource('none');
  assert.equal(src, 'desktop');
  src = armPhoneUserSttSource(src);
  assert.equal(src, 'phone');
  src = armDesktopUserSttSource(src);
  assert.equal(src, 'desktop');
});

test('disarm → none; releasePhone restores desktop only when phone was active', () => {
  assert.equal(disarmUserSttSource('phone'), 'none');
  assert.equal(releasePhoneUserSttSource('phone'), 'desktop');
  assert.equal(releasePhoneUserSttSource('desktop'), 'desktop');
  assert.equal(releasePhoneUserSttSource('none'), 'none');
});

test('shouldAcceptUserSttFrom enforces single active source', () => {
  assert.equal(shouldAcceptUserSttFrom('phone', 'phone'), true);
  assert.equal(shouldAcceptUserSttFrom('phone', 'desktop'), false);
  assert.equal(shouldAcceptUserSttFrom('desktop', 'desktop'), true);
  assert.equal(shouldAcceptUserSttFrom('desktop', 'phone'), false);
  assert.equal(shouldAcceptUserSttFrom('none', 'desktop'), false);
  assert.equal(shouldAcceptUserSttFrom('none', 'phone'), false);
});

test('labelUserSttSource maps to UI copy', () => {
  assert.equal(labelUserSttSource('desktop'), 'Desktop mic');
  assert.equal(labelUserSttSource('phone'), 'Phone');
  assert.equal(labelUserSttSource('none'), 'None');
});

test('planPhoneSttIngest accepts finals when phone is active', () => {
  const plan = planPhoneSttIngest('phone', '  hello from phone  ', true);
  assert.deepEqual(plan, {
    accept: true,
    text: 'hello from phone',
    final: true,
    speaker: 'user',
    origin: 'stt',
  });
});

test('planPhoneSttIngest rejects when desktop is active or text invalid', () => {
  assert.equal(planPhoneSttIngest('desktop', 'hi', true).accept, false);
  assert.equal(planPhoneSttIngest('none', 'hi', true).accept, false);
  assert.equal(planPhoneSttIngest('phone', '', true).accept, false);
  assert.equal(planPhoneSttIngest('phone', '   ', true).accept, false);
  assert.equal(planPhoneSttIngest('phone', 12, true).accept, false);
  assert.equal(planPhoneSttIngest('phone', 'x'.repeat(2001), true).accept, false);
});

test('planPhoneSttIngest defaults final to true when omitted', () => {
  const plan = planPhoneSttIngest('phone', 'partial-ish');
  assert.equal(plan.accept, true);
  assert.equal(plan.final, true);
});
