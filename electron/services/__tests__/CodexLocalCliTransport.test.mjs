// Regression coverage for the local Codex CLI integration.
//
// Natively must use the same local CLI that the user has authenticated with.
// A separate in-app OAuth store cannot see `codex login`, which made the old
// HTTP-direct transport report "Not signed in" even while the CLI worked.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const compiledPath = path.join(repoRoot, 'dist-electron/electron/services/CodexCliService.js');
const sourcePath = path.join(repoRoot, 'electron/services/CodexCliService.ts');
const selectorSourcePath = path.join(repoRoot, 'src/components/ModelSelectorWindow.tsx');
const settingsSourcePath = path.join(repoRoot, 'src/components/settings/AIProvidersSettings.tsx');
const preloadSourcePath = path.join(repoRoot, 'electron/preload.ts');
const { CodexCliService, normalizeCodexModelCatalog } =
  await import(pathToFileURL(compiledPath).href);
const { mergeCodexCliModelOptions } =
  await import(pathToFileURL(path.join(repoRoot, 'src/utils/modelUtils.ts')).href);

describe('Codex local CLI transport', () => {
  test('exec args use the authenticated local CLI and preserve the answer contract', () => {
    const args = CodexCliService.buildExecArgs(
      'gpt-5.6-terra',
      ['/tmp/screenshot.png'],
      'read-only',
      'default',
      'medium',
    );

    assert.deepEqual(args.slice(0, 8), [
      'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules',
      '--json', '--color', 'never', '--sandbox',
    ]);
    assert.ok(args.includes('--model'));
    assert.ok(args.includes('gpt-5.6-terra'));
    assert.ok(args.includes('--image'));
    assert.ok(args.includes('/tmp/screenshot.png'));
  });

  test('model catalog keeps visible current CLI models and ignores hidden entries by default', () => {
    const catalog = normalizeCodexModelCatalog({
      data: [
        { id: 'gpt-6-astra', model: 'gpt-6-astra', displayName: 'GPT-6-Astra', hidden: false },
        { id: 'gpt-5.6-terra', model: 'gpt-5.6-terra', displayName: 'GPT-5.6-Terra', hidden: false },
        { id: 'gpt-reserve', model: 'gpt-reserve', displayName: 'GPT-Reserve', hidden: true },
        { id: 'gpt-6-astra', model: 'gpt-6-astra', displayName: 'duplicate', hidden: false },
      ],
    });

    assert.deepEqual(catalog.map(model => model.id), ['gpt-6-astra', 'gpt-5.6-terra']);
    assert.equal(catalog[0].name, 'GPT-6-Astra');
  });

  test('a successful live catalog replaces stale presets but preserves persisted selections', () => {
    const options = mergeCodexCliModelOptions(
      [{ id: 'gpt-6-astra', name: 'GPT-6-Astra' }],
      ['gpt-5.6-terra'],
    );

    assert.deepEqual(options.map(model => model.id), ['gpt-6-astra', 'gpt-5.6-terra']);
  });

  test('the answer path does not require Natively-owned OAuth tokens', () => {
    const source = fs.readFileSync(sourcePath, 'utf8');
    assert.match(source, /spawn/);
    assert.match(source, /app-server/);
    assert.doesNotMatch(
      source,
      /CodexOAuthService\.getInstance\(\)\.getStatus\(\)\.signedIn/,
      'local CLI login must be the source of truth for local CLI requests',
    );
  });

  test('the model picker consumes the live CLI catalogue with a static fallback', () => {
    const selectorSource = fs.readFileSync(selectorSourcePath, 'utf8');
    const settingsSource = fs.readFileSync(settingsSourcePath, 'utf8');
    const preloadSource = fs.readFileSync(preloadSourcePath, 'utf8');
    assert.match(selectorSource, /getCodexCliModels/);
    assert.match(selectorSource, /mergeCodexCliModelOptions/);
    assert.match(settingsSource, /getCodexCliModels/);
    assert.match(settingsSource, /mergeCodexCliModelOptions/);
    assert.match(preloadSource, /getCodexCliModels/);
  });

  test('settings refreshes the model catalogue when the CLI is enabled or its path changes', () => {
    const settingsSource = fs.readFileSync(settingsSourcePath, 'utf8');
    assert.match(
      settingsSource,
      /getCodexCliModels[\s\S]*?\[codexCliConfig\.enabled, codexCliConfig\.path\]/,
      'model discovery must rerun after enabling the CLI or changing its executable path',
    );
  });

  test('the default bare codex command can resolve a standard user-local install', async () => {
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-codex-home-'));
    const candidate = path.join(dir, '.local', 'bin', 'codex');
    fs.mkdirSync(path.dirname(candidate), { recursive: true });
    fs.writeFileSync(candidate, '#!/bin/sh\n');
    fs.chmodSync(candidate, 0o755);
    process.env.HOME = dir;
    process.env.PATH = dir;
    try {
      assert.equal(await CodexCliService.resolvePathOrAutoDetect('codex'), candidate);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('exec uses the configured binary and ignores wrapper keepalives', { skip: process.platform === 'win32' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-codex-fixture-'));
    const fixture = path.join(dir, 'codex-fixture');
    fs.writeFileSync(fixture, `#!/usr/bin/env node
const mode = process.argv[2];
let input = '';
process.stdin.setEncoding('utf8');
const handleLine = line => {
  if (!line.trim() || mode !== 'app-server') return;
  const message = JSON.parse(line);
  if (message.id === 1) console.log(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
  if (message.id === 2) console.log(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { data: [
    { id: 'gpt-fixture', displayName: 'GPT Fixture', hidden: false },
  ] } }));
};
process.stdin.on('data', chunk => {
  input += chunk;
  const lines = input.split(/\\r?\\n/);
  input = lines.pop() || '';
  lines.forEach(handleLine);
});
process.stdin.on('end', () => {
  if (mode === 'app-server') {
    handleLine(input);
    return;
  }
  console.log(JSON.stringify({ type: 'agent_message.delta', delta: '\\u200B' }));
  console.log(JSON.stringify({ type: 'agent_message.delta', delta: 'FAKE_LOCAL_OK' }));
});
`);
    fs.chmodSync(fixture, 0o755);
    try {
      const models = await CodexCliService.listModels(fixture, 2_000);
      assert.deepEqual(models.map(model => ({ id: model.id, name: model.name })), [
        { id: 'gpt-fixture', name: 'GPT Fixture' },
      ]);

      const answer = await CodexCliService.run(fixture, {
        prompt: 'Reply with the fixture token.',
        model: 'gpt-fixture',
        timeoutMs: 2_000,
      });
      assert.equal(answer, 'FAKE_LOCAL_OK');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
