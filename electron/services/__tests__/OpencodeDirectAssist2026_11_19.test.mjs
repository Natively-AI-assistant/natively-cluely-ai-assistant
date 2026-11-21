/**
 * Direct Assist knows OpenCode.
 *
 * Direct Assist is the opt-in single-provider answer path: it classifies the
 * selected id itself, decides whether the model may receive an image, and has
 * its own dispatch switch. `DIRECT_ASSIST_PROVIDERS` has no exhaustiveness test
 * in this codebase (recorded as a risk in the 9Router design), so a missing arm
 * fails silently by default — every assertion below exists because of that.
 *
 * Run: node --test electron/services/__tests__/OpencodeDirectAssist2026_11_19.test.mjs
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
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);

const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: {
    app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    safeStorage: { isEncryptionAvailable: () => false },
  },
};

const { LLMHelper } = require(dist('LLMHelper.js'));
const { DIRECT_ASSIST_PROVIDERS } = require(dist('direct-assist/types.js'));
const src = fs.readFileSync(path.join(__dirname, '../../../electron/LLMHelper.ts'), 'utf8');

describe('classification', () => {
  test('opencode is a Direct Assist provider', () => {
    assert.ok(DIRECT_ASSIST_PROVIDERS.includes('opencode'));
  });

  test('an OpenCode id classifies as OpenCode, not the vendor inside it', () => {
    const h = Object.create(LLMHelper.prototype);
    h._groqLocalDisabled = false;
    for (const id of ['opencode/claude-sonnet-5', 'opencode/gpt-6.1-sol', 'opencode/gemini-3.8-flash']) {
      assert.deepEqual(h.classifyCloudModel(id), { provider: 'opencode', model: id });
    }
  });

  test('the credential gate reports the route, and its absence', () => {
    const h = Object.create(LLMHelper.prototype);
    h.opencodeApiKey = 'oc_sk_test';
    h._opencodeOpenAIClient = {};
    h._opencodeAnthropicClient = {};
    h.isProviderDisabled = () => false;
    assert.equal(h.directProviderHasCredential('opencode'), true);

    h._opencodeOpenAIClient = null;
    h._opencodeAnthropicClient = null;
    assert.equal(h.directProviderHasCredential('opencode'), false);
  });

  test('a catalogue "no" refuses an image, an unknown forwards it', () => {
    const h = Object.create(LLMHelper.prototype);
    h.visionFacts = (selection) => ({
      providerReportsVision: (p, m) => (m === 'opencode/glm-5.3' ? false : undefined),
      testedVision: () => undefined,
      overriddenVision: () => undefined,
    });
    const selection = (model) => ({ provider: 'opencode', model });
    assert.equal(h.directSelectionSupportsImages(selection('opencode/glm-5.3'), null, null), false);
    assert.equal(h.directSelectionSupportsImages(selection('opencode/kimi-k3'), null, null), true);
  });
});

describe('wiring', () => {
  test('the dispatch switch has an OpenCode arm that uses the streamer', () => {
    assert.match(src, /case 'opencode':[\s\S]{0,500}this\.streamWithOpencode\(/);
  });

  test('the one-time image test can ask OpenCode', () => {
    const start = src.indexOf('private static readonly VISION_TESTABLE');
    assert.notEqual(start, -1, 'VISION_TESTABLE declaration not found');
    const block = src.slice(start, src.indexOf(');', start));
    assert.match(block, /'opencode'/);
  });

  test('the fallback ladder can rescue an OpenCode-only profile', () => {
    const block = src.slice(src.indexOf('private directFallbackCandidates'));
    assert.match(block.slice(0, 1600), /provider: 'opencode'/);
  });

  test('the vision chain seats OpenCode only for the selected model', () => {
    assert.match(src, /isOpencodeModel\(this\.currentModelId\) && this\.hasOpencodeCredential\(\)[\s\S]{0,200}opencodeModelSupportsVision/);
  });
});
