import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('dynamic action accept uses promptInstruction instead of display label/manual submit', () => {
  const source = read('src/components/NativelyInterface.tsx');
  const mountStart = source.indexOf('<DynamicActionBar');
  assert.ok(mountStart >= 0, 'DynamicActionBar should be mounted');
  const mountSource = source.slice(mountStart, source.indexOf('/>', mountStart) + 2);

  assert.match(mountSource, /handleWhatToSay\(action\.promptInstruction\)/);
  assert.doesNotMatch(mountSource, /setInputValue\(action\.label\)/);
  assert.doesNotMatch(mountSource, /handleManualSubmitRef\.current/);
});

test('generate-what-to-say IPC forwards promptInstruction option to IntelligenceManager', () => {
  const source = read('electron/ipcHandlers.ts');
  const handlerStart = source.indexOf('safeHandle("generate-what-to-say"');
  assert.ok(handlerStart >= 0, 'generate-what-to-say handler should exist');
  const handlerSource = source.slice(handlerStart, source.indexOf('safeHandle("', handlerStart + 10));

  assert.match(handlerSource, /options\?: \{ promptInstruction\?: string; domContext\?: string \}/);
  assert.match(handlerSource, /promptInstruction: typeof options\?\.promptInstruction === 'string' \? options\.promptInstruction : undefined/);
});

test('preload and renderer type expose promptInstruction option on generateWhatToSay', () => {
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(preload, /generateWhatToSay: \(question\?: string, imagePaths\?: string\[\], options\?: \{ promptInstruction\?: string; domContext\?: string \}\)/);
  assert.match(preload, /ipcRenderer\.invoke\("generate-what-to-say", question, imagePaths, options\)/);
  assert.match(types, /generateWhatToSay: \(question\?: string, imagePaths\?: string\[\], options\?: \{ promptInstruction\?: string; domContext\?: string \}\)/);
});
