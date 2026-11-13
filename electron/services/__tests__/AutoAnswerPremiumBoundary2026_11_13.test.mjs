// Auto Answer lives in the private premium submodule (premium/electron/autoAnswer)
// since 2026-11-13. electron/premium/autoAnswer.ts is the app's side of that
// boundary: a contract and a loader that falls back to an inert stand-in. These
// tests pin both halves: a build without premium has Auto Answer off and every
// call safe, and the real module offers exactly what the stand-in does.
//
// No platform branches on either side of the boundary; the premium module's own
// macOS / Windows choices are tested in premium/electron/autoAnswer/__tests__.
//
// Run: npm run build:electron && node --test electron/services/__tests__/AutoAnswerPremiumBoundary2026_11_13.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const B = require(path.join(root, 'dist-electron/electron/premium/autoAnswer.js'));
const premiumIndex = path.join(root, 'dist-electron/premium/electron/autoAnswer/index.js');
const premiumBuilt = fs.existsSync(premiumIndex) ? false : 'premium not checked out or not built';

test('without premium: Auto Answer is unavailable and refused, never allowed', () => {
  const m = B.loadAutoAnswerPremium(() => { throw new Error("Cannot find module '../../premium/electron/autoAnswer'"); });
  assert.equal(m, B.UNAVAILABLE_AUTO_ANSWER);
  assert.equal(m.available, false);
  for (const proOrTrial of [true, false]) {
    const a = m.autoAnswerAccess({ proOrTrial, consent: { version: 1, grantedAt: new Date().toISOString() } });
    assert.deepEqual(a, { allowed: false, basis: 'none', uploads: false, error: 'auto_answer_unavailable' });
  }
});

test('without premium: every object main.ts builds is safe to call', async () => {
  const m = B.UNAVAILABLE_AUTO_ANSWER;
  const engine = m.createEngine({}, {});
  for (const k of ['setThresholds', 'onMeetingStart', 'onModeChanged', 'onMeetingStop', 'onEngineIdle', 'onProviderEndpoint',
    'onLocalSpeechEnd', 'onLocalSpeechStart', 'onManualAnswerStarted']) assert.equal(engine[k](), undefined, k);
  assert.equal(engine.ingest({ speaker: 'interviewer', text: 'what is a closure?', timestamp: 1, final: true }), undefined);

  const usage = m.createUsageTelemetry({ sink() { throw new Error('no rows without premium'); }, mode: () => null, answerModel: () => null });
  usage.meetingStarted(); usage.observe({ name: 'auto_answer_dispatched', meetingGeneration: 1 }); usage.answerShown(); usage.meetingEnded();

  const decider = m.createDecider({ platform: 'darwin', env: {}, isPackaged: true, installedModelDir: () => null, llmJudge: async () => 'x' });
  assert.equal(await decider.judgeCandidate({}), null);

  const installer = m.createModelInstaller({ bundledDir: '', installRoot: '', platform: 'win32', arch: 'x64', release: '10.0.26100', credential: () => null, apiBase: '' });
  assert.deepEqual(installer.status(), { state: 'unsupported' });
  assert.deepEqual(await installer.install(), { state: 'unsupported' });
  assert.equal(installer.installedDir(), null);

  const s = m.createSavingsLedger({ file: null }).summary();
  assert.equal(s.installedAt, null);
  assert.equal(s.after, null);
  assert.equal(s.projection, null);

  const up = m.createTrainingUploader({});
  up.meetingStarted(); up.noteAutoAnswerRan(); up.start(); up.stop(); up.withdraw();
  await up.flush();
  assert.deepEqual(await up.requestDeletion(), { success: true });
  assert.equal(m.acceptsLocalSpeechEndHint('soniox'), false);
  m.offerTrainingMeeting({ meetingId: 'm', startTime: 0, durationMs: 0, mode: null, transcript: [] });
});

test('a module that loads but is not the real one is treated as absent', () => {
  assert.equal(B.loadAutoAnswerPremium(() => ({})).available, false);
  assert.equal(B.loadAutoAnswerPremium(() => null).available, false);
});

test('with premium: the real module loads and offers exactly the contract the stand-in does', { skip: premiumBuilt }, () => {
  const real = B.loadAutoAnswerPremium(() => require(premiumIndex));
  assert.equal(real.available, true);
  assert.notEqual(real, B.UNAVAILABLE_AUTO_ANSWER);
  assert.deepEqual(Object.keys(real).sort(), Object.keys(B.UNAVAILABLE_AUTO_ANSWER).sort());
  for (const [k, v] of Object.entries(B.UNAVAILABLE_AUTO_ANSWER)) assert.equal(typeof real[k], typeof v, k);
  // Same access rules the app enforced before the move (autoAnswerAccess.ts).
  assert.equal(real.autoAnswerAccess({ proOrTrial: true, consent: null }).allowed, true);
  assert.equal(real.autoAnswerAccess({ proOrTrial: false, consent: null }).error, 'auto_answer_access_required');
});

test('main.ts reaches Auto Answer only through the loader', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
  const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  for (const src of [main, ipc]) {
    assert.doesNotMatch(src, /(?:from|require\()\s*['"][./]*(?:intelligence\/autoAnswer|premium\/electron\/autoAnswer)/);
  }
  assert.match(main, /from "\.\/premium\/autoAnswer"/);
});
