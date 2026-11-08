/**
 * ModelPickerIgnoresFetchedCatalogue2026_10_14.test.mjs
 *
 * PR 627 put each provider's fetched catalogue into the meeting-overlay picker,
 * and the catalogue now refreshes by itself on key save and at launch. Two
 * routes each flooded the picker:
 *
 *   - outside the opt-in gateways an EMPTY allow-list means "no filter", so a
 *     saved NVIDIA key put NVIDIA's whole catalogue (80 ids on 2026-10-14, from
 *     a placeholder key: /v1/models answers 200 to any key) into the picker;
 *   - narrowing to "only what the user ticked" did not help: Settings shows an
 *     empty list as every model ticked, so un-ticking ONE model saves the other
 *     79 explicitly. Measured in the running app: the picker went to 87 rows.
 *
 * Until Settings has a real "none ticked" state for these providers, the picker
 * stays as it was: presets, narrowed by the allow-list, plus the default model.
 * A model from the fetched list reaches the picker through "Set default".
 *
 * ONE exception (2026-10-28): LIVE_CATALOGUE_PROVIDERS, today AgentRouter
 * alone. Its catalogue is three models scoped to the key, so it cannot flood,
 * and it retired three of its four presets within a month, so presets alone
 * offered models that 503. The fetched list reaches the picker ONLY through
 * cloudModelRows(), which ignores it for every other provider.
 *
 * Run: node --test src/components/__tests__/ModelPickerIgnoresFetchedCatalogue2026_10_14.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const picker = readFileSync(join(ROOT, 'src/components/ModelSelectorWindow.tsx'), 'utf8');

const utils = readFileSync(join(ROOT, 'src/utils/modelUtils.ts'), 'utf8');

test('the overlay picker reads the fetched catalogue only through cloudModelRows', () => {
  assert.doesNotMatch(picker, /cloudFetchedModels/);
  // One read, and the only consumer of what it returns is cloudModelRows.
  assert.equal((picker.match(/getCloudFetchedModels/g) || []).length, 1);
  assert.equal((picker.match(/liveCatalogues/g) || []).length, 2, 'declared once, passed to cloudModelRows once');
  assert.match(picker, /cloudModelRows\(prov, liveCatalogues\)/);
});

test('only AgentRouter follows its fetched catalogue; every other provider keeps its presets', () => {
  assert.match(utils, /export const LIVE_CATALOGUE_PROVIDERS: ReadonlySet<string> = new Set\(\['agentrouter'\]\);/);
  const fn = utils.slice(utils.indexOf('export const cloudModelRows'), utils.indexOf('\n};\n', utils.indexOf('export const cloudModelRows')));
  assert.match(fn, /LIVE_CATALOGUE_PROVIDERS\.has\(provider\)/, 'the fetched list is gated on the set');
  assert.match(fn, /if \(!live\.length\) return presets;/, 'no catalogue yet: presets');
});

test('its cloud rows are those rows plus the default model', () => {
  assert.match(picker, /const rows = cloudModelRows\(prov, liveCatalogues\);\s*rows\.forEach\(\(\{ id, name \}\) => \{\s*models\.push\(\{ id, name, type: 'cloud', provider: prov \}\);/);
  assert.match(picker, /const pm = creds\?\.\[cfg\.pmKey\];\s*if \(pm && !rows\.some\(r => r\.id === pm\)\)/);
});
