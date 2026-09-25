// The Fast Model's boundary, at the two wiring points unit tests cannot reach.
//
// Both are review findings from the whole-branch pass:
//  - the fast model must not reach LIVE NEGOTIATION COACHING, which is text the
//    user reads and says aloud. `preferFast` was a no-op before this branch, so
//    giving it teeth silently enrolled that call site.
//  - the Settings picker must not report a refused write as success. The boolean
//    is plumbed carefully all the way to the renderer and then dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('live negotiation coaching does not run on the fast model', () => {
  const src = read('electron/main.ts');
  const i = src.indexOf('setLiveCoachingContentFn');
  assert.ok(i > -1, 'the live-coaching hook must still exist');
  const block = src.slice(i, i + 500);
  // Match the OBJECT PROPERTY, not the word: the call site carries a comment
  // explaining why preferFast is deliberately absent, and a bare /preferFast/
  // grep flags that comment as the very thing it documents.
  assert.doesNotMatch(block, /preferFast\s*:/,
    'live coaching returns a tacticalNote and exactScript the user reads and speaks — '
    + 'the fast path is for invisible calls only, and its 256-token cap truncates this JSON into a canned fallback');
});

test('the Fast Model picker reports a refused write instead of showing success', () => {
  const src = read('src/components/settings/AIProvidersSettings.tsx');
  const i = src.indexOf('setFastModel(val)');
  assert.ok(i > -1, 'the picker onChange must exist');
  const block = src.slice(i, i + 700);
  assert.match(block, /await/,
    'a resolved { success:false } is invisible to .catch() — the result must be awaited');
  assert.match(block, /success/,
    'the persistence boolean must control what the UI shows, not be discarded');
});

test('the picker offers only models the fast path can dispatch', () => {
  const src = read('src/components/settings/AIProvidersSettings.tsx');
  const i = src.indexOf('buildFastModelOptions');
  assert.ok(i > -1, 'the picker must build its options through the filter, not inline');
  const body = src.slice(i, i + 1400);
  assert.match(body, /fastModelDispatchable/,
    'options must be narrowed by the ids main says are dispatchable');
  assert.match(body, /=== null\s*\?\s*\[\]/,
    'before main answers, offer only Auto - otherwise the full unfiltered list flashes up as selectable');
  // The saved pick must survive filtering, labelled, not vanish: dropping it
  // renders an empty control while the id is still persisted.
  assert.match(body, /not supported/, 'a saved-but-unsupported pick must stay visible and labelled');

  const card = src.slice(src.indexOf("t('Background Model')"), src.indexOf("t('Background Model')") + 900);
  assert.doesNotMatch(card, /\.\.\.buildAvailableModelOptions\(\)/,
    'the unfiltered universe must not reach the picker');
});
