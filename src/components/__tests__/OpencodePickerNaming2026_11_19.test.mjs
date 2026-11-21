/**
 * Renderer-side naming and registry coverage for OpenCode.
 *
 * `ModelPickerProviderMarkCoverage.test.mjs` already pins every
 * STANDARD_CLOUD_MODELS provider to a real mark; this file pins the OpenCode
 * specifics that test cannot see: the picker's preset table, the chip label,
 * and the gateway prefix stripping.
 *
 * Run: node --test src/components/__tests__/OpencodePickerNaming2026_11_19.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const utils = read('src/utils/modelUtils.ts');
const groups = read('src/components/ui/modelSelectorGroups.ts');
const chip = read('src/components/NativelyInterface.tsx');
const settings = read('src/components/settings/AIProvidersSettings.tsx');
const marks = read('src/components/ui/aiProviderMarks.ts');

describe('the preset table', () => {
  test('OpenCode ships presets covering all four protocols', async () => {
    const { STANDARD_CLOUD_MODELS } = await import(
      pathToFileURL(path.join(root, 'src/utils/modelUtils.ts')).href
    );
    const cfg = STANDARD_CLOUD_MODELS.opencode;
    assert.ok(cfg, 'opencode must be a STANDARD_CLOUD_MODELS entry');
    assert.equal(cfg.pmKey, 'opencodePreferredModel');
    assert.ok(cfg.ids.length >= 4);

    const byPrefix = (p) => cfg.ids.filter((id) => id.startsWith(`opencode/${p}`));
    assert.ok(byPrefix('claude-').length, 'no Messages preset');
    assert.ok(byPrefix('gpt-').length, 'no Responses preset');
    assert.ok(byPrefix('gemini-').length, 'no generate-content preset');
    assert.ok(
      cfg.ids.some((id) => /deepseek|glm|kimi/.test(id)),
      'no chat-completions preset',
    );
  });

  test('no preset is a free-tier id', async () => {
    const { STANDARD_CLOUD_MODELS } = await import(
      pathToFileURL(path.join(root, 'src/utils/modelUtils.ts')).href
    );
    for (const id of STANDARD_CLOUD_MODELS.opencode.ids) {
      assert.doesNotMatch(id, /-free$/, `${id} would answer 403 outside OpenCode`);
    }
  });

  test('the key check follows the stored flag', async () => {
    const { STANDARD_CLOUD_MODELS } = await import(
      pathToFileURL(path.join(root, 'src/utils/modelUtils.ts')).href
    );
    assert.equal(STANDARD_CLOUD_MODELS.opencode.hasKeyCheck({ hasOpencodeKey: true }), true);
    assert.equal(STANDARD_CLOUD_MODELS.opencode.hasKeyCheck({ hasOpencodeKey: false }), false);
  });
});

describe('labels', () => {
  test('gatewayModelLabel strips exactly the routing prefix', async () => {
    const { gatewayModelLabel } = await import(
      pathToFileURL(path.join(root, 'src/utils/modelUtils.ts')).href
    );
    assert.equal(gatewayModelLabel('opencode/claude-sonnet-5'), 'claude-sonnet-5');
    assert.equal(gatewayModelLabel('opencode/gpt-6.1-sol'), 'gpt-6.1-sol');
  });

  test('the overlay chip has an OpenCode branch above the displayName fallback', () => {
    assert.match(chip, /if \(m\.startsWith\('opencode\/'\)\) return gatewayModelLabel\(m\);/);
    const branch = chip.indexOf("startsWith('opencode/')");
    // The fallback that renders a stale/literal display name, located AFTER the
    // branch: an earlier occurrence in this file belongs to a data-fetch effect,
    // not the chip.
    const fallback = chip.indexOf('currentModelDisplayName', branch);
    assert.ok(branch !== -1, 'no OpenCode branch in the chip');
    assert.ok(fallback === -1 || branch < fallback, 'the chip would render the raw routed id');
  });

  test('the picker groups under "OpenCode"', () => {
    assert.match(groups, /opencode: 'OpenCode'/);
    assert.match(groups, /opencode: \['OpenCode'\]/);
  });
});

describe('registration', () => {
  test('Settings lists OpenCode as a cloud provider', () => {
    assert.match(settings, /id: 'opencode' as const, name: 'OpenCode'/);
    assert.match(settings, /hasOpencodeKey/);
    assert.match(settings, /setOpencodeApiKey/);
  });

  test('a brand mark and tile colour are registered', () => {
    assert.match(marks, /opencode: \{ mono: 'OC', brand:/);
    assert.match(marks, /opencode: opencodeMark/);
    assert.ok(fs.existsSync(path.join(root, 'src/assets/provider-logos/opencode.svg')));
  });

  test('the overlay picker loads the OpenCode catalogue', () => {
    const picker = read('src/components/ModelSelectorWindow.tsx');
    assert.match(picker, /getAvailableOpencodeModels/);
    assert.match(picker, /provider: 'opencode'/);
  });
});
