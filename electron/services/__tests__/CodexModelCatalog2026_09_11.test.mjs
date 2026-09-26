// Issue #558 — the Codex model picker was four hardcoded ids and the shipped
// defaults were gpt-5.4 / gpt-5.3-codex. Live on 2026-09-11, with a ChatGPT
// sign-in, the backend rejected three of the four presets and both defaults:
// "The '<id>' model is not supported when using Codex with a ChatGPT account." The picker now reads the installation's own
// catalogue — `$CODEX_HOME/models_cache.json`, which the CLI refreshes from the
// same backend Natively calls — and falls back to the built-in presets only
// when no catalogue exists (most users never install the CLI: Natively signs in
// to ChatGPT itself).
//
// Every OS-facing input (env, home dir, path flavour, file reader) is injected,
// so both the macOS and Windows resolution branches run on either host without
// touching process.platform.
//
// Run via: npm run build:electron && node --test electron/services/__tests__/CodexModelCatalog2026_09_11.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const catalogMod = await import(pathToFileURL(path.join(root, 'dist-electron/electron/services/CodexModelCatalog.js')).href);
const { resolveCodexHome, parseCodexModelsCache, readCodexModelCatalog, CHATGPT_UNSUPPORTED_CODEX_MODELS, isChatGptUnsupportedCodexModel } = catalogMod;
const cliMod = await import(pathToFileURL(path.join(root, 'dist-electron/electron/services/CodexCliService.js')).href);
const { CodexCliService, chatGptCompatibleModel, DEFAULT_CODEX_CLI_CONFIG, CODEX_NOT_SIGNED_IN_MESSAGE, isCodexAuthError } = cliMod;
// src/utils/modelUtils.ts is imported for REAL (node >= 22.6 strips the types).
// file:// URL, not a bare path — a bare `C:\…` import throws on Windows.
const modelUtils = await import(pathToFileURL(path.join(root, 'src/utils/modelUtils.ts')).href);
const { CODEX_CLI_MODEL, CODEX_CLI_MODEL_PRESETS, codexModelOptions, getCodexCliModelDisplayName } = modelUtils;

