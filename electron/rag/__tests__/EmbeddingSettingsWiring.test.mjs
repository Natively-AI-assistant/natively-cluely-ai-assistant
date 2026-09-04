// electron/rag/__tests__/EmbeddingSettingsWiring.test.mjs
//
// The Embeddings settings panel spans renderer → preload → IPC → main. Each hop
// is a place the panel can come silently unhooked: a missing preload binding or
// an unregistered channel produces an empty panel, not an error.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(path.resolve(__dirname, '../../..', f), 'utf8');

const CHANNELS = [
  'embedding:get-status',
  'embedding:get-catalog',
  'embedding:test',
  'embedding:set-config',
  'embedding:fetch-models',
  'embedding:set-openrouter-key',
  'embedding:set-voyage-key',
  'embedding:set-custom-endpoint',
  'embedding:acknowledge-lightweight',
];

const API_METHODS = [
  'getEmbeddingStatus',
  'getEmbeddingCatalog',
  'testEmbeddingModel',
  'setEmbeddingConfig',
  'fetchEmbeddingModels',
  'setEmbeddingOpenRouterKey',
  'setEmbeddingVoyageKey',
  'setEmbeddingCustomEndpoint',
  'acknowledgeLightweightEmbeddings',
];

describe('main process', () => {
  test('every embedding channel is registered', () => {
    const src = read('electron/ipcHandlers.ts');
    for (const ch of CHANNELS) {
      assert.match(src, new RegExp(`safeHandle\\('${ch.replace(/[:]/g, '[:]')}'`), `${ch} is not registered`);
    }
  });

  test('the status handler reports the RESOLVED provider, not the configured one', () => {
    // They differ whenever a chosen provider was unavailable and the chain fell
    // through — which is exactly the case a user needs the panel to reveal.
    const src = read('electron/ipcHandlers.ts');
    assert.match(src, /getActiveProviderDescription/);
  });

  test('set-config measures a chosen Ollama model rather than trusting the UI', () => {
    const src = read('electron/ipcHandlers.ts');
    assert.match(src, /probeOllamaEmbeddingDimensions/);
    assert.match(src, /dimensions_unmeasurable/);
  });
});

describe('preload bridge', () => {
  test('every method is both typed and bound', () => {
    const src = read('electron/preload.ts');
    for (const m of API_METHODS) {
      // Typed on the interface AND wired to ipcRenderer.invoke — a type without
      // a binding is undefined at runtime with no error.
      assert.match(src, new RegExp(`${m}:\\s*\\(`), `${m} is not declared`);
      assert.match(src, new RegExp(`${m}: \\([^)]*\\) => ipcRenderer\\.invoke\\('embedding:`), `${m} is not bound to a channel`);
    }
  });

  test('the renderer type declaration matches', () => {
    const src = read('src/types/electron.d.ts');
    for (const m of API_METHODS) assert.match(src, new RegExp(`${m}:`), `${m} missing from ElectronAPI`);
  });
});

