/**
 * Provider runtime state-awareness regressions.
 *
 * These are source-level guardrails for the exact production failures fixed in
 * this change set: clearing a key must null the in-memory client, Codex must be
 * gated on real OAuth sign-in (not only an enabled flag), and credential-change
 * IPC handlers must refresh settings/model state after provider removals.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function methodBlock(source, methodName) {
  const start = source.indexOf(`public ${methodName}(`);
  assert.ok(start >= 0, `${methodName} method must exist`);
  const next = source.indexOf('\n  public ', start + 1);
  return source.slice(start, next > start ? next : start + 2200);
}

function handlerBlock(source, handlerName) {
  const start = source.indexOf(`safeHandle('${handlerName}'`);
  assert.ok(start >= 0, `${handlerName} handler must exist`);
  const next = source.indexOf('safeHandle(', start + 1);
  return source.slice(start, next > start ? next : start + 2400);
}

describe('LLMHelper key setters clear in-memory provider clients', () => {
  const cases = [
    ['setApiKey', 'apiKey', 'client', 'Gemini API Key cleared'],
    ['setGroqApiKey', 'groqApiKey', 'groqClient', 'Groq API Key cleared'],
    ['setOpenaiApiKey', 'openaiApiKey', 'openaiClient', 'OpenAI API Key cleared'],
    ['setClaudeApiKey', 'claudeApiKey', 'claudeClient', 'Claude API Key cleared'],
  ];

  for (const [method, keyField, clientField, logText] of cases) {
    test(`${method} nulls ${clientField} on an empty key`, () => {
      const source = read('electron/LLMHelper.ts');
      const block = methodBlock(source, method);
      assert.match(block, /const\s+trimmed\s*=\s*\(apiKey \|\| ''\)\.trim\(\)/, `${method} should trim the incoming key`);
      assert.match(block, new RegExp(`if\\s*\\(!trimmed\\)\\s*\\{[\\s\\S]*?this\\.${keyField}\\s*=\\s*null[\\s\\S]*?this\\.${clientField}\\s*=\\s*null`), `${method} should null both the key and client when the key is cleared`);
      assert.match(block, new RegExp(logText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${method} should log the clear path`);
    });
  }

  test('switch-to-gemini only persists a non-empty key and delegates empty-key clearing to LLMHelper.switchToGemini', () => {
    const block = handlerBlock(read('electron/ipcHandlers.ts'), 'switch-to-gemini');
    assert.match(block, /await\s+llmHelper\.switchToGemini\(apiKey, modelId\)/);
    assert.match(block, /if\s*\(apiKey\)\s*\{[\s\S]*?setGeminiApiKey\(apiKey\)/, 'empty apiKey must not be persisted back as an active Gemini key');
  });
});

describe('Codex availability uses OAuth state, not only enabled config', () => {
  test('isCodexAvailable requires enabled config plus signedIn=true from CodexOAuthService', () => {
    const source = read('electron/LLMHelper.ts');
    const start = source.indexOf('private isCodexAvailable(): boolean');
    assert.ok(start >= 0, 'isCodexAvailable helper must exist');
    const block = source.slice(start, source.indexOf('\n  // ---------------------------', start));
    assert.match(block, /if\s*\(!this\.codexCliConfig\.enabled\)\s*return false/);
    assert.match(block, /CodexOAuthService/);
    assert.match(block, /getStatus\(\)\.signedIn\s*===\s*true/);
  });

  test('structured generation and routeWithScopeFallback consult isCodexAvailable()', () => {
    const source = read('electron/LLMHelper.ts');
    const structured = source.slice(source.indexOf('public async generateContentStructured'), source.indexOf('/**\n   * Non-streaming Groq generation', source.indexOf('public async generateContentStructured')));
    assert.match(structured, /if\s*\(this\.isCodexAvailable\(\)\)\s*\{[\s\S]*?Codex CLI/, 'structured provider ladder must not add Codex when signed out');

    const routed = source.slice(source.indexOf('routeWithScopeFallback({'), source.indexOf('for (const routedProvider', source.indexOf('routeWithScopeFallback({')));
    assert.match(routed, /hasCodex:\s*this\.isCodexAvailable\(\)/, 'router availability should be based on OAuth-aware helper');
  });

  test('Codex CLI is NOT first in the structured-extraction ladder (2026-08-02 latency fix)', () => {
    // generateContentStructured documents an explicit latency policy: Gemini
    // Pro and MiniMax are excluded from document extraction *because* they are
    // slow, leaving flash-lite -> 3.6-flash. Codex CLI then sat at Priority 0,
    // ahead of all of them — a spawned-subprocess reasoning model measured at
    // 18-31s PER CALL on a real profile ingest. One résumé + JD upload makes
    // 6+ structured calls (2 extractions, 2 STAR batches, salary, company
    // research), so a signed-in Codex user paid ~68s of wall clock for work
    // flash-lite does in ~1-2s. That is the "file uploading is slower"
    // report; the ordering, not Codex itself, was the defect.
    //
    // Codex must REMAIN in the ladder (a legitimate fallback when every cloud
    // key is dead) — this pins position, not presence.
    const source = read('electron/LLMHelper.ts');
    const structured = source.slice(
      source.indexOf('public async generateContentStructured'),
      source.indexOf('/**\n   * Non-streaming Groq generation', source.indexOf('public async generateContentStructured')));

    const codexAt = structured.indexOf('Codex CLI (${this.codexCliConfig.model})');
    const flashLiteAt = structured.indexOf('buildGeminiProvider(GEMINI_FLASH_LITE_MODEL)');
    const flashAt = structured.indexOf('buildGeminiProvider(GEMINI_FLASH_MODEL)');

    assert.ok(codexAt > 0, 'Codex must remain available as a structured-generation fallback');
    assert.ok(flashLiteAt > 0 && flashAt > 0, 'the flash-lite -> 3.6-flash extraction cascade must still exist');
    assert.ok(codexAt > flashLiteAt && codexAt > flashAt,
      'Codex CLI must be pushed onto the provider ladder AFTER the Gemini flash cascade — a document ingest must never block on it first');
  });

  test('direct Codex generation throws a clean disabled/signed-out reason', () => {
    const source = read('electron/LLMHelper.ts');
    const generate = source.slice(source.indexOf('private async generateWithCodexCli'), source.indexOf('private async *streamWithCodexCli'));
    const stream = source.slice(source.indexOf('private async *streamWithCodexCli'), source.indexOf('public switchToCurl'));
    assert.match(generate, /if\s*\(!this\.isCodexAvailable\(\)\)\s*throw new Error\('Codex CLI transport is disabled or ChatGPT is signed out\.'\)/);
    assert.match(stream, /if\s*\(!this\.isCodexAvailable\(\)\)\s*throw new Error\('Codex CLI transport is disabled or ChatGPT is signed out\.'\)/);
  });

  test('both Codex sign-out paths broadcast credentials-changed and refresh stale defaults', () => {
    const source = read('electron/ipcHandlers.ts');
    const legacy = handlerBlock(source, 'codex-cli:logout');
    assert.match(legacy, /runCodexAuthAction\('logout'/, 'legacy logout handler should call OAuth-backed logout action');

    const eventStart = source.indexOf("codexOAuth.on('signed-out'");
    assert.ok(eventStart >= 0, 'Codex signed-out event subscription must exist');
    const eventBlock = source.slice(eventStart, source.indexOf("safeHandle('codex:login-status'", eventStart));
    assert.match(eventBlock, /broadcastCodexLoginEvent\('signed-out'/);
    assert.match(eventBlock, /await\s+refreshRuntimeDefaultIfUnavailable\(\)/, 'signed-out should evict Codex default model immediately');
    assert.match(eventBlock, /broadcastCredentialsChanged\(\)/, 'signed-out should refresh every Settings UI');

    const modern = handlerBlock(source, 'codex:sign-out');
    assert.match(modern, /codexOAuth\.signOut\(\)/, 'modern sign-out handler should emit the same signed-out event');
  });
});

describe('IPC credential changes synchronize runtime default and Settings UI', () => {
  for (const handlerName of ['set-gemini-api-key', 'set-groq-api-key', 'set-openai-api-key', 'set-claude-api-key', 'set-deepseek-api-key', 'set-litellm-config']) {
    test(`${handlerName} refreshes unavailable default model and broadcasts credential changes when changed`, () => {
      const block = handlerBlock(read('electron/ipcHandlers.ts'), handlerName);
      assert.match(block, /await\s+refreshRuntimeDefaultIfUnavailable\(\)/, `${handlerName} should reset a stale default model`);
      assert.match(block, /broadcastCredentialsChanged\(\)/, `${handlerName} should refresh open Settings panes`);
    });
  }

  test('custom provider save/delete also broadcast and reset deleted defaults', () => {
    const source = read('electron/ipcHandlers.ts');
    for (const handlerName of ['save-custom-provider', 'delete-custom-provider']) {
      const block = handlerBlock(source, handlerName);
      assert.match(block, /await\s+refreshRuntimeDefaultIfUnavailable\(\)/, `${handlerName} should validate the default model against the custom-provider list`);
      assert.match(block, /broadcastCredentialsChanged\(\)/, `${handlerName} should refresh active model options in Settings`);
    }
  });
});
