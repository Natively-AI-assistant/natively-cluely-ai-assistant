/**
 * BrowserExtensionToaster.test.mjs
 *
 * Self-contained source-level behavioral tests for the browser-extension
 * onboarding toaster. This project uses `node --test` for unit tests
 * (no JSX/vitest infrastructure), so we exercise the behavioral surface
 * by:
 *
 *   1. Reading the source as text and asserting the documented contracts
 *      are present (dismiss key, version gate, Chrome Store URL, gating
 *      ID, timer delay, indigo accent, a11y attributes).
 *   2. Pure-logic assertions on the inline `versionGte` comparator
 *      (re-derived from source — boundary correctness matters).
 *
 * The interactive, animated, mounted-in-electron rendering is verified
 * manually in the dev shell (see plan: declarative-gathering-bird.md).
 *
 * Run: `node --test src/components/onboarding/__tests__/BrowserExtensionToaster.test.mjs`
 *      (no build step required)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = resolve(__dirname, '../BrowserExtensionToaster.tsx');
const source = readFileSync(SOURCE_PATH, 'utf8');

// ─── Pure semver comparator — same logic the component uses ─────
function versionGte(a, b) {
  const pa = a.split('.').map(n => parseInt(n, 10));
  const pb = b.split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return true;
}

// ─── Tests ──────────────────────────────────────────────────────
test('versionGte: boundary cases (matches inline comparator in component)', () => {
  assert.equal(versionGte('2.8.0', '2.8.0'), true);
  assert.equal(versionGte('2.8.1', '2.8.0'), true);
  assert.equal(versionGte('2.9.0', '2.8.0'), true);
  assert.equal(versionGte('3.0.0', '2.8.0'), true);
  assert.equal(versionGte('2.7.9', '2.8.0'), false);
  assert.equal(versionGte('2.8.0', '2.7.9'), true);
  assert.equal(versionGte('1.0.0',  '2.8.0'), false);
  assert.equal(versionGte('10.0.0', '2.8.0'), true);
  assert.equal(versionGte('0.0.1',  '0.0.0'), true);
  assert.equal(versionGte('0.0.0',  '0.0.0'), true);
});

test('source: uses documented DISMISS_KEY = natively_ext_connect_dismissed_v1', () => {
  // Constant may have alignment whitespace between name and `=`.
  assert.ok(/const\s+DISMISS_KEY\s*=\s*'natively_ext_connect_dismissed_v1'/.test(source),
    'DISMISS_KEY constant must equal natively_ext_connect_dismissed_v1');
});

test('source: uses documented gating ID = extension_connect', () => {
  assert.ok(/const\s+TOASTER_ID\s*=\s*'extension_connect'/.test(source),
    'TOASTER_ID must equal extension_connect');
  assert.ok(source.includes('isToasterAllowed(TOASTER_ID)'),
    'must call isToasterAllowed(TOASTER_ID)');
  assert.ok(source.includes('markToasterAsShown(TOASTER_ID)'),
    'must call markToasterAsShown(TOASTER_ID)');
});

test('source: gates on app version 2.8.0+ via VITE_APP_VERSION', () => {
  assert.ok(source.includes('VITE_APP_VERSION'),
    'must read VITE_APP_VERSION at module load');
  assert.ok(/const\s+MIN_VERSION\s*=\s*'2\.8\.0'/.test(source),
    'must declare MIN_VERSION = 2.8.0');
  assert.ok(source.includes('versionGte(appVer, MIN_VERSION)'),
    'must call versionGte(appVer, MIN_VERSION)');
});

test('source: 12s startup delay (after trial=10s + support=10s to avoid overlap)', () => {
  assert.ok(source.includes('const STARTUP_DELAY_MS    = 12_000'),
    'STARTUP_DELAY_MS must be 12_000');
});

test('source: opens Chrome Web Store URL via openExternal on CTA click', () => {
  assert.ok(source.includes('CHROME_STORE_URL'),
    'must define CHROME_STORE_URL constant');
  assert.ok(source.includes('chromewebstore.google.com/detail/lmhgnkbjnelmciecjkleaomjpejcgaln'),
    'must reference the canonical Chrome Web Store extension ID');
  assert.ok(source.includes('utm_source=item-share-cb'),
    'must preserve the canonical utm_source tracking param');
  assert.ok(source.includes('window.electronAPI?.openExternal?.(CHROME_STORE_URL)'),
    'CTA must call window.electronAPI.openExternal(CHROME_STORE_URL)');
});

test('source: subscribes to onPhoneMirrorStatus to auto-dismiss on connect', () => {
  assert.ok(source.includes('onPhoneMirrorStatus(info =>'),
    'must subscribe to onPhoneMirrorStatus');
  assert.ok(source.includes("if (info?.extensionConnected)"),
    'must check info.extensionConnected flag');
});

test('source: phoneMirrorGetInfo queried before scheduling the visible timer', () => {
  assert.ok(source.includes('phoneMirrorGetInfo'),
    'must call phoneMirrorGetInfo');
  assert.ok(source.includes("if (!info || info.extensionConnected) return"),
    'must skip if extension is already connected');
});

test('source: indigo accent — distinct from violet trial and coral support', () => {
  assert.ok(source.includes("indigo: '#6366F1'"),
    'must use indigo #6366F1 as the primary accent');
  assert.ok(source.includes('#4F46E5'),
    'must use indigo gradient mid-stop #4F46E5');
  assert.ok(source.includes('#4338CA'),
    'must use indigo gradient deep stop #4338CA');
});

test('source: matches trial/support toaster spring config', () => {
  assert.ok(source.includes('stiffness: 290, damping: 25, mass: 0.82'),
    'must use spring { stiffness: 290, damping: 25, mass: 0.82 } — matches TrialPromoToaster');
});

test('source: copy strings are present and human-friendly', () => {
  assert.ok(source.includes('Faster answers. Fewer tokens.'),
    'headline copy conveys speed + cost benefits');
  assert.ok(source.includes('no screenshots, no copy-paste'),
    'body copy mentions screenshot avoidance');
  assert.ok(source.includes('~3× faster'),
    'benefit chip 1: ~3× faster responses');
  assert.ok(source.includes('−90% tokens'),
    'benefit chip 2: −90% tokens per turn');
  assert.ok(source.includes('Auto-detect'),
    'benefit chip 3: Auto-detect coding pages');
  assert.ok(source.includes('Install on Chrome'),
    'primary CTA label');
  assert.ok(source.includes("I don't want to"),
    'secondary dismiss label');
  assert.ok(source.includes('Browser Extension'),
    'eyebrow label');
});

test('source: NO generic Puzzle icon in the toaster (replaced by custom BrowserExtensionIcon)', () => {
  // The toaster used to import <Puzzle /> from lucide-react for both the
  // eyebrow row and the hero. Now uses the shared BrowserExtensionIcon
  // (browser-frame SVG) in both places. Verify no Puzzle import remains.
  assert.ok(!/import\s*\{[^}]*\bPuzzle\b[^}]*\}\s*from\s*'lucide-react'/.test(source),
    'toaster must NOT import Puzzle from lucide-react anymore');
  assert.ok(source.includes("from './BrowserExtensionIcon'"),
    'toaster must import the shared BrowserExtensionIcon');
});

test('source: respects prefers-reduced-motion via useReducedMotion()', () => {
  assert.ok(source.includes('useReducedMotion()'),
    'must call useReducedMotion to gate motion');
});

test('source: aria attributes for accessibility (dialog, labelled-by, labels)', () => {
  assert.ok(source.includes('role="dialog"'),
    'must set role=dialog on the card');
  assert.ok(source.includes('aria-modal="true"'),
    'must set aria-modal=true');
  assert.ok(source.includes('aria-labelledby="ext-toast-title"'),
    'must reference labelled-by for the headline');
  assert.ok(source.includes('id="ext-toast-title"'),
    'must set id on the headline for labelled-by');
  assert.ok(source.includes('aria-label="Install Natively browser extension on Chrome"'),
    'CTA must have descriptive aria-label');
  assert.ok(source.includes('aria-label="Dismiss browser extension invitation"'),
    'dismiss must have descriptive aria-label');
});

test('source: Escape key triggers permanent dismiss', () => {
  assert.ok(source.includes("e.key === 'Escape'"),
    'must handle Escape key');
  assert.ok(source.includes('handlePermanentDismiss'),
    'Escape must call handlePermanentDismiss');
});

test('source: backdrop click triggers permanent dismiss', () => {
  assert.ok(source.includes("onClick={e => { if (e.target === e.currentTarget) handlePermanentDismiss(); }}"),
    'backdrop click must call handlePermanentDismiss');
});

test('source: all electronAPI access is optional-chained (safe under missing preload)', () => {
  // Strip lines that already guard the call (i.e. lines with `?.electronAPI`
  // or that appear inside an `if (window.electronAPI?....)` block — we
  // simply check that NO direct, un-chained `window.electronAPI.X(...)`
  // call exists at top-level scope).
  // We do a per-line check: any line that mentions `window.electronAPI`
  // must use `?.` somewhere on that line.
  const offendingLines = source.split('\n').filter(line => {
    if (!line.includes('window.electronAPI')) return false;
    return !line.includes('window.electronAPI?');
  });
  assert.equal(offendingLines.length, 0,
    `All electronAPI access must be optional-chained; offending lines:\n  ${offendingLines.join('\n  ')}`);
});

test('source: renders nothing until visible timer fires (gate via isToasterAllowed)', () => {
  assert.ok(source.includes("if (!isToasterAllowed(TOASTER_ID)) return"),
    'must return early if isToasterAllowed returns false');
  assert.ok(source.includes('if (localStorage.getItem(DISMISS_KEY))'),
    'must check DISMISS_KEY before scheduling');
});

test('source: ?extToaster=force URL param bypasses all gating (test hook)', () => {
  assert.ok(source.includes("params.get('extToaster')"),
    'must check URL search param `extToaster`');
  assert.ok(source.includes("params.get('extToaster') === 'force'"),
    'must equal `force` to trigger bypass');
  assert.ok(source.includes('setVisible(true)'),
    'must set visible=true when force flag is set');
  // Force hook MUST clear all gating state so the bypass is bulletproof:
  assert.ok(source.includes("localStorage.removeItem(DISMISS_KEY)"),
    'must clear the permanent-dismiss localStorage flag');
  assert.ok(source.includes("localStorage.removeItem('last_shown_time_extension_connect')"),
    'must clear the cooldown time stamp');
  assert.ok(source.includes("localStorage.removeItem('last_shown_opens_extension_connect')"),
    'must clear the cooldown opens counter');
  assert.ok(source.includes("sessionStorage.removeItem('natively_session_toaster_shown')"),
    'must clear the one-toaster-per-session flag');
});

test('source: imports the shared BrowserExtensionIcon (used in both toaster and settings)', () => {
  assert.ok(source.includes("from './BrowserExtensionIcon'"),
    'toaster must import shared BrowserExtensionIcon component');
});
