// Setup & Help's live "Get started" rows, on both platforms.
//
// Each row states a fact about this install. These tests pin the two things
// that would make a row lie: a platform borrowing the other's rule (Windows has
// no Screen Recording gate; Apple Speech exists only on macOS), and a step
// ticked because a provider is CHOSEN when the key it needs is missing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  permissionsStep, speechStep, modelStep, nativelyStep, speechProviderLabel, contextUnlocked, modeStep, profileStep,
} from '../helpSetupStatus.mjs';

describe('unsupported platforms are refused', () => {
  for (const platform of ['linux', '', undefined]) {
    test(String(platform) || '(empty)', () => {
      assert.throws(() => permissionsStep(platform, null), /Unsupported platform/);
      assert.throws(() => speechStep(platform, null), /Unsupported platform/);
    });
  }
});

describe('permissions — darwin', () => {
  test('both allowed', () => {
    const step = permissionsStep('darwin', { platform: 'darwin', microphone: 'granted', screen: 'granted' });
    assert.equal(step.state, 'done');
    assert.match(step.detail, /Screen Recording/);
  });

  test('Screen Recording missing is named', () => {
    const step = permissionsStep('darwin', { platform: 'darwin', microphone: 'granted', screen: 'denied' });
    assert.deepEqual(step, { state: 'todo', detail: 'Screen Recording not allowed yet' });
  });

  test('both missing are both named', () => {
    const step = permissionsStep('darwin', { platform: 'darwin', microphone: 'denied', screen: 'not-determined' });
    assert.deepEqual(step, { state: 'todo', detail: 'Screen Recording and Microphone not allowed yet' });
  });

  test('a restricted (MDM) microphone is not something the user can fix, so it is not a todo', () => {
    const step = permissionsStep('darwin', { platform: 'darwin', microphone: 'restricted', screen: 'granted' });
    assert.equal(step.state, 'done');
  });
});

describe('permissions — win32', () => {
  test('only the microphone is checked; screen capture has no gate', () => {
    const step = permissionsStep('win32', { platform: 'win32', microphone: 'granted', screen: 'granted' });
    assert.deepEqual(step, { state: 'done', detail: 'Microphone allowed' });
    assert.doesNotMatch(step.detail, /Screen Recording/);
  });

  test('a denied microphone is a todo that never mentions Screen Recording', () => {
    const step = permissionsStep('win32', { platform: 'win32', microphone: 'denied', screen: 'granted' });
    assert.deepEqual(step, { state: 'todo', detail: 'Microphone not allowed yet' });
  });

  test("Windows 'not-determined' is a failed query, not a refusal", () => {
    assert.equal(permissionsStep('win32', { platform: 'win32', microphone: 'not-determined', screen: 'granted' }).state, 'done');
  });
});

describe('permissions — pending or foreign results', () => {
  test('still running', () => {
    assert.equal(permissionsStep('darwin', null).state, 'checking');
  });
  test('a result from another platform is not evidence about this one', () => {
    assert.equal(permissionsStep('win32', { platform: 'darwin', microphone: 'granted', screen: 'granted' }).state, 'checking');
  });
});

describe('speech', () => {
  test('nothing chosen', () => {
    for (const platform of ['darwin', 'win32']) {
      assert.deepEqual(speechStep(platform, { sttProvider: 'none' }), { state: 'todo', detail: 'No speech provider chosen yet' });
    }
  });

  test('a chosen provider without its key is not done', () => {
    assert.deepEqual(speechStep('darwin', { sttProvider: 'deepgram', hasDeepgramKey: false }), {
      state: 'todo', detail: 'Deepgram Nova-3 · needs a key',
    });
  });

  test('a chosen provider with its key is done', () => {
    assert.deepEqual(speechStep('win32', { sttProvider: 'deepgram', hasDeepgramKey: true }), {
      state: 'done', detail: 'Deepgram Nova-3 · key saved',
    });
  });

  test('Google Cloud is a file, recorded as its path', () => {
    assert.equal(speechStep('darwin', { sttProvider: 'google', googleServiceAccountPath: null }).state, 'todo');
    assert.equal(speechStep('darwin', { sttProvider: 'google', googleServiceAccountPath: '/x/sa.json' }).state, 'done');
  });

  test('Natively API needs the Natively key', () => {
    assert.equal(speechStep('darwin', { sttProvider: 'natively', hasNativelyKey: false }).state, 'todo');
    assert.equal(speechStep('darwin', { sttProvider: 'natively', hasNativelyKey: true }).state, 'done');
  });

  test('Apple Speech is on-device on macOS and not a provider on Windows', () => {
    assert.deepEqual(speechStep('darwin', { sttProvider: 'apple-speech' }), { state: 'done', detail: 'Apple Speech · runs on this computer' });
    assert.equal(speechStep('win32', { sttProvider: 'apple-speech' }).state, 'todo');
  });

  test('Local Models run on this computer on both platforms', () => {
    for (const platform of ['darwin', 'win32']) {
      assert.equal(speechStep(platform, { sttProvider: 'local-whisper' }).state, 'done');
    }
  });

  test('labels match the Speech Provider list', () => {
    assert.equal(speechProviderLabel('elevenlabs'), 'ElevenLabs Scribe');
    assert.equal(speechProviderLabel('nope'), null);
  });
});

