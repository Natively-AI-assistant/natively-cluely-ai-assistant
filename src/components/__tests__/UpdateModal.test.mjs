/**
 * UpdateModal.test.mjs
 *
 * Source-level tests for the update card and its corner toast. Like the other
 * card tests, the project has no JSX renderer under `node --test`, so the
 * component is read as text and its contracts asserted directly:
 *
 *   1. Platform branches: the macOS quarantine (xattr) help only on macOS,
 *      the .exe instructions only on Windows.
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

test('xattr quarantine help is macOS-only, in both the download and manual-install views', () => {
  assert.match(modal, /\{isMac && !ready && \(/, 'download-time "App is damaged" help must be gated on isMac');
  const instructions = modal.slice(modal.indexOf("status === 'instructions'"), modal.indexOf('} else if (busy)'));
  const macBranch = instructions.slice(instructions.indexOf('{isMac ? ('), instructions.indexOf(') : ('));
  const winBranch = instructions.slice(instructions.indexOf(') : ('));
  assert.ok(macBranch.includes('xattr -cr'), 'macOS branch carries the xattr steps');
  assert.ok(!winBranch.includes('xattr'), 'Windows branch must not mention xattr');
  assert.ok(winBranch.includes('.exe'), 'Windows branch explains the installer');
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
