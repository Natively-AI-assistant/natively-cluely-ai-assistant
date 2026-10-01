import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  THEME_CACHE_KEY,
  THEME_SWITCHING_ATTR,
  applyResolvedTheme,
  settleColourTransition,
  settleColourTransitions,
} from '../themeTransition.mjs';

function makeDoc({ theme = 'dark', visibility = 'visible', withVT = true } = {}) {
  const attrs = new Map([['data-theme', theme]]);
  const calls = { started: 0, flipsInsideCallback: 0 };
  const controls = {};
  const listeners = new Set();
  const doc = {
    visibilityState: visibility,
    addEventListener: (type, fn) => { if (type === 'transitionrun') listeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'transitionrun') listeners.delete(fn); },
    documentElement: {
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      setAttribute: (k, v) => attrs.set(k, v),
      removeAttribute: (k) => attrs.delete(k),
    },
  };
  if (withVT) {
    doc.startViewTransition = (cb) => {
      calls.started += 1;
      cb();
      let finish;
      const finished = new Promise((r) => { finish = r; });
      controls.finish = finish;
      return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), finished };
    };
  }
  return { doc, attrs, calls, controls, listeners };
}
const memoryStorage = () => {
  const m = new Map();
  return { setItem: (k, v) => m.set(k, v), get: (k) => m.get(k) };
};

describe('applyResolvedTheme', () => {
  test('a change dissolves: flips inside the view transition and scopes the timing attribute', async () => {
    const { doc, attrs, calls, controls } = makeDoc();
    const storage = memoryStorage();
    assert.equal(applyResolvedTheme('light', { doc, storage }), true);
    assert.equal(calls.started, 1);
    assert.equal(attrs.get('data-theme'), 'light');
    assert.equal(attrs.has(THEME_SWITCHING_ATTR), true);
    assert.equal(storage.get(THEME_CACHE_KEY), 'light');
    controls.finish();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(attrs.has(THEME_SWITCHING_ATTR), false);
  });

  test('a second change mid-dissolve retargets the live page instead of skipping the running transition', async () => {
    const { doc, attrs, calls, controls } = makeDoc();
    const storage = memoryStorage();
    applyResolvedTheme('light', { doc, storage });
    assert.equal(applyResolvedTheme('dark', { doc, storage }), false);
    assert.equal(calls.started, 1);
    assert.equal(attrs.get('data-theme'), 'dark');
    controls.finish();
    await new Promise((r) => setTimeout(r, 0));
    // …and the next change after it settles dissolves again.
    assert.equal(applyResolvedTheme('light', { doc, storage }), true);
    assert.equal(calls.started, 2);
  });

  test('the same resolved theme is a no-op (light → system while the OS is light)', () => {
    const { doc, calls } = makeDoc({ theme: 'light' });
    assert.equal(applyResolvedTheme('light', { doc, storage: memoryStorage() }), false);
    assert.equal(calls.started, 0);
  });

  test('animate:false snaps (first paint, authoritative re-read)', () => {
    const { doc, attrs, calls } = makeDoc();
    assert.equal(applyResolvedTheme('light', { doc, storage: memoryStorage(), animate: false }), false);
    assert.equal(calls.started, 0);
    assert.equal(attrs.get('data-theme'), 'light');
    assert.equal(attrs.has(THEME_SWITCHING_ATTR), false);
  });

  test('a hidden window snaps — nothing is on screen to dissolve', () => {
    const { doc, attrs, calls } = makeDoc({ visibility: 'hidden' });
    assert.equal(applyResolvedTheme('light', { doc, storage: memoryStorage() }), false);
    assert.equal(calls.started, 0);
    assert.equal(attrs.get('data-theme'), 'light');
  });

  test('without the View Transitions API it still switches', () => {
    const { doc, attrs } = makeDoc({ withVT: false });
    assert.equal(applyResolvedTheme('light', { doc, storage: memoryStorage() }), false);
    assert.equal(attrs.get('data-theme'), 'light');
  });

  test('a throwing startViewTransition falls back to a plain flip and clears the attribute', () => {
    const { doc, attrs } = makeDoc();
    doc.startViewTransition = () => { throw new Error('nope'); };
    assert.equal(applyResolvedTheme('light', { doc, storage: memoryStorage() }), false);
    assert.equal(attrs.get('data-theme'), 'light');
    assert.equal(attrs.has(THEME_SWITCHING_ATTR), false);
  });

  test('blocked storage does not stop the switch', () => {
    const { doc, attrs } = makeDoc();
    const storage = { setItem: () => { throw new Error('blocked'); } };
    assert.doesNotThrow(() => applyResolvedTheme('light', { doc, storage, animate: false }));
    assert.equal(attrs.get('data-theme'), 'light');
  });
});

