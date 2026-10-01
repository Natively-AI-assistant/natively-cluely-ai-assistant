/**
 * UpdateModal.test.mjs
 *
 * Source-level tests for the update card and its corner toast. Like the other
 * card tests, the project has no JSX renderer under `node --test`, so the
 * component is read as text and its contracts asserted directly:
 *
 *   1. Platform branches: no manual-install steps on either platform (the
 *      macOS build is signed and installs in place; Windows always could).
 *   2. Updater wiring: live bytes/speed reach the card, hiding a download
 *      minimises it instead of closing it, and the dev mock stays dev-only.
 *   3. Design contracts shared with the card family: dims but never blurs,
 *      motion only while downloading and never under reduced motion.
 *   4. Every phrase is translated whole, in every shipped language.
 *
 * Run: node --test src/components/__tests__/UpdateModal.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(__dirname, p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/[^\n]*$/gm, '');

const modal = strip(read('../UpdateModal.tsx'));
const banner = strip(read('../UpdateBanner.tsx'));

// ─── Platform branches ─────────────────────────────────────────

test('no manual-install steps: the signed macOS build installs in place', () => {
  // The quarantine (xattr) steps and "App is damaged" help date from the
  // unsigned macOS build. A signed, notarized app needs neither.
  for (const [name, src] of [['UpdateModal', modal], ['UpdateBanner', banner]]) {
    assert.doesNotMatch(src, /xattr|App is damaged|'instructions'|instructionsArch/, `${name} still carries the manual-install flow`);
  }
});

test('a build that cannot install in place opens the release page (macOS) or downloads (Windows)', () => {
  const install = banner.slice(banner.indexOf('const handleInstall'), banner.indexOf('const handleDismiss'));
  const mac = install.slice(install.indexOf("platform === 'darwin'"));
  assert.ok(install.indexOf('if (canAutoUpdate)') < install.indexOf("platform === 'darwin'"), 'installable builds take the in-app flow first');
  assert.match(mac, /openExternal\(parsedNotes\?\.url \|\| LATEST_RELEASE_URL\)/, 'macOS: the release page');
  assert.match(mac.slice(mac.indexOf('return;')), /downloadUpdate\(\)/, 'Windows keeps the in-app download');
});

// ─── Updater wiring ────────────────────────────────────────────

test('live download figures flow from the updater event to the card', () => {
  for (const field of ['transferred', 'total', 'bytesPerSecond']) {
    assert.ok(banner.includes(`${field}: progressObj.${field}`), `UpdateBanner forwards ${field}`);
  }
  assert.ok(banner.includes('downloadDetail={downloadDetail}'));
  assert.ok(modal.includes('describeDownload(downloadDetail, progress, t)'));
});

test('hiding a running download minimises to the corner toast; errors bring the card back', () => {
  assert.match(banner, /if \(status === 'downloading'\) \{\s*setMinimized\(true\);\s*return;/);
  assert.ok(banner.includes('isOpen={isVisible && minimized}'));
  assert.ok(banner.includes('isOpen={isVisible && !minimized}'));
  const onError = banner.slice(banner.indexOf('onUpdateError'), banner.indexOf('return () => {', banner.indexOf('onUpdateError')));
  assert.ok(onError.includes('setMinimized(false)'), 'an error must restore the full card');
});

test('the mock update and simulated download only run in development', () => {
  assert.ok(banner.includes('if (import.meta.env.DEV && mockRef.current) { startMockDownload(); return; }'));
  const keyHandler = banner.slice(banner.indexOf('const handleKeyDown'), banner.indexOf("window.addEventListener('keydown', handleKeyDown)"));
  assert.ok(keyHandler.includes('if (!import.meta.env.DEV) return;'));
  assert.ok(keyHandler.includes('(e.metaKey || e.ctrlKey) && e.shiftKey'), 'shortcut works with Ctrl on Windows and Cmd on macOS');
});

// ─── Design contracts ──────────────────────────────────────────

test('the scrim dims but never blurs', () => {
  assert.ok(!/backdrop-?filter|backdropFilter/i.test(modal));
  assert.ok(modal.includes("background: isLight ? 'rgba(10,10,18,0.30)' : 'rgba(0,0,0,0.80)'"));
});

test('motion runs only while downloading and never under reduced motion', () => {
  assert.ok(!modal.includes('requestAnimationFrame'), 'no auto-scrolling release notes');
  assert.ok(modal.includes("animation: reduced || !moving ? undefined : 'upd-wave 3s linear infinite'"));
  assert.ok(modal.includes("animation: reduced ? undefined : 'upd-pulse 1.2s ease-in-out infinite'"));
  assert.ok(modal.includes("moving={status === 'downloading'}"));
});

test('the card is a labelled dialog and closes on Escape', () => {
  assert.ok(modal.includes('role="dialog"'));
  assert.ok(modal.includes('aria-modal="true"'));
  assert.ok(modal.includes('aria-labelledby="update-toast-title"'));
  assert.ok(modal.includes("if (e.key === 'Escape') onDismiss();"));
});

// ─── Translations ──────────────────────────────────────────────

test('every phrase the card shows is translated in es, ja, zh and ru', () => {
  const keys = new Set();
  for (const m of modal.matchAll(/\bt\((['"])((?:\\.|(?!\1).)*)\1\)/g)) keys.add(m[2].replace(/\\'/g, "'").replace(/\\n/g, '\n'));
  const dicts = {
    es: read('../../i18n.es.generated.ts'),
    ja: read('../../i18n.ja.generated.ts'),
    zh: read('../../i18n.zh.generated.ts'),
    ru: read('../../i18n.ru.generated.ts') + read('../../i18n.ru.generated2.ts') + read('../../i18n.tsx'),
  };
  for (const [lang, text] of Object.entries(dicts)) {
    const missing = [...keys].filter(k =>
      !text.includes(JSON.stringify(k)) && !text.includes(`'${k.replace(/'/g, "\\'")}'`));
    assert.deepEqual(missing, [], `${lang} is missing: ${missing.join(' | ')}`);
  }
});

test('corner toast: one row in both states, so ready is the same size as downloading', () => {
  const toast = modal.slice(modal.indexOf('export const UpdateCornerToast'));
  const ready = toast.slice(toast.indexOf('{ready ? <>'), toast.indexOf('</> : ('));
  // Ready: no repeated "Ready to restart." title; the row holds the choice.
  assert.doesNotMatch(toast, /Ready to restart\./);
  assert.match(ready, /restartAndInstall/);
  assert.match(ready, /<QuietButton ink=\{ink\} onClick=\{onClose\}>\{t\('Not now'\)\}/);
  assert.match(toast, /\{!ready && \(\s*<motion\.button[\s\S]*?aria-label=\{t\('Close'\)\}/, '"Not now" replaces the × once ready');
  assert.doesNotMatch(toast, /role="progressbar"/, 'the wave is the progress');
});

// ─── State handovers ───────────────────────────────────────────

test('related states hand over in place on the motion-token scale', () => {
  const swap = modal.slice(modal.indexOf('const Swap: React.FC'), modal.indexOf('const CtaButton'));
  // Text swap 150ms / 4px / 2px blur / ease-in-out, both ways; icon swap 250ms, no travel.
  assert.match(swap, /const y = icon \? 0 : 4;/);
  assert.match(swap, /filter: 'blur\(2px\)'/);
  assert.match(swap, /duration: icon \? 0\.25 : 0\.15, ease: 'easeInOut'/);
  // Reduced motion: nothing moves.
  assert.match(swap, /initial=\{reduced \? false :/);
  assert.match(swap, /exit=\{reduced \? \{ opacity: 0, transition: \{ duration: 0 \} \}/);

  // Keyed by state, never by live figures, so bytes and speed don't re-animate each tick.
  const ids = [...modal.matchAll(/<Swap\s+id=\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(ids.length >= 6, `expected the card and toast handovers, found ${ids.length}`);
  for (const id of ids) assert.doesNotMatch(id, /(?<!')\b(progress|downloadProgress|downloadSub|downloadDetail|describeDownload)\b(?!')/, `Swap keyed by a live value: ${id}`);

  // The full card: available / updating / error; inside updating, downloading ⇄ ready.
  assert.match(modal, /id=\{status === 'error' \? 'error' : busy \? 'updating' : 'available'\}/);
  // The corner toast: tile and words swap on ready; the row itself stays put.
  const toast = modal.slice(modal.indexOf('export const UpdateCornerToast'));
  assert.match(toast, /<Swap id=\{ready \? 'done' : 'progress'\} reduced=\{reduced\} icon/);
  assert.match(toast, /<Swap id=\{ready \? 'ready' : 'downloading'\}/);
});
