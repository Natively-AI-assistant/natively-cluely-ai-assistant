import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_SCREENSHOT_PROMPT,
  DEFAULT_SCREENSHOT_INSTRUCTION,
  SCREENSHOT_PRESET_PROMPT_KEY,
  SCREENSHOT_PRESET_PROMPT_MAX,
  getScreenshotPresetPrompt,
  getScreenshotPresetPromptDraft,
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

test('typing keeps the space between words; readers get it trimmed', () => {
  resetScreenshotPresetPromptForTesting();
  setScreenshotPresetPrompt('Review ');
  assert.equal(getScreenshotPresetPromptDraft(), 'Review ');
  setScreenshotPresetPrompt('Review this ');
  assert.equal(getScreenshotPresetPromptDraft(), 'Review this ');
  assert.equal(getScreenshotPresetPrompt(), 'Review this');
  assert.equal(resolveScreenshotPromptText(), 'Review this');
});

test('a prompt saved by another window is read at send time, with no storage event', () => {
  resetScreenshotPresetPromptForTesting();
  // The Settings panel (launcher window) wrote it; this window's copy is stale.
  memoryStorage.set(SCREENSHOT_PRESET_PROMPT_KEY, '  Explain this diagram  ');
  assert.equal(getScreenshotPresetPromptDraft(), '');
  assert.equal(getScreenshotPresetPrompt(), 'Explain this diagram');
  assert.equal(resolveScreenshotPromptText(), 'Explain this diagram');
  memoryStorage.delete(SCREENSHOT_PRESET_PROMPT_KEY);
  assert.equal(resolveScreenshotPromptText(), 'What should I say about this?');
});

test('the Settings row: every string is translated, the table has no leftover rows', async () => {
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const src = fs.readFileSync(path.join(SRC, 'components/settings/OverlaySettings.tsx'), 'utf8');
  const start = src.indexOf('const ScreenshotQuestionRow');
  const end = src.indexOf('type ScreenshotDisplay', start);
  assert.ok(start > 0 && end > start, 'ScreenshotQuestionRow found');
  const block = src.slice(start, end);
  // On both meeting surfaces.
  assert.equal((src.match(/<ScreenshotQuestionRow \/>/g) || []).length, 2);
  const used = [...new Set([...block.matchAll(/\bt\((['"])((?:(?!\1)[^\\]|\\.)+)\1\)/g)].map((m) => m[2]))]
    .filter((s) => s !== 'Reset'); // in the generated tables
  assert.ok(used.length >= 2, `found ${used.length} strings`);
  const table = await import(pathToFileURL(path.join(SRC, 'i18n.screenshotQuestion.ts')).href);
  const rows = new Set(table.SCREENSHOT_QUESTION_EN);
  for (const s of used) assert.ok(rows.has(s), `no translation row for: ${s}`);
  for (const r of rows) assert.ok(used.includes(r), `leftover row: ${r}`);
  const i18n = fs.readFileSync(path.join(SRC, 'i18n.tsx'), 'utf8');
  for (const lang of ['RU', 'ZH', 'JA', 'ES']) {
    const column = table[`SCREENSHOT_QUESTION_${lang}`];
    for (const s of used) assert.ok(column[s] && column[s] !== s, `${lang} missing: ${s}`);
    assert.match(i18n, new RegExp(`\\.\\.\\.SCREENSHOT_QUESTION_${lang},`));
  }
});