describe('a change that arrives before the deferred update callback runs', () => {
  // The real startViewTransition captures the old snapshot FIRST and calls the
  // callback afterwards; until then data-theme still holds the old value.
  function deferredDoc(theme = 'dark') {
    const made = makeDoc({ theme });
    let cb = null;
    made.doc.startViewTransition = (fn) => {
      made.calls.started += 1;
      cb = fn;
      let finish;
      const finished = new Promise((r) => { finish = r; });
      made.controls.finish = finish;
      return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), finished };
    };
    made.runCallback = () => cb();
    return made;
  }

  test('the page is untouched until the callback runs (the old snapshot must stay old)', async () => {
    const { doc, attrs, runCallback } = deferredDoc('dark');
    applyResolvedTheme('light', { doc, storage: memoryStorage() });
    assert.equal(attrs.get('data-theme'), 'dark');
    await runCallback();
    assert.equal(attrs.get('data-theme'), 'light');
  });

  test('a duplicate broadcast (System sends the same payload twice) neither restarts nor pre-flips', async () => {
    const { doc, attrs, calls, runCallback } = deferredDoc('dark');
    applyResolvedTheme('light', { doc, storage: memoryStorage() });
    assert.equal(applyResolvedTheme('light', { doc, storage: memoryStorage() }), false);
    assert.equal(calls.started, 1);
    assert.equal(attrs.get('data-theme'), 'dark', 'still the old value, so the capture is still the old theme');
    await runCallback();
    assert.equal(attrs.get('data-theme'), 'light');
  });

  test('a different second value before the callback retargets it; the callback lands on the latest', async () => {
    const { doc, attrs, calls, runCallback } = deferredDoc('dark');
    applyResolvedTheme('light', { doc, storage: memoryStorage() });
    applyResolvedTheme('dark', { doc, storage: memoryStorage() });
    assert.equal(calls.started, 1);
    assert.equal(attrs.get('data-theme'), 'dark');
    await runCallback();
    assert.equal(attrs.get('data-theme'), 'dark', 'the stale closure must not resurrect "light"');
  });

  test('after the callback has run, a later change flips the live page directly', async () => {
    const { doc, attrs, calls, runCallback } = deferredDoc('dark');
    applyResolvedTheme('light', { doc, storage: memoryStorage() });
    const done = runCallback();
    applyResolvedTheme('dark', { doc, storage: memoryStorage() }); // arrives while the callback awaits its hops
    assert.equal(attrs.get('data-theme'), 'dark');
    await done;
    assert.equal(attrs.get('data-theme'), 'dark');
    assert.equal(calls.started, 1);
  });
});

