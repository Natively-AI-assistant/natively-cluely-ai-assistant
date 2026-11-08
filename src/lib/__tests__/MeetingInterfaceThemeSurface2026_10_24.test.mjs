// src/lib/__tests__/MeetingInterfaceThemeSurface2026_10_24.test.mjs
//
// The Lavender meeting style (2026-10-24) painted a LIGHT panel under both app
// colour themes; since 2026-10-31 it has a dark set and follows the app, as
// default does. Liquid glass and modern are always dark.
// Every window that picks light or dark classes for the overlay (the overlay,
// the settings popup, the model picker) asks interfaceThemeSurface(), so a
// wrong answer here repaints white text on the white panel.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { interfaceThemeSurface, isCssOwnedInterfaceTheme, getMeetingInterfaceTheme } from '../meetingInterfaceTheme.ts';

describe('interfaceThemeSurface', () => {
  test('default follows the app theme', () => {
    assert.equal(interfaceThemeSurface('default', 'light'), 'light');
    assert.equal(interfaceThemeSurface('default', 'dark'), 'dark');
  });

  test('liquid glass and modern are dark under both app themes (unchanged)', () => {
    for (const theme of ['liquid-glass', 'modern']) {
      assert.equal(interfaceThemeSurface(theme, 'light'), 'dark');
      assert.equal(interfaceThemeSurface(theme, 'dark'), 'dark');
    }
  });

  test('lavender follows the app theme (its dark set, 2026-10-31)', () => {
    assert.equal(interfaceThemeSurface('lavender', 'light'), 'light');
    assert.equal(interfaceThemeSurface('lavender', 'dark'), 'dark');
  });
});

describe('isCssOwnedInterfaceTheme', () => {
  test('liquid glass and lavender paint their own surfaces; default and modern take the inline opacity styles', () => {
    assert.equal(isCssOwnedInterfaceTheme('liquid-glass'), true);
    assert.equal(isCssOwnedInterfaceTheme('lavender'), true);
    assert.equal(isCssOwnedInterfaceTheme('default'), false);
    assert.equal(isCssOwnedInterfaceTheme('modern'), false);
  });
});

// Lavender left the picker on 2026-10-31: Default paints it in light and dark.
describe('Lavender is no longer a pick of its own', () => {
  const withStored = (value, fn) => {
    const prev = globalThis.localStorage;
    globalThis.localStorage = { getItem: () => value, setItem() {} };
    try { return fn(); } finally { globalThis.localStorage = prev; }
  };

  test('a saved Lavender pick reads as Default', () => {
    assert.equal(withStored('lavender', getMeetingInterfaceTheme), 'default');
  });

  test('the other picks read back as saved', () => {
    for (const theme of ['default', 'liquid-glass', 'modern']) {
      assert.equal(withStored(theme, getMeetingInterfaceTheme), theme);
    }
    assert.equal(withStored(null, getMeetingInterfaceTheme), 'default');
  });

  test('Settings › Overlay offers Default, Liquid Glass and Modern only', () => {
    const src = readFileSync(fileURLToPath(new URL('../../components/settings/OverlaySettings.tsx', import.meta.url)), 'utf8');
    const themes = src.slice(src.indexOf('const THEMES'), src.indexOf('];', src.indexOf('const THEMES')));
    assert.deepEqual([...themes.matchAll(/mode: '([a-z-]+)'/g)].map((m) => m[1]), ['default', 'liquid-glass', 'modern']);
  });
});
