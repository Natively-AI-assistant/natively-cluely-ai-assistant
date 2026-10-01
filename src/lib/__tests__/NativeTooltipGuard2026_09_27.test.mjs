// The overlay family must never carry an HTML `title`: Chromium draws it as a
// native tooltip window outside the overlay's content protection, so it shows
// up in screen shares (measured 2026-09-27 on macOS; Windows tooltips are
// separate windows too). See src/lib/nativeTooltipGuard.mjs.
//
// No jsdom in this repo, so a minimal element/observer fake stands in. The
// real-DOM behaviour (React commits, portals) was verified live in the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TOOLTIP_FREE_WINDOWS,
  createSwitchableTooltipGuard,
  installNativeTooltipGuard,
  restoreTitles,
  shouldSuppressNativeTooltips,
  stripTitle,
} from '../nativeTooltipGuard.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

class FakeEl {
  constructor(attrs = {}, text = '', children = [], tagName = 'BUTTON') {
    this.nodeType = 1;
    this.tagName = tagName;
    this.attrs = new Map(Object.entries(attrs));
    this.ownText = text;
    this.children = children;
  }
  get textContent() { return this.ownText + this.children.map((c) => c.textContent).join(''); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  get attrNames() { return [...this.attrs.keys()].sort(); }
  hasAttribute(n) { return this.attrs.has(n); }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  removeAttribute(n) { this.attrs.delete(n); }
  querySelectorAll(sel) {
    const attr = sel.match(/^\[([\w-]+)\]$/)[1];
    const out = [];
    const walk = (el) => { for (const c of el.children) { if (c.hasAttribute(attr)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}

class FakeObserver {
  static last;
  constructor(cb) { this.cb = cb; FakeObserver.last = this; }
  observe(root, opts) { this.root = root; this.opts = opts; }
  disconnect() { this.disconnected = true; }
  fire(records) { this.cb(records); }
}

test('every overlay-family route is guarded; the launcher is not', () => {
  for (const w of ['overlay', 'overlay-pill', 'overlay-toggle', 'settings', 'model-selector', 'cropper']) {
    assert.equal(shouldSuppressNativeTooltips(w), true, w);
  }
  assert.equal(shouldSuppressNativeTooltips('launcher'), false);
  assert.equal(shouldSuppressNativeTooltips(''), false);
});

test('every window main.tsx sends to the light root is guarded', () => {
  // Every aux window main.tsx mounts belongs to the overlay family; a new one
  // added there must be a deliberate decision here too.
  const main = readFileSync(path.join(repoRoot, 'src/main.tsx'), 'utf8');
  const light = JSON.parse(main.match(/LIGHT_ROUTES\s*=\s*(\[[^\]]*\])/)[1].replace(/'/g, '"'));
  for (const route of light) assert.ok(TOOLTIP_FREE_WINDOWS.includes(route), `${route} is not guarded`);
  assert.match(main, /installNativeTooltipGuard\(document\.documentElement\)/);
});

test('an icon-only element keeps its title as aria-label', () => {
  const el = new FakeEl({ title: 'Copy answer' });
  stripTitle(el);
  assert.equal(el.getAttribute('title'), '', 'blanked, not removed: title="" shows no tooltip');
  assert.equal(el.getAttribute('aria-label'), 'Copy answer');
});

test('an element with visible text gets aria-description, not a replacement name', () => {
  const el = new FakeEl({ title: 'Open Audio settings to select a provider' }, 'No speech provider');
  stripTitle(el);
  assert.equal(el.getAttribute('title'), '');
  assert.equal(el.getAttribute('aria-label'), null);
  assert.equal(el.getAttribute('aria-description'), 'Open Audio settings to select a provider');
});

test('an existing aria-label is never overwritten; empty titles just go', () => {
  const labelled = new FakeEl({ title: 'Dismiss', 'aria-label': 'Close banner' });
  stripTitle(labelled);
  assert.equal(labelled.getAttribute('aria-label'), 'Close banner');
  assert.equal(labelled.getAttribute('aria-description'), 'Dismiss');
  const empty = new FakeEl({ title: '' });
  stripTitle(empty);
  assert.equal(empty.getAttribute('title'), '');
  assert.equal(empty.getAttribute('aria-label'), null);
});

test('install strips existing titles, then new and changed ones', () => {
  const nested = new FakeEl({ title: 'Remove' });
  const root = new FakeEl({ title: 'root' }, '', [new FakeEl({}, '', [nested])]);
  const dispose = installNativeTooltipGuard(root, FakeObserver);
  assert.equal(root.getAttribute('title'), '');
  assert.equal(nested.getAttribute('title'), '');

  const obs = FakeObserver.last;
  assert.equal(obs.root, root);
  assert.deepEqual(obs.opts.attributeFilter, ['title']);
  assert.equal(obs.opts.subtree, true);
  assert.equal(obs.opts.childList, true);

  // React re-renders a title (e.g. Copy code → Copied).
  nested.setAttribute('title', 'Copied');
  obs.fire([{ type: 'attributes', target: nested }]);
  assert.equal(nested.getAttribute('title'), '');
  assert.equal(nested.getAttribute('aria-label'), 'Copied');

  // A portal or streamed markdown inserts a subtree containing titles.
  const deep = new FakeEl({ title: 'https://example.com' }, 'link');
  const added = new FakeEl({ title: 'Jump to latest' }, '', [deep]);
  obs.fire([{ type: 'childList', addedNodes: [added, { nodeType: 3 }] }]);
  assert.equal(added.getAttribute('title'), '');
  assert.equal(deep.getAttribute('title'), '');

  dispose();
  assert.equal(obs.disconnected, true);
});

test('a title re-set while stripped refreshes the guard\'s own aria-label', () => {
  const el = new FakeEl({ title: 'Copy code' });
  stripTitle(el);
  el.setAttribute('title', 'Copied');
  stripTitle(el);
  assert.equal(el.getAttribute('aria-label'), 'Copied');
  assert.equal(el.getAttribute('aria-description'), null);
});

test('restoreTitles puts titles back and removes only what the guard added', () => {
  const icon = new FakeEl({ title: 'Settings' });
  const labelled = new FakeEl({ title: 'Dismiss', 'aria-label': 'Close banner' });
  const texty = new FakeEl({ title: 'Gemini' }, 'Gemini logo');
  const root = new FakeEl({}, '', [icon, labelled, texty]);
  const before = [icon, labelled, texty].map((e) => e.attrNames);
  for (const el of [icon, labelled, texty]) stripTitle(el);
  restoreTitles(root);
  assert.deepEqual([icon, labelled, texty].map((e) => e.attrNames), before);
  assert.equal(icon.getAttribute('title'), 'Settings');
  assert.equal(labelled.getAttribute('aria-label'), 'Close banner');
  assert.equal(texty.getAttribute('title'), 'Gemini');
});

test('the switchable guard strips while active and restores when switched off', () => {
  const btn = new FakeEl({ title: 'Refresh State' });
  const root = new FakeEl({}, '', [btn]);
  const guard = createSwitchableTooltipGuard(root, FakeObserver);
  assert.equal(guard.isActive(), false);
  assert.equal(btn.getAttribute('title'), 'Refresh State');

  guard.setActive(true);
  const obs = FakeObserver.last;
  assert.equal(btn.getAttribute('title'), '');
  guard.setActive(true); // idempotent: no second observer
  assert.equal(FakeObserver.last, obs);

  guard.setActive(false);
  assert.equal(obs.disconnected, true);
  assert.equal(btn.getAttribute('title'), 'Refresh State');
  assert.equal(btn.getAttribute('aria-label'), null);
  assert.equal(guard.isActive(), false);
});

test('main.tsx switches the launcher guard on Undetectable, never permanently', () => {
  const main = readFileSync(path.join(repoRoot, 'src/main.tsx'), 'utf8');
  assert.match(main, /createSwitchableTooltipGuard\(document\.documentElement\)/);
  assert.match(main, /onUndetectableChanged/);
  assert.equal(shouldSuppressNativeTooltips('launcher'), false);
});

test('a title React drops while stripped does not come back on restore', () => {
  // SettingsOverlay: title={full ? 'Remove a downloaded language first.' : undefined}
  const btn = new FakeEl({ title: 'Remove a downloaded language first.' });
  const root = new FakeEl({}, '', [btn]);
  const guard = createSwitchableTooltipGuard(root, FakeObserver);
  guard.setActive(true);
  const obs = FakeObserver.last;
  // React removes the attribute. It is still present (blanked), so a record is queued.
  btn.removeAttribute('title');
  obs.fire([{ type: 'attributes', target: btn }]);
  assert.equal(btn.getAttribute('aria-label'), null, 'stale aria text dropped');
  guard.setActive(false);
  assert.equal(btn.getAttribute('title'), null, 'no stale tooltip after Undetectable turns off');
  assert.deepEqual(btn.attrNames, []);
});

test('an aria value the component set later is never removed by the guard', () => {
  const btn = new FakeEl({ title: 'Settings' });
  stripTitle(btn);
  assert.equal(btn.getAttribute('aria-label'), 'Settings');
  btn.setAttribute('aria-label', 'Open settings'); // component's own label now
  restoreTitles(new FakeEl({}, '', [btn]));
  assert.equal(btn.getAttribute('aria-label'), 'Open settings');
  assert.equal(btn.getAttribute('title'), 'Settings');
});

test('form fields and images get aria-description, never a replacement aria-label', () => {
  for (const tag of ['INPUT', 'IMG', 'SELECT', 'TEXTAREA']) {
    const el = new FakeEl({ title: 'Your API key' }, '', [], tag);
    stripTitle(el);
    assert.equal(el.getAttribute('aria-label'), null, tag);
    assert.equal(el.getAttribute('aria-description'), 'Your API key', tag);
  }
});