describe('settings shell', () => {
  test('the tab is registered in the nav order so its transition direction is known', () => {
    const src = read('src/components/SettingsOverlay.tsx');
    const order = src.slice(src.indexOf('const SETTINGS_NAV_ORDER'), src.indexOf('const SETTINGS_NAV_ORDER') + 400);
    assert.match(order, /'embedding'/);
  });

  test('the nav button and the panel are both present', () => {
    const src = read('src/components/SettingsOverlay.tsx');
    assert.match(src, /setActiveTab\('embedding'\)/, 'no nav button');
    assert.match(src, /activeTab === 'embedding' && \(\s*<EmbeddingSettings /, 'panel not mounted');
    assert.match(src, /import \{ EmbeddingSettings \}/, 'component not imported');
  });
});

describe('panel behaviour', () => {
  const panel = () => read('src/components/settings/EmbeddingSettings.tsx');

  test('the lightweight indicator comes from the resolved space, not a name check', () => {
    // A model-name test would nag an Ollama user on nomic-embed-text about a
    // problem they do not have, and miss a MiniLM reached by another route.
    const src = panel();
    assert.match(src, /active\.lightweight/);
    assert.doesNotMatch(src, /includes\(['"]minilm['"]\)/i, 'the panel must not re-derive lightweight from a model name');
  });

  test('the lightweight notice is dismissible and the dismissal is persisted', () => {
    // §5: do NOT block the user, and make the dismissal actually stick.
    // Asserts the BEHAVIOUR, not the button copy: the notice must be gated on
    // the stored acknowledgement, and dismissing must persist it. Pinning the
    // exact words makes a copy edit look like a regression.
    const src = panel();
    assert.match(src, /acknowledgeLightweightEmbeddings\?\.\(true\)/, 'dismissal must persist');
    assert.match(src, /!acknowledged/, 'the notice must respect the stored acknowledgement');
    assert.match(src, /setAcknowledged\(true\)/, 'dismissing must also update the view');
  });

  test('a model change tells the user a re-index follows', () => {
    assert.match(panel(), /reindexRequired/);
  });

  test('an unavailable provider is listed but inert, and says why', () => {
    // Omitting it entirely would leave the user unable to tell "Natively does
    // not support this" from "you have not added a key".
    const src = panel();
    assert.match(src, /data-off=\{p\.available \? undefined : 'true'\}/);
    // Selection is guarded at the handler: an unavailable provider, and the
    // managed one (whose model the server pins), cannot be selected.
    assert.match(src, /onToggle=\{\(id\) => \{ if \(!p\.managed && p\.available\)/);
    assert.match(src, /onSetDefault=\{\(id\) => \{ if \(!p\.managed && p\.available\)/);
    assert.match(src, /blocked_by_policy/, 'a policy block must be explained');
    assert.match(src, /no_key/, 'a missing key must be explained');
  });

  test('the managed provider offers no model choice it cannot honour', () => {
    // Natively pins the model server-side; a selectable list would be a promise
    // the client cannot keep.
    assert.match(panel(), /p\.managed/);
  });

  test('a provider-declared width is never presented as measured', () => {
    assert.match(panel(), /m\.dimensionsVerified \? '' :/);
  });

  test('models are shown through AipModelList, the same control AI Providers uses', () => {
    // Not a hand-rolled row list: the shared component owns the collapsed
    // "Models — <default> · default — n / N" summary, the reveal, keyboard
    // handling and the check-reveal animation.
    const src = panel();
    assert.match(src, /<AipModelList/);
    assert.match(src, /optIn/, 'exactly one model is active, so [] means "not this provider"');
  });

  test('Test leads the action row, as in ProviderCard', () => {
    const src = panel();
    assert.match(src, /Test Connection/);
    const row = src.indexOf('Action row');
    assert.ok(row !== -1, 'the action row should be named for what it is');
  });

  test('a declared model width is labelled as reported, never as measured', () => {
    // model_info embedding_length is the hidden size and is not always the real
    // output width — presenting it as measured would be a lie the space key
    // depends on.
    assert.match(panel(), /dimensionsVerified/);
  });

  test('no unverified comparative performance claim is shown', () => {
    // §18: benchmark numbers only after measuring on Natively's own workload.
    assert.doesNotMatch(panel(), /\d+\s*%\s*(better|faster|more accurate)/i);
  });
});

describe('cross-panel notice', () => {
  test('AI Providers surfaces the warning and can deep-link to the panel', () => {
    const src = read('src/components/settings/AIProvidersSettings.tsx');
    assert.match(src, /LightweightEmbeddingNotice/);
    assert.match(src, /onNavigate\('embedding'\)/);
  });

  test('the notice asks the main process rather than re-deriving the predicate', () => {
    const src = read('src/components/settings/AIProvidersSettings.tsx');
    assert.match(src, /s\?\.shouldWarn/);
  });
});

describe('design language', () => {
  const panel = () => read('src/components/settings/EmbeddingSettings.tsx');

  test('the panel is scoped to .aip-root and carries the sheet with it', () => {
    // Settings mounts one tab at a time, so on this tab AIProvidersSettings —
    // and therefore its <style> — is not in the DOM. Without AIP_CSS travelling
    // with the panel every .aip-* class silently resolves to nothing and the
    // panel renders unstyled. Same reason LocalWhisperModelPanel imports it.
    const src = panel();
    assert.match(src, /className="aip-root/);
    assert.match(src, /import \{[^}]*AIP_CSS/);
    assert.match(src, /<style>\{AIP_CSS\}<\/style>/);
    assert.match(src, /data-theme=\{aipTheme\}/, 'the token scope needs the resolved theme');
  });

  test('the sheet is the LAST child, or it eats the first card\'s margin', () => {
    // As a first child it satisfies the `space-*` sibling selector and pushes
    // margin onto the real first card.
    const src = panel();
    const styleAt = src.indexOf('<style>{AIP_CSS}</style>');
    const firstCard = src.indexOf('className="aip-card');
    assert.ok(styleAt > firstCard, 'AIP_CSS must come after the cards');
  });

  test('status colour comes only from AipBadge', () => {
    // AI Providers collapses every status colour into one primitive; a second
    // colour vocabulary in the same visual language is what made it necessary.
    const src = panel();
    assert.match(src, /AipBadge/);
    assert.doesNotMatch(src, /(border|bg|text)-(amber|red|green|emerald|yellow)-\d/, 'no ad-hoc status colours');
    assert.doesNotMatch(src, /style=\{\{[^}]*color:/, 'status colour belongs to AipBadge, not inline styles');
  });

  test('colour comes from --aip-* tokens, not generic settings tokens', () => {
    const src = panel();
    assert.doesNotMatch(src, /bg-bg-item-surface|border-border-subtle|text-text-secondary/, 'use var(--aip-*) inside .aip-root');
  });

  test('pressable controls reuse .aip-btn, which owns hover and press feedback', () => {
    // .aip-btn:active applies scale(0.975) with the panel's shared ease-out and
    // press duration. A hand-rolled button would silently lose that.
    const src = panel();
    assert.match(src, /className="aip-btn/);
  });

  test('cards are composed like ProviderCard, not invented', () => {
    const src = panel();
    assert.match(src, /className="aip-card aip-provider"/);
    assert.match(src, /className="aip-provider-head"/);
    assert.match(src, /<AipProviderMark/, 'a provider card leads with its mark');
    assert.match(src, /className="aip-card-title/, 'the title is the provider NAME');
  });

  test('no mb-* margins, which stack against the card padding into a dead band', () => {
    // The exact defect the AI Providers redesign called out: a trailing mb-3
    // against p-5 produced the largest block of nothing in the card.
    // mb-0 is exempt: it is the RESET that AI Providers' own "Active Model"
    // card carries on its label. The defect is a positive bottom margin.
    assert.doesNotMatch(panel(), /className="[^"]*\bmb-[1-9]/);
  });

  test('button variants come from data-attributes, not inline styles', () => {
    // .aip-btn[data-variant='accent'] already IS the selected treatment; an
    // inline style re-implements it and drifts from the sheet.
    const src = panel();
    assert.doesNotMatch(src, /style=\{\{[^}]*--aip-accent/, 'use data-variant, not inline accent styles');
  });
});

test('any .aip-reveal used carries data-open, or it renders at zero height', () => {
  // .aip-reveal is grid-template-rows:0fr until data-open="true", and needs its
  // inner `> div` (which owns overflow:hidden). Used without data-open, the
  // content mounts COLLAPSED — it type-checks and tests green while the section
  // silently renders empty. The panel does not currently use it; this guard
  // exists so re-introducing one cannot reintroduce the trap.
  const src = readFileSync(path.resolve(__dirname, '../../..', 'src/components/settings/EmbeddingSettings.tsx'), 'utf8');
  const i = src.indexOf('className="aip-reveal"');
  if (i === -1) return; // not used — nothing to guard
  assert.match(src.slice(i, i + 120), /data-open=/, 'aip-reveal must be driven by data-open');
  assert.match(src.slice(i, i + 200), /data-open=\{[^}]*\}>\s*<div>/, 'aip-reveal needs its inner > div wrapper');
});

describe('active model selector', () => {
  const panel = () => read('src/components/settings/EmbeddingSettings.tsx');

  test('there is one selector that both states and sets the active model', () => {
    // Mirrors the "Active Model" card at the top of AI Providers. Without it the
    // answer to "what is embedding my project" is a ticked row buried among six
    // provider cards.
    const src = panel();
    assert.match(src, /Active Embedding Model/);
    // The redesign uses its own floating EmbeddingModelSelect rather than the
    // shared AipSelect (whose menu is an in-flow reveal that would grow the card).
    assert.match(src, /<EmbeddingModelSelect/);
    assert.match(src, /activeOptions/);
  });

  test('the closed trigger shows the model, the open menu shows provider/model', () => {
    // 2026-09-01: options read `${label} — ${provider.name}`, and an OpenRouter
    // label is ALREADY namespaced, so the closed trigger said
    // "voyage/voyage-4-lite — OpenRouter" — three names for one model, with the
    // one a user actually recognises in the middle. Closed is a statement, open
    // is a comparison; only the comparison needs the qualifier.
    const src = panel();
    const i = src.indexOf('const activeOptions');
    assert.notEqual(i, -1);
    const block = src.slice(i, src.indexOf('const activeOptionId', i));
    assert.match(block, /name: qualifiedModelName\(p\.id, m\.label \|\| m\.id\)/,
      'the menu row must be provider-qualified');
    assert.match(block, /triggerName: bareModelName\(m\.label \|\| m\.id\)/,
      'the trigger must be the bare model');
    assert.doesNotMatch(block, /—/, 'the em-dash provider suffix must be gone');

    // And the trigger must actually PREFER the short name; an option type with
    // a field nothing reads would type-check and ship the old label.
    assert.match(src, /selectedOption\.triggerName \|\| selectedOption\.name/);
  });

  test('the qualifier is provider/model — the LAST path segment, not the first', () => {
    // `voyage/voyage-4-lite` must reduce to `voyage-4-lite`, never to `voyage`.
    // Taking [0] type-checks, passes a curated-label case, and silently renames
    // every OpenRouter model to its vendor.
    const src = panel();
    const i = src.indexOf('const bareModelName');
    assert.notEqual(i, -1);
    const block = src.slice(i, src.indexOf('const qualifiedModelName'));
    assert.match(block, /segments\[segments\.length - 1\]/);
    assert.doesNotMatch(block, /segments\[0\]/);
    assert.match(src, /\$\{providerId\}\/\$\{bareModelName\(label\)\}/,
      'the menu name is a provider ID and a bare model, in that order');
  });

  test('an option with no short name still labels its trigger', () => {
    // The same control renders the dimension picker, whose options are plain
    // `{id, name}` widths. A required triggerName would blank that trigger.
    const src = panel();
    assert.match(src, /interface EmbeddingSelectOption \{ id: string; name: string; triggerName\?: string \}/);
  });

  test('an unusable provider cannot be SELECTED, wherever the selector lists it', () => {
    // 2026-08-30: the panel was redesigned and its selector no longer filters on
    // p.available. That filter was the only thing preventing a keyless provider
    // from being chosen, and the resulting failure is silent: the resolver yields
    // no candidate and resolve() falls through to the bundled model, so the user
    // picks Gemini and sees MiniLM.
    //
    // The guarantee now lives on the WRITE PATH instead of in one surface's
    // markup, which is where it should have been — see EmbeddingSelectionGuard.
    const ipc = read('electron/ipcHandlers.ts');
    assert.match(ipc, /validateEmbeddingSelection/);
  });

  test('a selection round-trips through the provider::model id', () => {
    const src = panel();
    assert.match(src, /\$\{p\.id\}::\$\{m\.id\}/, 'options must carry both halves');
    assert.match(src, /id\.split\('::'\)/, 'and the handler must split them back');
    assert.match(src, /rest\.join\('::'\)/, 'a model id may itself contain ::');
  });
});

describe('custom endpoint', () => {
  const panel = () => read('src/components/settings/EmbeddingSettings.tsx');

  test('the endpoint is entered through the same field shell as an API key', () => {
    const src = panel();
    assert.match(src, /className="aip-field"/);
    assert.match(src, /className="aip-input"/);
    assert.match(src, /className="aip-field-seg"/, 'Save is an inset segment, as in ProviderCard');
  });

  test('the Save button is rendered-and-disabled, never conditional', () => {
    // A button that appears on the first keystroke shrinks the input mid-typing
    // and moves a target between aim and click — ProviderCard says so explicitly.
    const src = panel();
    const i = src.indexOf('className="aip-field-seg"');
    assert.notEqual(i, -1);
    assert.match(src.slice(i - 400, i), /disabled=\{endpointSaving\}/);
  });

  test('the endpoint is normalized before it is stored', () => {
    // The space key includes the host, so a bare host and its /v1 form must not
    // produce two different spaces for the same server.
    assert.match(read('electron/ipcHandlers.ts'), /normalizeCustomBaseUrl/);
  });

  test('the optional token is stored in the credential store, not settings.json', () => {
    const ipc = read('electron/ipcHandlers.ts');
    assert.match(ipc, /setCustomEmbeddingApiKey/);
    assert.doesNotMatch(ipc, /settings\.set\('customEmbeddingApiKey'/, 'a token must not land in plaintext settings');
  });

  test('a refused endpoint write does not report success', () => {
    assert.match(read('electron/ipcHandlers.ts'), /settings_store_degraded[\s\S]{0,600}?credential_store_degraded/);
  });
});

describe('built-in mark', () => {
  const panel = () => read('src/components/settings/EmbeddingSettings.tsx');

  test('the bundled provider is marked with the platform it ships on', () => {
    const src = panel();
    assert.match(src, /PlatformMark/);
    assert.match(src, /isMac/);
    assert.match(src, /isWindows/);
  });

  test('it does not use lucide\'s Apple FRUIT glyph', () => {
    // lucide's `Apple` is a piece of fruit and reads as a grocery icon beside
    // vendor logos.
    assert.doesNotMatch(panel(), /<Apple\b/);
  });
});

describe('model discovery', () => {
  const panel = () => read('src/components/settings/EmbeddingSettings.tsx');

  test('cloud providers get a refresh that hits their own list API', () => {
    const src = panel();
    assert.match(src, /onRefresh=\{[\s\S]{0,220}?fetchModels\(p\.id\)/);
  });

  test('discovery fires once on first expand, not on every panel mount', () => {
    // Expanding the list IS the intent to browse; mounting Settings is not.
    const src = panel();
    assert.match(src, /onFirstOpen=\{/);
    assert.match(src, /!hasCatalog\[p\.id\]/, 'a completed attempt must not re-fire');
  });

  test('discovery uses the STORED key, never a typed-but-unsaved one', () => {
    // Same rule as ProviderCard: Save is the only thing that saves.
    const ipc = read('electron/ipcHandlers.ts');
    const i = ipc.indexOf("safeHandle('embedding:fetch-models'");
    assert.notEqual(i, -1);
    const body = ipc.slice(i, i + 900);
    assert.match(body, /getOpenaiApiKey\(\)/);
    assert.match(body, /getGeminiApiKey\(\)/);
  });

  test('an empty discovery is still recorded, so it cannot loop', () => {
    const ipc = read('electron/ipcHandlers.ts');
    const i = ipc.indexOf("safeHandle('embedding:fetch-models'");
    assert.match(ipc.slice(i, i + 900), /fetchedEmbeddingModels\[providerId\] = models/);
  });

  test('the discovered list is cached in memory, never persisted', () => {
    // It is a cache of a remote list; on disk it would outlive a key change.
    const ipc = read('electron/ipcHandlers.ts');
    assert.doesNotMatch(ipc, /settings\.set\('fetchedEmbeddingModels'/);
  });
});

describe('models are hidden without a key', () => {
  test('the catalogue empties a cloud provider that has no key', () => {
    const src = read('electron/rag/embeddingCatalog.ts');
    assert.match(src, /if \(cloudBlocked \|\| !hasKey\) return \[\]/);
  });

  test('the panel only renders the Models control when there ARE models', () => {
    assert.match(panelSrc(), /\{p\.models\.length > 0 && \(/);
  });
});

function panelSrc() {
  return read('src/components/settings/EmbeddingSettings.tsx');
}

describe('cards vs selector', () => {
  const panel = () => read('src/components/settings/EmbeddingSettings.tsx');

  test('Natively and Built-in get NO card — there is nothing to configure', () => {
    // Their cards' only content was a one-item Models list reading
    // "None selected · 1", which is noise: Natively pins its model server-side
    // and Built-in ships with the app.
    //
    // The redesign expresses this as a positive CARD_ORDER allow-list rather
    // than an exclusion filter — same guarantee, and it cannot drift when a new
    // provider is added.
    const src = panel();
    const m = src.match(/CARD_ORDER = \[([^\]]*)\]/);
    assert.ok(m, 'the card list must be explicit');
    assert.ok(!m[1].includes("'natively'"), 'Natively must not get a card');
    assert.ok(!m[1].includes("'local'"), 'Built-in must not get a card');
  });

  test('but BOTH stay selectable in the active model control', () => {
    // Removing the cards must not remove the ability to choose them: the
    // selector builds from the full provider list, never from CARD_ORDER.
    const src = panel();
    const i = src.indexOf('const activeOptions');
    assert.notEqual(i, -1);
    const block = src.slice(i, i + 600);
    assert.match(block, /providers\b/, 'options come from the full catalogue');
    assert.doesNotMatch(block, /CARD_ORDER/, 'the selector must not inherit the card allow-list');
    assert.doesNotMatch(block, /!== 'natively'/);
    assert.doesNotMatch(block, /!== 'local'/);
  });

  test('the lightweight notice and re-index line stay with the ACTIVE model', () => {
    // These describe the model in use, not a provider, so they must not be
    // trapped inside a provider card — two selectable providers have none.
    // (Test Connection did move back per-card in the redesign; that is a
    // deliberate choice and is not asserted here.)
    const src = panel();
    assert.match(src, /acknowledgeLightweightEmbeddings/);
    assert.match(src, /reindexing/);
  });
});

describe('dimension picker', () => {
  const panel = () => read('src/components/settings/EmbeddingSettings.tsx');

  test('it is rendered whenever the provider supports widths, not only while active', () => {
    // It used to be gated on isActiveProvider, so it vanished the moment you
    // switched provider and the row's other controls slid under the cursor.
    // ProviderCard's rule: rendered-and-disabled, never conditionally removed.
    const src = panel();
    // One hoisted flag drives BOTH the picker and the label suffix, so they
    // cannot disagree about which providers have a width control.
    assert.match(src, /const hasWidthPicker = p\.id === 'gemini' \|\| p\.id === 'openai' \|\| p\.id === 'voyage' \|\| p\.id === 'openrouter'/);
    assert.match(src, /\{hasWidthPicker && \(\(\) => \{/);
    const i = src.indexOf('{hasWidthPicker && (() => {');
    const block = src.slice(i, src.indexOf('<AipModelList', i));
    assert.doesNotMatch(block, /if \([^)]*isActiveProvider[^)]*\) return null/,
      'the picker must not be removed when the provider is inactive');
  });

  test('it sits between Test Connection and the models list', () => {
    const src = panel();
    const test = src.indexOf('Test Connection');
    const dims = src.indexOf('{hasWidthPicker && (() => {');
    const models = src.indexOf('<AipModelList');
    assert.ok(test !== -1 && dims !== -1 && models !== -1);
    assert.ok(test < dims, 'Test Connection comes first');
    assert.ok(dims < models, 'the width picker precedes the models list');
  });

  test('it is disabled — not hidden — when the provider cannot act', () => {
    const src = panel();
    const i = src.indexOf('{hasWidthPicker && (() => {');
    const block = src.slice(i, src.indexOf('<AipModelList', i));
    assert.match(block, /disabled=\{[^}]*!p\.available[^}]*\}/);
    assert.match(block, /title=\{hint\}/, 'a disabled control must say why');
  });

  test('a model with a FIXED width offers no fake choice', () => {
    // ada-002 takes no `dimensions` parameter at all, so a one-option picker
    // would imply a choice that does not exist.
    const src = panel();
    const i = src.indexOf('{hasWidthPicker && (() => {');
    const block = src.slice(i, src.indexOf('<AipModelList', i));
    assert.match(block, /fixedWidth/);
  });

  test('only providers that document selectable widths get one', () => {
    // Ollama, the custom endpoint and the bundled model have a width fixed by
    // the model and MEASURED, so a picker there could not do anything.
    const src = panel();
    const i = src.indexOf('Dimensions — between Test');
    assert.notEqual(i, -1, 'the picker should explain which providers it covers');
    const block = src.slice(i, i + 900);
    assert.doesNotMatch(block, /p\.id === 'ollama'/);
    assert.doesNotMatch(block, /p\.id === 'custom'/);
  });
});

describe('the width belongs to a specific model', () => {
  const panel = () => read('src/components/settings/EmbeddingSettings.tsx');
  const block = () => {
    const src = panel();
    const i = src.indexOf('{hasWidthPicker && (() => {');
    return src.slice(i, src.indexOf('<AipModelList', i));
  };

  test('the live width is used ONLY when the target really is the active model', () => {
    // Keyed on isActiveProvider alone, it showed the active model's width against
    // a DIFFERENT model whenever the active one was missing from the list (a stale
    // id, or a refresh that stopped returning it): the target fell back to the
    // recommended model while the number did not follow.
    assert.match(block(), /target\.id === active\.model/);
    assert.match(block(), /showsActiveModel && active\.dimensions/);
  });

  test('otherwise it shows that model\'s OWN default width', () => {
    assert.match(block(), /target\?\.dimensions \?\? 0/);
  });

  test('the control names the model the width applies to', () => {
    // The number alone is ambiguous: when this provider is not the active one the
    // models list reads "None selected", so nothing else on the row says which
    // model the width belongs to.
    assert.match(block(), /Output width for/);
    assert.match(block(), /target\.label \|\| target\.id/);
  });

  test('the options come from that model, not from the provider', () => {
    assert.match(block(), /target\?\.supportedDimensions/);
  });
});

describe('the width picker floats, like the active model selector', () => {
  const panel = () => read('src/components/settings/EmbeddingSettings.tsx');
  const block = () => {
    const src = panel();
    const i = src.indexOf('{hasWidthPicker && (() => {');
    return src.slice(i, src.indexOf('<AipModelList', i));
  };

  test('it uses the floating select, not the in-flow AipSelect', () => {
    // AipSelect opens an IN-FLOW .aip-reveal (grid-rows 0fr -> 1fr), so expanding
    // it grew the card and pushed every row below it down. EmbeddingModelSelect
    // floats the menu (.aip-float + absolute top-full), which is exactly why the
    // Active Model card does not move when opened.
    assert.match(block(), /<EmbeddingModelSelect/);
    assert.doesNotMatch(block(), /<AipSelect/);
  });

  test('the floating select still positions absolutely', () => {
    // The whole fix rests on this; a change to in-flow would silently bring the
    // container growth back.
    const src = panel();
    const i = src.indexOf('const EmbeddingModelSelect');
    const body = src.slice(i, src.indexOf('};', src.indexOf('return (', i)));
    assert.match(body, /aip-float/);
    assert.match(body, /absolute top-full/);
  });

  test('the picker is sized for a width, not a model name', () => {
    assert.match(block(), /containerClassName="relative shrink-0 w-\[\d+px\]"/);
  });
});

describe('the width is stated once', () => {
  const panel = () => read('src/components/settings/EmbeddingSettings.tsx');

  test('a provider WITH a picker does not repeat the width in its model labels', () => {
    // Every row read "model · 3072d · default" beside a picker already showing
    // 3072d.
    // The OpenRouter price branch now sits ahead of it, so anchor on the width
    // condition itself rather than on it being the first thing after `label:`.
    assert.match(panel(), /\(!hasWidthPicker && m\.dimensions > 0\)/);
  });

  test('a provider WITHOUT a picker keeps the width, and the "reported" qualifier', () => {
    // Ollama, the custom endpoint and the bundled model have no picker — their
    // width is fixed by the model and only MEASURED, so the label is the only
    // place it appears, and "reported" is what flags a declared-not-verified
    // width.
    const src = panel();
    assert.match(src, /\$\{m\.dimensions\}d\$\{m\.dimensionsVerified \? '' : ' ' \+ t\('reported'\)\}/);
  });
});

describe('no Lightweight badge', () => {
  const panel = () => read('src/components/settings/EmbeddingSettings.tsx');

  test('MiniLM gets no "Lightweight" badge', () => {
    // AI Providers' own rule: a badge carries only what NO other control already
    // says. The notice below the header states it in words, with the reason and a
    // way to dismiss it, so the badge was a pure echo.
    assert.doesNotMatch(panel(), /label=\{t\('Lightweight'\)\}/);
  });

  test('but the explanation itself survives — it says something nothing else does', () => {
    // Removing the WARNING as well would silently drop the only signal that
    // retrieval quality is degraded.
    const src = panel();
    assert.match(src, /compatibility default/);
    assert.match(src, /acknowledgeLightweightEmbeddings/);
    assert.match(src, /active\.lightweight && !acknowledged/);
  });
});

describe('OpenRouter', () => {
  const panel = () => read('src/components/settings/EmbeddingSettings.tsx');

  test('it gets a card, with its own key field', () => {
    // OpenRouter has no slot in AI Providers (it is reachable there only as a
    // cURL provider), so the embeddings panel owns its key.
    const src = panel();
    assert.match(src, /CARD_ORDER = \[[^\]]*'openrouter'/);
    // Not anchored to being the LAST term — providers get appended over time.
    assert.match(src, /isCloudWithKey = \([^)]*p\.id === 'openrouter'/);
    assert.match(src, /openrouter: 'sk-or-v1/);
    assert.match(src, /openrouter: 'https:\/\/openrouter\.ai\/keys'/);
  });

  test('the key is saved through the embeddings channel, not a chat one', () => {
    assert.match(panel(), /setEmbeddingOpenRouterKey/);
  });

  test('price is shown, because choosing an OpenRouter model IS a price decision', () => {
    // It fronts many vendors at very different rates, and it has no width picker,
    // so the label is the only surface for it.
    assert.match(panel(), /pricePerMillion === 0[\s\S]{0,120}?free/);
  });

  test('its width is MEASURED — the listing carries none', () => {
    const ipc = read('electron/ipcHandlers.ts');
    assert.match(ipc, /probeOpenRouterEmbeddingDimensions/);
    assert.match(ipc, /dimensions_unmeasurable/);
  });

  test('the resolver refuses to guess a width', () => {
    const src = read('electron/rag/EmbeddingProviderResolver.ts');
    assert.match(src, /OpenRouter model '\$\{orModel\}' has no measured dimensions/);
  });

  test('it is scope-gated like every other cloud provider', () => {
    // A paid third-party service; the embeddings privacy scope must gate it.
    assert.match(read('electron/rag/EmbeddingProviderResolver.ts'), /pushScoped\('openrouter_embeddings'/);
  });
});

describe('Voyage AI', () => {
  const panel = () => read('src/components/settings/EmbeddingSettings.tsx');

  test('it gets a card with its own key field', () => {
    // Voyage is embeddings-only here, so AI Providers has no slot for it.
    const src = panel();
    assert.match(src, /CARD_ORDER = \[[^\]]*'voyage'/);
    assert.match(src, /voyage: 'pa-/);
    assert.match(src, /setEmbeddingVoyageKey/);
  });

  test('it gets a width picker — Voyage documents 256/512/1024/2048', () => {
    assert.match(panel(), /hasWidthPicker = [^;]*p\.id === 'voyage'/);
  });

  test('its width is MEASURED even though the catalogue is curated', () => {
    // Voyage has no models endpoint, so the list can go stale; measuring makes
    // the number that matters self-correcting.
    const ipc = read('electron/ipcHandlers.ts');
    assert.match(ipc, /provider === 'voyage'[\s\S]{0,900}?dimensions_unmeasurable/);
  });

  test('the resolver refuses to guess a width', () => {
    assert.match(read('electron/rag/EmbeddingProviderResolver.ts'),
      /Voyage model '\$\{voyModel\}' has no measured dimensions/);
  });

  test('it is scope-gated like every other cloud provider', () => {
    assert.match(read('electron/rag/EmbeddingProviderResolver.ts'), /pushScoped\('voyage_embeddings'/);
  });
});

describe('brand marks', () => {
  const marks = () => read('src/components/ui/aiProviderMarks.ts');

  test('OpenRouter and Voyage render real marks, not monograms', () => {
    const src = marks();
    assert.match(src, /openrouter: openrouterMark/);
    assert.match(src, /voyage: voyageMark/);
  });

  test('both are vendored from the package already in use, under its licence', () => {
    // AGPL requires every shipped asset to be licence-compatible; the README is
    // explicit that a stock-vector download does not qualify. Both come from the
    // same MIT lobehub set the other twelve marks came from.
    const readme = read('src/assets/provider-logos/README.md');
    assert.match(readme, /openrouter\.svg\s+←\s+openrouter\.svg/);
    assert.match(readme, /voyage\.svg\s+←\s+voyage\.svg/);
  });

  test('both take the MONOCHROME variant, and the file says why', () => {
    // openrouter-color is lime (illegible on the light tile); voyage-color is
    // near-black teal (vanishes on the dark tile). currentColor adapts to both.
    const orSvg = read('src/assets/provider-logos/openrouter.svg');
    const voySvg = read('src/assets/provider-logos/voyage.svg');
    assert.match(orSvg, /fill="currentColor"/);
    assert.match(voySvg, /fill="currentColor"/);
    assert.doesNotMatch(orSvg, /#C8FF00/);
    assert.doesNotMatch(voySvg, /#012E33/);
    assert.match(read('src/assets/provider-logos/README.md'), /why the monochrome variant/);
  });
});

describe('OpenRouter width selection', () => {
  test('the provider actually SENDS the requested width', () => {
    // The comment claimed it did while the body never included it.
    assert.match(read('electron/rag/providers/OpenRouterEmbeddingProvider.ts'),
      /body: JSON\.stringify\(\{ model: this\.model, input, dimensions: this\.dimensions \}\)/);
  });

  test('a model that ignores the requested width is REFUSED, not silently stored', () => {
    // OpenRouter forwards `dimensions`; honouring it is the upstream model's
    // business. Storing a width the user did not pick would mis-describe their
    // own index.
    const ipc = read('electron/ipcHandlers.ts');
    assert.match(ipc, /dimensions_unsupported/);
    assert.match(ipc, /measured !== requested/);
  });
});

/**
 * The body of ONE safeHandle(...) block, sliced to the next handler.
 *
 * Every fixed-width slice in this file (i + 200 / 1800 / 2600) has silently
 * broken at least once as the handler grew: the assertion stops testing what the
 * body CONTAINS and starts testing whether it FITS.
 */
function ipcHandlerBody(channel) {
  const src = read('electron/ipcHandlers.ts');
  const i = src.indexOf(`safeHandle('${channel}'`);
  assert.notEqual(i, -1, `handler ${channel} not found`);
  const next = src.indexOf("safeHandle('", i + 10);
  return src.slice(i, next === -1 ? undefined : next);
}

describe('code-review fixes (xhigh, 2026-08-31)', () => {
  const ipc = () => read('electron/ipcHandlers.ts');

  test('the selection guard knows about EVERY provider it can refuse', () => {
    // It built its catalogue without hasVoyageKey/hasOpenrouterKey, so both were
    // always `available: false` and selecting either was ALWAYS refused as
    // "no key" — for a key the user had just saved. The two providers the whole
    // change exists to add could never be selected.
    // Slice the whole handler, not a guessed window — the flags sit well past a
    // fixed +200 and the assertion would pass/fail on size, not content.
    const src = ipc();
    const i = src.indexOf("safeHandle('embedding:set-config'");
    const block = src.slice(i, src.indexOf("safeHandle('", i + 10));
    assert.match(block, /validateEmbeddingSelection/);
    assert.match(block, /hasVoyageKey/);
    assert.match(block, /hasOpenrouterKey/);
  });

  test('voyage and openrouter are classified as CLOUD', () => {
    // describeEmbeddingProvider feeds the Active Model card. Omitting them made
    // it tell users their documents stay "On-device" while being uploaded to
    // api.voyageai.com / openrouter.ai — a false privacy statement.
    assert.match(read('electron/rag/embeddingStatus.ts'),
      /CLOUD_PROVIDERS = new Set\(\[[^\]]*'voyage'[^\]]*'openrouter'/);
  });

  test('every network provider gets the 3-attempt probe retry', () => {
    // One 429 or DNS blip would otherwise demote on the first failure, changing
    // the embedding SPACE and stranding every persisted vector.
    const src = read('electron/rag/EmbeddingProviderResolver.ts');
    const i = src.indexOf('CLOUD_PROVIDER_NAMES');
    const block = src.slice(i, i + 300);
    for (const p of ['voyage', 'openrouter', 'custom']) assert.match(block, new RegExp(`'${p}'`));
  });

  test('Voyage gets the same width back-fill its siblings have', () => {
    assert.match(read('electron/rag/EmbeddingProviderResolver.ts'), /withMeasuredVoyageDims/);
  });

  test('initializeEmbeddings returns a promise, so reindexRequired is real', () => {
    // It returned void, so `await` resolved before re-resolution and the handler
    // read the OLD space — reindexRequired was permanently false and a full
    // corpus re-index started with no warning.
    assert.match(read('electron/rag/RAGManager.ts'), /initializeEmbeddings\(keys: AppAPIConfig\): Promise<void>/);
  });

  test('the Voyage probe measures through a RAW request, not the provider', () => {
    // The provider's validate() throws on any length but its own, so probing
    // through it could only ever confirm the width it was constructed with.
    const src = read('electron/rag/voyageEmbeddingModels.ts');
    assert.match(src, /probeVoyageEmbeddingDimensions/);
    // It NAMES the provider in a comment explaining why it does not use it, so
    // assert on the construction rather than the mention.
    assert.doesNotMatch(src, /new VoyageEmbeddingProvider/);
    assert.match(src, /await fetch\(/, 'the probe issues its own request');
  });

  test('a Voyage width the model does not support is refused', () => {
    assert.match(ipc(), /provider === 'voyage'[\s\S]{0,1400}?dimensions_unsupported/);
  });

  test('Ollama task prefixes are keyed on the MODEL, not applied to all', () => {
    // search_document:/search_query: belong to nomic-embed's training. Prepending
    // them to qwen3-embedding or bge-m3 puts literal instruction text in the
    // strongest position of an input the model never saw — silent quality loss.
    const src = read('electron/rag/providers/OllamaEmbeddingProvider.ts');
    assert.match(src, /usesTaskPrefixes/);
    assert.match(src, /nomic-embed/);
  });

  test('Ollama validates the returned width like every sibling', () => {
    assert.match(read('electron/rag/providers/OllamaEmbeddingProvider.ts'), /Ollama embedding dimension mismatch/);
  });

  test('OpenAI batch has the count, range and hole guards', () => {
    const src = read('electron/rag/providers/OpenAIEmbeddingProvider.ts');
    assert.match(src, /refusing a partial batch/);
    assert.match(src, /out-of-range index/);
    assert.match(src, /did not return a vector for input/);
  });

  test('the Test path measures every provider, as resolve() does', () => {
    const block = ipcHandlerBody('embedding:test');
    for (const h of ['withMeasuredOllamaDims', 'withMeasuredCustomDims', 'withMeasuredOpenRouterDims', 'withMeasuredVoyageDims']) {
      assert.match(block, new RegExp(h));
    }
  });

  test('the OpenRouter status signal reads the OpenRouter key', () => {
    // It read the LiteLLM key, so a real OpenRouter key was invisible to the
    // lightweight-embedding warning and a LiteLLM-only user was misreported.
    assert.match(ipc(), /getOpenrouterApiKey\?\.\(\) \? 'openrouter'/);
  });
});
