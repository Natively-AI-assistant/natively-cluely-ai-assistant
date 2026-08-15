// Opt-in model allow-list (LiteLLM): empty means NONE, not "all".
//
// Every other provider ships 1-3 curated preset models, so "empty = no filter"
// is right for them and is unchanged. A LiteLLM gateway fronts the upstream's
// whole catalogue — 300+ models is normal — and defaulting that to "all" put a
// list nobody chose into the meeting-overlay picker.
//
// The contract lives in ONE function (isModelAllowed) which the settings panel
// and the overlay picker both call, and which modelAvailable() in ipcHandlers.ts
// mirrors for routing. The drift guard below is the point of this file: if those
// two ever disagree, the picker offers models the router rejects.
//
// Run via: node --test electron/services/__tests__/OptInModelAllowList2026_08_06.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const { isModelAllowed, isOptInModelProvider } = await import(path.join(root, 'src/utils/modelUtils.ts'));

const settings = fs.readFileSync(path.join(root, 'src/components/settings/AIProvidersSettings.tsx'), 'utf8');
const selector = fs.readFileSync(path.join(root, 'src/components/ModelSelectorWindow.tsx'), 'utf8');
const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

describe('allow-list contract', () => {
  test('LiteLLM is opt-in; the curated providers are not', () => {
    assert.equal(isOptInModelProvider('litellm'), true);
    ['gemini', 'openai', 'claude', 'groq', 'deepseek', 'ollama', 'custom', 'codex-cli'].forEach(p => {
      assert.equal(isOptInModelProvider(p), false, `${p} must keep "empty = all"`);
    });
  });

  test('empty list: NONE for LiteLLM, ALL for everyone else', () => {
    assert.equal(isModelAllowed('litellm', 'litellm/openai/gpt-4o', []), false);
    assert.equal(isModelAllowed('gemini', 'gemini-3.6-flash', []), true);
    assert.equal(isModelAllowed('ollama', 'ollama-llama3', []), true);
  });

  test('a populated list is an allow-list for both kinds', () => {
    assert.equal(isModelAllowed('litellm', 'litellm/a', ['litellm/a']), true);
    assert.equal(isModelAllowed('litellm', 'litellm/b', ['litellm/a']), false);
    assert.equal(isModelAllowed('gemini', 'gemini-3.6-flash', ['gemini-3.1-pro-preview']), false);
  });

  test('a FULL LiteLLM selection must be stored explicitly, never folded to []', () => {
    // Folding "everything selected" back to [] is correct for the other
    // providers and catastrophic here: [] reads as "none", so the fold would
    // silently deselect all 300 models the user had just ticked.
    const universe = ['litellm/a', 'litellm/b', 'litellm/c'];
    universe.forEach(id => assert.equal(isModelAllowed('litellm', id, universe), true));
    universe.forEach(id => assert.equal(isModelAllowed('litellm', id, []), false));
  });
});

