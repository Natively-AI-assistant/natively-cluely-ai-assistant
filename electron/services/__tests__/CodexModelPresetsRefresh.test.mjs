// electron/services/__tests__/CodexModelPresetsRefresh.test.mjs
// Issue #573 regression tests:
// 1. CODEX_CLI_MODEL_PRESETS includes latest verified models (gpt-6-astra, gpt-5.6-sol/terra/luna, gpt-5.5)
//    and excludes retired models (spark, 5.3-codex).
// 2. CODEX_MODEL_REASONING_SETS in both CodexCliService.ts and AIProvidersSettings.tsx contains
//    gpt-6, gpt-6-astra, gpt-5.6, and variants, while removing retired presets.
// 3. AIProvidersSettings.tsx provides catalogue fallback status notice and refresh functionality.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.resolve(repoRoot, rel), 'utf8');

describe('Issue #573 Codex Model Presets and Catalogue Refresh', () => {
  test('CODEX_CLI_MODEL_PRESETS includes active models and excludes retired ones', () => {
    const src = read('src/utils/modelUtils.ts');
    const match = src.match(/export const CODEX_CLI_MODEL_PRESETS = \[([\s\S]*?)\];/);
    assert.ok(match, 'CODEX_CLI_MODEL_PRESETS must exist in src/utils/modelUtils.ts');
    const presetsContent = match[1];

    // Must include modern models
    assert.ok(presetsContent.includes('gpt-6-astra'), 'Must include gpt-6-astra');
    assert.ok(presetsContent.includes('gpt-5.6-sol'), 'Must include gpt-5.6-sol');
    assert.ok(presetsContent.includes('gpt-5.6-terra'), 'Must include gpt-5.6-terra');
    assert.ok(presetsContent.includes('gpt-5.6-luna'), 'Must include gpt-5.6-luna');
    assert.ok(presetsContent.includes('gpt-5.5'), 'Must include gpt-5.5');

    // Must not include retired models
    assert.ok(!presetsContent.includes('gpt-5.3-codex-spark'), 'Must not include gpt-5.3-codex-spark');
    assert.ok(!presetsContent.includes('gpt-5.3-codex'), 'Must not include gpt-5.3-codex');
  });

  test('CodexCliService.ts CODEX_MODEL_REASONING_SETS has gpt-6 and gpt-5.6 families and no dead presets', () => {
    const src = read('electron/services/CodexCliService.ts');
    const match = src.match(/const CODEX_MODEL_REASONING_SETS:[^=]*= \[([\s\S]*?)\];/);
    assert.ok(match, 'CODEX_MODEL_REASONING_SETS must exist in CodexCliService.ts');
    const table = match[1];

    assert.ok(table.includes('gpt-6-astra'), 'Must include gpt-6-astra');
    assert.ok(table.includes('gpt-6'), 'Must include gpt-6');
    assert.ok(table.includes('gpt-5.6-sol'), 'Must include gpt-5.6-sol');
    assert.ok(table.includes('gpt-5.6-terra'), 'Must include gpt-5.6-terra');
    assert.ok(!table.includes('gpt-5.3-codex-spark'), 'Must not include retired gpt-5.3-codex-spark');
  });

  test('AIProvidersSettings.tsx CODEX_MODEL_REASONING_SETS matches active families', () => {
    const src = read('src/components/settings/AIProvidersSettings.tsx');
    const match = src.match(/const CODEX_MODEL_REASONING_SETS:[^=]*= \[([\s\S]*?)\];/);
    assert.ok(match, 'CODEX_MODEL_REASONING_SETS must exist in AIProvidersSettings.tsx');
    const table = match[1];

    assert.ok(table.includes('gpt-6-astra'), 'Must include gpt-6-astra');
    assert.ok(table.includes('gpt-6'), 'Must include gpt-6');
    assert.ok(table.includes('gpt-5.6-sol'), 'Must include gpt-5.6-sol');
    assert.ok(table.includes('gpt-5.6-terra'), 'Must include gpt-5.6-terra');
    assert.ok(!table.includes('gpt-5.3-codex-spark'), 'Must not include retired gpt-5.3-codex-spark');
  });

  test('AIProvidersSettings.tsx surfaces catalog warning and refresh button', () => {
    const src = read('src/components/settings/AIProvidersSettings.tsx');
    assert.match(src, /Refresh Models|Refresh/i, 'AIProvidersSettings must have a refresh button for codex models');
    assert.match(src, /Codex CLI catalogue is unavailable|unavailable/i, 'AIProvidersSettings must surface notice when CLI catalogue is absent');
  });
});
