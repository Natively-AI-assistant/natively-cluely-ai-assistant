/**
 * The live helper's OpenCode routing map follows the catalogue.
 *
 * The map decides, per model, which of the four protocols serves it and which
 * base URL (pay-as-you-go or Go) it is sent to. It was written only at boot and
 * on key save, so a Refresh — or the background refresh — persisted a new
 * catalogue that the next turn never saw: a model added since the last save was
 * sent to the paid base (402 on a Go-only key) or to a guessed protocol (a 404
 * telling the user to "Refresh", which did not help).
 *
 * And a key change whose catalogue fetch failed kept the PREVIOUS workspace's
 * map, although the docblock promised the presets.
 *
 * Run: node --test electron/services/__tests__/OpencodeRoutingMapSync2026_11_22.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.join(__dirname, '../../..');
const dist = (p) => path.join(root, 'dist-electron/electron', p);

// CredentialsManager (imported transitively) reads app.getPath at module scope.
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { LLMHelper } = require(dist('LLMHelper.js'));
const { opencodePresetMeta } = require(dist('llm/opencode/catalog.js'));
const { OPENCODE_OPENAI_BASE } = require(dist('llm/opencode/constants.js'));

const PRESET_IDS = Object.keys(opencodePresetMeta()).sort();
const GO_BASE = 'https://opencode.ai/inference/go/openai/v1';

function bare() {
  const h = Object.create(LLMHelper.prototype);
  h.textHealth = new Map();
  h.visionHealth = new Map();
  h.isProviderDisabled = () => false;
  return h;
}

describe('setOpencodeConfig never keeps a previous workspace map', () => {
  test('a key change whose catalogue fetch failed falls back to the presets', () => {
    const h = bare();
    h.setOpencodeConfig('oc_sk_workspaceA', {
      'claude-opus-6': { api: 'messages', baseUrl: 'https://opencode.ai/inference/go/anthropic', vision: true, go: true },
    });
    assert.deepEqual(Object.keys(h.getOpencodeModelMeta()), ['claude-opus-6']);

    h.setOpencodeConfig('oc_sk_workspaceB', {});
    assert.deepEqual(Object.keys(h.getOpencodeModelMeta()).sort(), PRESET_IDS);
  });

  test('clearing the key falls back to the presets too', () => {
    const h = bare();
    h.setOpencodeConfig('oc_sk_a', { 'x-model': { api: 'chat-completions', baseUrl: OPENCODE_OPENAI_BASE, vision: false } });
    h.setOpencodeConfig('', undefined);
    assert.deepEqual(Object.keys(h.getOpencodeModelMeta()).sort(), PRESET_IDS);
  });
});

describe('setOpencodeModelMeta replaces the routing map, and only the map', () => {
  test('a fresh catalogue replaces the map; an empty one means "no catalogue yet"', () => {
    const h = bare();
    h.setOpencodeConfig('oc_sk_a', undefined);
    const clientBefore = h.opencodeOpenAIClient;

    h.setOpencodeModelMeta({ 'new-model': { api: 'chat-completions', baseUrl: GO_BASE, vision: false, go: true } });
    assert.deepEqual(Object.keys(h.getOpencodeModelMeta()), ['new-model']);
    assert.equal(h.opencodeOpenAIClient, clientBefore, 'no client is rebuilt');

    h.setOpencodeModelMeta({});
    assert.deepEqual(Object.keys(h.getOpencodeModelMeta()).sort(), PRESET_IDS);
    h.setOpencodeModelMeta(undefined);
    assert.deepEqual(Object.keys(h.getOpencodeModelMeta()).sort(), PRESET_IDS);
  });

  test('the NEXT turn routes on the refreshed map: a Go model goes to the Go base', async () => {
    const h = bare();
    h.isLocalOnlyMode = false;
    h.opencodeApiKey = 'oc_sk_test';
    h.assertOutboundScopes = () => {};
    h.rateLimiters = { opencode: { acquire: async () => {} } };
    h.recordOpencodeUsage = () => {};
    const bases = [];
    const create = async () => (async function* () { yield { choices: [{ delta: { content: 'ok' } }] }; })();
    const primary = { chat: { completions: { create } } };
    primary.withOptions = ({ baseURL }) => { bases.push(baseURL); return primary; };
    h._opencodeOpenAIClient = primary;
    h._opencodeAnthropicClient = {};
    h.opencodeModelMeta = opencodePresetMeta();

    // What a Refresh now does: the catalogue names a model the presets do not.
    h.setOpencodeModelMeta({ 'kimi-k3-go': { api: 'chat-completions', baseUrl: GO_BASE, vision: false, go: true } });
    let text = '';
    for await (const chunk of h.streamWithOpencode('hi', 'sys', undefined, undefined, 'opencode/kimi-k3-go')) text += chunk;
    assert.equal(text, 'ok');
    assert.deepEqual(bases, [GO_BASE], 'the Go model must not be sent to the pay-as-you-go base');
  });
});

describe('every catalogue reader applies through ONE writer', () => {
  const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'electron/services/LiveModelCatalogService.ts'), 'utf8');

  const body = (src, start) => {
    const at = src.indexOf(start);
    assert.notEqual(at, -1, `${start} not found`);
    return src.slice(at, src.indexOf('\n  };\n', at));
  };

  test('applyOpencodeCatalogue writes credentials AND the live helper', () => {
    const apply = body(ipc, 'const applyOpencodeCatalogue = ');
    // `meta` is the catalogue's, with the last Go routes carried forward when
    // this fetch could not read the Go list.
    assert.match(apply, /const meta = catalogue\.goListRead \? catalogue\.meta : carryForwardGoRoutes\(catalogue\.meta, cm\.getOpencodeModelMeta\(\)\)/);
    assert.match(apply, /cm\.setOpencodeModelMeta\(meta\)/);
    assert.match(apply, /cm\.setOpencodeVisionModels\(catalogue\.vision\)/);
    assert.match(apply, /llmHelper\.setOpencodeModelMeta\(meta\)/);
    // And the key's Go access, tagged with the key it was read for.
    assert.match(apply, /cm\.setOpencodeGoAccess\(catalogue\.goAccess, key\)/);
    assert.match(apply, /llmHelper\.setOpencodeGoAccess\(catalogue\.goAccess, key\)/);
  });

  test('it is the only place the routing metadata is persisted', () => {
    assert.equal(ipc.split('cm.setOpencodeModelMeta(').length - 1, 1, 'one writer in ipcHandlers');
    assert.doesNotMatch(service, /setOpencodeModelMeta|setOpencodeVisionModels/,
      'the background service commits ids only; it must not persist routing metadata before its key-rotation guard');
  });

  test('discovery and the card\'s fetch both apply through it', () => {
    assert.match(body(ipc, 'const discoverOpencodeModels = '), /applyOpencodeCatalogue\(catalogue, key\)/);
    const fetchHandler = ipc.slice(ipc.indexOf("'fetch-provider-models'"), ipc.indexOf("'set-provider-preferred-model'"));
    assert.match(fetchHandler, /applyOpencodeCatalogue\(catalogue, key\.trim\(\)\)/);
  });

  test('the background refresh is applied after the service commits', () => {
    const listener = ipc.slice(ipc.indexOf('setOnUpdated('), ipc.indexOf('setOnUpdated(') + 900);
    assert.match(listener, /provider === 'opencode'/);
    assert.match(listener, /discoverOpencodeModels\(\)/);
  });
});
