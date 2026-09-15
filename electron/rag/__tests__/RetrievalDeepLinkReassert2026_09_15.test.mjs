// electron/rag/__tests__/RetrievalDeepLinkReassert2026_09_15.test.mjs
//
// THE BUG THIS PREVENTS. Clicking AI Providers' lightweight-embedding notice a
// SECOND time did nothing. Reproduced live 2026-09-15:
//
//   deep-link 'embedding'       -> Embedding sub-tab
//   user switches to Reranker   -> Reranker
//   deep-link 'embedding' again -> still Reranker   <-- the defect
//
// Three layers each bailed on an unchanged value: App's setState with an equal
// tab does not re-render, so SettingsOverlay's sync effect never ran, so
// RetrievalLayout's effect never ran. Invisible while a tab id mapped to
// exactly one view; a real defect once Retrieval grew sub-tabs the deep link
// has to reach.
//
// The fix is a nav SEQUENCE that changes on every request. Two properties have
// to hold together, and the second is what a naive fix gets wrong:
//
//   1. the sequence reaches RetrievalSettings' effect, so a repeat re-asserts;
//   2. the sub-tab target is derived from `initialTab` (the request), NOT from
//      `activeTab`. activeTab updates one render LATER than the sequence, so
//      reading them as independent props re-applied the PREVIOUS request's
//      target and threw away the user's sub-tab. That regression was caught by
//      a guard on the same day and is the reason `retrievalRequest` is one
//      atomic piece of state.
//
// Source-level: these are .tsx files the renderer test runner cannot import.
// Comments are stripped so prose can neither satisfy nor break an assertion.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = f =>
  readFileSync(path.resolve(__dirname, '../../..', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('a repeated Settings deep link re-asserts', () => {
  test('App bumps a sequence on every open request', () => {
    const src = read('src/App.tsx');
    assert.match(src, /setSettingsNav\(prev => \(\{ tab, seq: prev\.seq \+ 1 \}\)\)/,
      'openSettingsExclusive no longer bumps a sequence, so re-issuing the same tab is a no-op again');
    assert.match(src, /initialTabSeq=\{settingsNav\.seq\}/, 'the sequence is not passed to SettingsOverlay');
  });

  test('the sequence is in the sync effect deps', () => {
    const src = read('src/components/SettingsOverlay.tsx');
    assert.match(src, /\}, \[isOpen, initialTab, initialTabSeq\]\);/,
      'the nav effect ignores the sequence, so an unchanged initialTab bails');
  });

  test('the sub-tab target is derived from the REQUEST, not from activeTab', () => {
    // Guards the regression the first attempt shipped: activeTab lags the
    // sequence by a render, so pairing them re-applied a stale target.
    const src = read('src/components/SettingsOverlay.tsx');
    const i = src.indexOf('setRetrievalRequest({');
    assert.notEqual(i, -1, 'the request is no longer captured as one atomic value');
    const block = src.slice(i, i + 400);
    assert.match(block, /initialTab === 'reranker'/, 'target must be derived from initialTab');
    assert.match(block, /initialTab === 'embedding'/, 'target must be derived from initialTab');
    assert.doesNotMatch(block, /activeTab/,
      'the target must NOT be read from activeTab — it updates a render after the sequence');

    // And the render site must consume that single value, not re-derive it.
    assert.match(src, /initialTab=\{retrievalRequest\.tab\}/);
    assert.match(src, /navSeq=\{retrievalRequest\.seq\}/);
  });

  test('RetrievalSettings re-asserts on the sequence', () => {
    const src = read('src/components/settings/RetrievalSettings.tsx');
    assert.match(src, /\}, \[initialTab, navSeq\]\);/,
      'the sub-tab effect ignores navSeq, so a repeat deep link cannot reach it');
    // A plain Retrieval open must still leave the sub-tab alone.
    assert.match(src, /if \(initialTab\) setActiveTab\(initialTab\);/,
      'an undefined target must be a no-op, or opening Retrieval would reset the sub-tab');
  });
});
