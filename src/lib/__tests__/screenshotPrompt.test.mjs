import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SCREENSHOT_PROMPT,
  DEFAULT_SCREENSHOT_INSTRUCTION,
  SCREENSHOT_PRESET_PROMPT_KEY,
  SCREENSHOT_PRESET_PROMPT_MAX,
  getScreenshotPresetPrompt,
  setScreenshotPresetPrompt,
  resolveScreenshotPromptText,
  resolveScreenshotInstruction,
  resetScreenshotPresetPromptForTesting,
} from '../screenshotPrompt.ts';
import { buildDirectWhatToSayPayload } from '../directAssistWhatToSayPayload.mjs';

// Clean memory mock for localStorage in Node test runner
const memoryStorage = new Map();
globalThis.localStorage = {
  getItem: (k) => memoryStorage.get(k) ?? null,
  setItem: (k, v) => memoryStorage.set(k, String(v)),
  removeItem: (k) => memoryStorage.delete(k),
  clear: () => memoryStorage.clear(),
};

test('defaults match standard screenshot wording', () => {
  assert.equal(DEFAULT_SCREENSHOT_PROMPT, 'What should I say about this?');
  assert.equal(
    DEFAULT_SCREENSHOT_INSTRUCTION,
    'Analyze the attached screenshot and answer the interviewer question provided with it.'
  );
  assert.equal(SCREENSHOT_PRESET_PROMPT_KEY, 'natively_screenshot_preset_prompt');
  assert.equal(SCREENSHOT_PRESET_PROMPT_MAX, 500);
});

test('resolveScreenshotPromptText defaults to standard prompt when unset', () => {
  resetScreenshotPresetPromptForTesting();
  assert.equal(getScreenshotPresetPrompt(), '');
  assert.equal(resolveScreenshotPromptText(), 'What should I say about this?');
  assert.equal(resolveScreenshotPromptText(''), 'What should I say about this?');
  assert.equal(resolveScreenshotPromptText('   '), 'What should I say about this?');
});

test('resolveScreenshotPromptText prefers explicit argument over stored preset', () => {
  resetScreenshotPresetPromptForTesting();
  setScreenshotPresetPrompt('Review this architecture');
  assert.equal(getScreenshotPresetPrompt(), 'Review this architecture');
  assert.equal(resolveScreenshotPromptText('Explain this algorithm'), 'Explain this algorithm');
  assert.equal(resolveScreenshotPromptText(), 'Review this architecture');
});

test('empty or whitespace input clears the preset', () => {
  resetScreenshotPresetPromptForTesting();
  setScreenshotPresetPrompt('Something temporary');
  assert.equal(getScreenshotPresetPrompt(), 'Something temporary');

  setScreenshotPresetPrompt('   ');
  assert.equal(getScreenshotPresetPrompt(), '');
  assert.equal(resolveScreenshotPromptText(), 'What should I say about this?');
  assert.equal(memoryStorage.has(SCREENSHOT_PRESET_PROMPT_KEY), false);
});

test('preset prompt is capped to 500 characters', () => {
  resetScreenshotPresetPromptForTesting();
  const oversized = 'A'.repeat(600);
  setScreenshotPresetPrompt(oversized);
  assert.equal(getScreenshotPresetPrompt().length, 500);
});

test('resolveScreenshotInstruction resolves default or custom instruction', () => {
  resetScreenshotPresetPromptForTesting();
  assert.equal(resolveScreenshotInstruction(), DEFAULT_SCREENSHOT_INSTRUCTION);

  setScreenshotPresetPrompt('Diagnose failing unit tests on screen');
  assert.equal(resolveScreenshotInstruction(), 'Diagnose failing unit tests on screen');
  assert.equal(
    resolveScreenshotInstruction('Explicit dynamic action'),
    'Explicit dynamic action'
  );
});

test('buildDirectWhatToSayPayload incorporates customScreenshotPrompt when screenshots attached', () => {
  const standard = buildDirectWhatToSayPayload({
    hasScreenshots: true,
  });
  assert.equal(
    standard.currentRequest,
    'Analyze the attached screenshot and answer the interviewer question provided with it.'
  );

  const custom = buildDirectWhatToSayPayload({
    hasScreenshots: true,
    customScreenshotPrompt: 'Analyze this dashboard error',
  });
  assert.equal(custom.currentRequest, 'Analyze this dashboard error');

  // Explicit dynamic action instruction takes precedence over preset
  const override = buildDirectWhatToSayPayload({
    hasScreenshots: true,
    dynamicPromptInstruction: 'Code hint',
    customScreenshotPrompt: 'Analyze this dashboard error',
  });
  assert.equal(override.currentRequest, 'Code hint');
});
