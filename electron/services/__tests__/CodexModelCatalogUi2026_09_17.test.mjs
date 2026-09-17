import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const settings = fs.readFileSync(path.join(root, 'src/components/settings/AIProvidersSettings.tsx'), 'utf8');
const selector = fs.readFileSync(path.join(root, 'src/components/ModelSelectorWindow.tsx'), 'utf8');
const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const models = fs.readFileSync(path.join(root, 'src/utils/modelUtils.ts'), 'utf8');
const llm = fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');

test('Settings gates refresh behind a signed-in status and refreshes asynchronously', () => {
  assert.match(settings, /if \(!codexOauthStatus\.signedIn \|\| !window\.electronAPI\?\.refreshCodexModels\) return/);
  assert.match(settings, /useEffect\(\(\) => \{ void refreshCodexCatalog\(\); \}, \[refreshCodexCatalog\]\)/);
  assert.match(settings, /getCodexCliModels.*catch\(\(\) => null\)/s, 'loads cache without blocking on provider refresh');
});

test('GUI identifies live, provider-cache, CLI-cache, refresh-failure, and unavailable states', () => {
  for (const text of [
    'Model list fetched from OpenAI',
    'Using the last model list fetched from OpenAI',
    'Using your Codex CLI model cache',
    'Refresh failed; the cached list may be stale.',
    'No hardcoded model list will be substituted',
  ]) assert.match(settings, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('model selector is cache-only and IPC separates cache reads from refresh', () => {
  assert.match(selector, /getCodexCliModels/);
  assert.doesNotMatch(selector, /refreshCodexModels/);
  const cacheHandler = ipc.indexOf("safeHandle('codex-cli:models'");
  const refreshHandler = ipc.indexOf("safeHandle('codex:refresh-models'");
  assert.ok(cacheHandler >= 0 && refreshHandler > cacheHandler);
  assert.doesNotMatch(ipc.slice(cacheHandler, refreshHandler), /refreshCodexModelCatalog/);
  assert.match(ipc.slice(refreshHandler, refreshHandler + 900), /refreshCodexModelCatalog/);
});

test('renderer has no static Codex model roster or duplicated capability table', () => {
  assert.doesNotMatch(models, /CODEX_CLI_MODEL_PRESETS/);
  assert.doesNotMatch(settings, /CODEX_MODEL_REASONING_SETS|CODEX_MODEL_REASONING_EFFORTS/);
  assert.doesNotMatch(models, /gpt-5\.6|gpt-6-astra|gpt-5\.3-codex/);
});

test('empty Codex configurations are unavailable and explicit selections fail closed', () => {
  const availability = llm.slice(llm.indexOf('private isCodexAvailable(): boolean'), llm.indexOf('public getCodexSelectionAuthError(): string | null'));
  assert.match(availability, /if \(!this\.codexCliConfig\.model\) return false/);
  const selectionError = llm.slice(llm.indexOf('public getCodexSelectionAuthError(): string | null'), llm.indexOf('// ---------------------------', llm.indexOf('public getCodexSelectionAuthError(): string | null')));
  assert.match(selectionError, /No Codex model is selected/);
});
