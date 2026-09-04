/**
 * RerankerHostedProviderCards2026_09_03.test.mjs
 *
 * The bug this exists for: the main process grew a second hosted reranker
 * provider (Jina, whose only reason to exist is jina-reranker-v3.5 — a model
 * that cannot run on this device at all), the IPC surface was made fully
 * provider-generic, twelve tests passed against it... and the settings panel
 * still rendered exactly ONE hardcoded card, for OpenRouter. There was no
 * field anywhere in the app in which to type a Jina key, so `hasApiKey` was
 * false forever, so the Jina models never appeared in the Active Reranker
 * selector, so the model stayed unusable. Every test in the repo was green.
 *
 * So this pins the renderer end of the chain, which is the end that broke:
 * the panel must render its hosted cards FROM the discovered provider list
 * rather than from a literal, and it must write keys through the generic
 * channel. There is no DOM harness in this repo (no jsdom, no
 * testing-library), so this reads the source — the same technique
 * ModelPickerProviderMarkCoverage uses for the same reason.
 *
 * Run: `node --test src/components/__tests__/RerankerHostedProviderCards2026_09_03.test.mjs`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const PANEL = join(REPO_ROOT, 'src/components/settings/RerankerSettings.tsx');
const PROVIDERS = join(REPO_ROOT, 'electron/rag/hostedRerankProviders.ts');
const PRELOAD = join(REPO_ROOT, 'electron/preload.ts');

const MARKS = join(REPO_ROOT, 'src/components/ui/aiProviderMarks.ts');
const panel = readFileSync(PANEL, 'utf8');
const marks = readFileSync(MARKS, 'utf8');
const providers = readFileSync(PROVIDERS, 'utf8');
const preload = readFileSync(PRELOAD, 'utf8');

/** Provider ids the main process advertises, read from the table itself. */
function advertisedProviderIds() {
  // Each entry is `<id>: { id: '<id>', ...`. Keyed on the inner literal so a
  // renamed record key alone cannot drift this list.
  return [...providers.matchAll(/\bid:\s*'([a-z0-9-]+)'\s*,\s*\n?\s*(?:name|baseUrl)/g)].map(m => m[1]);
}

test('the main process advertises more than one hosted provider', () => {
  // If this ever drops back to one, the rest of this file is still correct but
  // stops being load-bearing — and the panel could quietly re-hardcode.
  const ids = advertisedProviderIds();
  assert.ok(ids.includes('openrouter'), `expected openrouter, got ${ids.join(', ')}`);
  assert.ok(ids.includes('jina'), `expected jina, got ${ids.join(', ')}`);
});

test('the panel renders one card per DISCOVERED provider, not per literal', () => {
  // The substance: cards come from the list, so a provider added to the table
  // gets a card without touching this file.
  assert.match(panel, /hostedProviders\.map\(/,
    'the hosted cards must be mapped from the discovered provider list');
  // And the old hardcoded mark must be gone. `provider="openrouter"` as a JSX
  // literal is exactly what pinned the panel to one provider.
  assert.doesNotMatch(panel, /provider="openrouter"/,
    'a literal provider on the card mark means the card is hardcoded again');
});

test('the key field is fed by the provider descriptor, not by an OpenRouter constant', () => {
  // A hardcoded `sk-or-v1-…` placeholder is the tell that one provider owns
  // the field. Both the placeholder and the "Get key" link must come from the
  // descriptor, or Jina's card would send users to OpenRouter's dashboard.
  assert.match(panel, /placeholder=\{[^}]*p\.keyPlaceholder\}/,
    'the placeholder must come from the provider descriptor');
  assert.match(panel, /openExternal\?\.\(p\.keyUrl\)/,
    'the Get Key link must come from the provider descriptor');
  assert.doesNotMatch(panel, /'https:\/\/openrouter\.ai\/keys'\s*\)/,
    'a hardcoded OpenRouter dashboard URL in a per-provider card sends Jina users to the wrong site');
});

