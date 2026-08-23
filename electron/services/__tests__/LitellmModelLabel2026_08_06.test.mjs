// The display label for LiteLLM-proxied models.
//
// LiteLLM ids carry TWO prefixes, and the overlay chip was rendering both:
// `litellm/openai/gpt-4o`. The first is Natively's routing prefix (load-bearing
// in the ID — providerFamily()/modelAvailable() key off it), the second is the
// proxy's own `<upstream>/<model>` naming. Neither is identity, so the label is
// the last segment.
//
// The helper is imported for REAL (node ≥22.6 strips the types), not asserted
// as source text: this is a pure function and its edge cases — bare vs prefixed
// input, dotted ids, degenerate slashes — are exactly what a regex-on-source
// test would wave through.
//
// Run via: node --test electron/services/__tests__/LitellmModelLabel2026_08_06.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const { litellmModelLabel, prettifyModelId } = await import(
  path.join(root, 'src/utils/modelUtils.ts')
);

describe('litellmModelLabel', () => {
  test('strips our routing prefix AND the proxy upstream, leaving the model name', () => {
    assert.equal(litellmModelLabel('litellm/openai/gpt-4o'), 'gpt-4o');
    assert.equal(litellmModelLabel('litellm/anthropic/claude-3-5-sonnet'), 'claude-3-5-sonnet');
    assert.equal(litellmModelLabel('litellm/bedrock/anthropic.claude-v2'), 'anthropic.claude-v2');
  });

  test('handles a proxy model with no upstream segment', () => {
    assert.equal(litellmModelLabel('litellm/gpt-4o'), 'gpt-4o');
  });

  test('accepts BARE ids too — the discovery cache holds them unprefixed', () => {
    // getAvailableLiteLLMModels() returns the proxy's ids verbatim, while the
    // picker holds `litellm/<id>`. Both call this, so both forms must work.
    assert.equal(litellmModelLabel('openai/gpt-4o'), 'gpt-4o');
    assert.equal(litellmModelLabel('gpt-4o'), 'gpt-4o');
  });

  test('deeper nesting still yields the final segment', () => {
    assert.equal(litellmModelLabel('litellm/vertex_ai/publishers/google/gemini-pro'), 'gemini-pro');
  });

  test('does not mangle the id the way prettifyModelId does', () => {
    // The bug this replaced: prettify is built for OUR hyphenated ids and turns
    // a proxy literal into "Bedrock/Anthropic.Claude V2".
    assert.equal(prettifyModelId('bedrock/anthropic.claude-v2'), 'Bedrock/Anthropic.Claude V2');
    assert.equal(litellmModelLabel('bedrock/anthropic.claude-v2'), 'anthropic.claude-v2');
    // Case and punctuation are preserved exactly — it is a literal, not prose.
    assert.equal(litellmModelLabel('litellm/openai/GPT-4o_Turbo'), 'GPT-4o_Turbo');
  });

  test('degenerate ids never produce a blank label', () => {
    assert.equal(litellmModelLabel(''), '');
    assert.equal(litellmModelLabel('litellm/'), 'litellm/');
    assert.equal(litellmModelLabel('///'), '///');
    assert.equal(litellmModelLabel('litellm/openai/'), 'openai');
  });

  test('a non-litellm id passed in is returned as its last segment, never crashed on', () => {
    assert.equal(litellmModelLabel('gemini-3.6-flash'), 'gemini-3.6-flash');
  });
});

describe('litellmModelLabel is wired into every surface that shows a LiteLLM model', () => {
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

  test('the overlay chip formats LiteLLM ids ABOVE the displayName fallback', () => {
    const src = read('src/components/NativelyInterface.tsx');
    assert.match(src, /litellmModelLabel/, 'the chip should use the shared helper');
    const chipBranch = src.indexOf("if (m.startsWith('litellm/')) return litellmModelLabel(m)");
    const displayNameBranch = src.indexOf('if (currentModelDisplayName && currentModelDisplayName !== m)');
    assert.ok(chipBranch !== -1, 'the chip needs an explicit litellm branch');
    assert.ok(displayNameBranch !== -1, 'the displayName fallback should still exist');
    // Order is the whole point: getCurrentModelDisplayName() returns the raw
    // currentModelId for LiteLLM, so a later branch would never be reached.
    assert.ok(
      chipBranch < displayNameBranch,
      'the litellm branch must precede the displayName fallback or the raw id wins',
    );
  });

  test('the model selector window labels with the bare name', () => {
    const src = read('src/components/ModelSelectorWindow.tsx');
    assert.match(src, /litellmModelLabel\(m\)\} \(LiteLLM\)/, 'selector should show the bare model name');
    assert.doesNotMatch(src, /name: `\$\{m\} \(LiteLLM\)`/, 'the raw-id label must be gone');
  });

  test('settings labels LiteLLM rows without prettifyModelId', () => {
    const src = read('src/components/settings/AIProvidersSettings.tsx');
    assert.match(
      src,
      /litellmModels\.forEach\(m => push\(`litellm\/\$\{m\}`, litellmModelLabel\(m\)\)\)/,
      'the model list should use the segment label',
    );
    assert.match(
      src,
      /provider === 'litellm' \? litellmModelLabel\(id\) : prettifyModelId\(id\)/,
      'allow-listed ids with no catalog entry need the same treatment',
    );
    assert.match(
      src,
      /\$\{litellmModelLabel\(model\)\} \(LiteLLM\)/,
      'the active-model options should use it too',
    );
    assert.doesNotMatch(src, /prettifyModelId\(m\)\)\);/, 'no prettify on litellm catalogue ids');
  });

  test('the ID keeps its litellm/ prefix — only the LABEL changes', () => {
    // Regression guard for the tempting wrong fix: stripping the prefix from the
    // id itself would break providerFamily()/modelAvailable() routing and the
    // allow-list, which are all keyed on `litellm/<model>`.
    const settings = read('src/components/settings/AIProvidersSettings.tsx');
    const selector = read('src/components/ModelSelectorWindow.tsx');
    assert.match(settings, /const id = `litellm\/\$\{model\}`/, 'settings must still build prefixed ids');
    assert.match(selector, /id: `litellm\/\$\{m\}`/, 'the selector must still emit prefixed ids');
  });
});
