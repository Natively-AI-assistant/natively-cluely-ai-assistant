// electron/rag/__tests__/SettingsSectionErrorBoundary2026_09_15.test.mjs
//
// THE BUG THIS PREVENTS. A render error in ANY settings section destroyed the
// whole launcher window.
//
// SettingsOverlay renders inside App's <ErrorBoundary context="Launcher">, so a
// throw in a panel bubbled past the settings shell and replaced the entire
// launcher with "Launcher crashed". Measured 2026-09-15 by injecting a throw
// into each half of the Retrieval panel: launcher gone, sidebar gone, settings
// gone, in both directions.
//
// With a boundary at the section, the same injected throw leaves the launcher
// and the settings shell (11 nav buttons) intact, does not latch onto other
// sections, and clears when the fault goes away.
//
// Two properties, and the second is the subtle one:
//   1. the boundary wraps the section content;
//   2. it sits INSIDE the panelKey-keyed wrapper, so switching sections
//      remounts it and clears a latched error. A boundary placed outside that
//      key would show its fallback on every other tab once any section threw.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raw = f => readFileSync(path.resolve(__dirname, '../../..', f), 'utf8');
const stripComments = src =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('a settings section cannot take down the launcher', () => {
  const src = stripComments(raw('src/components/SettingsOverlay.tsx'));

  test('the section content is wrapped in an ErrorBoundary', () => {
    assert.match(src, /import \{ ErrorBoundary \}/, 'ErrorBoundary is not imported');
    assert.match(src, /<ErrorBoundary context=\{`Settings/, 'the section content is not wrapped');
  });

  test('the boundary is INSIDE the panelKey-keyed wrapper, so it resets per section', () => {
    const keyed = src.indexOf('key={panelKey}');
    const boundary = src.indexOf('<ErrorBoundary context={`Settings');
    const close = src.indexOf('</ErrorBoundary>', boundary);
    const motionClose = src.indexOf('</motion.div>', close);
    assert.notEqual(keyed, -1, 'the panel wrapper is no longer keyed on panelKey');
    assert.notEqual(boundary, -1);
    assert.ok(keyed < boundary,
      'the boundary must sit inside the keyed wrapper, or a latched error would '
      + 'follow the user to every other settings section');
    assert.ok(close !== -1 && motionClose !== -1 && close < motionClose,
      'the boundary must close before the keyed wrapper does');
  });

  test('the sections actually live inside the boundary', () => {
    const boundary = src.indexOf('<ErrorBoundary context={`Settings');
    const close = src.indexOf('</ErrorBoundary>', boundary);
    const inner = src.slice(boundary, close);
    for (const tab of ['general', 'ai-providers', 'skills', 'audio', 'keybinds', 'about']) {
      assert.ok(inner.includes(`activeTab === '${tab}'`), `the '${tab}' section is outside the boundary`);
    }
    assert.ok(inner.includes('isRetrievalTab(activeTab)'), 'the Retrieval section is outside the boundary');
  });
});