describe('AI model', () => {
  test('no key and no sign-in', () => {
    assert.deepEqual(modelStep({ hasGeminiKey: false }, { provider: 'gemini', modelId: 'gemini-3.7-flash' }), {
      state: 'todo', detail: 'No key or sign-in yet',
    });
  });

  test('a saved key is named as a key, never by the raw model id', () => {
    const step = modelStep({ hasDeepseekKey: true }, { provider: 'gemini', modelId: 'deepseek-flash' });
    assert.deepEqual(step, { state: 'done', detail: 'A provider key is saved' });
    assert.doesNotMatch(step.detail, /deepseek-flash/);
  });

  test('Natively API as the active model', () => {
    assert.deepEqual(modelStep({ hasNativelyKey: true }, { provider: 'gemini', modelId: 'natively' }), {
      state: 'done', detail: 'Using Natively API',
    });
  });

  test('sign-ins and local models need no key flag', () => {
    assert.equal(modelStep({}, { provider: 'codex-cli' }).detail, 'Signed in with OpenAI Codex');
    assert.equal(modelStep({}, { provider: 'antigravity' }).detail, 'Signed in with Google Antigravity');
    assert.equal(modelStep({}, { provider: 'ollama' }).detail, 'Running a model on this computer');
    assert.equal(modelStep({}, { provider: 'custom' }).detail, 'Using your own endpoint');
  });

  test('still loading', () => {
    assert.equal(modelStep(null, null).state, 'checking');
  });
});

describe('Natively API', () => {
  test('saved or not', () => {
    assert.equal(nativelyStep({ hasNativelyKey: true }).state, 'done');
    assert.equal(nativelyStep({ hasNativelyKey: false }).state, 'todo');
  });
});

describe('Modes and Profile Intelligence access', () => {
  test('Natively Pro opens them', () => {
    assert.equal(contextUnlocked({ isPremium: true }, { hasToken: false }), true);
  });
  test("a trial opens them while its token hasn't expired", () => {
    assert.equal(contextUnlocked({ isPremium: false }, { hasToken: true, expired: false }), true);
    assert.equal(contextUnlocked({ isPremium: false }, { hasToken: true, expired: true }), false);
  });
  test('neither', () => {
    assert.equal(contextUnlocked({ isPremium: false }, { hasToken: false }), false);
  });
  test('unknown until both reads land', () => {
    assert.equal(contextUnlocked(null, { hasToken: true }), null);
    assert.equal(contextUnlocked({ isPremium: true }, null), null);
  });
});

describe('mode', () => {
  test('locked without Pro or a trial, whatever is stored', () => {
    assert.equal(modeStep(false, { name: 'Sales', templateType: 'sales' }).state, 'locked');
  });
  test('General is where everyone starts, so it is not a choice made', () => {
    assert.equal(modeStep(true, { name: 'General', templateType: 'general' }).state, 'todo');
    assert.equal(modeStep(true, null).state, 'todo');
  });
  test('a mode for a kind of meeting is named', () => {
    assert.deepEqual(modeStep(true, { name: 'Technical Interview', templateType: 'technical-interview' }), {
      state: 'done', detail: 'Using Technical Interview',
    });
  });
  test('still reading', () => {
    assert.equal(modeStep(null, null).state, 'checking');
    assert.equal(modeStep(true, undefined).state, 'checking');
  });
});

describe('profile', () => {
  test('locked, empty, added', () => {
    assert.equal(profileStep(false, { hasProfile: true }).state, 'locked');
    assert.equal(profileStep(true, { hasProfile: false }).state, 'todo');
    assert.equal(profileStep(true, { hasProfile: true }).state, 'done');
  });
  test('a failed read counts as no résumé, not as checking forever', () => {
    assert.equal(profileStep(true, null).state, 'todo');
  });
});

describe('row copy fits one Settings line', () => {
  const details = [
    permissionsStep('darwin', { platform: 'darwin', microphone: 'denied', screen: 'denied' }).detail,
    speechStep('darwin', { sttProvider: 'elevenlabs' }).detail,
    nativelyStep({ hasNativelyKey: false }).detail,
    nativelyStep({ hasNativelyKey: true }).detail,
    modeStep(false, null).detail,
    modeStep(true, null).detail,
    profileStep(true, { hasProfile: false }).detail,
    profileStep(true, { hasProfile: true }).detail,
  ];
  for (const detail of details) {
    test(detail, () => assert.ok(detail.length <= 60, `${detail.length} characters`));
  }
});
