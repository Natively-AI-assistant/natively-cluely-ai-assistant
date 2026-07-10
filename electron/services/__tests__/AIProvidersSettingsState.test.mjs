// electron/services/__tests__/AIProvidersSettingsState.test.mjs
//
// Source-level guardrails for Settings → AI Providers state synchronization.
// The UI must not keep stale default-model entries after a provider key is
// removed or Codex OAuth is signed out.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'src/components/settings/AIProvidersSettings.tsx'), 'utf8');

describe('AIProvidersSettings credential synchronization', () => {
  test('subscribes to credentials-changed and reloads credentials/default model state', () => {
    assert.match(source, /onCredentialsChanged/, 'Settings should listen for backend credential changes');
    assert.match(source, /onCredentialsChanged\(\(\)\s*=>\s*\{\s*loadCredentials\(\);\s*\}\)/, 'credentials-changed should call loadCredentials()');
  });

  test('Codex active-model and fast-mode options require enabled config AND signed-in OAuth', () => {
    assert.match(source, /const\s+isCodexReady\s*=\s*codexCliConfig\.enabled\s*&&\s*codexOauthStatus\.signedIn/, 'Codex readiness should be signedIn && enabled');
    assert.match(source, /if\s*\(isCodexReady\)\s*\{[\s\S]*?CODEX_CLI_MODEL/, 'Codex model options should only be added when ready');
    assert.doesNotMatch(source, /codexOauthStatus\.signedIn\s*\|\|\s*codexCliConfig\.enabled/, 'old signedIn || enabled availability check must not return');
    assert.match(source, /hasStoredKey\.groq \|\| hasStoredKey\.natively \|\| \(codexCliConfig\.enabled && codexOauthStatus\.signedIn\)/, 'fast mode should not be enabled by a signed-out Codex flag');
  });

  test('unavailable current default model is not reinserted into the active-model dropdown', () => {
    assert.doesNotMatch(source, /opts\.unshift\(\{\s*id:\s*defaultModel/, 'stale defaultModel should not be re-added to available options');
    assert.match(source, /if\s*\(!defaultModel \|\| opts\.some\(o => o\.id === defaultModel\) \|\| opts\.length === 0\) return/, 'guard should detect unavailable default');
    assert.match(source, /window\.electronAPI\?\.setDefaultModel\?\.\(next\)/, 'unavailable default should be persisted to a safe option');
  });

  test('LiteLLM models are loaded only while configured and cleared on removal', () => {
    assert.match(source, /const \[litellmModels, setLitellmModels\] = useState<string\[\]>\(\[\]\)/, 'LiteLLM model list state should exist');
    assert.match(source, /if\s*\(!hasStoredKey\.litellm\)\s*\{\s*setLitellmModels\(\[\]\);\s*return;/, 'LiteLLM models should clear when proxy is removed');
    assert.match(source, /getAvailableLiteLLMModels/, 'configured LiteLLM proxy should populate selectable models');
    assert.match(source, /id: `litellm\/\$\{model\}`/, 'LiteLLM options should use the runtime litellm/<model> id shape');
  });

  test('loadCredentials clears LiteLLM form fields when another window removes the proxy', () => {
    assert.match(source, /setLitellmBaseURL\(creds\.litellmBaseURL \|\| ''\)/, 'base URL should clear when creds no longer contain LiteLLM config');
    assert.match(source, /setLitellmMaxTokens\(creds\.litellmMaxTokens \? String\(creds\.litellmMaxTokens\) : ''\)/, 'max tokens should clear when proxy is removed');
  });
});
