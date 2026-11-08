/**
 * Live-reproduced on Windows 2026-11-05: Settings › Audio showed Tiny English,
 * yet every later meeting loaded Moonshine Tiny. The STT instances are built
 * once (pre-warmed at launch) and kept across meetings, and the local-model
 * setters only saved the setting, so a model change reached nothing until the
 * app restarted. Each setter now rebuilds the pipeline the way a provider
 * change does, when a channel's model actually changed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

function handlerBlock(name) {
  const start = source.search(new RegExp(`safeHandle\\(\\s*'${name}'`));
  assert.ok(start >= 0, `${name} handler not found`);
  const next = source.indexOf('safeHandle(', start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

for (const name of ['local-whisper-set-model', 'local-whisper-set-channel-config', 'local-whisper-reset-to-default']) {
  test(`${name} applies the model change to the running STT instances`, () => {
    const block = handlerBlock(name);
    const before = block.indexOf('const before = effectiveLocalSttModels()');
    const apply = block.indexOf('await applyLocalSttModelChange(before)');
    assert.ok(before >= 0, 'reads the effective models before writing');
    assert.ok(apply > before, 'applies the change after writing');
    // Before the first write, so `before` is the old configuration.
    const firstWrite = Math.min(...[/\bsm\.set\('/, /getInstance\(\)\.set\('/].map((re) => block.search(re)).filter((i) => i >= 0));
    assert.ok(before < firstWrite, 'snapshot taken before the first write');
  });
}

test('the rebuild runs only for a real change while Local Models is the provider', () => {
  const start = source.indexOf('const applyLocalSttModelChange');
  const body = source.slice(start, source.indexOf('};', start));
  assert.match(body, /effectiveLocalSttModels\(\) === before\) return/);
  assert.match(body, /getSttProvider\(\) !== 'local-whisper'\) return/);
  assert.match(body, /appState\.reconfigureSttProvider\(\)/);
});

test('effective models mirror createSTTProvider: per-channel slots only when enabled', () => {
  const start = source.indexOf('const effectiveLocalSttModels');
  const body = source.slice(start, source.indexOf('};', start));
  assert.match(body, /localWhisperModel'\) \?\? 'Xenova\/whisper-tiny\.en'/);
  assert.match(body, /perChannel && sm\.get\('localWhisperModelSystem'\)\) \|\| global/);
  assert.match(body, /perChannel && sm\.get\('localWhisperModelMic'\)\) \|\| global/);
});