// Shape of the file the Codex CLI writes (trimmed to the fields we read; the
// real file carries ~30 more per model).
const CACHE = JSON.stringify({
  fetched_at: '2026-08-15T08:21:05.413810Z',
  client_version: '0.148.0',
  models: [
    { slug: 'gpt-5.4-mini', display_name: 'GPT-5.4-Mini', visibility: 'list', priority: 23 },
    { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide', priority: 43 },
    { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', visibility: 'list', priority: 2 },
    { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', priority: 7 },
  ],
});

describe('resolveCodexHome', () => {
  test('macOS: defaults to ~/.codex', () => {
    assert.equal(resolveCodexHome({}, '/Users/ana', path.posix), '/Users/ana/.codex');
  });

  test('Windows: defaults to %USERPROFILE%\\.codex', () => {
    assert.equal(resolveCodexHome({}, 'C:\\Users\\Ana Maria', path.win32), 'C:\\Users\\Ana Maria\\.codex');
  });

  test('CODEX_HOME wins on both platforms, surrounding whitespace ignored', () => {
    assert.equal(resolveCodexHome({ CODEX_HOME: '  /opt/codex ' }, '/Users/ana', path.posix), '/opt/codex');
    assert.equal(resolveCodexHome({ CODEX_HOME: 'D:\\tools\\codex' }, 'C:\\Users\\Ana', path.win32), 'D:\\tools\\codex');
  });

  test('a blank CODEX_HOME falls back to the home-dir default', () => {
    assert.equal(resolveCodexHome({ CODEX_HOME: '   ' }, '/Users/ana', path.posix), '/Users/ana/.codex');
  });
});

describe('parseCodexModelsCache', () => {
  test('keeps only models the CLI itself lists, in the CLI\'s priority order', () => {
    assert.deepEqual(parseCodexModelsCache(CACHE).models, [
      { id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' },
      { id: 'gpt-5.5', name: 'GPT-5.5' },
    ]);
  });

  test('drops listed models the backend rejects for a ChatGPT account', () => {
    // The real cache listed gpt-5.4-mini (visibility "list"); a live request with
    // a ChatGPT sign-in was refused. The catalogue alone is not proof of use.
    const ids = parseCodexModelsCache(CACHE).models.map((m) => m.id);
    assert.ok(!ids.includes('gpt-5.4-mini'));
    assert.ok(isChatGptUnsupportedCodexModel(' GPT-5.4-Mini '));
    assert.ok(!isChatGptUnsupportedCodexModel('gpt-5.5'));
  });

  test('carries fetched_at / client_version so the UI can say how old the list is', () => {
    const parsed = parseCodexModelsCache(CACHE);
    assert.equal(parsed.fetchedAt, '2026-08-15T08:21:05.413810Z');
    assert.equal(parsed.clientVersion, '0.148.0');
  });

  test('a model without display_name is named by its slug', () => {
    const raw = JSON.stringify({ models: [{ slug: 'gpt-9', visibility: 'list' }] });
    assert.deepEqual(parseCodexModelsCache(raw).models, [{ id: 'gpt-9', name: 'gpt-9' }]);
  });

  test('malformed or empty input yields null, never a throw', () => {
    assert.equal(parseCodexModelsCache('not json'), null);
    assert.equal(parseCodexModelsCache('{}'), null);
    assert.equal(parseCodexModelsCache(JSON.stringify({ models: [] })), null);
    assert.equal(parseCodexModelsCache(JSON.stringify({ models: [{ visibility: 'list' }, { slug: 'x', visibility: 'hide' }] })), null);
  });
});

describe('readCodexModelCatalog', () => {
  test('macOS: reads models_cache.json from the resolved Codex home', async () => {
    const reads = [];
    const catalog = await readCodexModelCatalog({
      env: {}, homeDir: '/Users/ana', pathImpl: path.posix,
      readFile: async (p) => { reads.push(p); return CACHE; },
    });
    assert.deepEqual(reads, ['/Users/ana/.codex/models_cache.json']);
    assert.equal(catalog.source, 'codex-cli');
    assert.equal(catalog.models[0].id, 'gpt-5.6-terra');
  });

  test('Windows: reads models_cache.json from %USERPROFILE%\\.codex', async () => {
    const reads = [];
    const catalog = await readCodexModelCatalog({
      env: {}, homeDir: 'C:\\Users\\Ana Maria', pathImpl: path.win32,
      readFile: async (p) => { reads.push(p); return CACHE; },
    });
    assert.deepEqual(reads, ['C:\\Users\\Ana Maria\\.codex\\models_cache.json']);
    assert.equal(catalog.source, 'codex-cli');
  });

  test('no CLI installed (ENOENT) is "unavailable", not an error', async () => {
    const catalog = await readCodexModelCatalog({
      env: {}, homeDir: '/Users/ana', pathImpl: path.posix,
      readFile: async () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
    });
    assert.equal(catalog.source, 'unavailable');
    assert.deepEqual(catalog.models, []);
  });

  test('an unreadable or corrupt cache is "unavailable" too', async () => {
    const corrupt = await readCodexModelCatalog({
      env: {}, homeDir: '/Users/ana', pathImpl: path.posix, readFile: async () => '{"models":',
    });
    assert.equal(corrupt.source, 'unavailable');
    const denied = await readCodexModelCatalog({
      env: {}, homeDir: '/Users/ana', pathImpl: path.posix,
      readFile: async () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; },
    });
    assert.equal(denied.source, 'unavailable');
  });
});

describe('codexModelOptions (renderer)', () => {
  test('uses the installed CLI\'s catalogue when one was found', () => {
    const catalogue = parseCodexModelsCache(CACHE).models;
    assert.deepEqual(codexModelOptions({ source: 'codex-cli', models: catalogue }), catalogue);
  });

  test('falls back to the built-in presets without a catalogue (CLI not installed, old preload)', () => {
    assert.deepEqual(codexModelOptions({ source: 'unavailable', models: [] }), CODEX_CLI_MODEL_PRESETS);
    assert.deepEqual(codexModelOptions(undefined), CODEX_CLI_MODEL_PRESETS);
    assert.deepEqual(codexModelOptions(null), CODEX_CLI_MODEL_PRESETS);
  });
});

describe('presets and defaults', () => {
  test('no preset, and neither default, is a model the ChatGPT backend rejects', () => {
    // The renderer preset list and the main-process deny list live in different
    // bundles; this is what keeps them apart.
    for (const m of CODEX_CLI_MODEL_PRESETS) assert.ok(!CHATGPT_UNSUPPORTED_CODEX_MODELS.has(m.id), m.id);
    assert.ok(!CHATGPT_UNSUPPORTED_CODEX_MODELS.has(DEFAULT_CODEX_CLI_CONFIG.model));
    assert.ok(!CHATGPT_UNSUPPORTED_CODEX_MODELS.has(DEFAULT_CODEX_CLI_CONFIG.fastModel));
  });

  test('both shipped defaults are presets, so the settings field never opens on an unlisted id', () => {
    const ids = CODEX_CLI_MODEL_PRESETS.map((m) => m.id);
    assert.ok(ids.includes(DEFAULT_CODEX_CLI_CONFIG.model), DEFAULT_CODEX_CLI_CONFIG.model);
    assert.ok(ids.includes(DEFAULT_CODEX_CLI_CONFIG.fastModel), DEFAULT_CODEX_CLI_CONFIG.fastModel);
  });

  test('catalogue-era ids resolve to real names on surfaces without catalogue access', () => {
    assert.equal(getCodexCliModelDisplayName('codex-cli:gpt-5.6-terra'), 'GPT-5.6 Terra');
    assert.equal(getCodexCliModelDisplayName('codex-cli:gpt-5.6-luna'), 'GPT-5.6 Luna');
  });
});

describe('persisted ChatGPT-incompatible models', () => {
  test('persisted ChatGPT-rejected models are replaced by the defaults on load', () => {
    // main.ts used to fall back to spark for an unset fast model, gpt-5.4 /
    // gpt-5.3-codex were the shipped defaults, and the Settings card persists
    // the whole config on sign-in — all of them are sitting in real settings
    // files (the reporter's had fastModel gpt-5.4). Every call with them 400s.
    for (const id of CHATGPT_UNSUPPORTED_CODEX_MODELS) {
      const cfg = CodexCliService.normalizeConfig({ model: id, fastModel: id });
      assert.equal(cfg.model, DEFAULT_CODEX_CLI_CONFIG.model, id);
      assert.equal(cfg.fastModel, DEFAULT_CODEX_CLI_CONFIG.fastModel, id);
    }
  });

  test('a picked codex-cli:<rejected> runs the configured model instead (LLMHelper.getSelectedCodexCliModel)', () => {
    assert.equal(chatGptCompatibleModel('gpt-5.3-codex-spark', 'gpt-5.5'), 'gpt-5.5');
    assert.equal(chatGptCompatibleModel('GPT-5.4', 'gpt-5.5'), 'gpt-5.5');
    assert.equal(chatGptCompatibleModel('', 'gpt-5.5'), 'gpt-5.5');
    assert.equal(chatGptCompatibleModel(' gpt-5.6-luna ', 'gpt-5.5'), 'gpt-5.6-luna');
  });

  test('any other persisted model is kept as chosen, listed or not', () => {
    const cfg = CodexCliService.normalizeConfig({ model: 'gpt-5.6-luna', fastModel: 'gpt-9-future' });
    assert.equal(cfg.model, 'gpt-5.6-luna');
    assert.equal(cfg.fastModel, 'gpt-9-future');
  });

  test('startup restore has no model literals of its own — normalizeConfig owns the defaults', () => {
    // A second copy of the defaults in main.ts is how spark shipped as the
    // fast model while DEFAULT_CODEX_CLI_CONFIG said gpt-5.3-codex.
    const src = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    const start = src.indexOf('llmHelper.setCodexCliConfig({');
    assert.ok(start >= 0, 'startup setCodexCliConfig call not found');
    const block = src.slice(start, src.indexOf('});', start));
    assert.doesNotMatch(block, /['"]gpt-/);
  });
});

describe('wording', () => {
  test('the provider is not labelled as a local CLI transport', () => {
    assert.equal(CODEX_CLI_MODEL.name, 'OpenAI Codex');
    assert.doesNotMatch(CODEX_CLI_MODEL.desc, /local|cli/i);
  });

  test('the signed-out error names both ways in (Settings, or `codex login`) and still matches isCodexAuthError', () => {
    assert.match(CODEX_NOT_SIGNED_IN_MESSAGE, /^Not signed in to ChatGPT/);
    assert.match(CODEX_NOT_SIGNED_IN_MESSAGE, /codex login/);
    assert.ok(isCodexAuthError(new Error(CODEX_NOT_SIGNED_IN_MESSAGE)));
  });
});