describe('the rule is applied everywhere, identically', () => {
  test('settings and the overlay picker both defer to isModelAllowed', () => {
    assert.match(
      settings,
      /const isModelEnabled = \(provider: string, modelId: string\) =>\s*\n?\s*isModelAllowed\(provider, modelId, cloudEnabledModels\[provider\] \|\| \[\]\)/,
      'settings must not re-implement the contract',
    );
    assert.match(selector, /isModelAllowed\(family, m\.id, allowLists\[family\] \|\| \[\]\)/, 'the overlay must gate on it too');
  });

  test('DRIFT GUARD: routing mirrors the opt-in carve-out', () => {
    // modelAvailable() cannot import the renderer helper (electron/ never
    // imports from src/), so it re-states the rule. These two assertions are
    // what stop that copy from rotting.
    const fn = ipc.slice(ipc.indexOf('const modelAvailable ='), ipc.indexOf('if (modelAvailable(defaultModel)) return null;'));
    assert.match(fn, /const optInFamily = family === 'litellm'/, 'routing must know which families are opt-in');
    assert.match(
      fn,
      /if \(optInFamily\) \{\s*if \(!enabledForFamily\.includes\(modelId\)\) return false;\s*\} else if \(enabledForFamily\.length > 0/,
      'opt-in families must reject an empty allow-list; the others must still treat it as "no filter"',
    );
  });

  test('the overlay also honours disabled providers', () => {
    // Same class of gap: switching a provider off never removed it from the
    // overlay picker either.
    assert.match(selector, /disabled\.has\(family\)/, 'a disabled provider must not reach the overlay picker');
  });
});

describe('opt-in UI affordances', () => {
  test('the sole-remaining-model guard is lifted for opt-in providers', () => {
    // That guard exists only to stop an un-check from normalising to [] and
    // re-lighting every row. With [] meaning "none", clearing the last model is
    // a legitimate end state and the guard would just trap the user.
    assert.match(
      settings,
      /const soleEnabled = \(!optIn && enabled\.length === 1\) \? enabled\[0\] : null/,
      'opt-in lists must allow clearing the last model',
    );
  });

  test('the count reads "None selected" rather than "All N" when empty', () => {
    assert.match(settings, /optIn \? `\$\{t\('None selected'\)\}/, 'an empty opt-in list must not claim "All"');
  });

  test('bulk actions are NOT gated behind the >12-model filter bar', () => {
    // The bug this pins: the buttons were nested inside {showFilterBar && ...},
    // which only opens above AIP_MODEL_FILTER_THRESHOLD models. A small proxy
    // (4 models) rendered NO bulk controls at all — and on an opt-in list, where
    // nothing is ticked until you tick it, those are the controls that matter
    // most. Every other assertion in this file passed while they were invisible.
    const bar = settings.indexOf('{showFilterBar && (');
    // The block's REAL close — `)}` at its own indent. Anchoring on the next
    // sibling ({onRefresh}) instead would count everything between the close and
    // that sibling as "inside", which is exactly where the fix moved the buttons.
    const barEnd = settings.indexOf('\n                        )}', bar);
    const bulk = settings.indexOf('{onBulkToggle && visible.length > 0 && (');
    assert.ok(bar !== -1 && barEnd > bar, 'the filter-bar block should still exist');
    assert.ok(bulk !== -1, 'the bulk controls should exist');
    assert.ok(
      bulk < bar || bulk > barEnd,
      'bulk controls must live OUTSIDE the showFilterBar block so they render at any catalogue size',
    );
  });

  test('bulk actions operate on the FILTERED rows', () => {
    // With 300+ models the filter is how a family gets scoped; a Select all
    // that ignored it would be a foot-gun sitting right next to the filter box.
    assert.match(settings, /onBulkToggle\(visible\.map\(m => m\.id\), true\)/, 'Select all must act on visible rows');
    assert.match(settings, /onBulkToggle\(visible\.map\(m => m\.id\), false\)/, 'Clear must act on visible rows');
  });

  test('bulk toggling reuses the single-click normalisation, including the opt-in carve-out', () => {
    // Anchor the end on the NEXT DECLARATION, not on prose: "Promote a model to
    // this provider" also appears in an AipModelList prop doc far above, which
    // inverts the slice and silently yields '' — an assertion that can only pass.
    const start = settings.indexOf('const handleBulkToggleModels');
    const end = settings.indexOf('const handleSetDefaultModel', start);
    assert.ok(start !== -1 && end > start, 'the bulk handler should sit before handleSetDefaultModel');
    const fn = settings.slice(start, end);
    assert.match(fn, /const normalised = optIn\s*\n?\s*\? nextList/, 'bulk must not fold a full opt-in selection to []');
    assert.match(fn, /isModelAllowed\(provider, currentDefault, normalised\)/, 'a bulk clear must move an orphaned default');
  });

  test('Reset ("show all again") is hidden for opt-in providers', () => {
    assert.match(settings, /\{!optIn && enabled\.length > 0 && \(/, 'Reset means "all", which is incoherent when empty means none');
  });
});