test('keys are saved through the provider-generic channel', () => {
  // setRerankerOpenRouterKey writes OpenRouter's credential whatever card you
  // are looking at. Typing a Jina key into it would store it as an OpenRouter
  // key — a silent credential mix-up, not just a dead button.
  assert.match(panel, /setRerankerHostedKey\?\.\(\s*providerId\s*,/,
    'saveKey must pass the provider id to the generic channel');
  assert.doesNotMatch(panel, /setRerankerOpenRouterKey/,
    'the OpenRouter-only key writer must not be reachable from a multi-provider panel');
  // The generic channel has to actually exist on the bridge.
  assert.match(preload, /setRerankerHostedKey:\s*\(provider: string, key: string\)/,
    'preload must expose the generic key channel');
});

test('a static-catalogue provider offers its models before a key is set', () => {
  // Jina's catalogue ships with the app. Listing it only after a key exists
  // would hide the one thing that justifies adding a key at all — you could
  // not see that v3.5 is on offer until you had already paid for a key.
  assert.match(panel, /p\.staticCatalogue\s*\n?\s*\?\s*p\.models\.map/,
    'a static catalogue must be listed from the descriptor');
  assert.match(panel, /\{\(hasKey \|\| models\.length > 0\) &&/,
    'the model list must render on catalogue presence, not only on key presence');
});

test('selecting a hosted model sets BOTH the provider and that provider’s model', () => {
  // Setting jinaModel while provider stayed 'openrouter' would store a
  // selection that never runs. Both branches must carry a provider.
  assert.match(panel, /\{ provider: 'jina', jinaModel: id \}/,
    'the jina branch must set provider and jinaModel together');
  assert.match(panel, /\{ provider: 'openrouter', openrouterModel: id \}/,
    'the openrouter branch must set provider and openrouterModel together');
  // onToggle and onSetDefault are two separate call sites, so matching once is
  // not enough — a bare model write in either of them is the bug.
  assert.doesNotMatch(panel, /\{\s*jinaModel: id\s*\}/,
    'a jinaModel write with no provider stores a selection that never runs');
  assert.doesNotMatch(panel, /\{\s*openrouterModel: id\s*\}/,
    'an openrouterModel write with no provider stores a selection that never runs');
});

test('Test Connection is offered only on the provider that is actually selected', () => {
  // reranker:test probes whichever provider is SELECTED — it takes no provider
  // argument. Enabling Test on an unselected card would either probe the wrong
  // provider or require silently switching to it, and silently switching the
  // reranker is the thing this feature must never do.
  assert.match(panel, /disabled=\{testing \|\| !isSelected \|\| !selectedModel\}/,
    'Test must be disabled unless this provider is the selected one');
});

test('losing provider discovery degrades to a card, never to nothing', () => {
  // hostedProviders is the ONLY source of hosted cards now. An empty list
  // renders no key field at all, which is precisely the state that made v3.5
  // unreachable — so a failed lookup must still leave one usable card.
  const fn = panel.slice(panel.indexOf('const loadHostedProviders'));
  const body = fn.slice(0, fn.indexOf('}, []);'));
  assert.match(body, /catch/, 'a rejected lookup must not leave the panel card-less');
  assert.match(body, /setHostedProviders\(cur => \(cur\.length \? cur :/,
    'the fallback must not clobber a list that already loaded');
});

test('every hosted provider has a real brand mark, not a monogram', () => {
  // AipProviderMark falls back to a two-letter monogram when a provider has no
  // vendored logo, and the fallback is silent — Jina's card shipped a "JI" tile
  // that read as a placeholder next to OpenRouter's real mark. A provider added
  // to the table with no mark should fail here rather than on screen.
  for (const id of advertisedProviderIds()) {
    assert.match(marks, new RegExp(`\\b${id}: \\w+Mark,`),
      `${id} has no entry in AI_PROVIDER_MARKS, so its card renders a monogram`);
    assert.match(marks, new RegExp(`${id}:\\s*\\{ mono: '[A-Z]{2}', brand: '#[0-9A-Fa-f]{6}' \\}`),
      `${id} needs an AI_PROVIDER_BRANDS entry — brand drives the tile wash`);
  }
});

test('a vendored mark paints currentColor, so it survives both themes', () => {
  // .aip-tile--mark paints var(--aip-btn-bg), which follows the theme. A mark
  // with a hardcoded fill at either extreme is unreadable in one of them — the
  // reason the OpenRouter and Voyage marks take the monochrome variant.
  const svg = readFileSync(join(REPO_ROOT, 'src/assets/provider-logos/jina.svg'), 'utf8');
  assert.match(svg, /fill="currentColor"/,
    'a hardcoded fill would vanish against one of the two tile backgrounds');
  assert.doesNotMatch(svg, /<script|<foreignObject|xlink:href|href="http/i,
    'this is inlined with dangerouslySetInnerHTML — vector paths only');
});
