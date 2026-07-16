const assert = require('node:assert/strict');
const test = require('node:test');

const {
  shouldSkipDeviceAvailabilityCheck,
} = require('../dist-electron/electron/audio/deviceSelection.js');
const {
  getAutomaticAnswerThrottleReason,
} = require('../dist-electron/electron/intelligencePolicy.js');

test('connected named audio devices are checked instead of discarded', () => {
  assert.equal(shouldSkipDeviceAvailabilityCheck('input', 'David AirPods Microphone'), false);
  assert.equal(shouldSkipDeviceAvailabilityCheck('output', 'David AirPods'), false);
  assert.equal(shouldSkipDeviceAvailabilityCheck('output', 'Built-in Output'), false);
  assert.equal(shouldSkipDeviceAvailabilityCheck('output', 'sck'), false);
});

test('only stale-shaped CoreAudio output route ids bypass enumeration', () => {
  assert.equal(shouldSkipDeviceAvailabilityCheck('output', 'aa-bb-cc-dd-ee-ff:output'), true);
  assert.equal(shouldSkipDeviceAvailabilityCheck('input', 'aa-bb-cc-dd-ee-ff:output'), false);
});

test('automatic answer requests respect cooldowns while explicit requests do not', () => {
  const coolingDown = {
    hasImages: false,
    now: 10_000,
    quotaCooldownUntil: 20_000,
    lastTriggerTime: 9_500,
    triggerCooldown: 2_000,
  };

  assert.equal(getAutomaticAnswerThrottleReason({ ...coolingDown, isAutomatic: true }), 'quota');
  assert.equal(getAutomaticAnswerThrottleReason({ ...coolingDown, isAutomatic: false }), null);
  assert.equal(getAutomaticAnswerThrottleReason({ ...coolingDown, isAutomatic: true, hasImages: true }), null);
  assert.equal(getAutomaticAnswerThrottleReason({
    ...coolingDown,
    isAutomatic: true,
    quotaCooldownUntil: 0,
  }), 'trigger');
});