describe('colour transitions started by the flip are finished, not run under the dissolve', () => {
  const fakeAnimation = (transitionProperty, pseudoElement = null) => {
    const a = { transitionProperty, effect: { pseudoElement }, finished: 0, finish() { a.finished += 1; } };
    return a;
  };
  const fakeEvent = (propertyName, animations, pseudoElement = '') => ({
    propertyName, pseudoElement, target: { getAnimations: () => animations },
  });

  test('a colour transition is finished (the toggle track, the pill, a shadow)', () => {
    for (const prop of ['background-color', 'border-top-color', 'color', 'box-shadow', 'fill', 'stroke', 'filter']) {
      const a = fakeAnimation(prop);
      settleColourTransition(fakeEvent(prop, [a]));
      assert.equal(a.finished, 1, prop);
    }
  });

  test('a transform, opacity or size transition is left running', () => {
    for (const prop of ['transform', 'opacity', 'width', 'height', 'border-radius', 'translate']) {
      const a = fakeAnimation(prop);
      settleColourTransition(fakeEvent(prop, [a]));
      assert.equal(a.finished, 0, prop);
    }
  });

  test('only the animation for the announced property on the announced (pseudo-)element is finished', () => {
    const own = fakeAnimation('background-color');
    const otherProp = fakeAnimation('transform');
    const pseudo = fakeAnimation('background-color', '::before');
    settleColourTransition(fakeEvent('background-color', [own, otherProp, pseudo]));
    assert.deepEqual([own.finished, otherProp.finished, pseudo.finished], [1, 0, 0]);
    settleColourTransition(fakeEvent('background-color', [own, pseudo], '::before'));
    assert.deepEqual([own.finished, pseudo.finished], [1, 1]);
  });

  test('the sweep finishes running colour transitions and leaves the rest', () => {
    const colour = fakeAnimation('background-color');
    const shadow = fakeAnimation('box-shadow');
    const move = fakeAnimation('transform');
    const keyframes = { effect: {}, finished: 0, finish() { this.finished += 1; } }; // a CSSAnimation has no transitionProperty
    settleColourTransitions({ getAnimations: () => [colour, shadow, move, keyframes] });
    assert.deepEqual([colour.finished, shadow.finished, move.finished, keyframes.finished], [1, 1, 0, 0]);
  });

  test('the sweep runs inside the update callback, after the flip and again after the commit hops', async () => {
    const { doc, attrs } = makeDoc();
    const seen = [];
    doc.getAnimations = () => { seen.push(attrs.get('data-theme')); return []; };
    let callbackDone;
    doc.startViewTransition = (cb) => {
      callbackDone = Promise.resolve(cb());
      return { ready: Promise.resolve(), updateCallbackDone: callbackDone, finished: callbackDone };
    };
    applyResolvedTheme('light', { doc, storage: memoryStorage() });
    assert.deepEqual(seen, ['light'], 'first sweep is synchronous, on the flipped theme');
    await callbackDone;
    assert.deepEqual(seen, ['light', 'light'], 'second sweep after React had its turn');
  });

  test('the listener lives exactly as long as the dissolve', async () => {
    const { doc, controls, listeners } = makeDoc();
    applyResolvedTheme('light', { doc, storage: memoryStorage() });
    assert.equal(listeners.size, 1);
    controls.finish();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(listeners.size, 0);
  });

  test('snapping registers no listener', () => {
    const { doc, listeners } = makeDoc();
    applyResolvedTheme('light', { doc, storage: memoryStorage(), animate: false });
    assert.equal(listeners.size, 0);
  });
});

describe('theme switch wiring', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

  test('both renderer entry points go through the helper, none flips the attribute on a change event', () => {
    const main = read('../../main.tsx');
    const hook = read('../../hooks/useResolvedTheme.ts');
    assert.match(main, /onThemeChanged\?\.\(\(\{ resolved \}\) => \{\s*applyResolvedTheme\(resolved\);/);
    assert.match(main, /applyResolvedTheme\(resolved, \{ animate: false \}\)/);
    assert.match(hook, /applyResolvedTheme\(resolved\)/);
    assert.doesNotMatch(hook, /setAttribute\('data-theme'/);
  });

  test('index.css has no universal transition:none rule — it forced a full-document restyle as the dissolve began', () => {
    const css = read('../../index.css');
    const rules = css.slice(css.indexOf('/* ── Theme switch')).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(rules, /transition:\s*none/);
  });

  test('index.css is a tight dissolve: 240ms, strong ease-in-out, no blur or movement', () => {
    const css = read('../../index.css');
    assert.match(css, /:root\[data-theme-switching\]::view-transition-group\(root\)\s*\{\s*animation-duration: 240ms;\s*animation-timing-function: cubic-bezier\(0\.77, 0, 0\.175, 1\);/);
    const block = css.slice(css.indexOf('/* ── Theme switch'));
    assert.doesNotMatch(block, /filter:\s*blur|@keyframes|transform:/);
  });

  test('reduced motion keeps the dissolve, only shorter', () => {
    const css = read('../../index.css');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  :root[data-theme-switching]'));
    assert.match(block, /animation-duration: 160ms;/);
  });
});
